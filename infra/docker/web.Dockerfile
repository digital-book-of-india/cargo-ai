# Owner or super admin panel image. Build from the repository root:
#   docker build -f infra/docker/web.Dockerfile --build-arg APP=owner \
#     --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com/api/v1 -t dbi-owner .
#   docker build -f infra/docker/web.Dockerfile --build-arg APP=superadmin ... -t dbi-superadmin .
#
# NEXT_PUBLIC_* values are written into the browser code at build time, so build one image per
# environment. Never pass secrets as build arguments.

FROM node:20-alpine
ARG APP=owner
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_TELEMETRY_DISABLED=1 \
    APP=${APP}
WORKDIR /app
COPY . .
RUN npm ci --workspace @dbi/${APP} --include-workspace-root \
 && npm run build -w @dbi/${APP} \
 && chown -R node:node /app
USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/ >/dev/null || exit 1

CMD ["sh", "-c", "npm run start -w @dbi/${APP} -- -p ${PORT}"]
