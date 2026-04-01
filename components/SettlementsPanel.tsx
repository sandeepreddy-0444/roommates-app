"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "@/app/lib/firebase";

type Expense = {
  id: string;
  title: string;
  amount: number;
  splitMap?: Record<string, number>;
  participants?: string[];
  paidByUid?: string;
  createdByUid?: string;
  settled?: boolean;
};

type UserMap = Record<string, string>;

type Suggestion = {
  from: string;
  to: string;
  amount: number;
};

export default function SettlementsPanel() {
  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [users, setUsers] = useState<UserMap>({});
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setLoading(false);
        return;
      }

      setUid(u.uid);

      const userSnap = await getDoc(doc(db, "users", u.uid));
      const userData = userSnap.exists() ? (userSnap.data() as any) : {};
      const gid = userData?.groupId || null;
      setGroupId(gid);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!groupId) return;

    const unsub = onSnapshot(
      collection(db, "groups", groupId, "members"),
      async (snap) => {
        const next: UserMap = {};
        await Promise.all(
          snap.docs.map(async (memberDoc) => {
            const userSnap = await getDoc(doc(db, "users", memberDoc.id));
            const data = userSnap.exists() ? (userSnap.data() as any) : {};
            next[memberDoc.id] = data?.name || memberDoc.id.slice(0, 6);
          })
        );
        setUsers(next);
      }
    );

    return () => unsub();
  }, [groupId]);

  useEffect(() => {
    if (!groupId) return;

    const q = query(
      collection(db, "groups", groupId, "expenses"),
      orderBy("createdAt", "desc"),
      limit(500)
    );

    const unsub = onSnapshot(q, (snap) => {
      const rows: Expense[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          title: data?.title || "Untitled",
          amount: Number(data?.amount || 0),
          splitMap: data?.splitMap || {},
          participants: Array.isArray(data?.participants) ? data.participants : [],
          paidByUid: data?.paidByUid || data?.createdByUid || null,
          createdByUid: data?.createdByUid || null,
          settled: !!data?.settled,
        };
      });
      setExpenses(rows);
    });

    return () => unsub();
  }, [groupId]);

  const balances = useMemo(() => {
    const map: Record<string, number> = {};

    for (const exp of expenses) {
      if (exp.settled) continue;

      const payer = exp.paidByUid || exp.createdByUid;
      if (!payer) continue;

      map[payer] = (map[payer] || 0) + Number(exp.amount || 0);

      const splitMap = exp.splitMap || {};
      for (const [personUid, owed] of Object.entries(splitMap)) {
        map[personUid] = (map[personUid] || 0) - Number(owed || 0);
      }
    }

    return map;
  }, [expenses]);

  const suggestions = useMemo(() => simplifyDebts(balances), [balances]);

  const unsettledExpenses = useMemo(
    () => expenses.filter((e) => !e.settled),
    [expenses]
  );

  const totalUnsettledAmount = useMemo(
    () =>
      unsettledExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0),
    [unsettledExpenses]
  );

  const peopleCount = Object.keys(users).length;

  async function markExpenseSettled(expenseId: string) {
    if (!groupId) return;
    setSavingId(expenseId);
    try {
      await updateDoc(doc(db, "groups", groupId, "expenses", expenseId), {
        settled: true,
        settledAt: serverTimestamp(),
      });
    } finally {
      setSavingId(null);
    }
  }

  async function saveSuggestion(s: Suggestion) {
    if (!groupId || !uid) return;
    setSavingId(`${s.from}-${s.to}-${s.amount}`);

    try {
      await addDoc(collection(db, "groups", groupId, "settlements"), {
        fromUid: s.from,
        toUid: s.to,
        amount: round2(s.amount),
        createdAt: serverTimestamp(),
        createdBy: uid,
        status: "pending",
      });

      await addDoc(collection(db, "groups", groupId, "notifications"), {
        type: "settlement",
        title: "Settlement suggestion created",
        body: `${users[s.from] || "Someone"} should pay $${round2(s.amount).toFixed(
          2
        )} to ${users[s.to] || "someone"}`,
        createdAt: serverTimestamp(),
        createdBy: uid,
        readBy: [],
      });

      alert("Settlement suggestion saved ✅");
    } finally {
      setSavingId(null);
    }
  }

  function getExpenseDetails(exp: Expense) {
    const payer = exp.paidByUid || exp.createdByUid || null;
    const splitMap = exp.splitMap || {};
    const people =
      exp.participants && exp.participants.length > 0
        ? exp.participants
        : Object.keys(splitMap);

    const perPerson = people.length > 0 ? round2(exp.amount / people.length) : 0;
    const myShare = uid ? Number(splitMap[uid] || 0) : 0;
    const myPaid = uid && payer === uid ? Number(exp.amount || 0) : 0;
    const myNet = round2(myPaid - myShare);

    return {
      payer,
      perPerson,
      myShare,
      myPaid,
      myNet,
      people,
    };
  }

  if (loading) {
    return (
      <div style={shellStyle}>
        <div style={heroCardStyle}>
          <div style={heroGlowStyle} />
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={eyebrowStyle}>Settlements</div>
            <h2 style={titleStyle}>Loading settlements...</h2>
            <p style={subtitleStyle}>Preparing your room balance overview.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!groupId) {
    return (
      <div style={shellStyle}>
        <div style={emptyStateStyle}>
          <div style={emptyIconStyle}>🏠</div>
          <h2 style={emptyTitleStyle}>You are not in a room yet</h2>
          <p style={emptyTextStyle}>
            Join or create a room to view balances, settlement plans, and shared
            expense activity.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={shellStyle}>
      <div style={heroCardStyle}>
        <div style={heroGlowStyle} />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={eyebrowStyle}>Smart Settlements</div>
          <div style={heroHeaderRowStyle}>
            <div>
              <h2 style={titleStyle}>Balance the room faster</h2>
              <p style={subtitleStyle}>
                See who is owed, who owes, and the simplest plan to settle
                everything with fewer transactions.
              </p>
            </div>
          </div>

          <div style={statsGridStyle}>
            <div style={statCardStyle}>
              <div style={statLabelStyle}>Unsettled Expenses</div>
              <div style={statValueStyle}>{unsettledExpenses.length}</div>
            </div>

            <div style={statCardStyle}>
              <div style={statLabelStyle}>Pending Value</div>
              <div style={statValueStyle}>
                ${round2(totalUnsettledAmount).toFixed(2)}
              </div>
            </div>

            <div style={statCardStyle}>
              <div style={statLabelStyle}>Roommates</div>
              <div style={statValueStyle}>{peopleCount}</div>
            </div>

            <div style={statCardStyle}>
              <div style={statLabelStyle}>Best Plan Steps</div>
              <div style={statValueStyle}>{suggestions.length}</div>
            </div>
          </div>
        </div>
      </div>

      <div style={sectionCardStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <div style={sectionEyebrowStyle}>Overview</div>
            <h3 style={sectionTitleStyle}>Current balances</h3>
            <p style={sectionTextStyle}>
              These balances reflect all unsettled shared expenses in the room.
            </p>
          </div>
        </div>

        {Object.keys(users).length === 0 ? (
          <div style={emptyInnerCardStyle}>No roommates found.</div>
        ) : (
          <div style={balanceGridStyle}>
            {Object.entries(users).map(([personUid, name]) => {
              const value = balances[personUid] || 0;
              const positive = value >= 0;

              return (
                <div key={personUid} style={balanceCardStyle}>
                  <div style={balanceTopRowStyle}>
                    <div>
                      <div style={balanceNameStyle}>
                        {name}
                        {uid === personUid ? " (You)" : ""}
                      </div>
                      <div style={balanceHelperStyle}>
                        {positive ? "Should receive" : "Needs to pay"}
                      </div>
                    </div>

                    <div
                      style={{
                        ...pillStyle,
                        ...(positive ? positivePillStyle : negativePillStyle),
                      }}
                    >
                      {positive ? "Credit" : "Debit"}
                    </div>
                  </div>

                  <div
                    style={{
                      ...balanceValueStyle,
                      color: positive ? "#8ef7b7" : "#ff9a9a",
                    }}
                  >
                    {value >= 0 ? "+" : "-"}$
                    {Math.abs(round2(value)).toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={sectionCardStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <div style={sectionEyebrowStyle}>Optimization</div>
            <h3 style={sectionTitleStyle}>Best settlement plan</h3>
            <p style={sectionTextStyle}>
              We simplify debt paths so the room can settle with fewer payments.
            </p>
          </div>
        </div>

        {suggestions.length === 0 ? (
          <div style={emptyInnerCardStyle}>Everything is already balanced 🎉</div>
        ) : (
          <div style={suggestionsGridStyle}>
            {suggestions.map((s, index) => {
              const id = `${s.from}-${s.to}-${s.amount}`;

              return (
                <div key={index} style={suggestionCardStyle}>
                  <div style={suggestionLeftStyle}>
                    <div style={suggestionLabelStyle}>Suggested payment</div>
                    <div style={suggestionTitleStyle}>
                      <strong>{users[s.from] || "Someone"}</strong>
                      <span style={arrowStyle}>→</span>
                      <strong>{users[s.to] || "Someone"}</strong>
                    </div>
                    <div style={suggestionSubtextStyle}>
                      Settle this balance in one payment.
                    </div>
                  </div>

                  <div style={suggestionRightStyle}>
                    <div style={suggestionAmountStyle}>
                      ${round2(s.amount).toFixed(2)}
                    </div>
                    <button
                      onClick={() => saveSuggestion(s)}
                      disabled={savingId === id}
                      style={{
                        ...primaryButtonStyle,
                        minWidth: 160,
                        ...(savingId === id ? disabledButtonStyle : {}),
                      }}
                    >
                      {savingId === id ? "Saving..." : "Save Suggestion"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={sectionCardStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <div style={sectionEyebrowStyle}>Expenses</div>
            <h3 style={sectionTitleStyle}>Unsettled expenses</h3>
            <p style={sectionTextStyle}>
              Review expense splits and close items once everyone is settled.
            </p>
          </div>
        </div>

        {unsettledExpenses.length === 0 ? (
          <div style={emptyInnerCardStyle}>No unsettled expenses.</div>
        ) : (
          <div style={expensesListStyle}>
            {unsettledExpenses.map((e) => {
              const details = getExpenseDetails(e);

              return (
                <div key={e.id} style={expenseCardStyle}>
                  <div style={expenseHeaderStyle}>
                    <div style={expenseMainStyle}>
                      <div style={expenseTitleStyle}>{e.title}</div>

                      <div style={expenseMetaWrapStyle}>
                        <div style={metaChipStyle}>
                          Total: ${Number(e.amount || 0).toFixed(2)}
                        </div>
                        <div style={metaChipStyle}>
                          Each share: ${details.perPerson.toFixed(2)}
                        </div>
                        <div style={metaChipStyle}>
                          Paid by: {users[details.payer || ""] || "Unknown"}
                          {details.payer === uid ? " (You)" : ""}
                        </div>
                      </div>

                      {uid && (
                        <div
                          style={{
                            ...myNetBadgeStyle,
                            ...(details.myNet > 0
                              ? positiveNetStyle
                              : details.myNet < 0
                              ? negativeNetStyle
                              : neutralNetStyle),
                          }}
                        >
                          {details.myNet > 0
                            ? `You should receive $${details.myNet.toFixed(2)}`
                            : details.myNet < 0
                            ? `You owe $${Math.abs(details.myNet).toFixed(2)}`
                            : "You are settled for this expense"}
                        </div>
                      )}
                    </div>

                    <div style={expenseActionWrapStyle}>
                      <button
                        onClick={() => markExpenseSettled(e.id)}
                        disabled={savingId === e.id}
                        style={{
                          ...primaryButtonStyle,
                          ...(savingId === e.id ? disabledButtonStyle : {}),
                        }}
                      >
                        {savingId === e.id ? "Saving..." : "Mark Settled"}
                      </button>
                    </div>
                  </div>

                  <div style={splitPanelStyle}>
                    <div style={splitPanelHeaderStyle}>
                      <div style={splitPanelTitleStyle}>Split details</div>
                      <div style={splitPanelHintStyle}>
                        Individual share breakdown
                      </div>
                    </div>

                    <div style={splitGridStyle}>
                      {Object.entries(e.splitMap || {}).map(([personUid, owed]) => (
                        <div key={personUid} style={splitRowStyle}>
                          <div style={splitNameStyle}>
                            {users[personUid] || "Someone"}
                            {personUid === uid ? " (You)" : ""}
                          </div>
                          <div style={splitAmountStyle}>
                            ${round2(Number(owed || 0)).toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function simplifyDebts(balances: Record<string, number>) {
  const debtors: { uid: string; amount: number }[] = [];
  const creditors: { uid: string; amount: number }[] = [];

  for (const [uid, value] of Object.entries(balances)) {
    const rounded = round2(value);
    if (rounded > 0.009) creditors.push({ uid, amount: rounded });
    else if (rounded < -0.009) debtors.push({ uid, amount: Math.abs(rounded) });
  }

  const out: Suggestion[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    if (pay > 0.009) {
      out.push({
        from: debtors[i].uid,
        to: creditors[j].uid,
        amount: round2(pay),
      });
    }

    debtors[i].amount = round2(debtors[i].amount - pay);
    creditors[j].amount = round2(creditors[j].amount - pay);

    if (debtors[i].amount <= 0.009) i++;
    if (creditors[j].amount <= 0.009) j++;
  }

  return out;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const shellStyle: React.CSSProperties = {
  display: "grid",
  gap: 18,
};

const heroCardStyle: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  borderRadius: 28,
  padding: 24,
  border: "1px solid rgba(255,255,255,0.09)",
  background:
    "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(139,92,246,0.16), rgba(15,23,42,0.95))",
  boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
  backdropFilter: "blur(18px)",
};

const heroGlowStyle: React.CSSProperties = {
  position: "absolute",
  inset: -80,
  background:
    "radial-gradient(circle at top left, rgba(96,165,250,0.22), transparent 32%), radial-gradient(circle at bottom right, rgba(168,85,247,0.18), transparent 30%)",
  pointerEvents: "none",
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.18em",
  color: "rgba(191,219,254,0.9)",
  fontWeight: 700,
  marginBottom: 10,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "clamp(1.6rem, 2vw, 2.2rem)",
  fontWeight: 800,
  color: "#f8fafc",
};

const subtitleStyle: React.CSSProperties = {
  margin: "8px 0 0",
  maxWidth: 760,
  lineHeight: 1.6,
  color: "rgba(226,232,240,0.8)",
  fontSize: 14,
};

const heroHeaderRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
};

const statsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 14,
  marginTop: 20,
};

const statCardStyle: React.CSSProperties = {
  borderRadius: 20,
  padding: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(8,15,30,0.55)",
  backdropFilter: "blur(12px)",
};

const statLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(191,219,254,0.78)",
  marginBottom: 8,
};

const statValueStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 800,
  color: "#ffffff",
};

const sectionCardStyle: React.CSSProperties = {
  borderRadius: 24,
  padding: 20,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(10,14,24,0.82)",
  boxShadow: "0 18px 40px rgba(0,0,0,0.28)",
  backdropFilter: "blur(18px)",
};

const sectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
  marginBottom: 16,
};

const sectionEyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.16em",
  color: "#93c5fd",
  fontWeight: 700,
  marginBottom: 8,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#f8fafc",
  fontSize: 20,
  fontWeight: 800,
};

const sectionTextStyle: React.CSSProperties = {
  margin: "8px 0 0",
  color: "rgba(203,213,225,0.72)",
  fontSize: 14,
  lineHeight: 1.6,
};

const balanceGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 14,
};

const balanceCardStyle: React.CSSProperties = {
  borderRadius: 22,
  padding: 20,
  border: "1px solid rgba(255,255,255,0.08)",
  background:
    "linear-gradient(180deg, rgba(15,23,42,0.92), rgba(2,6,23,0.98))",
  display: "grid",
  gap: 18,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
};

const balanceTopRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
};

const balanceNameStyle: React.CSSProperties = {
  color: "#f8fafc",
  fontWeight: 700,
  fontSize: 16,
};

const balanceHelperStyle: React.CSSProperties = {
  marginTop: 6,
  color: "rgba(148,163,184,0.8)",
  fontSize: 12,
};

const balanceValueStyle: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 900,
  letterSpacing: "-0.03em",
  lineHeight: 1,
};

const pillStyle: React.CSSProperties = {
  borderRadius: 999,
  padding: "6px 10px",
  fontSize: 11,
  fontWeight: 700,
  border: "1px solid rgba(255,255,255,0.08)",
};

const positivePillStyle: React.CSSProperties = {
  background: "rgba(34,197,94,0.12)",
  color: "#86efac",
};

const negativePillStyle: React.CSSProperties = {
  background: "rgba(239,68,68,0.12)",
  color: "#fca5a5",
};

const suggestionsGridStyle: React.CSSProperties = {
  display: "grid",
  gap: 16,
};

const suggestionCardStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 18,
  flexWrap: "wrap",
  borderRadius: 22,
  padding: 18,
  border: "1px solid rgba(255,255,255,0.08)",
  background:
    "linear-gradient(180deg, rgba(17,24,39,0.9), rgba(2,6,23,0.96))",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
};

const suggestionLeftStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  flex: "1 1 280px",
};

const suggestionRightStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
  justifyItems: "end",
  flex: "0 0 auto",
};

const suggestionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  color: "#93c5fd",
  fontWeight: 700,
};

const suggestionTitleStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  color: "#f8fafc",
  fontSize: 17,
  fontWeight: 700,
};

const arrowStyle: React.CSSProperties = {
  color: "rgba(148,163,184,0.9)",
  fontWeight: 700,
};

const suggestionSubtextStyle: React.CSSProperties = {
  color: "rgba(203,213,225,0.68)",
  fontSize: 13,
};

const suggestionAmountStyle: React.CSSProperties = {
  fontSize: 34,
  fontWeight: 900,
  color: "#ffffff",
  lineHeight: 1,
  letterSpacing: "-0.03em",
};

const primaryButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 14,
  padding: "12px 16px",
  background:
    "linear-gradient(135deg, rgba(59,130,246,0.95), rgba(139,92,246,0.92))",
  color: "#ffffff",
  fontWeight: 800,
  cursor: "pointer",
  boxShadow: "0 12px 30px rgba(59,130,246,0.22)",
};

const disabledButtonStyle: React.CSSProperties = {
  opacity: 0.65,
  cursor: "not-allowed",
};

const expensesListStyle: React.CSSProperties = {
  display: "grid",
  gap: 18,
};

const expenseCardStyle: React.CSSProperties = {
  borderRadius: 24,
  padding: 20,
  border: "1px solid rgba(255,255,255,0.08)",
  background:
    "linear-gradient(180deg, rgba(15,23,42,0.86), rgba(2,6,23,0.98))",
  display: "grid",
  gap: 18,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
};

const expenseHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  flexWrap: "wrap",
};

const expenseMainStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
  flex: "1 1 380px",
};

const expenseActionWrapStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "flex-end",
};

const expenseTitleStyle: React.CSSProperties = {
  fontSize: 19,
  fontWeight: 800,
  color: "#f8fafc",
};

const expenseMetaWrapStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const metaChipStyle: React.CSSProperties = {
  borderRadius: 999,
  padding: "8px 12px",
  fontSize: 12,
  color: "#cbd5e1",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.06)",
};

const myNetBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  width: "fit-content",
  borderRadius: 999,
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 700,
  marginTop: 2,
  border: "1px solid rgba(255,255,255,0.08)",
};

const positiveNetStyle: React.CSSProperties = {
  background: "rgba(34,197,94,0.12)",
  color: "#86efac",
};

const negativeNetStyle: React.CSSProperties = {
  background: "rgba(239,68,68,0.12)",
  color: "#fca5a5",
};

const neutralNetStyle: React.CSSProperties = {
  background: "rgba(148,163,184,0.12)",
  color: "#cbd5e1",
};

const splitPanelStyle: React.CSSProperties = {
  borderRadius: 18,
  padding: 16,
  border: "1px solid rgba(255,255,255,0.07)",
  background: "rgba(255,255,255,0.04)",
  display: "grid",
  gap: 12,
};

const splitPanelHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap",
};

const splitPanelTitleStyle: React.CSSProperties = {
  color: "#e2e8f0",
  fontWeight: 800,
  fontSize: 14,
};

const splitPanelHintStyle: React.CSSProperties = {
  color: "rgba(148,163,184,0.78)",
  fontSize: 12,
};

const splitGridStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
};

const splitRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  padding: "12px 14px",
  borderRadius: 14,
  background: "rgba(2,6,23,0.62)",
  border: "1px solid rgba(255,255,255,0.05)",
};

const splitNameStyle: React.CSSProperties = {
  color: "#dbeafe",
  fontSize: 14,
};

const splitAmountStyle: React.CSSProperties = {
  color: "#ffffff",
  fontWeight: 700,
};

const emptyStateStyle: React.CSSProperties = {
  borderRadius: 28,
  padding: 28,
  border: "1px solid rgba(255,255,255,0.08)",
  background:
    "linear-gradient(180deg, rgba(15,23,42,0.82), rgba(2,6,23,0.96))",
  textAlign: "center",
};

const emptyIconStyle: React.CSSProperties = {
  fontSize: 34,
  marginBottom: 12,
};

const emptyTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#f8fafc",
  fontSize: 22,
  fontWeight: 800,
};

const emptyTextStyle: React.CSSProperties = {
  margin: "10px auto 0",
  maxWidth: 520,
  color: "rgba(203,213,225,0.72)",
  lineHeight: 1.6,
};

const emptyInnerCardStyle: React.CSSProperties = {
  borderRadius: 18,
  padding: 18,
  border: "1px solid rgba(255,255,255,0.07)",
  background: "rgba(255,255,255,0.03)",
  color: "rgba(203,213,225,0.78)",
};