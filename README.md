# Inkling

An AI app builder. You describe an app, an agent writes and runs it inside a Daytona cloud sandbox, and the running result is streamed back into a live preview beside the chat.

## Quick start

The fastest way to run the stack is with Docker. This starts Postgres, Redis, two backend replicas, a worker, the Next.js UI, and nginx.

```bash
cp .env.example .env
```

Open `.env` and provide your keys:
- `GEMINI_API_KEY` or `OPENROUTER_API_KEY`
- `DAYTONA_API_KEY`
- `SECRETS_MASTER_KEY` (generate with `openssl rand -base64 32`)

Start the infrastructure:

```bash
docker compose up -d --build
```

The UI is available at `http://localhost:8080`.

## Architecture

- **Postgres is the source of truth.** Every event is written there eventually. Redis, the sandbox filesystem, and the R2 snapshot are caches that can be rebuilt from it.
- **Writes are buffered.** Backends push events onto a Redis stream. The worker drains this stream and batches writes into Postgres. A chat turn never waits on a database write.
- **One backend owns a project at a time.** `SET NX PX` in Redis decides who, a heartbeat keeps it, and compare-and-swap Lua scripts make release safe. Nginx hashes on the project ID so requests keep landing on the owner.
- **Commands run serially.** Each project gets one persistent shell inside its Daytona sandbox plus a serial queue. Two tool calls cannot interleave.
- **Snapshots make revisiting cheap.** Cloudflare R2 stores a tarball of the working tree plus a watermark in Postgres. Returning to a project restores the tarball and replays only subsequent events.

## Project structure

- `apps/backend`: API for SSE chat, project ownership, sandbox execution, and the agent loop.
- `apps/worker`: Drains the Redis stream into Postgres.
- `apps/web`: Next.js UI builder with a split chat and live preview.
- `packages/db`: Prisma schema and client.
- `packages/memory`: Redis Iris agent memory, with a plain-Redis fallback.
- `packages/redis`: Client, key names, ownership locks, event stream, and pub/sub.
- `packages/shared`: Shared event vocabulary and secret redaction.
- `packages/storage`: Cloudflare R2 integration for snapshots.
- `templates/`: Base project templates uploaded into each new sandbox.
- `scripts/`: Tools for snapshot baking (`bake-snapshot.ts`) and lock verification (`check-locks.ts`).

## Development

To run the application locally without Docker:

```bash
bun install
bun run db:sync
```

`bun run dev` and `bun run dev:backend` also run this schema sync automatically. If the
Prisma schema changes while using Docker, rebuild the migration and service images so the
database and generated client come from the same checkout:

```bash
docker compose up -d --build migrate backend-1 backend-2 worker web
```

Start the services in separate terminals:

```bash
bun run dev:backend
bun run dev:worker
bun run dev:web
```

By default, a new sandbox runs `npm install`, which is slow. You can bake a snapshot with dependencies pre-installed:

```bash
bun scripts/bake-snapshot.ts
```

Then set `TEMPLATE_SOURCE=snapshot` and `TEMPLATE_SNAPSHOT=<name>` in `.env`.

To verify the ownership lock logic locally:

```bash
docker compose up -d redis
REDIS_URL=redis://localhost:6379 bun scripts/check-locks.ts
```

## Long-running agent runtime

The backend now keeps the model's working context disposable and stores execution continuity
in Postgres. `TaskState` is versioned and durable, `session_summaries` are append-only, and
raw oversized tool results are stored in `tool_outputs`. The active prompt contains task
state plus bounded recent/retrieved observations; it never needs the complete session history.

Runtime diagnostics are available at `GET /projects/:projectId/runtime` for an authorized
project owner. The endpoint reports task state, latest summary coverage, event count,
externalized output count, and the latest recorded context budget.

Run the architecture tests with:

```bash
bun test
bun run typecheck
```

The forced-small-context integration test exercises repeated compaction, retrieval, large
tool outputs, isolated subagents, verification gating, and a process-replacement resume.

## Limitations

- Production persistence follows this repository's existing Postgres source-of-truth design;
  lexical retrieval is implemented as a bounded Postgres event scan behind a retriever
  abstraction rather than adding a second SQLite database.
- Secrets and user keys are encrypted at rest using AES-256-GCM. Plaintext is never stored or returned by the API, and secrets are redacted from anything the agent prints (see `packages/shared/redact.ts` and `apps/backend/src/userKeys.ts`).

## Not in this version: payments, email and SMS

Generated apps do not get real payments (Stripe and similar), sending email (Resend, SendGrid,
Postmark, Mailgun) or sending text messages (Twilio and similar) in this version. They are planned
for the next one.

**Why.** Preview sandboxes run on Daytona Tier 1/2, which only lets a sandbox reach an allowlist of
essential services. Measured from inside a sandbox: Neon (over HTTPS), Supabase, Clerk, OpenAI,
Anthropic, Gemini, OpenRouter, npm and GitHub are reachable; Stripe, Resend, SendGrid, Twilio and
the plain Postgres port (5432) are blocked. A payment or email feature would pass key verification
and then never work in the preview.

**What users get instead.** When a request includes payments, email or SMS, the agent does not ask
for those keys. It builds that part as a realistic design-only flow (a pretend checkout that ends
on a success screen, a confirmation instead of a sent message) with a small "Preview" note, tells
the user in one sentence that the real feature is coming in a future version, and builds the rest
of the request normally. This is enforced in two places: the system prompt, and
`DEFERRED_SERVICES` in `apps/backend/src/keyRequest.ts`, which strips these keys from any key
request even if the model asks for them.

**Turning it on in the next version.**

1. Move the Daytona organization to Tier 3 or higher (full internet access), or configure a
   `domainAllowList` for the providers you support.
2. Remove the service from `DEFERRED_SERVICES` in `apps/backend/src/keyRequest.ts`.
3. Remove the "Payments, email and SMS are not part of this version" paragraph from
   `apps/backend/src/sytemPrompt.ts` and add provider guidance back. Stripe notes that worked well
   before: install only `stripe`; create `new Stripe(secretKey)` inside the route handler with no
   `apiVersion`; in `checkout.sessions.create` pass `mode`, `line_items` (`price_data` with
   `currency`, `unit_amount`, `product_data.name`), `success_url` and `cancel_url`, and do not pass
   `payment_method_types`; return `{ url: session.url }` from `app/api/checkout/route.ts` and
   redirect with `window.location.href`.
4. The key checks already exist: `apps/backend/src/keyVerification.ts` verifies Stripe, Resend,
   SendGrid, Postmark and Twilio keys with each provider, and `apps/backend/src/sandboxReach.ts`
   confirms the sandbox can reach them before a key is accepted.
