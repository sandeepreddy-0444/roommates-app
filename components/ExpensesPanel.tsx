"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
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

  const [msg, setMsg] = useState<string | null>(null);

  const expensesCol = useMemo(() => {
    if (!groupId) return null;
    return collection(db, "groups", groupId, "expenses");
  }, [groupId]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return router.push("/login");
      setUid(u.uid);

      const userDoc = await getDoc(doc(db, "users", u.uid));
      const gid = userDoc.exists() ? userDoc.data().groupId : null;
      if (!gid) return router.push("/room");
      setGroupId(gid);

      const membersUnsub = onSnapshot(
        collection(db, "groups", gid, "members"),
        async (snap) => {
          const uids = snap.docs.map((d) => d.id);

          const results: Member[] = [];
          for (const id of uids) {
            const userSnap = await getDoc(doc(db, "users", id));
            const data = userSnap.exists() ? userSnap.data() : {};
            results.push({
              uid: id,
              name: (data as any).name ?? "Roommate",
              email: (data as any).email ?? "",
            });
          }

          results.sort((a, b) => a.name.localeCompare(b.name));
          setMembers(results);

          if (!paidBy && u.uid) setPaidBy(u.uid);
        }
      );

      return () => membersUnsub();
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

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

  const balances = useMemo(() => {
    const n = members.length || 1;
    const map: Record<string, number> = {};
    for (const m of members) map[m.uid] = 0;

    for (const e of expenses) {
      const perHead = e.amount / n;

      for (const m of members) map[m.uid] -= perHead;

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

    await addDoc(expensesCol, {
      title: t,
      amount: a,
      paidBy,
      splitType: "equal",
      createdAt: serverTimestamp(),
    });

    setTitle("");
    setAmount("");
  }

  // ✅ ONLY payer can delete
  async function removeExpense(expenseId: string, paidById: string) {
    if (!groupId) return;

    if (!uid || uid !== paidById) {
      setMsg("Only the person who paid can delete this expense.");
      return;
    }

    await deleteDoc(doc(db, "groups", groupId, "expenses", expenseId));
  }

  async function logout() {
    await signOut(auth);
    router.push("/login");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Expenses</h2>
          <p className="text-sm text-gray-600">Room: {groupId}</p>
        </div>

        <button onClick={logout} className="border px-4 py-2 rounded">
          Logout
        </button>
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

        <button className="rounded-xl bg-black text-white px-4 py-3">
          Add Expense (split equal)
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

                {/* ✅ show Delete only for payer */}
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
