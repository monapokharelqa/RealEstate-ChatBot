import { createHash } from "crypto";

/**
 * Whether raw prompt/completion text should be included in telemetry.
 * Controlled by LOG_RAW_PROMPTS env var (default: false).
 */
export function shouldLogRawText(): boolean {
  return process.env.LOG_RAW_PROMPTS === "true";
}

/** SHA-256 hash of a string, returned as hex. */
export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Build a safe telemetry summary of a message.
 * If LOG_RAW_PROMPTS is enabled, returns the raw text.
 * Otherwise returns length + sha256 hash so content stays private.
 */
export function redactForTelemetry(text: string): Record<string, string | number> {
  if (shouldLogRawText()) {
    return { raw: text };
  }
  return {
    length: text.length,
    sha256: hashText(text),
  };
}

/** Patterns that indicate the user is sharing sensitive PII. */
const SENSITIVE_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN
  /\b\d{13,19}\b/, // credit card numbers
  /password\s*[:=]/i, // passwords
  /\bpin\s*[:=]\s*\d{4,8}\b/i,
  /\baccount\s*(?:number|#)\s*[:=]/i,
  /\brouting\s*(?:number|#)\s*[:=]/i,
  /\bbank\s*(?:login|password|pin)\b/i,
  /\bmortgage\s*(?:account|portal)?\s*(?:login|password|pin)\b/i,
];

/** Check if user message contains obvious sensitive PII. */
export function containsSensitiveInfo(text: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(text));
}
