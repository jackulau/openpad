# syntax=docker/dockerfile:1.7
# Multi-stage build: produces a single image with API + bundled web SPA.

FROM node:20-bookworm-slim AS builder
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.12.4 --activate
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/opencoder
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm --filter @opencoder/shared build || true
RUN pnpm --filter @opencoder/api prisma:generate
RUN pnpm --filter @opencoder/web build
RUN pnpm --filter @opencoder/api build

FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates docker-cli \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/opencoder
COPY --from=builder /opt/opencoder/node_modules ./node_modules
COPY --from=builder /opt/opencoder/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /opt/opencoder/apps/api/dist ./apps/api/dist
COPY --from=builder /opt/opencoder/apps/api/prisma ./apps/api/prisma
COPY --from=builder /opt/opencoder/apps/api/package.json ./apps/api/package.json
COPY --from=builder /opt/opencoder/apps/web/dist ./web-dist
COPY --from=builder /opt/opencoder/packages/shared ./packages/shared
COPY --from=builder /opt/opencoder/package.json ./package.json
ENV PORT=4000
ENV HOST=0.0.0.0
ENV DATABASE_URL="file:/data/opencoder.db"
EXPOSE 4000
VOLUME ["/data"]
WORKDIR /opt/opencoder/apps/api
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
