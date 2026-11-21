FROM oven/bun:1.3-alpine AS base
WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY registry ./registry
COPY flows-templates ./flows-templates

RUN bun install --frozen-lockfile || bun install
RUN bun run --filter @symforyx/web build

ENV NODE_ENV=production
ENV SYMFORYX_PORT=3000
ENV SYMFORYX_HOST=0.0.0.0
ENV SYMFORYX_STATIC_DIR=/app/apps/web/build

EXPOSE 3000
CMD ["bun", "run", "apps/server/src/index.ts"]
