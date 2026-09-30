FROM oven/bun:1.2-alpine

WORKDIR /app

RUN apk add --no-cache openssl curl

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

RUN bunx prisma generate --schema packages/db/prisma/schema.prisma

EXPOSE 8000

CMD ["bun", "apps/backend/index.ts"]
