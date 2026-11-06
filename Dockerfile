# Tréso Optimum — image unique : l'API sert aussi l'application compilée.
FROM node:22-bookworm-slim

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @optimum/web build

ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST=/app/apps/web/dist

EXPOSE 3000
CMD ["pnpm", "--filter", "@optimum/api", "start"]
