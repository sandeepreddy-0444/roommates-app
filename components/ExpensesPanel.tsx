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
  participants?: string[];
  splitMap?: Record<string, number>;
};

type Roommate = {
  uid: string;
  name: string;
};

function formatMoney(n: number) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toFixed(2);
}

function toDisplayDate(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value?.toDate) return value.toDate().toLocaleDateString();
  if (value instanceof Date) return value.toLocaleDateString();
  return "";
}

export default function ExpensesPanel() {
  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [roommates, setRoommates] = useState<Roommate[]>([]);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [selectedParticipants, setSelectedParticipants] = useState<Record<string, boolean>>({});

  const selectedCount = useMemo(
    () => Object.values(selectedParticipants).filter(Boolean).length,
    [selectedParticipants]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setUid(null);
        setGroupId(null);
        setIsAdmin(false);
        setExpenses([]);
        setRoommates([]);
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
        const createdBy = groupData?.createdBy || null;
        setIsAdmin(createdBy === u.uid);
      } else {
        setIsAdmin(false);
      }

      setLoading(false);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!groupId) {
      setRoommates([]);
      return;
    }

    const unsub = onSnapshot(
      collection(db, "groups", groupId, "members"),
      async (snap) => {
        const ids = snap.docs.map((d) => d.id);

        const userDocs = await Promise.all(
          ids.map((id) => getDoc(doc(db, "users", id)))
        );

        const list: Roommate[] = userDocs.map((docSnap, i) => {
          const id = ids[i];
          const data = docSnap.exists() ? (docSnap.data() as any) : {};
          return { uid: id, name: data?.name || id.slice(0, 6) };
        });

        setRoommates(list);

        setSelectedParticipants((prev) => {
          const next: Record<string, boolean> = {};
          for (const mate of list) {
            next[mate.uid] = prev[mate.uid] ?? true;
          }
          return next;
        });
      }
    );

    return () => unsub();
  }, [groupId]);

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
            participants: Array.isArray(data?.participants) ? data.participants : [],
            splitMap: data?.splitMap ?? {},
          };
        });

        setExpenses(list);
      },
      () => setExpenses([])
    );

    return () => unsub();
  }, [groupId]);

  function toggleParticipant(id: string) {
    setSelectedParticipants((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }

  function selectAllParticipants() {
    const next: Record<string, boolean> = {};
    for (const mate of roommates) next[mate.uid] = true;
    setSelectedParticipants(next);
  }

  function clearAllParticipants() {
    const next: Record<string, boolean> = {};
    for (const mate of roommates) next[mate.uid] = false;
    setSelectedParticipants(next);
  }

  async function addExpense() {
    setErr(null);

    const t = title.trim();
    const a = Number(amount);

    if (!t) return setErr("Title is required.");
    if (!Number.isFinite(a) || a <= 0) return setErr("Amount must be > 0.");
    if (!uid || !groupId) return setErr("Not ready (missing user or room).");
    if (!expenseDate) return setErr("Expense date is required.");

    const participants = roommates
      .filter((r) => selectedParticipants[r.uid])
      .map((r) => r.uid);

    if (participants.length === 0) {
      return setErr("Select at least one roommate to split the expense.");
    }

    const share = Math.round((a / participants.length) * 100) / 100;
    const splitMap: Record<string, number> = {};

    participants.forEach((id, index) => {
      if (index === participants.length - 1) {
        const assignedSoFar = Object.values(splitMap).reduce((sum, v) => sum + v, 0);
        splitMap[id] = Math.round((a - assignedSoFar) * 100) / 100;
      } else {
        splitMap[id] = share;
      }
    });

    setAdding(true);
    try {
      const col = collection(db, "groups", groupId, "expenses");

      await addDoc(col, {
        title: t,
        amount: a,
        date: expenseDate,
        createdAt: serverTimestamp(),
        createdBy: uid,
        createdByUid: uid,
        paidByUid: uid,
        participants,
        splitMap,
      });

      setTitle("");
      setAmount("");
      setExpenseDate(new Date().toISOString().slice(0, 10));

      const resetSelection: Record<string, boolean> = {};
      for (const mate of roommates) resetSelection[mate.uid] = true;
      setSelectedParticipants(resetSelection);
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
          style={inputStyle}
          disabled={adding}
        />

        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount (e.g., 25)"
          inputMode="decimal"
          style={inputStyle}
          disabled={adding}
        />

        <input
          type="date"
          value={expenseDate}
          onChange={(e) => setExpenseDate(e.target.value)}
          style={inputStyle}
          disabled={adding}
        />

        <div
          style={{
            border: "1px solid #2b2b2b",
            borderRadius: 10,
            padding: 12,
            background: "#0b0b0b",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 800 }}>Split with roommates</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={selectAllParticipants} style={miniBtnStyle}>
                Select all
              </button>
              <button type="button" onClick={clearAllParticipants} style={miniBtnStyle}>
                Clear all
              </button>
            </div>
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {roommates.map((mate) => (
              <label
                key={mate.uid}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  border: "1px solid #222",
                  borderRadius: 10,
                  padding: "10px 12px",
                  background: "#111",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={!!selectedParticipants[mate.uid]}
                  onChange={() => toggleParticipant(mate.uid)}
                />
                <span>
                  {mate.name} {mate.uid === uid ? "(You)" : ""}
                </span>
              </label>
            ))}
          </div>

          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
            {selectedCount > 0 && amount && Number(amount) > 0
              ? `Each selected roommate owes about $${formatMoney(Number(amount) / selectedCount)}`
              : "Select roommates to split this expense equally."}
          </div>
        </div>

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
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontWeight: 900 }}>{exp.title}</div>

                  <div style={{ fontSize: 13, opacity: 0.75 }}>
                    {toDisplayDate(exp.date || exp.createdAt)}
                  </div>

                  {exp.participants && exp.participants.length > 0 ? (
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      Split with {exp.participants.length} roommate(s)
                    </div>
                  ) : null}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontWeight: 900 }}>
                    ${formatMoney(Number(exp.amount) || 0)}
                  </div>

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

const inputStyle: React.CSSProperties = {
  background: "#0b0b0b",
  color: "white",
  border: "1px solid #2b2b2b",
  borderRadius: 10,
  padding: "10px 12px",
  outline: "none",
};

const miniBtnStyle: React.CSSProperties = {
  border: "1px solid #2b2b2b",
  borderRadius: 8,
  padding: "6px 10px",
  background: "#111",
  color: "white",
  cursor: "pointer",
};