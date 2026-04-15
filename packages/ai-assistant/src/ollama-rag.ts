export function resolveOllamaBaseUrl(): string | null {
  const raw = process.env.OLLAMA_HOST ?? process.env.OLLAMA_BASE_URL;
  if (!raw?.trim()) {
    return null;
  }
  return raw.trim().replace(/\/$/, "");
}

export function resolveOllamaChatModel(): string {
  return (process.env.OLLAMA_CHAT_MODEL ?? "llama3.2").trim();
}

export function isOllamaChatAvailable(): boolean {
  return resolveOllamaBaseUrl() !== null;
}

export async function ollamaChatCompletion(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
): Promise<string> {
  const base = resolveOllamaBaseUrl();
  if (!base) {
    throw new Error("Ollama base URL not configured");
  }
  const model = resolveOllamaChatModel();
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Ollama chat failed (${response.status}): ${detail.slice(0, 400)}`);
  }

  const data = (await response.json()) as { message?: { content?: string } };
  const content = data.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Ollama chat response missing message.content");
  }
  return content.trim();
}
