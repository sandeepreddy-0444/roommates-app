import OpenAI from "openai";
import { NextResponse } from "next/server";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

/** Lets the client show setup UI without attempting chat. */
export async function GET() {
  const configured = !!process.env.OPENAI_API_KEY?.trim();
  return NextResponse.json({ configured, model: MODEL });
}

const SYSTEM_PROMPT = `You are the helpful AI assistant for a shared “Roommates” app. Each request includes JSON: expenses, reminders, people, optional chore/cook schedule, group chat, grocery, polls, and summary stats.

**This room (strict)**
- For money, who paid, who owes, reminders, who cooks/cleans on which day, chat, grocery, or polls: use ONLY the provided JSON. Never invent UIDs, amounts, names, or dates.
- "How much do I owe" → summary.myOwe (sum of the current user’s splitMap on visible expenses) unless they clearly mean something else.
- "Who paid the most" → summary.spendByUser.
- "Who is cooking on [day]?" / chores → choreScheduleByDay: look up the weekday, then Morning / Afternoon / Night (or Cleaning) slots and the person’s name.
- customChores = extra tasks (trash, vacuum, etc.): title, assignee name, done flag.

**General topics**
- For questions not about this room, you may answer with general knowledge briefly. Label room facts vs. general info when both apply.

**Style**
- Concise, friendly, mobile-friendly. Bullets for lists. USD with two decimals.`;

export async function POST(req: Request) {
  try {
    const client = getOpenAIClient();
    const body = await req.json();
    const { message, context } = body as { message?: string; context?: unknown };

    if (!client) {
      return NextResponse.json(
        {
          error:
            "AI is not configured. Add OPENAI_API_KEY to .env.local in the project root, then restart `npm run dev`.",
          code: "AI_NOT_CONFIGURED",
        },
        { status: 503 }
      );
    }

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const userQuestion = message.trim();
    const dataPayload =
      typeof context === "object" && context !== null
        ? JSON.stringify(context, null, 2)
        : "{}";

    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Question:\n${userQuestion}\n\nApp context (JSON):\n${dataPayload}`,
        },
      ],
      max_tokens: 1200,
      temperature: 0.25,
    });

    const reply =
      response.choices[0]?.message?.content?.trim() || "I could not generate a response.";

    return NextResponse.json({ reply });
  } catch (error: unknown) {
    const err = error as { message?: string; status?: number; code?: string };
    console.error("OpenAI route error:", error);

    const message =
      err?.message ||
      (typeof error === "object" && error && "toString" in error
        ? String(error)
        : "Failed to get AI response");

    const status = typeof err?.status === "number" ? err.status : undefined;
    const isQuota =
      status === 429 ||
      /exceeded your (current )?quota|insufficient[_ ]?quota|billing|rate limit/i.test(
        message
      );

    if (isQuota) {
      return NextResponse.json(
        {
          error: message,
          code: "OPENAI_QUOTA",
        },
        { status: 402 }
      );
    }

    return NextResponse.json({ error: message, code: "OPENAI_ERROR" }, { status: 500 });
  }
}
