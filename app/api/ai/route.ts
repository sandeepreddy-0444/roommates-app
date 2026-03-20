import OpenAI from "openai";
import { NextResponse } from "next/server";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { message, context } = body;

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is missing in .env.local" },
        { status: 500 }
      );
    }

    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const prompt = `
You are a smart assistant inside a roommates management app.

Answer only using the provided app data.
Be clear, short, and helpful.
Do not make up numbers.
If data is missing, say that clearly.

User question:
${message}

App data:
${JSON.stringify(context, null, 2)}
`;

    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: prompt,
    });

    return NextResponse.json({
      reply: response.output_text || "I could not generate a response.",
    });
  } catch (error: any) {
    console.error("OpenAI route error:", error);

    return NextResponse.json(
      {
        error: error?.message || "Failed to get AI response",
      },
      { status: 500 }
    );
  }
}