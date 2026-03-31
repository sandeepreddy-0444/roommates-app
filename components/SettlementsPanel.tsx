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

    const unsub = onSnapshot(collection(db, "groups", groupId, "members"), async (snap) => {
      const next: UserMap = {};
      await Promise.all(
        snap.docs.map(async (memberDoc) => {
          const userSnap = await getDoc(doc(db, "users", memberDoc.id));
          const data = userSnap.exists() ? (userSnap.data() as any) : {};
          next[memberDoc.id] = data?.name || memberDoc.id.slice(0, 6);
        })
      );
      setUsers(next);
    });

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
    const people = exp.participants && exp.participants.length > 0
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

  if (loading) return <div>Loading settlements...</div>;
  if (!groupId) return <div>You are not in a room yet.</div>;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <h2 style={{ margin: 0 }}>Smart Settlements</h2>

      <div style={cardStyle}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Current balances</div>
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
          These are total balances across all unsettled expenses in the room.
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {Object.keys(users).length === 0 ? (
            <div style={{ opacity: 0.7 }}>No roommates found.</div>
          ) : (
            Object.entries(users).map(([personUid, name]) => {
              const value = balances[personUid] || 0;
              return (
                <div key={personUid} style={rowStyle}>
                  <div>
                    {name}
                    {uid === personUid ? " (You)" : ""}
                  </div>
                  <div style={{ fontWeight: 900 }}>
                    {value >= 0 ? "+" : "-"}${Math.abs(round2(value)).toFixed(2)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Best settlement plan</div>
        {suggestions.length === 0 ? (
          <div style={{ opacity: 0.75 }}>Everything is already balanced 🎉</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {suggestions.map((s, index) => {
              const id = `${s.from}-${s.to}-${s.amount}`;
              return (
                <div key={index} style={rowStyle}>
                  <div>
                    <strong>{users[s.from] || "Someone"}</strong> pays{" "}
                    <strong>{users[s.to] || "Someone"}</strong> $
                    {round2(s.amount).toFixed(2)}
                  </div>
                  <button
                    onClick={() => saveSuggestion(s)}
                    disabled={savingId === id}
                    style={buttonStyle}
                  >
                    {savingId === id ? "Saving..." : "Save"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Unsettled expenses</div>
        {expenses.filter((e) => !e.settled).length === 0 ? (
          <div style={{ opacity: 0.75 }}>No unsettled expenses.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {expenses
              .filter((e) => !e.settled)
              .map((e) => {
                const details = getExpenseDetails(e);

                return (
                  <div
                    key={e.id}
                    style={{
                      border: "1px solid #2b2b2b",
                      borderRadius: 12,
                      padding: 12,
                      background: "#111",
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 800 }}>{e.title}</div>
                        <div style={{ fontSize: 13, opacity: 0.75 }}>
                          Total: ${Number(e.amount || 0).toFixed(2)}
                        </div>
                        <div style={{ fontSize: 13, opacity: 0.75 }}>
                          Each share: ${details.perPerson.toFixed(2)}
                        </div>
                        <div style={{ fontSize: 13, opacity: 0.75 }}>
                          Paid by: {users[details.payer || ""] || "Unknown"}
                          {details.payer === uid ? " (You)" : ""}
                        </div>
                        {uid && (
                          <div style={{ fontSize: 13, fontWeight: 800, marginTop: 4 }}>
                            {details.myNet > 0
                              ? `You should receive $${details.myNet.toFixed(2)}`
                              : details.myNet < 0
                              ? `You owe $${Math.abs(details.myNet).toFixed(2)}`
                              : "You are settled for this expense"}
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => markExpenseSettled(e.id)}
                        disabled={savingId === e.id}
                        style={buttonStyle}
                      >
                        {savingId === e.id ? "Saving..." : "Mark Settled"}
                      </button>
                    </div>

                    <div
                      style={{
                        border: "1px solid #2b2b2b",
                        borderRadius: 10,
                        padding: 10,
                        background: "#0b0b0b",
                        display: "grid",
                        gap: 6,
                        fontSize: 13,
                      }}
                    >
                      <div style={{ fontWeight: 800 }}>Split details</div>
                      {Object.entries(e.splitMap || {}).map(([personUid, owed]) => (
                        <div key={personUid}>
                          {users[personUid] || "Someone"}
                          {personUid === uid ? " (You)" : ""}: ${round2(Number(owed || 0)).toFixed(2)}
                        </div>
                      ))}
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

const cardStyle: React.CSSProperties = {
  border: "1px solid #2b2b2b",
  borderRadius: 12,
  padding: 14,
  background: "#0b0b0b",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  border: "1px solid #2b2b2b",
  borderRadius: 12,
  padding: 12,
  background: "#111",
  flexWrap: "wrap",
};

const buttonStyle: React.CSSProperties = {
  border: "1px solid #2b2b2b",
  borderRadius: 10,
  padding: "8px 12px",
  background: "white",
  color: "black",
  fontWeight: 800,
  cursor: "pointer",
};