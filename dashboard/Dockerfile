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
RUN npm ci

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
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_API_BASE_URL

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

RUN npm run build

# ── Production ────────────────────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production

# If next.config.ts has `output: 'standalone'`, copy the minimal bundle.
# Otherwise copy the full .next output + public assets.
# Using standard copy here for compatibility with both approaches.
COPY --from=build /app/public ./public
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts

USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "start"]
