# syntax=docker/dockerfile:1
#
# Multi-stage: uma imagem base compartilhada, três alvos finais.
#   docker build --target app     -t cybergard-app     .
#   docker build --target worker  -t cybergard-worker  .
#   docker build --target migrate -t cybergard-migrate .

FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

# Só dependências de produção (inclui tsx, que worker/migrate rodam de verdade) —
# nada de vitest/typescript/vite na imagem final. Cai o tamanho da imagem e a
# superfície de vulnerabilidade de devDependency que nunca roda em produção.
FROM base AS runtime-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- App (Next.js, servidor standalone) ---
FROM base AS app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 cybergard && adduser --system --uid 1001 cybergard
COPY --from=build --chown=cybergard:cybergard /app/.next/standalone ./
COPY --from=build --chown=cybergard:cybergard /app/.next/static ./.next/static
COPY --from=build --chown=cybergard:cybergard /app/public ./public
USER cybergard
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]

# --- Worker (filas BullMQ — não passa pelo build do Next.js) ---
FROM runtime-deps AS worker
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 cybergard && adduser --system --uid 1001 cybergard
COPY --from=build --chown=cybergard:cybergard /app/src ./src
COPY --from=build --chown=cybergard:cybergard /app/tsconfig.json ./tsconfig.json
USER cybergard
CMD ["npx", "tsx", "src/worker.ts"]

# --- Migrate (job único — roda e sai) ---
FROM runtime-deps AS migrate
ENV NODE_ENV=production
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/db ./db
COPY --from=build /app/tsconfig.json ./tsconfig.json
CMD ["npx", "tsx", "scripts/migrate.ts"]
