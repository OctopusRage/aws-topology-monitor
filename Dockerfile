# Single-container build: Node serves the API *and* the built frontend on one
# port (ideal for a PaaS like Hormuz Dock that routes a domain → one container).
# For the 2-container (nginx) setup, use server/Dockerfile + web/Dockerfile.

# 1) build the web UI
FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# 2) API + static frontend
FROM node:24-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=web /web/dist ./public
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DB_PATH=/app/data/data.db
ENV STATIC_DIR=/app/public
ENV PORT=8473

EXPOSE 8473
CMD ["node", "index.js"]
