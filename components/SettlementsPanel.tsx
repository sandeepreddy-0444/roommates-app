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
  /** In-app confirm — `window.confirm` is unreliable on many mobile WebViews. */
  const [settleTarget, setSettleTarget] = useState<Expense | null>(null);

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
    if (!settleTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !savingId) setSettleTarget(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settleTarget, savingId]);

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

  async function confirmMarkExpenseSettled(exp: Expense) {
    if (!groupId) return;

    setSavingId(exp.id);

    try {
      await updateDoc(doc(db, "groups", groupId, "expenses", exp.id), {
        settled: true,
        settledAt: serverTimestamp(),
      });
      setSettleTarget(null);
    } catch (e) {
      console.error(e);
      alert("Could not mark as settled. Check your connection and try again.");
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
                  <div style={balanceRowGridStyle}>
                    <div style={balanceNameStatusStyle}>
                      <span style={balanceNameStyle}>
                        {name}
                        {uid === personUid ? " (You)" : ""}
                      </span>
                      <span style={balanceSubStyle}>
                        {positive ? "Should receive" : "Needs to pay"}
                      </span>
                    </div>
                    <span
                      style={{
                        ...balanceAmountInlineStyle,
                        color: positive ? "#86efac" : "#fca5a5",
                      }}
                    >
                      {value >= 0 ? "+" : "-"}${Math.abs(round2(value)).toFixed(2)}
                    </span>
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
                  <span style={settlementAmountInlineSepStyle} aria-hidden>
                    ·
                  </span>
                  <span style={settlementAmountStyle}>
                    ${round2(s.amount).toFixed(2)}
                  </span>
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
                      onClick={() => setSettleTarget(e)}
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

      {settleTarget ? (
        <div
          style={modalOverlayStyle}
          role="presentation"
          onClick={() => {
            if (!savingId) setSettleTarget(null);
          }}
        >
          <div
            style={modalCardStyle}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settle-dialog-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3 id="settle-dialog-title" style={modalTitleStyle}>
              Mark expense settled?
            </h3>
            <div style={modalWarningBannerStyle} role="alert">
              <span style={modalWarningLabelStyle}>Warning</span>
              <p style={modalWarningTextStyle}>
                Only confirm after payments match what you agreed. This updates unsettled balances for
                everyone who shares this room.
              </p>
            </div>
            <p style={modalBodyStyle}>
              <strong>{settleTarget.title}</strong>
              <span style={{ display: "block", marginTop: 8, fontVariantNumeric: "tabular-nums" }}>
                Total: ${Number(settleTarget.amount || 0).toFixed(2)}
              </span>
            </p>
            <p style={modalFinePrintStyle}>
              This marks the bill as closed for splitting purposes: it stops counting toward the
              unsettled totals above. The expense record stays in your history — it is not deleted.
            </p>
            <div style={modalActionsStyle}>
              <button
                type="button"
                style={modalCancelBtnStyle}
                disabled={!!savingId}
                onClick={() => setSettleTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                style={modalConfirmBtnStyle}
                disabled={!!savingId}
                onClick={() => void confirmMarkExpenseSettled(settleTarget)}
              >
                {savingId ? "Saving…" : "Mark settled"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
  gap: 10,
  color: "#0f172a",
};

const sectionStyle: CSSProperties = {
  border: "1px solid var(--app-border-subtle, rgba(148, 163, 184, 0.32))",
  borderRadius: "clamp(16px, 3.5vw, 22px)",
  padding: "clamp(12px, 3.2vw, 18px)",
  background: "var(--app-surface-elevated, linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%))",
  boxShadow: "var(--app-shadow-sheet, 0 8px 28px rgba(15, 23, 42, 0.07))",
  display: "grid",
  gap: 8,
};

const sectionEyebrowStyle: CSSProperties = {
  fontSize: "clamp(10px, 2.6vw, 12px)",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: "rgba(15, 23, 42, 0.55)",
  fontWeight: 800,
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "clamp(15px, 3.7vw, 18px)",
  fontWeight: 800,
  lineHeight: 1.2,
  color: "#0f172a",
};

const statsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 8,
};

const statCardStyle: CSSProperties = {
  border: "1px solid var(--app-border-subtle, rgba(148, 163, 184, 0.32))",
  borderRadius: 14,
  padding: "clamp(10px, 2.6vw, 14px)",
  background: "var(--app-surface-card, rgba(255, 255, 255, 0.94))",
};

const statLabelStyle: CSSProperties = {
  fontSize: "clamp(9px, 2.4vw, 11px)",
  color: "rgba(15, 23, 42, 0.76)",
  marginBottom: 3,
  textTransform: "uppercase",
  letterSpacing: 0.08,
};

const statValueStyle: CSSProperties = {
  fontSize: "clamp(15px, 4vw, 18px)",
  fontWeight: 800,
  lineHeight: 1.15,
  color: "#0f172a",
  fontVariantNumeric: "tabular-nums",
};

const cardsGridStyle: CSSProperties = {
  display: "grid",
  gap: 8,
};

const balanceCardStyle: CSSProperties = {
  border: "1px solid var(--app-border-subtle, rgba(148, 163, 184, 0.32))",
  borderRadius: 16,
  padding: "clamp(8px, 2.2vw, 12px) clamp(11px, 2.8vw, 14px)",
  background: "var(--app-surface-card, rgba(255, 255, 255, 0.94))",
};

/** One dense row: name + status (left) · amount (right). */
const balanceRowGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "baseline",
  gap: "6px 10px",
  columnGap: 12,
  width: "100%",
};

const balanceNameStatusStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  gap: "6px 10px",
  minWidth: 0,
};

const balanceNameStyle: CSSProperties = {
  fontSize: "clamp(13px, 3.2vw, 15px)",
  fontWeight: 800,
  lineHeight: 1.25,
  wordBreak: "break-word",
  color: "#0f172a",
};

const balanceSubStyle: CSSProperties = {
  marginTop: 0,
  fontSize: "clamp(11px, 2.7vw, 12px)",
  color: "rgba(15, 23, 42, 0.72)",
  whiteSpace: "nowrap",
};

const balanceAmountInlineStyle: CSSProperties = {
  justifySelf: "end",
  textAlign: "right",
  fontSize: "clamp(14px, 3.5vw, 17px)",
  fontWeight: 800,
  lineHeight: 1.15,
  fontVariantNumeric: "tabular-nums",
};

const cardsListStyle: CSSProperties = {
  display: "grid",
  gap: 8,
};

const simpleCardStyle: CSSProperties = {
  border: "1px solid var(--app-border-subtle, rgba(148, 163, 184, 0.32))",
  borderRadius: 16,
  padding: "clamp(11px, 2.6vw, 14px)",
  background: "var(--app-surface-card, rgba(255, 255, 255, 0.94))",
  display: "grid",
  gap: 6,
};

const settlementLineStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  flexWrap: "wrap",
  fontSize: "clamp(13px, 3.1vw, 16px)",
  lineHeight: 1.3,
};

const settlementAmountInlineSepStyle: CSSProperties = {
  opacity: 0.45,
  fontWeight: 600,
  userSelect: "none",
  padding: "0 1px",
};

const settlementAmountStyle: CSSProperties = {
  fontSize: "clamp(15px, 3.6vw, 18px)",
  fontWeight: 800,
  lineHeight: 1.25,
  fontVariantNumeric: "tabular-nums",
};

const expenseTitleStyle: CSSProperties = {
  fontSize: "clamp(15px, 3.6vw, 17px)",
  fontWeight: 800,
  lineHeight: 1.25,
  color: "#0f172a",
};

const chipRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  alignItems: "center",
  rowGap: 6,
};

const chipStyle: CSSProperties = {
  borderRadius: 999,
  padding: "6px 10px",
  fontSize: "clamp(11px, 2.8vw, 13px)",
  color: "rgba(15, 23, 42, 0.62)",
  border: "1px solid rgba(148, 163, 184, 0.4)",
  background: "rgba(255, 255, 255, 0.55)",
};

const statusStyle: CSSProperties = {
  borderRadius: 12,
  padding: "8px 10px",
  fontWeight: 700,
  fontSize: "clamp(12px, 3.1vw, 14px)",
};

const receiveStyle: CSSProperties = {
  background: "rgba(220,252,231,0.95)",
  color: "#14532d",
  border: "1px solid rgba(34,197,94,0.32)",
};

const oweStyle: CSSProperties = {
  background: "rgba(254,226,226,0.95)",
  color: "#991b1b",
  border: "1px solid rgba(239,68,68,0.32)",
};

const settledStyle: CSSProperties = {
  background: "rgba(148,163,184,0.10)",
  color: "#334155",
  border: "1px solid rgba(148,163,184,0.18)",
};

const buttonStyle: CSSProperties = {
  minHeight: 44,
  borderRadius: 12,
  border: "1px solid rgba(148, 163, 184, 0.45)",
  background: "rgba(59,130,246,0.9)",
  color: "white",
  fontWeight: 800,
  fontSize: "clamp(13px, 3.2vw, 15px)",
  cursor: "pointer",
  padding: "10px 12px",
};

const infoTextStyle: CSSProperties = {
  fontSize: "clamp(12px, 2.9vw, 13px)",
  color: "rgba(15, 23, 42, 0.76)",
  lineHeight: 1.5,
};

const loadingStyle: CSSProperties = {
  padding: 12,
  color: "rgba(15, 23, 42, 0.76)",
};

const emptyWrapStyle: CSSProperties = {
  border: "1px solid var(--app-border-subtle, rgba(148, 163, 184, 0.32))",
  borderRadius: 22,
  padding: 18,
  background: "var(--app-surface-card, rgba(255, 255, 255, 0.94))",
  display: "grid",
  gap: 8,
};

const emptyTitleStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  color: "#0f172a",
};

const emptyTextStyle: CSSProperties = {
  fontSize: 14,
  color: "rgba(15, 23, 42, 0.58)",
  lineHeight: 1.5,
};

const emptyMiniStyle: CSSProperties = {
  fontSize: "clamp(12px, 3.1vw, 14px)",
  color: "rgba(15, 23, 42, 0.58)",
  lineHeight: 1.4,
};

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10050,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  background: "rgba(15, 23, 42, 0.45)",
  backdropFilter: "blur(4px)",
  WebkitBackdropFilter: "blur(4px)",
};

const modalCardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 400,
  borderRadius: 16,
  padding: "clamp(16px, 4vw, 20px)",
  background: "var(--app-surface-elevated, #ffffff)",
  border: "1px solid var(--app-border-subtle, rgba(148, 163, 184, 0.35))",
  boxShadow: "0 20px 50px rgba(15, 23, 42, 0.15)",
  color: "#0f172a",
};

const modalTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(16px, 3.8vw, 19px)",
  fontWeight: 800,
  letterSpacing: "-0.02em",
  lineHeight: 1.2,
};

const modalBodyStyle: CSSProperties = {
  margin: "10px 0 0",
  fontSize: "clamp(14px, 3.3vw, 15px)",
  lineHeight: 1.45,
  color: "rgba(15, 23, 42, 0.88)",
};

const modalFinePrintStyle: CSSProperties = {
  margin: "10px 0 0",
  fontSize: "clamp(12px, 2.9vw, 13px)",
  lineHeight: 1.45,
  color: "rgba(15, 23, 42, 0.62)",
};

const modalWarningBannerStyle: CSSProperties = {
  marginTop: 12,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(245, 158, 11, 0.45)",
  background: "rgba(254, 243, 199, 0.95)",
  display: "grid",
  gap: 4,
};

const modalWarningLabelStyle: CSSProperties = {
  fontSize: "clamp(10px, 2.5vw, 11px)",
  fontWeight: 800,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#92400e",
};

const modalWarningTextStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(12px, 2.9vw, 13px)",
  lineHeight: 1.4,
  color: "#78350f",
  fontWeight: 600,
};

const modalActionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
  marginTop: 18,
  justifyContent: "flex-end",
};

const modalCancelBtnStyle: CSSProperties = {
  padding: "9px 12px",
  borderRadius: 12,
  border: "1px solid rgba(148, 163, 184, 0.45)",
  background: "rgba(248, 250, 252, 0.95)",
  color: "#0f172a",
  fontWeight: 650,
  fontSize: "clamp(13px, 3.1vw, 14px)",
  cursor: "pointer",
};

const modalConfirmBtnStyle: CSSProperties = {
  padding: "9px 12px",
  borderRadius: 12,
  border: "1px solid rgba(37, 99, 235, 0.45)",
  background: "linear-gradient(135deg, #60a5fa, #2563eb)",
  color: "#fff",
  fontWeight: 750,
  fontSize: "clamp(13px, 3.1vw, 14px)",
  cursor: "pointer",
};