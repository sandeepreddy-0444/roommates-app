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
  type Timestamp,
} from "firebase/firestore";
import { auth, db } from "@/app/lib/firebase";
import { choreFirestoreDocToAiSchedule } from "@/app/lib/choreScheduleForAi";
import {
  tryLocalAssistantAnswer,
  type LocalAnswerContext,
} from "@/app/lib/aiLocalAnswers";

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

const MOBILE_BREAKPOINT = 900;
const EXPENSE_LIMIT = 200;
const REMINDER_LIMIT = 60;
const CONTEXT_EXPENSE_LIMIT = 80;
const CONTEXT_REMINDER_LIMIT = 40;
const CHAT_CONTEXT_LIMIT = 100;
const GROCERY_CONTEXT_LIMIT = 80;
const POLLS_CONTEXT_LIMIT = 20;

export default function AIAssistantPanel() {
  const [uid, setUid] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [users, setUsers] = useState<UserMap>({});
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  /** Raw chore doc — paired with `users` in useMemo for names. */
  const [choreDocData, setChoreDocData] = useState<Record<string, unknown> | null>(
    null
  );
  const [chatForAi, setChatForAi] = useState<
    { text: string; from: string; at: string }[]
  >([]);
  const [groceryForAi, setGroceryForAi] = useState<
    { name: string; qty: string; category: string; bought: boolean }[]
  >([]);
  const [pollsForAi, setPollsForAi] = useState<
    {
      question: string;
      closed: boolean;
      options: { text: string; voteCount: number }[];
    }[]
  >([]);
  const [rawChoreExtras, setRawChoreExtras] = useState<
    { title: string; assigneeUid: string | null; done: boolean }[]
  >([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const prevMessageCountRef = useRef(0);

  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Ask about expenses, who cooks on which day, chat, grocery, polls, and reminders. Quick chips answer instantly; open-ended questions use your full room data plus AI when the API is enabled.",
    },
  ]);

  const isMobile =
    typeof window !== "undefined" ? window.innerWidth <= MOBILE_BREAKPOINT : false;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ai");
        const data = (await res.json()) as { configured?: boolean };
        if (!cancelled) setAiConfigured(!!data.configured);
      } catch {
        if (!cancelled) setAiConfigured(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      limit(EXPENSE_LIMIT)
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
      limit(REMINDER_LIMIT)
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
    if (!groupId) {
      setChoreDocData(null);
      return;
    }
    const ref = doc(db, "groups", groupId, "choreTable", "schedule");
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setChoreDocData(null);
        return;
      }
      setChoreDocData(snap.data() as Record<string, unknown>);
    });
    return () => unsub();
  }, [groupId]);

  const choreScheduleByDay = useMemo(
    () => choreFirestoreDocToAiSchedule(choreDocData ?? undefined, users),
    [choreDocData, users]
  );

  useEffect(() => {
    if (!groupId) {
      setChatForAi([]);
      return;
    }
    const q = query(
      collection(db, "groups", groupId, "messages"),
      orderBy("createdAt", "desc"),
      limit(CHAT_CONTEXT_LIMIT)
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs
        .map((d) => {
          const data = d.data() as {
            text?: string;
            senderName?: string;
            createdAt?: Timestamp;
            imageUrl?: string;
          };
          const text = (data.text || "").trim();
          const t = data.createdAt?.toDate
            ? data.createdAt.toDate().toISOString()
            : "";
          if (!text && data.imageUrl) {
            return {
              text: "[image]",
              from: data.senderName || "Someone",
              at: t,
            };
          }
          if (!text) return null;
          return {
            text: text.length > 500 ? `${text.slice(0, 500)}…` : text,
            from: data.senderName || "Someone",
            at: t,
          };
        })
        .filter((r): r is { text: string; from: string; at: string } => r !== null);
      rows.reverse();
      setChatForAi(rows);
    });
    return () => unsub();
  }, [groupId]);

  useEffect(() => {
    if (!groupId) {
      setGroceryForAi([]);
      return;
    }
    const q = query(
      collection(db, "groups", groupId, "grocery"),
      orderBy("createdAt", "desc"),
      limit(GROCERY_CONTEXT_LIMIT)
    );
    const unsub = onSnapshot(q, (snap) => {
      setGroceryForAi(
        snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            name: typeof data.name === "string" ? data.name : "",
            qty: typeof data.qty === "string" ? data.qty : "",
            category: typeof data.category === "string" ? data.category : "",
            bought: !!data.bought,
          };
        })
      );
    });
    return () => unsub();
  }, [groupId]);

  useEffect(() => {
    if (!groupId) {
      setPollsForAi([]);
      return;
    }
    const q = query(
      collection(db, "groups", groupId, "polls"),
      orderBy("createdAt", "desc"),
      limit(POLLS_CONTEXT_LIMIT)
    );
    const unsub = onSnapshot(q, (snap) => {
      setPollsForAi(
        snap.docs.map((d) => {
          const data = d.data() as {
            question?: string;
            closed?: boolean;
            options?: { text?: string; votes?: string[] }[];
          };
          const options = Array.isArray(data.options) ? data.options : [];
          return {
            question:
              typeof data.question === "string" ? data.question : "Poll",
            closed: !!data.closed,
            options: options.map((o) => ({
              text: typeof o?.text === "string" ? o.text : "",
              voteCount: Array.isArray(o?.votes) ? o.votes.length : 0,
            })),
          };
        })
      );
    });
    return () => unsub();
  }, [groupId]);

  useEffect(() => {
    if (!groupId) {
      setRawChoreExtras([]);
      return;
    }
    const q = query(
      collection(db, "groups", groupId, "choreExtras"),
      orderBy("createdAt", "desc"),
      limit(80)
    );
    const unsub = onSnapshot(q, (snap) => {
      setRawChoreExtras(
        snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          const aid = data.assigneeUid;
          return {
            title: typeof data.title === "string" ? data.title : "",
            assigneeUid: typeof aid === "string" && aid ? aid : null,
            done: !!data.done,
          };
        })
      );
    });
    return () => unsub();
  }, [groupId]);

  const customChoresForAi = useMemo(
    () =>
      rawChoreExtras.map((r) => ({
        title: r.title,
        assignee: r.assigneeUid
          ? users[r.assigneeUid] || r.assigneeUid.slice(0, 8)
          : "Anyone",
        done: r.done,
      })),
    [rawChoreExtras, users]
  );

  useEffect(() => {
    const hasNewMessage = messages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    if (!hasNewMessage && !loading) return;

    messagesEndRef.current?.scrollIntoView({
      behavior: isMobile ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, loading, isMobile]);

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

  const activeRemindersCount = useMemo(
    () => reminders.filter((r) => r.isActive).length,
    [reminders]
  );

  const summarizedExpenses = useMemo(
    () =>
      expenses.slice(0, CONTEXT_EXPENSE_LIMIT).map((e) => ({
        id: e.id,
        title: e.title,
        amount: e.amount,
        paidByUid: e.paidByUid || e.createdByUid || "",
        splitMap: e.splitMap || {},
        participants: e.participants || [],
        date: e.date || "",
      })),
    [expenses]
  );

  const summarizedReminders = useMemo(
    () =>
      reminders.slice(0, CONTEXT_REMINDER_LIMIT).map((r) => ({
        id: r.id,
        title: r.title,
        dueDate: r.dueDate,
        isActive: r.isActive,
      })),
    [reminders]
  );

  async function runChatTurn(userText: string) {
    const text = userText.trim();
    if (!text || loading) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setLoading(true);

    const localCtx: LocalAnswerContext = {
      uid,
      users,
      expenses,
      reminders,
      computed: {
        myOwe: computed.myOwe,
        thisMonthExpenses: computed.thisMonthExpenses,
        myMonthExpenses: computed.myMonthExpenses,
        spendByUser: computed.spendByUser,
      },
    };

    const localReply = tryLocalAssistantAnswer(text, localCtx);
    if (localReply) {
      setMessages((prev) => [...prev, { role: "assistant", text: localReply }]);
      setLoading(false);
      return;
    }

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
            expenses: summarizedExpenses,
            reminders: summarizedReminders,
            choreScheduleByDay: choreScheduleByDay,
            customChores: customChoresForAi,
            groupChatRecent: chatForAi,
            groceryList: groceryForAi,
            polls: pollsForAi,
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

      let data: { reply?: string; error?: string; code?: string } = {};
      try {
        data = await res.json();
      } catch {
        throw new Error(`Server returned ${res.status}. Check the network and API route.`);
      }

      if (!res.ok) {
        if (res.status === 503 && data?.code === "AI_NOT_CONFIGURED") {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              text: "Cloud AI isn’t configured. Add OPENAI_API_KEY to .env.local in the project root, restart npm run dev, then ask again. Quick prompts above still work from your live room data.",
            },
          ]);
          setAiConfigured(false);
          return;
        }
        if (res.status === 402 && data?.code === "OPENAI_QUOTA") {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              text: "OpenAI blocked this request: no API quota or billing isn’t set up (error 429). Fix it on your OpenAI account — open Billing and add a payment method or credits:\nhttps://platform.openai.com/account/billing\n\nThen try again. The quick prompt chips above still answer from your room data without the API.",
            },
          ]);
          return;
        }
        throw new Error(data?.error || `Request failed (${res.status}).`);
      }

      setAiConfigured(true);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data?.reply || "I could not generate a reply.",
        },
      ]);
    } catch (error) {
      console.error("AI send error:", error);
      const detail =
        error instanceof Error ? error.message : "Something went wrong while contacting AI.";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Couldn’t get an answer: ${detail}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function send() {
    void runChatTurn(input);
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

  const quickPrompts = [
    "How much do I owe?",
    "Expenses this month",
    "Who paid the most?",
    "Upcoming reminders?",
  ];

  return (
    <div style={shellStyle}>
      <div style={aiHeroCompactStyle}>
        {aiConfigured === false ? (
          <div style={aiSetupBannerStyle} role="status">
            <strong style={aiSetupBannerTitleStyle}>Full AI is off</strong>
            <span style={aiSetupBannerTextStyle}>
              Add <code style={aiSetupCodeStyle}>OPENAI_API_KEY</code> to{" "}
              <code style={aiSetupCodeStyle}>.env.local</code>, restart{" "}
              <code style={aiSetupCodeStyle}>npm run dev</code>. Quick prompts still work without it.
            </span>
          </div>
        ) : null}
        <div style={aiStatStripStyle} aria-label="Room snapshot">
          <div style={aiStatPillStyle}>
            <span style={aiStatPillLabelStyle}>You owe</span>
            <span style={aiStatPillValueStyle}>${computed.myOwe.toFixed(2)}</span>
          </div>
          <div style={aiStatPillStyle}>
            <span style={aiStatPillLabelStyle}>This month</span>
            <span style={aiStatPillValueStyle}>{computed.thisMonthExpenses.length}</span>
          </div>
          <div style={aiStatPillStyle}>
            <span style={aiStatPillLabelStyle}>Your pays</span>
            <span style={aiStatPillValueStyle}>{computed.myMonthExpenses.length}</span>
          </div>
          <div style={aiStatPillStyle}>
            <span style={aiStatPillLabelStyle}>Reminders</span>
            <span style={aiStatPillValueStyle}>{activeRemindersCount}</span>
          </div>
        </div>
        <p style={aiContextHintStyle}>
          {Object.keys(users).length} people · {expenses.length} expenses · {reminders.length}{" "}
          reminders
        </p>
      </div>

      <div style={chatCardCompactStyle}>
        <div style={messagesPanelCompactStyle} className="app-scroll">
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
                  ...messageBubbleCompactStyle,
                  ...(m.role === "user" ? userMessageStyle : assistantMessageStyle),
                }}
              >
                <div style={messageRoleStyle}>{m.role === "user" ? "You" : "AI"}</div>
                <div style={messageTextStyle}>{m.text}</div>
              </div>
            </div>
          ))}

          {loading ? (
            <div style={messageRowStyle}>
              <div style={{ ...messageBubbleStyle, ...messageBubbleCompactStyle, ...assistantMessageStyle }}>
                <div style={messageRoleStyle}>AI</div>
                <div style={thinkingWrapStyle}>
                  <span style={thinkingDotStyle} />
                  <span style={thinkingDotStyle} />
                  <span style={thinkingDotStyle} />
                  <span style={{ marginLeft: 8, fontSize: 13 }}>Thinking…</span>
                </div>
              </div>
            </div>
          ) : null}

          <div ref={messagesEndRef} />
        </div>

        <div style={chipRowStyle}>
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => void runChatTurn(prompt)}
              disabled={loading}
              style={{
                ...chipButtonStyle,
                ...(loading ? { opacity: 0.55, cursor: "not-allowed" } : {}),
              }}
            >
              {prompt}
            </button>
          ))}
        </div>

        <div style={composerStyle}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything… (Enter to send)"
            rows={2}
            style={textareaCompactStyle}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            type="button"
            onClick={() => send()}
            style={{
              ...primaryButtonStyle,
              ...(loading ? disabledButtonStyle : {}),
            }}
            disabled={loading}
          >
            {loading ? "…" : "Send"}
          </button>
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
  gap: 12,
  minWidth: 0,
  color: "#0f172a",
};

const aiHeroCompactStyle: React.CSSProperties = {
  borderRadius: 18,
  padding: "12px 14px 10px",
  border: "1px solid var(--app-border-subtle)",
  background: "linear-gradient(145deg, color-mix(in srgb, var(--app-accent) 8%, var(--app-surface-elevated)), var(--app-surface-elevated))",
  boxShadow: "var(--app-shadow-sheet)",
  display: "grid",
  gap: 10,
};

const aiSetupBannerStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid rgba(245, 158, 11, 0.45)",
  background: "rgba(254, 243, 199, 0.92)",
  display: "grid",
  gap: 6,
};

const aiSetupBannerTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  color: "#92400e",
};

const aiSetupBannerTextStyle: React.CSSProperties = {
  fontSize: "clamp(11px, 2.85vw, 12px)",
  lineHeight: 1.45,
  color: "#78350f",
};

const aiSetupCodeStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "0.92em",
  padding: "1px 5px",
  borderRadius: 6,
  background: "rgba(255,255,255,0.75)",
  border: "1px solid rgba(245, 158, 11, 0.35)",
};

const aiStatStripStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 0,
};

const aiStatPillStyle: React.CSSProperties = {
  display: "inline-flex",
  flexDirection: "column",
  gap: 2,
  padding: "6px 10px",
  borderRadius: 12,
  background: "var(--app-surface-card)",
  border: "1px solid var(--app-border-subtle)",
  minWidth: 0,
};

const aiStatPillLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "rgba(15, 23, 42, 0.5)",
};

const aiStatPillValueStyle: React.CSSProperties = {
  fontSize: "clamp(14px, 3.2vw, 16px)",
  fontWeight: 800,
  color: "#0f172a",
  fontVariantNumeric: "tabular-nums",
};

const aiContextHintStyle: React.CSSProperties = {
  margin: "8px 0 0",
  fontSize: 11,
  color: "rgba(15, 23, 42, 0.45)",
};

const chatCardCompactStyle: React.CSSProperties = {
  borderRadius: 18,
  padding: 12,
  border: "1px solid var(--app-border-subtle)",
  background: "var(--app-surface-elevated)",
  boxShadow: "var(--app-shadow-sheet)",
  display: "grid",
  gap: 10,
  minWidth: 0,
};

const messagesPanelCompactStyle: React.CSSProperties = {
  minHeight: 200,
  maxHeight: "48vh",
  overflowY: "auto",
  display: "grid",
  gap: 10,
  padding: 10,
  borderRadius: 14,
  border: "1px solid var(--app-border-subtle)",
  background: "rgba(248, 250, 252, 0.95)",
  minWidth: 0,
  WebkitOverflowScrolling: "touch",
  overscrollBehavior: "contain",
};

const messageBubbleCompactStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 16,
  lineHeight: 1.5,
  fontSize: 14,
};

const chipRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};

const chipButtonStyle: React.CSSProperties = {
  fontSize: "clamp(11px, 2.8vw, 12px)",
  fontWeight: 650,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid var(--app-border-subtle)",
  background: "var(--app-surface-card)",
  color: "var(--app-accent, #2563eb)",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};

const textareaCompactStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid var(--app-border-subtle)",
  background: "#ffffff",
  color: "#0f172a",
  outline: "none",
  resize: "none",
  minHeight: 72,
  fontSize: 15,
  lineHeight: 1.45,
  boxSizing: "border-box",
};

const messageRowStyle: React.CSSProperties = {
  display: "flex",
  minWidth: 0,
};

const messageBubbleStyle: React.CSSProperties = {
  maxWidth: "92%",
  borderRadius: 20,
  padding: 14,
  border: "1px solid var(--app-border-subtle)",
  whiteSpace: "pre-wrap",
  lineHeight: 1.7,
  boxShadow: "0 4px 14px rgba(15, 23, 42, 0.06)",
  wordBreak: "break-word",
  overflowWrap: "anywhere",
};

const userMessageStyle: React.CSSProperties = {
  background:
    "linear-gradient(135deg, rgba(37,99,235,0.96), rgba(124,58,237,0.9))",
  color: "#ffffff",
};

const assistantMessageStyle: React.CSSProperties = {
  background: "var(--app-surface-card)",
  color: "#0f172a",
};

const messageRoleStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.72,
  marginBottom: 8,
  fontWeight: 700,
};

const messageTextStyle: React.CSSProperties = {
  fontSize: 14,
};

const thinkingWrapStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  color: "rgba(15, 23, 42, 0.65)",
  fontSize: 14,
};

const thinkingDotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: "rgba(37, 99, 235, 0.55)",
  display: "inline-block",
  marginRight: 5,
};

const composerStyle: React.CSSProperties = {
  borderRadius: "var(--app-radius-card)",
  padding: "clamp(12px, 3vw, 16px)",
  border: "1px solid var(--app-border-subtle)",
  background: "rgba(255, 255, 255, 0.72)",
  display: "grid",
  gap: 12,
  minWidth: 0,
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
  boxShadow: "0 10px 22px rgba(59,130,246,0.20)",
  width: "100%",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
};

const disabledButtonStyle: React.CSSProperties = {
  opacity: 0.65,
  cursor: "not-allowed",
};

const emptyStateStyle: React.CSSProperties = {
  borderRadius: "var(--app-radius-sheet)",
  padding: 28,
  border: "1px solid var(--app-border-subtle)",
  background: "var(--app-surface-elevated)",
  boxShadow: "var(--app-shadow-sheet)",
  textAlign: "center",
};

const emptyIconStyle: React.CSSProperties = {
  fontSize: 34,
  marginBottom: 12,
};

const emptyTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#0f172a",
  fontSize: 22,
  fontWeight: 800,
};

const emptyTextStyle: React.CSSProperties = {
  margin: "10px auto 0",
  maxWidth: 520,
  color: "rgba(15, 23, 42, 0.65)",
  lineHeight: 1.6,
};