"use client";

import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import { auth, db } from "@/app/lib/firebase";

type Member = { uid: string; name: string; email: string };

type Expense = {
  id: string;
  title: string;
  amount: number;
  paidBy: string;
  participants?: string[];
  createdAt?: any;
};

export default function ExpensesPanel() {
  const router = useRouter();

  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState<string>("");

  // ✅ Split selected people
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const [msg, setMsg] = useState<string | null>(null);

  const expensesCol = useMemo(() => {
    if (!groupId) return null;
    return collection(db, "groups", groupId, "expenses");
  }, [groupId]);

  // ✅ Auth + load groupId
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.push("/login");
        return;
      }
      setUid(u.uid);

      const userDoc = await getDoc(doc(db, "users", u.uid));
      const gid = userDoc.exists() ? (userDoc.data() as any).groupId : null;

      if (!gid) {
        router.push("/room");
        return;
      }

      setGroupId(gid);
      if (!paidBy) setPaidBy(u.uid);
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // ✅ HARD BLOCK: If my members/{uid} doc disappears, clear everything + redirect
  useEffect(() => {
    if (!groupId || !uid) return;

    const myMemberRef = doc(db, "groups", groupId, "members", uid);

    const unsub = onSnapshot(myMemberRef, (snap) => {
      if (!snap.exists()) {
        // I am not a member anymore
        setMembers([]);
        setExpenses([]);
        setGroupId(null);
        router.push("/room");
      }
    });

    return () => unsub();
  }, [groupId, uid, router]);

  // ✅ Members list
  useEffect(() => {
    if (!groupId) return;

    const membersUnsub = onSnapshot(
      collection(db, "groups", groupId, "members"),
      async (snap) => {
        const uids = snap.docs.map((d) => d.id);

        const userDocs = await Promise.all(
          uids.map((id) => getDoc(doc(db, "users", id)))
        );

        const results: Member[] = userDocs.map((docSnap, idx) => {
          const id = uids[idx];
          const data = docSnap.exists() ? (docSnap.data() as any) : {};
          return {
            uid: id,
            name: data?.name ?? "Roommate",
            email: data?.email ?? "",
          };
        });

        results.sort((a, b) => a.name.localeCompare(b.name));
        setMembers(results);

        // default paidBy = me (once)
        if (!paidBy && uid) setPaidBy(uid);
      }
    );

    return () => membersUnsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // ✅ Default select everyone whenever members change
  useEffect(() => {
    const init: Record<string, boolean> = {};
    members.forEach((m) => (init[m.uid] = true));
    setSelected(init);
  }, [members]);

  // ✅ Expenses list
  useEffect(() => {
    if (!expensesCol) return;

    const q = query(expensesCol, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const rows: Expense[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          title: data.title ?? "",
          amount: Number(data.amount ?? 0),
          paidBy: data.paidBy ?? "",
          participants: Array.isArray(data.participants)
            ? (data.participants as string[])
            : undefined,
          createdAt: data.createdAt,
        };
      });
      setExpenses(rows);
    });

    return () => unsub();
  }, [expensesCol]);

  function nameOf(id: string) {
    const m = members.find((x) => x.uid === id);
    return m ? m.name : id.slice(0, 6);
  }

  // ✅ Balances: split only among participants (or all members if old expense)
  const balances = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of members) map[m.uid] = 0;

    const all = members.map((m) => m.uid);

    for (const e of expenses) {
      const parts =
        e.participants && e.participants.length > 0 ? e.participants : all;

      const denom = parts.length || 1;
      const perHead = e.amount / denom;

      for (const pid of parts) {
        if (map[pid] === undefined) map[pid] = 0;
        map[pid] -= perHead;
      }

      if (map[e.paidBy] === undefined) map[e.paidBy] = 0;
      map[e.paidBy] += e.amount;
    }

    return map;
  }, [expenses, members]);

  const settleUps = useMemo(() => {
    const eps = 0.01;
    const creditors: { uid: string; amt: number }[] = [];
    const debtors: { uid: string; amt: number }[] = [];

    for (const m of members) {
      const b = balances[m.uid] ?? 0;
      if (b > eps) creditors.push({ uid: m.uid, amt: b });
      else if (b < -eps) debtors.push({ uid: m.uid, amt: -b });
    }

    const transfers: { from: string; to: string; amount: number }[] = [];
    let i = 0;
    let j = 0;

    while (i < debtors.length && j < creditors.length) {
      const pay = Math.min(debtors[i].amt, creditors[j].amt);

      if (pay > eps) {
        transfers.push({
          from: debtors[i].uid,
          to: creditors[j].uid,
          amount: Math.round(pay * 100) / 100,
        });
      }

      debtors[i].amt -= pay;
      creditors[j].amt -= pay;

      if (debtors[i].amt <= eps) i++;
      if (creditors[j].amt <= eps) j++;
    }

    return transfers;
  }, [balances, members]);

  async function addExpense(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (!expensesCol) return;

    const t = title.trim();
    const a = Number(amount);

    if (!t) return setMsg("Enter a title (ex: Chicken, Rent, Milk)");
    if (!a || a <= 0) return setMsg("Enter a valid amount");
    if (!paidBy) return setMsg("Select who paid");

    const participants = Object.keys(selected).filter((id) => selected[id]);
    if (participants.length < 2) return setMsg("Select at least 2 people for split.");

    await addDoc(expensesCol, {
      title: t,
      amount: a,
      paidBy,
      splitType: "equal",
      participants,
      createdAt: serverTimestamp(),
    });

    setTitle("");
    setAmount("");
  }

  async function removeExpense(expenseId: string, paidById: string) {
    if (!groupId) return;

    if (!uid || uid !== paidById) {
      setMsg("Only the person who paid can delete this expense.");
      return;
    }

    await deleteDoc(doc(db, "groups", groupId, "expenses", expenseId));
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Expenses</h2>
      </div>

      {msg && <p className="text-sm text-red-600">{msg}</p>}

      <form onSubmit={addExpense} className="border rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            className="rounded-xl border p-3"
            placeholder="Title (ex: Chicken, Milk)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="rounded-xl border p-3"
            placeholder="Amount (ex: 12.50)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
          />
          <select
            className="rounded-xl border p-3"
            value={paidBy}
            onChange={(e) => setPaidBy(e.target.value)}
          >
            <option value="" disabled>
              Paid by...
            </option>
            {members.map((m) => (
              <option key={m.uid} value={m.uid}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div className="border rounded-2xl p-3">
          <div className="font-semibold mb-2">Split with</div>
          <p className="text-sm text-gray-600 mb-3">
            Uncheck roommates who did NOT participate.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {members.map((m) => (
              <label key={m.uid} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!selected[m.uid]}
                  onChange={(e) =>
                    setSelected((prev) => ({ ...prev, [m.uid]: e.target.checked }))
                  }
                />
                <span>{m.name}</span>
              </label>
            ))}
          </div>
        </div>

        <button className="rounded-xl bg-black text-white px-4 py-3">
          Add Expense (split selected people)
        </button>
      </form>

      <div className="border rounded-2xl p-4">
        <h3 className="font-semibold">Balances</h3>
        <p className="text-sm text-gray-600 mt-1">
          Positive = should receive money • Negative = owes money
        </p>

        <div className="mt-3 space-y-2">
          {members.map((m) => (
            <div key={m.uid} className="flex justify-between border-b py-2">
              <div>{m.name}</div>
              <div className="font-mono">
                {balances[m.uid] ? balances[m.uid].toFixed(2) : "0.00"}
              </div>
            </div>
          ))}
          {members.length === 0 && (
            <p className="text-gray-600">No members found.</p>
          )}
        </div>
      </div>

      <div className="border rounded-2xl p-4">
        <h3 className="font-semibold">Who owes who</h3>
        <p className="text-sm text-gray-600 mt-1">
          Suggested payments to settle everything
        </p>

        <div className="mt-3 space-y-2">
          {settleUps.length === 0 ? (
            <p className="text-gray-600">All settled ✅</p>
          ) : (
            settleUps.map((t, idx) => (
              <div key={idx} className="flex justify-between border-b py-2">
                <div>
                  <span className="font-medium">{nameOf(t.from)}</span> pays{" "}
                  <span className="font-medium">{nameOf(t.to)}</span>
                </div>
                <div className="font-mono">${t.amount.toFixed(2)}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold">Recent expenses</h3>
        {expenses.length === 0 ? (
          <p className="text-gray-600">No expenses yet. Add your first one ☝️</p>
        ) : (
          expenses.map((ex) => (
            <div
              key={ex.id}
              className="border rounded-2xl p-4 flex items-center justify-between"
            >
              <div>
                <div className="font-medium">{ex.title}</div>
                <div className="text-sm text-gray-600">
                  Paid by: {nameOf(ex.paidBy)}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="font-mono">${ex.amount.toFixed(2)}</div>

                {uid === ex.paidBy && (
                  <button
                    onClick={() => removeExpense(ex.id, ex.paidBy)}
                    className="text-sm border px-3 py-2 rounded text-red-600"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
