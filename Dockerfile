# Kick-Off FM — production server image.
# Multi-stage: deps cached separately from source for fast rebuilds.

# ---- Stage 1: install prod deps ----
FROM node:22-alpine AS deps
WORKDIR /app
# argon2 needs build tools at install time (native module). Keep tooling in this stage only.
RUN apk add --no-cache python3 make g++ libc6-compat
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ---- Stage 2: runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Copy only what's needed to run.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* ./
COPY server ./server
COPY scripts ./scripts
COPY engine.js data.js ai.js ./
COPY index.html app.js styles.css ./
COPY legacy.html legacy-main.js legacy-ui.js legacy-style.css ./
# Create non-root user
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 3000
CMD ["node", "server/index.js"]
