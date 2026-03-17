/**
 * Arato.ai monitoring integration.
 *
 * Sends structured log payloads to the Arato REST API for each
 * LLM request/response cycle.  Configure via env vars:
 *   ARATO_API_URL   – e.g. https://api.arato.ai/<project>/log
 *   ARATO_API_KEY   – Bearer token
 */

export interface AratoLogParams {
  model: string;
  id: string;
  messages: { role: string; content: string }[];
  response: string;
  variables?: Record<string, unknown>;
  usage?: { prompt_tokens: number; completion_tokens: number };
  performance?: { ttft: number; ttlt: number };
  toolCalls?: unknown;
  threadId?: string | null;
  promptId?: string | null;
  promptVersion?: string | null;
  tags?: Record<string, string>;
}

/**
 * Post a monitoring log entry to Arato.
 * Silently no-ops if ARATO_API_URL is not configured.
 */
export async function postAratoLog(params: AratoLogParams): Promise<void> {
  const url = process.env.ARATO_API_URL;
  const apiKey = process.env.ARATO_API_KEY;

  if (!url) return; // Arato integration not configured

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const body = {
    model: params.model,
    id: params.id,
    messages: params.messages,
    response: params.response,
    variables: params.variables ?? {},
    usage: params.usage ?? {},
    performance: params.performance ?? {},
    tool_calls: params.toolCalls ?? null,
    arato_thread_id: params.threadId ?? null,
    prompt_id: params.promptId ?? null,
    prompt_version: params.promptVersion ?? null,
    tags: params.tags ?? {},
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    console.log("[Arato] Log status:", res.status);
  } catch (err) {
    console.error("[Arato] Failed to log:", err);
  }
}
