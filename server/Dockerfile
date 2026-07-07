# API — Node/Express. Uses node:sqlite (built-in, stable in Node 24), no native deps.
FROM node:24-alpine

WORKDIR /app

# install prod deps first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# SQLite lives on a mounted volume so users/sessions/views persist
RUN mkdir -p /app/data
ENV NODE_ENV=production
ENV DB_PATH=/app/data/data.db
ENV PORT=4000

EXPOSE 4000
CMD ["node", "index.js"]
