# Backend API image. Build from the repository root:
#   docker build -f infra/docker/backend.Dockerfile -t dbi-backend .
#
# The server is bundled with esbuild (the shared packages are TypeScript source and are bundled in);
# only third-party dependencies are installed in the final image.
#
# Layer order matters for build time: the dependency manifests are copied and installed FIRST, the source
# afterwards, so a code change does not reinstall every package. (.dockerignore keeps node_modules out of COPY . .)

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/owner/package.json apps/owner/
COPY apps/superadmin/package.json apps/superadmin/
COPY packages/api-types/package.json packages/api-types/
COPY packages/validation/package.json packages/validation/
COPY packages/ui/package.json packages/ui/
RUN npm ci --workspace @dbi/backend --include-workspace-root
COPY . .
RUN npm run build -w @dbi/backend

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/owner/package.json apps/owner/
COPY apps/superadmin/package.json apps/superadmin/
COPY packages/api-types/package.json packages/api-types/
COPY packages/validation/package.json packages/validation/
COPY packages/ui/package.json packages/ui/
RUN npm ci --workspace @dbi/backend --include-workspace-root --omit=dev

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/backend/dist ./dist
COPY --from=build /app/apps/backend/package.json ./package.json

# evidence files live on a mounted volume (EVIDENCE_STORAGE_DIR), owned by the unprivileged user
RUN mkdir -p /data/evidence && chown -R node:node /data
ENV EVIDENCE_STORAGE_DIR=/data/evidence
VOLUME ["/data/evidence"]
USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-4000}/health/ready >/dev/null || exit 1

# one-off commands use the same image:  node dist/migrations/cli.js up | node dist/ops/backup.js
CMD ["node", "dist/server.js"]
