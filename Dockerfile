# syntax=docker/dockerfile:1

# Rival Restaurant backend.
#
# The server serves BOTH the HTTP/WebSocket API and the built client from one origin, which
# is what lets the browser resolve the WebSocket as `ws://<this-host>/ws` with no extra
# configuration when you reach it from another machine on your network.
#
# Node 22: the server uses ESM import attributes (`with { type: 'json' }`), which need 20.10+.

# ---------------------------------------------------------------------------
# Stage 1 — build the browser client
# ---------------------------------------------------------------------------
FROM node:22-alpine AS client-build
WORKDIR /app

# Install client dependencies first so this layer caches across source edits.
COPY client/package.json client/package-lock.json ./client/
RUN npm --prefix client ci

# The client imports from shared/ (tuning constants, restaurant layout), and the root
# package.json supplies "type": "module" for those bare .js files.
COPY package.json ./
COPY shared/ ./shared/
COPY client/ ./client/

# Vite writes to ../server/public/client-build (see client/vite.config.ts).
RUN mkdir -p server/public/client-build && npm --prefix client run build

# ---------------------------------------------------------------------------
# Stage 2 — runtime: server + built client only
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Production dependencies only — express and ws. Three.js is never installed anywhere;
# it is loaded by the browser from a pinned CDN import map (see README).
COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci --omit=dev && npm cache clean --force

# The root package.json must be present at runtime: shared/*.js has no package.json of its
# own, so Node walks up to this one to resolve "type": "module".
COPY package.json ./
COPY shared/ ./shared/
COPY server/src/ ./server/src/
COPY --from=client-build /app/server/public/client-build/ ./server/public/client-build/

# Drop privileges. The node image already provides an unprivileged `node` user.
RUN chown -R node:node /app
USER node

ENV PORT=3000
EXPOSE 3000

# Node binds 0.0.0.0 by default, so the container is reachable from your LAN once the port
# is published. The health probe uses the built-in fetch — no curl in the alpine image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
