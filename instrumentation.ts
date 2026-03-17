/**
 * Next.js instrumentation hook.
 * Called once when the server starts.
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only initialize telemetry on the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initTelemetry } = await import("./lib/telemetry");
    initTelemetry();
  }
}
