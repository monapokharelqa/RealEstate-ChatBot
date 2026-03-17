/**
 * LLM call wrapper.
 *
 * Uses the Vercel AI SDK with a configurable provider (OpenAI or Anthropic).
 * Set LLM_PROVIDER=anthropic to use Claude, or LLM_PROVIDER=openai (default).
 * Wraps every call in an OTel span and logs to Arato.
 */

import { streamText, generateText, type CoreMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { SpanStatusCode } from "@opentelemetry/api";
import { getTracer } from "./telemetry";
import { redactForTelemetry } from "./redact";
import { postAratoLog } from "./arato";
import { generateId } from "./ids";

// ---------- system prompt ----------
const SYSTEM_PROMPT = `You are a helpful home-buying education assistant. You provide general information about buying a house, including budgeting for a purchase, mortgage basics, pre-approval, down payments, home search strategy, offers, contingencies, inspections, appraisals, closing costs, and moving planning.

IMPORTANT RULES:
- You are NOT a licensed real estate agent, mortgage broker, attorney, or tax advisor.
- You provide general education, not personalized legal, tax, lending, or financial advice.
- Do not guarantee mortgage approval, rates, home values, or timelines.
- Refuse and redirect requests related to illegal activities such as mortgage fraud, appraisal fraud, occupancy fraud, document forgery, straw-buyer schemes, money laundering, or tax evasion.
- Never ask for or encourage sharing of sensitive personal information (SSN, bank account numbers, routing numbers, passwords, PINs, or mortgage portal login details).
- If the user shares sensitive info, warn them not to share such details online and continue with general guidance.
- In your first message of each conversation, include this disclaimer: "Disclaimer: I provide general home-buying education only - not legal, tax, mortgage, or financial advice. Please consult licensed professionals for guidance on your specific situation."

FORMATTING RULES - always structure your responses using Markdown:
- Use **bold** for key terms and important figures.
- Use bullet lists (- item) for options, pros/cons, or checklists.
- Use numbered lists (1. step) for sequential processes.
- Use ## headings to separate sections when covering multiple topics.
- Use > blockquotes to highlight tips, warnings, or key takeaways.
- Use tables when comparing options side-by-side (for example, fixed vs adjustable rate mortgage).
- Include a concrete **Example** whenever it helps explain a concept.
- End responses that involve a decision with a **Questions to ask yourself** section.
- Keep paragraphs short (2-3 sentences max). Prefer structure over long walls of text.`;

// ---------- provider setup ----------

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-20250514",
};

/**
 * Build the AI SDK LanguageModel for the configured provider + model.
 * Reads LLM_PROVIDER (openai | anthropic) and the matching API key env var.
 */
function getModel(): { model: LanguageModel; modelName: string } {
  const provider = (process.env.LLM_PROVIDER ?? "openai").toLowerCase();
  const modelName =
    process.env.LLM_MODEL ?? DEFAULT_MODELS[provider] ?? DEFAULT_MODELS.openai;

  switch (provider) {
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY ?? "missing-key",
      });
      return { model: anthropic(modelName), modelName };
    }
    case "openai":
    default: {
      const openai = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY ?? "missing-key",
        ...(process.env.OPENAI_BASE_URL
          ? { baseURL: process.env.OPENAI_BASE_URL }
          : {}),
      });
      return { model: openai(modelName), modelName };
    }
  }
}

// ---------- exported JSON (non-streaming) helper ----------

/**
 * Generate a full chat response as a plain string.
 * Used when the caller requests application/json (e.g. promptfoo).
 */
export async function generateChatResponse(
  opts: Omit<ChatStreamOptions, "safetyFlag"> & { safetyFlag?: string }
): Promise<string> {
  const { model } = getModel();
  const fullMessages: CoreMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...opts.messages,
  ];
  const result = await generateText({ model, messages: fullMessages });
  return result.text;
}

// ---------- exported stream helper ----------

export interface ChatStreamOptions {
  messages: CoreMessage[];
  conversationId: string;
  requestId: string;
  isFirstMessage: boolean;
  safetyFlag?: string;
}

/**
 * Stream an LLM response, instrumented with OTel spans and Arato logging.
 *
 * Returns a ReadableStream<Uint8Array> suitable for use in a Response body.
 * Errors are encoded as user-friendly text in the stream (never
 * controller.error()) to avoid unhandled rejections on the client.
 */
export async function streamChatResponse(
  opts: ChatStreamOptions
): Promise<ReadableStream<Uint8Array>> {
  const tracer = getTracer();
  const { model, modelName } = getModel();

  const fullMessages: CoreMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...opts.messages,
  ];

  const span = tracer.startSpan("llm.request");
  const startTime = Date.now();
  const encoder = new TextEncoder();

  // Set span attributes
  span.setAttributes({
    "llm.model": modelName,
    "llm.conversation_id": opts.conversationId,
    "llm.request_id": opts.requestId,
    "llm.is_first_message": opts.isFirstMessage,
    "llm.message_count": opts.messages.length,
    ...(opts.safetyFlag ? { "llm.safety_flag": opts.safetyFlag } : {}),
  });

  // Attach redacted last-user-message info
  const lastUserMsg = [...opts.messages]
    .reverse()
    .find((m) => m.role === "user");
  if (lastUserMsg && typeof lastUserMsg.content === "string") {
    const redacted = redactForTelemetry(lastUserMsg.content);
    for (const [k, v] of Object.entries(redacted)) {
      span.setAttribute(`llm.user_message.${k}`, v);
    }
  }

  try {
    const result = streamText({
      model,
      messages: fullMessages,
    });

    const originalStream = result.textStream;
    let ttftMs: number | undefined;
    let fullResponse = "";
    let promptTokens = 0;
    let completionTokens = 0;

    // Wrap the AI SDK stream into a Uint8Array stream with proper error handling
    const byteStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of originalStream) {
            // Track time-to-first-token
            if (ttftMs === undefined) {
              ttftMs = Date.now() - startTime;
              span.setAttribute("llm.ttft_ms", ttftMs);
            }
            fullResponse += chunk;
            controller.enqueue(encoder.encode(chunk));
          }

          // --- stream completed successfully ---
          console.log("[llm] Full response:", fullResponse);
          const totalDuration = Date.now() - startTime;
          span.setAttributes({
            "llm.total_duration_ms": totalDuration,
            "llm.response_length": fullResponse.length,
          });

          // Try to get token usage — race against a 5 s timeout so a
          // hanging promise (seen with some Anthropic SDK versions) can
          // never block the Arato log call below.
          try {
            const usage = await Promise.race([
              result.usage,
              new Promise<null>((r) => setTimeout(() => r(null), 5_000)),
            ]);
            if (usage) {
              promptTokens = usage.promptTokens ?? 0;
              completionTokens = usage.completionTokens ?? 0;
              const totalTokens = promptTokens + completionTokens;
              span.setAttributes({
                "llm.prompt_tokens": promptTokens,
                "llm.completion_tokens": completionTokens,
                "llm.total_tokens": totalTokens,
              });
            }
          } catch {
            // Usage not available for some providers
          }

          span.setStatus({ code: SpanStatusCode.OK });
          span.end();

          // Log to Arato
          const userContent =
            lastUserMsg && typeof lastUserMsg.content === "string"
              ? lastUserMsg.content
              : "";
          postAratoLog({
            model: modelName,
            id: `msg-${generateId()}`,
            messages: [{ role: "user", content: userContent }],
            response: fullResponse,
            variables: {
              conversation_id: opts.conversationId,
              request_id: opts.requestId,
              is_first_message: opts.isFirstMessage,
              ...(opts.safetyFlag
                ? { safety_flag: opts.safetyFlag }
                : {}),
            },
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
            },
            performance: {
              ttft: ttftMs ?? 0,
              ttlt: totalDuration,
            },
            threadId: opts.conversationId,
            promptId: "realestate-chat-bot",
            promptVersion: "1.0",
            tags: {
              environment: process.env.NODE_ENV ?? "development",
              feature: "chat",
            },
          }).catch((err) => {
            console.error("[Arato] postAratoLog rejected:", err);
          });

          controller.close();
        } catch (err) {
          // --- stream error ---
          // Don't call controller.error() — it causes unhandled rejections
          // in the browser. Instead, send an error message as text and close.
          const elapsed = Date.now() - startTime;
          const errMsg =
            err instanceof Error ? err.message : "Unknown error";

          console.error("[llm] Stream error:", err);

          span.setAttributes({
            "llm.total_duration_ms": elapsed,
            "llm.error": true,
            "llm.error_type":
              err instanceof Error ? err.name : "UnknownError",
          });
          span.setStatus({ code: SpanStatusCode.ERROR, message: errMsg });
          span.end();

          // Send a user-friendly error as stream content
          const errorText =
            "\n\nSorry, I encountered an error processing your request. " +
            "Please check your configuration and try again.";
          controller.enqueue(encoder.encode(errorText));
          controller.close();
        }
      },
    });

    return byteStream;
  } catch (error) {
    // Synchronous error (e.g., invalid provider config)
    const elapsed = Date.now() - startTime;
    span.setAttributes({
      "llm.total_duration_ms": elapsed,
      "llm.error": true,
      "llm.error_type":
        error instanceof Error ? error.name : "UnknownError",
    });
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    span.end();
    throw error;
  }
}
