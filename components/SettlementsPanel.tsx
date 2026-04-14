"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
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
  visibleTo?: string[];
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

const EXPENSE_LIMIT = 200;

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

export default function SettlementsPanel() {
  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [users, setUsers] = useState<UserMap>({});
  const [allExpenses, setAllExpenses] = useState<Expense[]>([]);
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

      if (gid) {
        const groupSnap = await getDoc(doc(db, "groups", gid));
        const groupData = groupSnap.exists() ? (groupSnap.data() as any) : {};
        setIsAdmin(groupData?.createdBy === u.uid);
      } else {
        setIsAdmin(false);
      }

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
      limit(EXPENSE_LIMIT)
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
          visibleTo: Array.isArray(data?.visibleTo) ? data.visibleTo : [],
          paidByUid: data?.paidByUid || data?.createdByUid || null,
          createdByUid: data?.createdByUid || null,
          settled: !!data?.settled,
        };
      });

      setAllExpenses(rows);
    });

    return () => unsub();
  }, [groupId]);

  function canViewExpense(exp: Expense) {
    if (!uid) return false;

    const payer = exp.paidByUid || exp.createdByUid || null;
    const visibleTo =
      Array.isArray(exp.visibleTo) && exp.visibleTo.length > 0
        ? exp.visibleTo
        : uniqueIds([
            ...(Array.isArray(exp.participants) ? exp.participants : []),
            payer || "",
          ]);

    return visibleTo.includes(uid);
  }

  const expenses = useMemo(
    () => allExpenses.filter(canViewExpense),
    [allExpenses, uid]
  );

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
    () => unsettledExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0),
    [unsettledExpenses]
  );

  const peopleCount = useMemo(() => {
    const ids = new Set<string>();
    for (const exp of unsettledExpenses) {
      (exp.participants || []).forEach((id) => ids.add(id));
      const payer = exp.paidByUid || exp.createdByUid;
      if (payer) ids.add(payer);
    }
    return ids.size;
  }, [unsettledExpenses]);

  async function markExpenseSettled(expenseId: string) {
    if (!groupId) return;

    const ok = confirm("Are you sure you want to mark this expense as settled?");
    if (!ok) return;

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
      myNet,
    };
  }

  if (loading) {
    return <div style={loadingStyle}>Loading settlements...</div>;
  }

  if (!groupId) {
    return (
      <div style={emptyWrapStyle}>
        <div style={emptyTitleStyle}>You are not in a room yet</div>
        <div style={emptyTextStyle}>
          Join or create a room to view balances and settlements.
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <section style={sectionStyle}>
        <div style={sectionEyebrowStyle}>Smart Settlements</div>
        <div style={sectionTitleStyle}>Visible summary</div>

        <div style={statsGridStyle}>
          <div style={statCardStyle}>
            <div style={statLabelStyle}>Unsettled</div>
            <div style={statValueStyle}>{unsettledExpenses.length}</div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>Pending</div>
            <div style={statValueStyle}>
              ${round2(totalUnsettledAmount).toFixed(2)}
            </div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>Members</div>
            <div style={statValueStyle}>{peopleCount}</div>
          </div>

          <div style={statCardStyle}>
            <div style={statLabelStyle}>Best steps</div>
            <div style={statValueStyle}>{suggestions.length}</div>
          </div>
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionEyebrowStyle}>Overview</div>
        <div style={sectionTitleStyle}>Current balances</div>

        {Object.keys(balances).length === 0 ? (
          <div style={emptyMiniStyle}>No visible balances right now.</div>
        ) : (
          <div style={cardsGridStyle}>
            {Object.entries(balances).map(([personUid, value]) => {
              const positive = value >= 0;
              const name = users[personUid] || "Someone";

              return (
                <div key={personUid} style={balanceCardStyle}>
                  <div style={balanceTopStyle}>
                    <div style={{ minWidth: 0 }}>
                      <div style={balanceNameStyle}>
                        {name}
                        {uid === personUid ? " (You)" : ""}
                      </div>
                      <div style={balanceSubStyle}>
                        {positive ? "Should receive" : "Needs to pay"}
                      </div>
                    </div>

                    <div
                      style={{
                        ...pillStyle,
                        ...(positive ? creditPillStyle : debitPillStyle),
                      }}
                    >
                      {positive ? "Credit" : "Debit"}
                    </div>
                  </div>

                  <div
                    style={{
                      ...balanceValueStyle,
                      color: positive ? "#86efac" : "#fca5a5",
                    }}
                  >
                    {value >= 0 ? "+" : "-"}${Math.abs(round2(value)).toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section style={sectionStyle}>
        <div style={sectionEyebrowStyle}>Best plan</div>
        <div style={sectionTitleStyle}>Who should pay whom</div>

        {suggestions.length === 0 ? (
          <div style={emptyMiniStyle}>Everything visible to you is balanced 🎉</div>
        ) : (
          <div style={cardsListStyle}>
            {suggestions.map((s, index) => (
              <div
                key={`${s.from}-${s.to}-${s.amount}-${index}`}
                style={simpleCardStyle}
              >
                <div style={settlementLineStyle}>
                  <strong>{users[s.from] || "Someone"}</strong>
                  <span style={{ opacity: 0.65 }}>→</span>
                  <strong>{users[s.to] || "Someone"}</strong>
                </div>

                <div style={settlementAmountStyle}>
                  ${round2(s.amount).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={sectionStyle}>
        <div style={sectionEyebrowStyle}>Expenses</div>
        <div style={sectionTitleStyle}>Unsettled expenses</div>

        {unsettledExpenses.length === 0 ? (
          <div style={emptyMiniStyle}>No visible unsettled expenses.</div>
        ) : (
          <div style={cardsListStyle}>
            {unsettledExpenses.map((e) => {
              const details = getExpenseDetails(e);
              const canSettle =
                !!uid && (details.payer === uid || isAdmin);

              return (
                <div key={e.id} style={simpleCardStyle}>
                  <div style={expenseTitleStyle}>{e.title}</div>

                  <div style={chipRowStyle}>
                    <div style={chipStyle}>
                      Total: ${Number(e.amount || 0).toFixed(2)}
                    </div>
                    <div style={chipStyle}>Each: ${details.perPerson.toFixed(2)}</div>
                    <div style={chipStyle}>
                      Paid by: {users[details.payer || ""] || "Unknown"}
                      {details.payer === uid ? " (You)" : ""}
                    </div>
                  </div>

                  {uid ? (
                    <div
                      style={{
                        ...statusStyle,
                        ...(details.myNet > 0
                          ? receiveStyle
                          : details.myNet < 0
                          ? oweStyle
                          : settledStyle),
                      }}
                    >
                      {details.myNet > 0
                        ? `You should receive $${details.myNet.toFixed(2)}`
                        : details.myNet < 0
                        ? `You owe $${Math.abs(details.myNet).toFixed(2)}`
                        : "You are settled"}
                    </div>
                  ) : null}

                  {canSettle ? (
                    <button
                      type="button"
                      onClick={() => markExpenseSettled(e.id)}
                      disabled={savingId === e.id}
                      style={buttonStyle}
                    >
                      {savingId === e.id ? "Saving..." : "Mark Settled"}
                    </button>
                  ) : (
                    <div style={infoTextStyle}>
                      Only the payer or admin can mark this as settled.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
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

const pageStyle: CSSProperties = {
  display: "grid",
  gap: 16,
  color: "white",
};

const sectionStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 22,
  padding: 18,
  background:
    "linear-gradient(180deg, rgba(8,13,28,0.88) 0%, rgba(10,16,34,0.82) 100%)",
  boxShadow: "0 18px 38px rgba(0,0,0,0.18)",
  display: "grid",
  gap: 14,
};

const sectionEyebrowStyle: CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 2,
  color: "#7dd3fc",
  fontWeight: 800,
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  lineHeight: 1.2,
};

const statsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
};

const statCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 14,
  background: "rgba(255,255,255,0.03)",
};

const statLabelStyle: CSSProperties = {
  fontSize: 11,
  color: "rgba(255,255,255,0.66)",
  marginBottom: 8,
  textTransform: "uppercase",
  letterSpacing: 0.6,
};

const statValueStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  lineHeight: 1.15,
};

const cardsGridStyle: CSSProperties = {
  display: "grid",
  gap: 12,
};

const balanceCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 18,
  padding: 16,
  background: "rgba(255,255,255,0.03)",
};

const balanceTopStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
};

const balanceNameStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  lineHeight: 1.25,
  wordBreak: "break-word",
};

const balanceSubStyle: CSSProperties = {
  marginTop: 6,
  fontSize: 13,
  color: "rgba(255,255,255,0.66)",
};

const balanceValueStyle: CSSProperties = {
  marginTop: 14,
  fontSize: 18,
  fontWeight: 800,
  lineHeight: 1.15,
};

const pillStyle: CSSProperties = {
  borderRadius: 999,
  padding: "7px 12px",
  fontSize: 12,
  fontWeight: 800,
  border: "1px solid",
  flexShrink: 0,
};

const creditPillStyle: CSSProperties = {
  background: "rgba(22,163,74,0.12)",
  color: "#86efac",
  borderColor: "rgba(34,197,94,0.28)",
};

const debitPillStyle: CSSProperties = {
  background: "rgba(239,68,68,0.12)",
  color: "#fca5a5",
  borderColor: "rgba(239,68,68,0.28)",
};

const cardsListStyle: CSSProperties = {
  display: "grid",
  gap: 12,
};

const simpleCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 18,
  padding: 16,
  background: "rgba(255,255,255,0.03)",
  display: "grid",
  gap: 12,
};

const settlementLineStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  fontSize: 16,
  lineHeight: 1.3,
};

const settlementAmountStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  lineHeight: 1.15,
};

const expenseTitleStyle: CSSProperties = {
  fontSize: 17,
  fontWeight: 800,
  lineHeight: 1.25,
};

const chipRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const chipStyle: CSSProperties = {
  borderRadius: 999,
  padding: "8px 12px",
  fontSize: 13,
  color: "rgba(255,255,255,0.82)",
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.04)",
};

const statusStyle: CSSProperties = {
  borderRadius: 14,
  padding: "10px 12px",
  fontWeight: 700,
  fontSize: 14,
};

const receiveStyle: CSSProperties = {
  background: "rgba(22,163,74,0.12)",
  color: "#86efac",
  border: "1px solid rgba(34,197,94,0.24)",
};

const oweStyle: CSSProperties = {
  background: "rgba(239,68,68,0.12)",
  color: "#fca5a5",
  border: "1px solid rgba(239,68,68,0.24)",
};

const settledStyle: CSSProperties = {
  background: "rgba(148,163,184,0.10)",
  color: "#e2e8f0",
  border: "1px solid rgba(148,163,184,0.18)",
};

const buttonStyle: CSSProperties = {
  minHeight: 46,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(59,130,246,0.9)",
  color: "white",
  fontWeight: 800,
  fontSize: 15,
  cursor: "pointer",
};

const infoTextStyle: CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.66)",
  lineHeight: 1.5,
};

const loadingStyle: CSSProperties = {
  padding: 12,
  color: "rgba(255,255,255,0.75)",
};

const emptyWrapStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 22,
  padding: 18,
  background: "rgba(255,255,255,0.03)",
  display: "grid",
  gap: 8,
};

const emptyTitleStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
};

const emptyTextStyle: CSSProperties = {
  fontSize: 14,
  color: "rgba(255,255,255,0.68)",
  lineHeight: 1.5,
};

const emptyMiniStyle: CSSProperties = {
  fontSize: 14,
  color: "rgba(255,255,255,0.68)",
};