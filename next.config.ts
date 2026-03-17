import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-side instrumentation file for OpenTelemetry
  serverExternalPackages: [
    "@opentelemetry/sdk-node",
    "@opentelemetry/sdk-trace-node",
    "@opentelemetry/exporter-trace-otlp-http",
    "@opentelemetry/exporter-metrics-otlp-http",
  ],
};

export default nextConfig;
