# ── Fastify Backend API — Multi-Stage Dockerfile ─────────────────────────────
#
# Stages:
#   deps        — Install all npm dependencies (cached layer)
#   development — Hot-reload dev server using tsx watch
#   build       — Compile TypeScript to JS
#   production  — Minimal runtime image (no devDependencies, no source)
#
# Build targets are selected via docker-compose `target:` key or
# `docker build --target <stage>`.

# ── Base: Node 20 LTS Alpine ──────────────────────────────────────────────────
# Alpine reduces final image size (~50 MB vs ~350 MB for full Debian).
# Pin to a specific digest in production for reproducible builds.
FROM node:20.14.0-alpine3.20 AS base
WORKDIR /app
# Install tini for proper PID 1 signal handling in Docker
RUN apk add --no-cache tini

# ── Deps: Install dependencies ────────────────────────────────────────────────
FROM base AS deps
# Copy lockfile first so this layer is only invalidated on dependency changes
COPY package-lock.json package.json ./
# ci uses lockfile exactly — no implicit upgrades
RUN npm ci --legacy-peer-deps

# ── Development: hot-reload with tsx ─────────────────────────────────────────
FROM deps AS development
COPY tsconfig.json ./
COPY src ./src
EXPOSE 3001
# Use tini to properly forward SIGTERM for graceful shutdown
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "dev"]

# ── Build: compile TypeScript → JavaScript ────────────────────────────────────
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ── Production: minimal runtime image ────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production

# Install only production dependencies in a fresh layer
COPY package-lock.json package.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

# Copy compiled output from build stage
COPY --from=build /app/dist ./dist

# Run as non-root user (node is created by the official Node image)
USER node

EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
