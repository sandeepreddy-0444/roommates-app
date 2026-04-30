/** Minimal expense shape for local answers (mirrors AIAssistantPanel). */
export type LocalExpense = {
  amount: number;
  date?: string;
  createdAt?: unknown;
};

export type LocalAnswerContext = {
  uid: string | null;
  users: Record<string, string>;
  expenses: LocalExpense[];
  reminders: Array<{ id: string; title: string; dueDate: string; isActive: boolean }>;
  computed: {
    myOwe: number;
    thisMonthExpenses: LocalExpense[];
    myMonthExpenses: LocalExpense[];
    spendByUser: Record<string, number>;
  };
};

function norm(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function monthLabel(d: Date) {
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

/**
 * Pattern-based answers from live Firestore-backed context (no network).
 * Returns null when the question should be handled by the LLM instead.
 */
export function tryLocalAssistantAnswer(
  raw: string,
  ctx: LocalAnswerContext
): string | null {
  const q = norm(raw);
  if (!q || !ctx.uid) return null;

  const name = ctx.users[ctx.uid] || "You";

  const owesYou =
    /\b(how much do i owe|what do i owe|how much i owe|my share|split total|balance)\b/.test(q) ||
    (q.includes("owe") && (q.includes("how much") || q.includes("do i") || q.includes("i owe")));

  if (owesYou) {
    return `${name}, across visible expenses your split amounts add up to $${ctx.computed.myOwe.toFixed(2)} (same as the “You owe” pill above). This is the sum of your shares in splitMap — not net cash paid vs received.`;
  }

  const thisMonth =
    q.includes("this month") ||
    q.includes("expenses this month") ||
    q.includes("spent this month") ||
    /\b(month so far|current month)\b/.test(q);

  if (thisMonth) {
    const list = ctx.computed.thisMonthExpenses;
    const total = list.reduce((s, e) => s + Number(e.amount || 0), 0);
    const now = new Date();
    return `${monthLabel(now)}: ${list.length} expense(s) dated this month, totaling $${total.toFixed(2)} (visible to you). You paid for ${ctx.computed.myMonthExpenses.length} of them.`;
  }

  const paidMost =
    q.includes("who paid the most") ||
    q.includes("paid the most") ||
    q.includes("biggest payer") ||
    q.includes("top spender") ||
    (q.includes("who") && q.includes("paid") && q.includes("most"));

  if (paidMost) {
    const entries = Object.entries(ctx.computed.spendByUser);
    if (entries.length === 0) {
      return "No payer totals yet from visible expenses.";
    }
    entries.sort((a, b) => b[1] - a[1]);
    const [topUid, topAmt] = entries[0];
    const topName = ctx.users[topUid] || topUid.slice(0, 8);
    return `${topName} paid the most by gross total: $${topAmt.toFixed(2)} across visible expenses (amounts on the bill, before splits).`;
  }

  const remindersQ =
    q.includes("reminder") ||
    q.includes("upcoming") ||
    q.includes("due soon") ||
    q.includes("bills coming");

  if (remindersQ) {
    const active = ctx.reminders.filter((r) => r.isActive);
    if (active.length === 0) {
      return "No active reminders right now.";
    }
    const lines = active.slice(0, 8).map((r) => {
      const when = r.dueDate || "no date";
      return `• ${r.title} — due ${when}`;
    });
    return `Active reminders (${active.length}):\n${lines.join("\n")}`;
  }

  const help =
    q === "help" ||
    q === "?" ||
    q.includes("what can you do") ||
    q.includes("how does this work");

  if (help) {
    return `Try:\n• “How much do I owe?” — your split total\n• “Expenses this month” — count & sum\n• “Who paid the most?” — by gross paid\n• “Upcoming reminders?” — active list\n\nOpen-ended questions need AI (set OPENAI_API_KEY).`;
  }

  return null;
}
