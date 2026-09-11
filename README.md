# my-lovable

An AI app builder. You describe an app, an agent writes and runs it inside a cloud
sandbox, and the running result is streamed back into a live preview beside the chat.

## Running it

```bash
cp .env.example .env       # fill in GEMINI_API_KEY and DAYTONA_API_KEY at minimum
openssl rand -base64 32    # -> SECRETS_MASTER_KEY

docker compose up -d --build
open http://localhost:8080
```

Everything is reachable through nginx on `:8080` — the builder UI at `/`, the API on
`/chat`, `/projects`, `/answer`.

Without Docker:

```bash
bun install
bunx prisma db push --schema packages/db/prisma/schema.prisma
bun run dev:backend   # :8000
bun run dev:worker
bun run dev:web       # :3001
```

## Shape

```
apps/backend     express — SSE chat, project ownership, sandbox, agent loop, secrets
apps/worker      drains the Redis stream into Postgres in batches
apps/web         Next.js builder UI — chat left, live preview right

packages/redis   client, key names, ownership locks, event stream, pub/sub
packages/db      Prisma schema and client
packages/memory  Redis Iris agent memory, with a plain-Redis fallback
packages/storage Cloudflare R2 for snapshots
packages/shared  event vocabulary and secret redaction

templates/       the project template uploaded into each sandbox
infra/           nginx config and container images
scripts/         snapshot baking, lock verification
```

## How it fits together

**Postgres is the source of truth.** Every event is written there eventually. Redis, the
sandbox filesystem and the R2 snapshot are all caches that can be rebuilt from it.

**One backend owns a project at a time.** `SET NX PX` in Redis decides who, a heartbeat
keeps it, and compare-and-swap Lua scripts make release safe — a backend that reconnects
after its lock expired cannot delete the lock another backend now holds. nginx hashes on
the project id so requests keep landing on the owner and the conflict rarely arises at
all.

**Writes are buffered.** Backends push events onto a Redis stream; the worker batches
them into Postgres. A chat turn never waits on a database write, and a worker restart
resumes rather than loses.

**Snapshots make revisiting cheap.** A tarball of the working tree in R2, plus a
watermark in Postgres saying which event it already reflects. Coming back to a project
restores the tarball and replays only what happened after that point.

**Commands run one at a time.** Each project gets one persistent shell inside its
sandbox plus a serial queue, so `cd` and exports persist and two tool calls can never
interleave.

## Verifying the ownership logic

```bash
docker compose up -d redis
REDIS_URL=redis://localhost:6379 bun scripts/check-locks.ts
```

## Faster cold starts

By default a new sandbox uploads the template and runs `npm install`, which is the slow
part. Bake it once instead:

```bash
bun scripts/bake-snapshot.ts
# then set TEMPLATE_SOURCE=snapshot and TEMPLATE_SNAPSHOT=<printed name> in .env
```

## Notes

- `bunx tsc --noEmit` is the only automated gate. There is no test suite.
- Secrets are encrypted at rest, never returned by the API, injected as sandbox secrets,
  and stripped from anything the agent prints. See the comment at the top of
  `apps/backend/src/secrets.ts` for what that does and does not protect against.
