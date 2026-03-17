/**
 * OpenTelemetry initialization and span helpers.
 *
 * Initializes once (guarded against Next.js hot-reload).
 * In development, spans also go to the console.
 * In all environments, spans export via OTLP HTTP when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { trace, metrics, type Tracer, type Meter } from "@opentelemetry/api";

// ---------- singleton guard ----------
let initialized = false;

export function initTelemetry(): void {
  if (initialized) return;
  initialized = true;

  const serviceName =
    process.env.OTEL_SERVICE_NAME ?? "realestate-chat-bot";
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const otlpHeaders = parseOtlpHeaders(
    process.env.OTEL_EXPORTER_OTLP_HEADERS
  );
  const isDev = process.env.NODE_ENV === "development";

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: serviceName,
  });

  // Span processors
  const spanProcessors: (BatchSpanProcessor | SimpleSpanProcessor)[] = [];

  if (otlpEndpoint) {
    const traceExporter = new OTLPTraceExporter({
      url: `${otlpEndpoint.replace(/\/+$/, "")}/v1/traces`,
      headers: otlpHeaders,
    });
    spanProcessors.push(new BatchSpanProcessor(traceExporter));
  }

  if (isDev) {
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  // Metric reader (only when endpoint is set)
  const metricReader = otlpEndpoint
    ? new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${otlpEndpoint.replace(/\/+$/, "")}/v1/metrics`,
          headers: otlpHeaders,
        }),
        exportIntervalMillis: 30_000,
      })
    : undefined;

  const sdk = new NodeSDK({
    resource,
    spanProcessors,
    ...(metricReader ? { metricReader } : {}),
  });

  sdk.start();
  console.log(
    `[OTel] Telemetry initialized (service=${serviceName}, otlp=${!!otlpEndpoint}, dev_console=${isDev})`
  );
}

// ---------- helpers ----------

/** Parse comma-separated key=value header string into an object. */
function parseOtlpHeaders(
  raw: string | undefined
): Record<string, string> | undefined {
  if (!raw) return undefined;
  const result: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      result[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }
  return result;
}

/** Get the global tracer for this app. */
export function getTracer(): Tracer {
  return trace.getTracer("realestate-chat-bot");
}

/** Get the global meter for this app. */
export function getMeter(): Meter {
  return metrics.getMeter("realestate-chat-bot");
}
