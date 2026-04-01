"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

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

  const activeRemindersCount = reminders.filter((r) => r.isActive).length;

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
              activeReminders: activeRemindersCount,
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

  if (!groupId) {
    return (
      <div style={shellStyle}>
        <div style={emptyStateStyle}>
          <div style={emptyIconStyle}>🤖</div>
          <h2 style={emptyTitleStyle}>You are not in a room yet</h2>
          <p style={emptyTextStyle}>
            Join a room to ask AI about shared expenses, balances, reminders, and
            roommate activity.
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
          <div style={eyebrowStyle}>AI Assistant</div>
          <div style={heroHeaderStyle}>
            <div>
              <h2 style={titleStyle}>Your smart room copilot</h2>
              <p style={subtitleStyle}>
                Ask questions about expenses, who paid what, balances, and
                upcoming reminders with room-aware AI context.
              </p>
            </div>
          </div>

          <div style={statsGridStyle}>
            <div style={statCardStyle}>
              <div style={statLabelStyle}>Your Total Owed</div>
              <div style={statValueStyle}>${computed.myOwe.toFixed(2)}</div>
            </div>

            <div style={statCardStyle}>
              <div style={statLabelStyle}>This Month Expenses</div>
              <div style={statValueStyle}>{computed.thisMonthExpenses.length}</div>
            </div>

            <div style={statCardStyle}>
              <div style={statLabelStyle}>Your Paid This Month</div>
              <div style={statValueStyle}>{computed.myMonthExpenses.length}</div>
            </div>

            <div style={statCardStyle}>
              <div style={statLabelStyle}>Active Reminders</div>
              <div style={statValueStyle}>{activeRemindersCount}</div>
            </div>
          </div>
        </div>
      </div>

      <div style={layoutGridStyle}>
        <div style={chatCardStyle}>
          <div style={chatHeaderStyle}>
            <div>
              <div style={sectionEyebrowStyle}>Conversation</div>
              <h3 style={sectionTitleStyle}>Chat with your assistant</h3>
              <p style={sectionTextStyle}>
                Press Enter to send. Use Shift + Enter for a new line.
              </p>
            </div>
          </div>

          <div style={messagesPanelStyle}>
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  ...messageRowStyle,
                  justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    ...messageBubbleStyle,
                    ...(m.role === "user"
                      ? userMessageStyle
                      : assistantMessageStyle),
                  }}
                >
                  <div style={messageRoleStyle}>
                    {m.role === "user" ? "You" : "Assistant"}
                  </div>
                  <div style={messageTextStyle}>{m.text}</div>
                </div>
              </div>
            ))}

            {loading && (
              <div style={messageRowStyle}>
                <div style={{ ...messageBubbleStyle, ...assistantMessageStyle }}>
                  <div style={messageRoleStyle}>Assistant</div>
                  <div style={thinkingWrapStyle}>
                    <span style={thinkingDotStyle} />
                    <span style={thinkingDotStyle} />
                    <span style={thinkingDotStyle} />
                    <span style={{ marginLeft: 8 }}>Thinking...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div style={composerStyle}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask: How much do I owe?"
              rows={4}
              style={textareaStyle}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />

            <div style={composerFooterStyle}>
              <div style={hintTextStyle}>
                Try asking about spending trends, dues, reminders, or monthly
                totals.
              </div>

              <button
                onClick={send}
                style={{
                  ...primaryButtonStyle,
                  ...(loading ? disabledButtonStyle : {}),
                }}
                disabled={loading}
              >
                {loading ? "Thinking..." : "Ask AI"}
              </button>
            </div>
          </div>
        </div>

        <div style={sidePanelStyle}>
          <div style={tipsCardStyle}>
            <div style={sectionEyebrowStyle}>Suggestions</div>
            <h3 style={sectionTitleStyle}>Good prompts</h3>

            <div style={promptListStyle}>
              {[
                "How much do I owe right now?",
                "Show my expenses this month",
                "Who paid the most so far?",
                "What reminders are coming up?",
                "Summarize this room’s spending",
              ].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => setInput(prompt)}
                  style={promptButtonStyle}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div style={tipsCardStyle}>
            <div style={sectionEyebrowStyle}>Live context</div>
            <h3 style={sectionTitleStyle}>What AI can see</h3>

            <div style={contextListStyle}>
              <div style={contextRowStyle}>
                <span style={contextLabelStyle}>Roommates</span>
                <span style={contextValueStyle}>{Object.keys(users).length}</span>
              </div>
              <div style={contextRowStyle}>
                <span style={contextLabelStyle}>Expenses loaded</span>
                <span style={contextValueStyle}>{expenses.length}</span>
              </div>
              <div style={contextRowStyle}>
                <span style={contextLabelStyle}>Reminders loaded</span>
                <span style={contextValueStyle}>{reminders.length}</span>
              </div>
              <div style={contextRowStyle}>
                <span style={contextLabelStyle}>Current user</span>
                <span style={contextValueStyle}>
                  {uid ? users[uid] || "You" : "You"}
                </span>
              </div>
            </div>
          </div>
        </div>
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

const heroHeaderStyle: React.CSSProperties = {
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

const layoutGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.7fr) minmax(300px, 0.9fr)",
  gap: 18,
  alignItems: "start",
};

const chatCardStyle: React.CSSProperties = {
  borderRadius: 24,
  padding: 20,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(10,14,24,0.82)",
  boxShadow: "0 18px 40px rgba(0,0,0,0.28)",
  backdropFilter: "blur(18px)",
  display: "grid",
  gap: 16,
};

const sidePanelStyle: React.CSSProperties = {
  display: "grid",
  gap: 18,
  alignContent: "start",
};

const tipsCardStyle: React.CSSProperties = {
  borderRadius: 24,
  padding: 20,
  border: "1px solid rgba(255,255,255,0.08)",
  background:
    "linear-gradient(180deg, rgba(15,23,42,0.84), rgba(2,6,23,0.98))",
  boxShadow: "0 18px 40px rgba(0,0,0,0.28)",
};

const chatHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
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

const messagesPanelStyle: React.CSSProperties = {
  minHeight: 360,
  maxHeight: 560,
  overflowY: "auto",
  display: "grid",
  gap: 14,
  padding: 12,
  borderRadius: 20,
  border: "1px solid rgba(255,255,255,0.06)",
  background:
    "linear-gradient(180deg, rgba(2,6,23,0.82), rgba(15,23,42,0.5))",
};

const messageRowStyle: React.CSSProperties = {
  display: "flex",
};

const messageBubbleStyle: React.CSSProperties = {
  maxWidth: "84%",
  borderRadius: 22,
  padding: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  whiteSpace: "pre-wrap",
  lineHeight: 1.75,
  boxShadow: "0 12px 28px rgba(0,0,0,0.22)",
};

const userMessageStyle: React.CSSProperties = {
  background:
    "linear-gradient(135deg, rgba(37,99,235,0.96), rgba(124,58,237,0.9))",
  color: "#ffffff",
};

const assistantMessageStyle: React.CSSProperties = {
  background:
    "linear-gradient(180deg, rgba(18,27,47,0.96), rgba(2,6,23,0.98))",
  color: "#edf4ff",
};

const messageRoleStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.78,
  marginBottom: 8,
  fontWeight: 700,
};

const messageTextStyle: React.CSSProperties = {
  fontSize: 14,
};

const thinkingWrapStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  color: "#cbd5e1",
  fontSize: 14,
};

const thinkingDotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: "rgba(147,197,253,0.9)",
  display: "inline-block",
  marginRight: 5,
};

const composerStyle: React.CSSProperties = {
  borderRadius: 20,
  padding: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))",
  display: "grid",
  gap: 12,
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: 16,
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(2,6,23,0.8)",
  color: "white",
  outline: "none",
  resize: "vertical",
  minHeight: 120,
  fontSize: 14,
  lineHeight: 1.65,
};

const composerFooterStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap",
};

const hintTextStyle: React.CSSProperties = {
  color: "rgba(203,213,225,0.68)",
  fontSize: 13,
};

const primaryButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 14,
  padding: "12px 18px",
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

const promptListStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
  marginTop: 14,
};

const promptButtonStyle: React.CSSProperties = {
  textAlign: "left",
  borderRadius: 16,
  padding: "14px 16px",
  border: "1px solid rgba(255,255,255,0.08)",
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))",
  color: "#dbeafe",
  cursor: "pointer",
  fontWeight: 700,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
};

const contextListStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
  marginTop: 14,
};

const contextRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  borderRadius: 14,
  padding: "13px 14px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.06)",
};

const contextLabelStyle: React.CSSProperties = {
  color: "#cbd5e1",
  fontSize: 14,
};

const contextValueStyle: React.CSSProperties = {
  color: "#ffffff",
  fontWeight: 800,
  fontSize: 14,
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