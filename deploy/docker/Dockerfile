FROM node:24-bookworm-slim AS build

WORKDIR /build
COPY . .

RUN npm ci \
    && npm run plugins:build \
    && npm run plugins:materialize -- --defaults \
    && npm run build

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV AGENT_CANVAS_DB=/var/lib/agentcanvas/agent-canvas.sqlite

COPY --from=build --chown=node:node /build/package.json /build/package-lock.json ./
COPY --from=build --chown=node:node /build/node_modules ./node_modules
COPY --from=build --chown=node:node /build/packages ./packages
COPY --from=build --chown=node:node /build/plugins ./plugins
COPY --from=build --chown=node:node /build/dist ./dist
COPY --from=build --chown=node:node /build/src ./src

RUN mkdir -p /var/lib/agentcanvas \
    && chown -R node:node /var/lib/agentcanvas

USER node
EXPOSE 23003
VOLUME ["/var/lib/agentcanvas"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 CMD node -e "fetch('http://127.0.0.1:23003/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["node", "--import", "tsx", "src/server.ts"]

