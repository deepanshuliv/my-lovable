FROM oven/bun:1.2-alpine

WORKDIR /app

COPY apps/web/package.json ./
RUN bun install

COPY apps/web/ ./

EXPOSE 3001

CMD ["bun", "run", "dev"]
