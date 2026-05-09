# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY lib ./lib
COPY artifacts ./artifacts
COPY scripts ./scripts

RUN pnpm install --no-frozen-lockfile
RUN pnpm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/public \
    LIVE_TRADING_ENABLED=false \
    ENABLE_LISTING_AUTO_TRADE=false \
    ALLOW_MOCK_MARKET_DATA=false

RUN useradd --system --uid 10001 --create-home appuser

COPY --from=build /app/artifacts/api-server/dist ./dist
COPY --from=build /app/artifacts/crypto-signals/dist ./public

USER appuser
EXPOSE 8080

CMD ["node", "--enable-source-maps", "dist/index.mjs"]
