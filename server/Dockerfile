# Taalmel API. Build from the repository root (it needs ../database for migrations):
#   docker build -f server/Dockerfile -t taalmel-api .

FROM node:22-alpine AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

FROM node:22-alpine
# pg_dump / psql for the backup and restore feature (match the database's major version)
RUN apk add --no-cache postgresql16-client tini
WORKDIR /app/server
ENV NODE_ENV=production PORT=8000
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist ./dist
# Fonts for invoice PDFs, and the SQL migrations applied at startup
COPY server/assets ./assets
COPY database /app/database
RUN mkdir -p /app/server/backups && chown -R node:node /app/server/backups
USER node
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD wget -qO- http://127.0.0.1:8000/api/health/ready > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
