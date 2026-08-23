# ── Next.js Dashboard — Multi-Stage Dockerfile ───────────────────────────────
#
# Stages:
#   deps        — Install all npm dependencies (cached layer)
#   development — Next.js dev server with hot-reload
#   build       — next build (standalone output mode)
#   production  — Minimal runtime image using Next.js standalone output
#
# Next.js standalone output (output: 'standalone' in next.config.ts) bundles
# only the files needed to run the server, keeping the production image small.
# Add `output: 'standalone'` to next.config.ts to enable this optimization.

# ── Base ──────────────────────────────────────────────────────────────────────
FROM node:20.14.0-alpine3.20 AS base
WORKDIR /app
RUN apk add --no-cache tini

# ── Deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package-lock.json package.json ./
# --legacy-peer-deps: vitest@4.x peer dep on @types/node conflicts with pinned
# version in lockfile; this only affects devDeps used for testing, not runtime.
RUN npm ci --legacy-peer-deps

# ── Development ───────────────────────────────────────────────────────────────
FROM deps AS development
COPY . .
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "dev"]

# ── Build ─────────────────────────────────────────────────────────────────────
FROM deps AS build
# Copy all source files
COPY . .

# Build-time public environment variables must be available at `next build`.
# They are baked into the JS bundle — NOT runtime-injectable.
# Pass these via `--build-arg` in CI or docker-compose.prod.yml.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_API_BASE_URL

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

# NEXT_TELEMETRY_DISABLED suppresses the first-run prompt.
# Type-checking and linting run in CI (Jenkinsfile); next.config.mjs sets
# ignoreBuildErrors/ignoreDuringBuilds so the build focuses on JS compilation only.
ENV NEXT_TELEMETRY_DISABLED=1
RUN mkdir -p public && npm run build

# ── Production ────────────────────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create public/ in build stage first so COPY never fails if directory is empty
RUN mkdir -p /app/public
COPY --from=build /app/public ./public
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs

USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "start"]
