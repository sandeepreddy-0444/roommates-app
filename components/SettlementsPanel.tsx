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

const EXPENSE_LIMIT = 200;

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
    () => unsettledExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0),
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

    const saveKey = `${s.from}-${s.to}-${s.amount}`;
    setSavingId(saveKey);

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
      <div className="grid gap-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <div className="text-xs uppercase tracking-[0.18em] text-sky-200/90 font-bold">
            Settlements
          </div>
          <h2 className="mt-2 text-xl sm:text-2xl font-bold text-white">
            Loading settlements...
          </h2>
          <p className="mt-2 text-sm text-white/70">
            Preparing your room balance overview.
          </p>
        </div>
      </div>
    );
  }

  if (!groupId) {
    return (
      <div className="grid gap-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
          <div className="text-3xl mb-3">🏠</div>
          <h2 className="text-xl sm:text-2xl font-bold text-white">
            You are not in a room yet
          </h2>
          <p className="mt-2 text-sm text-white/70 max-w-xl mx-auto leading-6">
            Join or create a room to view balances, settlement plans, and shared
            expense activity.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 min-w-0 text-white">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="text-xs uppercase tracking-[0.18em] text-sky-200/90 font-bold">
          Smart Settlements
        </div>

        <h2 className="mt-2 text-xl sm:text-2xl font-bold break-words">
          Balance the room faster
        </h2>

        <p className="mt-2 text-sm text-white/70 leading-6 max-w-3xl">
          See who is owed, who owes, and the simplest plan to settle everything
          with fewer transactions.
        </p>

        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] text-white/65">Unsettled Expenses</div>
            <div className="mt-1 text-xl sm:text-2xl font-bold">
              {unsettledExpenses.length}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] text-white/65">Pending Value</div>
            <div className="mt-1 text-xl sm:text-2xl font-bold break-words">
              ${round2(totalUnsettledAmount).toFixed(2)}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] text-white/65">Roommates</div>
            <div className="mt-1 text-xl sm:text-2xl font-bold">{peopleCount}</div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] text-white/65">Best Plan Steps</div>
            <div className="mt-1 text-xl sm:text-2xl font-bold">
              {suggestions.length}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="mb-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-sky-300 font-bold">
            Overview
          </div>
          <h3 className="mt-2 text-lg sm:text-xl font-bold">Current balances</h3>
          <p className="mt-1 text-sm text-white/70 leading-6">
            These balances reflect all unsettled shared expenses in the room.
          </p>
        </div>

        {Object.keys(users).length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-white/70">
            No roommates found.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {Object.entries(users).map(([personUid, name]) => {
              const value = balances[personUid] || 0;
              const positive = value >= 0;

              return (
                <div
                  key={personUid}
                  className="rounded-xl border border-white/10 bg-black/20 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold break-words">
                        {name}
                        {uid === personUid ? " (You)" : ""}
                      </div>
                      <div className="mt-1 text-xs text-white/60">
                        {positive ? "Should receive" : "Needs to pay"}
                      </div>
                    </div>

                    <div
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold border ${
                        positive
                          ? "bg-green-500/10 text-green-300 border-green-400/20"
                          : "bg-red-500/10 text-red-300 border-red-400/20"
                      }`}
                    >
                      {positive ? "Credit" : "Debit"}
                    </div>
                  </div>

                  <div
                    className={`mt-4 text-2xl sm:text-3xl font-extrabold break-words ${
                      positive ? "text-green-300" : "text-red-300"
                    }`}
                  >
                    {value >= 0 ? "+" : "-"}${Math.abs(round2(value)).toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="mb-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-sky-300 font-bold">
            Optimization
          </div>
          <h3 className="mt-2 text-lg sm:text-xl font-bold">
            Best settlement plan
          </h3>
          <p className="mt-1 text-sm text-white/70 leading-6">
            We simplify debt paths so the room can settle with fewer payments.
          </p>
        </div>

        {suggestions.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-white/70">
            Everything is already balanced 🎉
          </div>
        ) : (
          <div className="grid gap-3">
            {suggestions.map((s, index) => {
              const id = `${s.from}-${s.to}-${s.amount}`;

              return (
                <div
                  key={index}
                  className="rounded-xl border border-white/10 bg-black/20 p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-sky-300 font-bold">
                        Suggested payment
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-base sm:text-lg font-semibold break-words">
                        <strong>{users[s.from] || "Someone"}</strong>
                        <span className="text-white/60">→</span>
                        <strong>{users[s.to] || "Someone"}</strong>
                      </div>

                      <div className="mt-2 text-sm text-white/65">
                        Settle this balance in one payment.
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 lg:items-end">
                      <div className="text-2xl sm:text-3xl font-extrabold break-words">
                        ${round2(s.amount).toFixed(2)}
                      </div>

                      <button
                        type="button"
                        onClick={() => saveSuggestion(s)}
                        disabled={savingId === id}
                        className="w-full lg:w-auto min-h-[46px] rounded-xl border border-white/15 bg-blue-500/90 px-4 py-3 font-semibold text-white disabled:opacity-60"
                      >
                        {savingId === id ? "Saving..." : "Save Suggestion"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="mb-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-sky-300 font-bold">
            Expenses
          </div>
          <h3 className="mt-2 text-lg sm:text-xl font-bold">
            Unsettled expenses
          </h3>
          <p className="mt-1 text-sm text-white/70 leading-6">
            Review expense splits and close items once everyone is settled.
          </p>
        </div>

        {unsettledExpenses.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-white/70">
            No unsettled expenses.
          </div>
        ) : (
          <div className="grid gap-4">
            {unsettledExpenses.map((e) => {
              const details = getExpenseDetails(e);

              return (
                <div
                  key={e.id}
                  className="rounded-xl border border-white/10 bg-black/20 p-4"
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="text-lg font-bold break-words">{e.title}</div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/75">
                          Total: ${Number(e.amount || 0).toFixed(2)}
                        </div>
                        <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/75">
                          Each share: ${details.perPerson.toFixed(2)}
                        </div>
                        <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/75 break-words">
                          Paid by: {users[details.payer || ""] || "Unknown"}
                          {details.payer === uid ? " (You)" : ""}
                        </div>
                      </div>

                      {uid && (
                        <div
                          className={`mt-3 inline-flex rounded-full border px-3 py-2 text-xs sm:text-sm font-semibold ${
                            details.myNet > 0
                              ? "bg-green-500/10 text-green-300 border-green-400/20"
                              : details.myNet < 0
                              ? "bg-red-500/10 text-red-300 border-red-400/20"
                              : "bg-white/5 text-white/75 border-white/10"
                          }`}
                        >
                          {details.myNet > 0
                            ? `You should receive $${details.myNet.toFixed(2)}`
                            : details.myNet < 0
                            ? `You owe $${Math.abs(details.myNet).toFixed(2)}`
                            : "You are settled for this expense"}
                        </div>
                      )}
                    </div>

                    <div className="w-full xl:w-auto">
                      <button
                        type="button"
                        onClick={() => markExpenseSettled(e.id)}
                        disabled={savingId === e.id}
                        className="w-full xl:w-auto min-h-[46px] rounded-xl border border-white/15 bg-blue-500/90 px-4 py-3 font-semibold text-white disabled:opacity-60"
                      >
                        {savingId === e.id ? "Saving..." : "Mark Settled"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="font-semibold text-sm text-slate-200">
                        Split details
                      </div>
                      <div className="text-xs text-white/55">
                        Individual share breakdown
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2">
                      {Object.entries(e.splitMap || {}).map(([personUid, owed]) => (
                        <div
                          key={personUid}
                          className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                        >
                          <div className="text-sm text-sky-100 break-words min-w-0">
                            {users[personUid] || "Someone"}
                            {personUid === uid ? " (You)" : ""}
                          </div>
                          <div className="text-sm font-semibold shrink-0">
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