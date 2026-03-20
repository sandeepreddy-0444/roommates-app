"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { auth, db } from "@/app/lib/firebase";

type Expense = {
  id: string;
  title: string;
  amount: number;
  paidByUid?: string;
  createdByUid?: string;
  splitMap?: Record<string, number>;
  participants?: string[];
  date?: string;
  createdAt?: any;
};

type Reminder = {
  id: string;
  title: string;
  dueDate: string;
  isActive: boolean;
};

type UserMap = Record<string, string>;

type Message = {
  role: "user" | "assistant";
  text: string;
};

export default function AIAssistantPanel() {
  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [users, setUsers] = useState<UserMap>({});
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: `Hi! Ask me things like:
- How much do I owe?
- Show my expenses this month
- Who paid the most?
- Who didn’t pay rent?
- What reminders are coming up?`,
    },
  ]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return;
      setUid(u.uid);

      const userSnap = await getDoc(doc(db, "users", u.uid));
      const userData = userSnap.exists() ? (userSnap.data() as any) : {};
      setGroupId(userData?.groupId || null);
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
          title: data?.title || "",
          amount: Number(data?.amount || 0),
          paidByUid: data?.paidByUid || data?.createdByUid || "",
          createdByUid: data?.createdByUid || "",
          splitMap: data?.splitMap || {},
          participants: Array.isArray(data?.participants)
            ? data.participants
            : [],
          date: data?.date || "",
          createdAt: data?.createdAt,
        };
      });

      setExpenses(rows);
    });

    return () => unsub();
  }, [groupId]);

  useEffect(() => {
    if (!groupId) return;

    const q = query(
      collection(db, "groups", groupId, "reminders"),
      orderBy("dueDate", "asc"),
      limit(100)
    );

    const unsub = onSnapshot(q, (snap) => {
      const rows: Reminder[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          title: data?.title || "",
          dueDate: data?.dueDate || "",
          isActive: data?.isActive ?? true,
        };
      });

      setReminders(rows);
    });

    return () => unsub();
  }, [groupId]);

  const computed = useMemo(() => {
    const myOwe = expenses.reduce((sum, e) => {
      const val = Number(e?.splitMap?.[uid || ""] || 0);
      return sum + (Number.isFinite(val) ? val : 0);
    }, 0);

    const thisMonthExpenses = expenses.filter((e) =>
      isThisMonth(e.date, e.createdAt)
    );

    const myMonthExpenses = thisMonthExpenses.filter(
      (e) => (e.paidByUid || e.createdByUid) === uid
    );

    const spendByUser: Record<string, number> = {};
    for (const e of expenses) {
      const payer = e.paidByUid || e.createdByUid || "unknown";
      spendByUser[payer] = (spendByUser[payer] || 0) + Number(e.amount || 0);
    }

    return {
      myOwe,
      thisMonthExpenses,
      myMonthExpenses,
      spendByUser,
    };
  }, [expenses, uid]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: Message = { role: "user", text };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: text,
          context: {
            currentUserUid: uid,
            currentUserName: uid ? users[uid] || uid : null,
            groupId,
            users,
            expenses,
            reminders,
            summary: {
              myOwe: computed.myOwe,
              totalExpenses: expenses.length,
              thisMonthExpensesCount: computed.thisMonthExpenses.length,
              myMonthExpensesCount: computed.myMonthExpenses.length,
              activeReminders: reminders.filter((r) => r.isActive).length,
              spendByUser: computed.spendByUser,
            },
          },
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to get AI response");
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data?.reply || "I could not generate a reply.",
        },
      ]);
    } catch (error) {
      console.error("AI send error:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Something went wrong while contacting AI. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  if (!groupId) return <div>You are not in a room yet.</div>;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <h2 style={{ margin: 0 }}>AI Assistant</h2>

      <div
        style={{
          border: "1px solid #2b2b2b",
          borderRadius: 12,
          padding: 14,
          background: "#0b0b0b",
          maxHeight: 500,
          overflowY: "auto",
          display: "grid",
          gap: 10,
        }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "user" ? "end" : "start",
              maxWidth: "80%",
              border: "1px solid #2b2b2b",
              borderRadius: 12,
              padding: 12,
              background: m.role === "user" ? "#1f3a2a" : "#111",
              whiteSpace: "pre-wrap",
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
              {m.role === "user" ? "You" : "Assistant"}
            </div>
            <div>{m.text}</div>
          </div>
        ))}

        {loading && (
          <div
            style={{
              alignSelf: "start",
              maxWidth: "80%",
              border: "1px solid #2b2b2b",
              borderRadius: 12,
              padding: 12,
              background: "#111",
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
              Assistant
            </div>
            <div>Thinking...</div>
          </div>
        )}
      </div>

      <div
        style={{
          border: "1px solid #2b2b2b",
          borderRadius: 12,
          padding: 14,
          background: "#0b0b0b",
          display: "grid",
          gap: 10,
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask: How much do I owe?"
          rows={3}
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 10,
            border: "1px solid #2b2b2b",
            background: "#111",
            color: "white",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />

        <button onClick={send} style={buttonStyle} disabled={loading}>
          {loading ? "Thinking..." : "Ask AI"}
        </button>
      </div>
    </div>
  );
}

function isThisMonth(dateString?: string, createdAt?: any) {
  let d: Date | null = null;

  if (dateString) {
    const temp = new Date(`${dateString}T00:00:00`);
    if (!Number.isNaN(temp.getTime())) d = temp;
  }

  if (!d && createdAt?.toDate) d = createdAt.toDate();
  if (!d) return false;

  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth()
  );
}

const buttonStyle: React.CSSProperties = {
  border: "1px solid #2b2b2b",
  borderRadius: 10,
  padding: "10px 12px",
  background: "white",
  color: "black",
  fontWeight: 800,
  cursor: "pointer",
};