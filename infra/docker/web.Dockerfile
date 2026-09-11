# The builder UI.
#
# Runs `next dev` rather than a production build: this compose file is the local
# development stack, and the UI is the part you iterate on most. `output: standalone` is
# already set in next.config.ts for when this becomes a production image.
FROM oven/bun:1.2-alpine

WORKDIR /app

COPY apps/web/package.json ./
RUN bun install

COPY apps/web/ ./

EXPOSE 3001

CMD ["bun", "run", "dev"]
