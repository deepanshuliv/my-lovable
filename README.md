# my-lovable

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
bunx prisma db push --schema packages/db/prisma/schema.prisma
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

## Limitations

- There is no automated test suite. The only gate is `bun run typecheck`.
- Secrets and user keys are encrypted at rest using AES-256-GCM. Plaintext is never stored or returned by the API, and secrets are redacted from anything the agent prints (see `packages/shared/redact.ts` and `apps/backend/src/userKeys.ts`).
