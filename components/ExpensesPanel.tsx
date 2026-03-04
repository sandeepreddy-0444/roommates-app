"use client";

import { useEffect, useState } from "react";
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
} from "firebase/firestore";
import { auth, db } from "@/app/lib/firebase";
import ExpenseActions from "@/components/ExpenseActions";

type Expense = {
  id: string;
  title: string;
  amount: number;
  createdAt?: any;
  date?: any;
  createdBy?: string;
  createdByUid?: string;
  paidByUid?: string;
  paidBy?: string;
};

function formatMoney(n: number) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toFixed(2);
}

function toDisplayDate(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (value?.toDate) return value.toDate().toLocaleDateString();
  if (value instanceof Date) return value.toLocaleDateString();
  return "";
}

export default function ExpensesPanel() {
  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  // Add expense form
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // ✅ auth -> user -> groupId
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setUid(null);
        setGroupId(null);
        setIsAdmin(false);
        setExpenses([]);
        setLoading(false);
        return;
      }

      setUid(u.uid);

      // read user's groupId
      const userSnap = await getDoc(doc(db, "users", u.uid));
      const userData = userSnap.exists() ? (userSnap.data() as any) : {};
      const gid = userData?.groupId || null;
      setGroupId(gid);

      // read group createdBy to decide admin
      if (gid) {
        const groupSnap = await getDoc(doc(db, "groups", gid));
        const groupData = groupSnap.exists() ? (groupSnap.data() as any) : {};
        const createdBy = groupData?.createdBy || null;
        setIsAdmin(createdBy === u.uid);
      } else {
        setIsAdmin(false);
      }

      setLoading(false);
    });

    return () => unsub();
  }, []);

  // ✅ listen to expenses
  useEffect(() => {
    if (!groupId) {
      setExpenses([]);
      return;
    }

    const col = collection(db, "groups", groupId, "expenses");
    const q = query(col, orderBy("createdAt", "desc"), limit(100));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Expense[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            title: data?.title ?? "Untitled",
            amount: Number(data?.amount ?? 0),
            createdAt: data?.createdAt,
            date: data?.date ?? data?.createdAt,
            createdBy: data?.createdBy ?? data?.createdByUid ?? null,
            createdByUid: data?.createdByUid ?? null,
            paidByUid: data?.paidByUid ?? null,
            paidBy: data?.paidBy ?? null,
          };
        });

        setExpenses(list);
      },
      () => setExpenses([])
    );

    return () => unsub();
  }, [groupId]);

  async function addExpense() {
    setErr(null);

    const t = title.trim();
    const a = Number(amount);

    if (!t) return setErr("Title is required.");
    if (!Number.isFinite(a) || a <= 0) return setErr("Amount must be > 0.");
    if (!uid || !groupId) return setErr("Not ready (missing user or room).");

    setAdding(true);
    try {
      const col = collection(db, "groups", groupId, "expenses");

      await addDoc(col, {
        title: t,
        amount: a,
        createdAt: serverTimestamp(),
        createdBy: uid,
        createdByUid: uid,
        paidByUid: uid,
      });

      setTitle("");
      setAmount("");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to add expense.");
    } finally {
      setAdding(false);
    }
  }

  if (loading) return <div style={{ padding: 8 }}>Loading expenses...</div>;

  if (!groupId) {
    return (
      <div style={{ padding: 8 }}>
        <h2 style={{ marginTop: 0 }}>Expenses</h2>
        <p style={{ opacity: 0.8 }}>
          You are not in a room yet. Go to the Room page and join/create one.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <h2 style={{ margin: 0 }}>Expenses</h2>

      {/* Add Expense */}
      <div
        style={{
          border: "1px solid #2b2b2b",
          borderRadius: 12,
          padding: 12,
          background: "#111",
          display: "grid",
          gap: 10,
        }}
      >
        <div style={{ fontWeight: 800 }}>Add expense</div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (e.g., Dinner)"
          style={{
            background: "#0b0b0b",
            color: "white",
            border: "1px solid #2b2b2b",
            borderRadius: 10,
            padding: "10px 12px",
            outline: "none",
          }}
          disabled={adding}
        />

        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount (e.g., 25)"
          inputMode="decimal"
          style={{
            background: "#0b0b0b",
            color: "white",
            border: "1px solid #2b2b2b",
            borderRadius: 10,
            padding: "10px 12px",
            outline: "none",
          }}
          disabled={adding}
        />

        {err && <div style={{ color: "#fca5a5", fontSize: 13 }}>{err}</div>}

        <button
          onClick={addExpense}
          disabled={adding}
          style={{
            border: "1px solid #2b2b2b",
            borderRadius: 10,
            padding: "10px 12px",
            background: "white",
            color: "black",
            fontWeight: 900,
            cursor: "pointer",
            opacity: adding ? 0.6 : 1,
          }}
        >
          {adding ? "Adding..." : "Add"}
        </button>
      </div>

      {/* Expenses List */}
      <div
        style={{
          border: "1px solid #2b2b2b",
          borderRadius: 12,
          padding: 12,
          background: "#111",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 10 }}>Recent expenses</div>

        {expenses.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No expenses yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {expenses.map((exp) => (
              <div
                key={exp.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  border: "1px solid #2b2b2b",
                  borderRadius: 12,
                  padding: 12,
                  background: "#0b0b0b",
                }}
              >
                <div style={{ display: "grid", gap: 2 }}>
                  <div style={{ fontWeight: 900 }}>{exp.title}</div>
                  <div style={{ fontSize: 13, opacity: 0.75 }}>
                    {toDisplayDate(exp.date || exp.createdAt)}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontWeight: 900 }}>
                    ${formatMoney(Number(exp.amount) || 0)}
                  </div>

                  {/* ✅ Edit/Delete buttons */}
                  {uid && (
                    <ExpenseActions
                      groupId={groupId}
                      expense={{
                        id: exp.id,
                        title: exp.title,
                        amount: Number(exp.amount) || 0,
                        date: exp.date || exp.createdAt,
                        createdBy:
                          exp.createdBy ||
                          exp.createdByUid ||
                          exp.paidByUid ||
                          exp.paidBy ||
                          "",
                      }}
                      myUid={uid}
                      isAdmin={isAdmin}
                      onDone={() => {}}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}