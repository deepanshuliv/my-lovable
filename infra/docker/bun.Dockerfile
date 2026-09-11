# Shared image for the Bun services (backend replicas and the worker).
#
# One image rather than three: they share the same workspace, the same dependencies and
# the same Prisma client, so building it once and varying the command is both faster and
# less to keep in sync.
FROM oven/bun:1.2-alpine

WORKDIR /app

# Prisma's engines need these on alpine, and the agent shells out to curl when probing
# the sandbox dev server.
RUN apk add --no-cache openssl curl

# Manifests first so a source-only change does not reinstall the world.
COPY package.json bun.lock* ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/worker/package.json ./apps/worker/
COPY packages/db/package.json ./packages/db/
COPY packages/memory/package.json ./packages/memory/
COPY packages/redis/package.json ./packages/redis/
COPY packages/shared/package.json ./packages/shared/
COPY packages/storage/package.json ./packages/storage/

RUN bun install

COPY . .

# Generate the client at build time; the runtime container has no schema-writing rights.
RUN bunx prisma generate --schema packages/db/prisma/schema.prisma

EXPOSE 8000

CMD ["bun", "apps/backend/index.ts"]
