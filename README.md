
# Real Estate Chatbot

A minimal home-buying education chatbot built with Next.js (App Router + TypeScript).

It answers common questions during the house-buying journey, such as:
- How pre-approval works
- How much down payment to target
- What to include in an offer
- Inspection and appraisal basics
- Closing costs and timelines

Responses are educational only and include clear disclaimers that they are not legal, tax, mortgage, or personalized financial advice.

The app includes built-in observability via OpenTelemetry (OTLP export) and Arato.ai REST logging.

---

## Quick Start

```bash
# 1) Install dependencies
npm install

# 2) Create local env file
cp .env.example .env

# 3) Set your provider + API key in .env

# 4) Start dev server
npm run dev
```

Open `http://localhost:3000` and start chatting.

---

## Environment Variables

### LLM Provider (required)

Set `LLM_PROVIDER` and the matching API key:

```env
# Option A: Anthropic
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Option B: OpenAI
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

| Variable | Required | Description |
|---|---|---|
| `LLM_PROVIDER` | Yes | `anthropic` or `openai` |
| `ANTHROPIC_API_KEY` | If Anthropic | Anthropic API key |
| `OPENAI_API_KEY` | If OpenAI | OpenAI (or compatible) API key |
| `LLM_MODEL` | No | Override model name |
| `OPENAI_BASE_URL` | No | OpenAI-compatible base URL override |

### Arato.ai Monitoring (optional)

```env
ARATO_API_URL=https://api.arato.ai/<your-project>/log
ARATO_API_KEY=ar-...
```

### OpenTelemetry (optional)

```env
OTEL_SERVICE_NAME=realestate-chat-bot
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.arato.ai
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <your-api-key>
```

### Privacy

```env
LOG_RAW_PROMPTS=false
```

By default, telemetry stores only message length + SHA-256 hash (not raw text).

---

## Run Modes

```bash
npm run dev      # development
npm run build    # production build
npm start        # run production server
npm run lint     # lint
```

---

## Verify

1. Chat in the UI at `http://localhost:3000` and confirm streamed responses.
2. Check health endpoint:
    ```bash
    curl http://localhost:3000/api/health
    ```
3. If Arato is configured, confirm logs appear for each chat response.

---

## Project Structure

```text
app/
  layout.tsx            Root layout
  page.tsx              Client chat UI
  globals.css           Styles
  api/
     chat/route.ts       Chat endpoint (safety + streaming)
     health/route.ts     Health endpoint + test span
lib/
  llm.ts                LLM wrapper (Anthropic + OpenAI)
  arato.ts              Arato logging helper
  telemetry.ts          OpenTelemetry setup + tracer helpers
  redact.ts             Redaction/hashing and sensitive pattern checks
  ids.ts                UUID helper
instrumentation.ts      Next.js instrumentation hook
```

---

## Notes

- No database is used; conversation state lives in browser state and is sent with each request.
- No auth is included in this MVP.
- Add authentication and server-side persistence before production use.
