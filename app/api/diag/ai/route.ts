import { NextResponse } from "next/server";

export async function GET() {
  const diag: Record<string, unknown> = {};

  // Check GROQ_API_KEY presence (never expose the value)
  diag.groqApiKeySet = !!process.env.GROQ_API_KEY;
  diag.groqApiKeyLength = process.env.GROQ_API_KEY?.length ?? 0;

  // Check GROQ_MODEL
  diag.groqModel = process.env.GROQ_MODEL || null;
  diag.effectiveModel = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  // Check AI_PROVIDER
  diag.aiProvider = process.env.AI_PROVIDER || "groq";

  // List available Groq models
  try {
    const modelsResponse = await fetch("https://api.groq.com/openai/v1/models", {
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
    });
    if (modelsResponse.ok) {
      const modelsData = await modelsResponse.json();
      diag.availableModels = (modelsData.data || [])
        .map((m: { id: string }) => m.id)
        .filter((id: string) => id.includes("llama") || id.includes("mixtral") || id.includes("gemma"))
        .slice(0, 20);
    } else {
      diag.modelsListStatus = modelsResponse.status;
    }
  } catch (error) {
    diag.modelsListError = error instanceof Error ? error.message : String(error);
  }

  // Test Groq API call
  try {
    const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Say hello" }],
        max_tokens: 10,
      }),
    });

    diag.groqStatus = response.status;

    if (!response.ok) {
      const errorText = await response.text();
      diag.groqError = errorText.substring(0, 500);
    } else {
      const data = await response.json();
      diag.groqResponse = data.choices?.[0]?.message?.content || "empty";
      diag.groqModel = data.model;
    }
  } catch (error) {
    diag.groqFetchError = error instanceof Error ? error.message : String(error);
  }

  return NextResponse.json(diag);
}
