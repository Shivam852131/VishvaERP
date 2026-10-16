FROM node:20-alpine AS deps

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

FROM node:20-alpine

RUN addgroup -g 1001 -S vishva && adduser -S vishva -u 1001 -G vishva

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY backend/ ./backend/
COPY frontend/ ./frontend/

RUN mkdir -p backend/uploads/avatars backend/uploads/assignments backend/uploads/notices backend/uploads/messages backend/uploads/library backend/uploads/temp \
    && npm install sharp --no-save && npm cache clean --force \
    && chown -R vishva:vishva /app

USER vishva

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

CMD ["node", "backend/server.js"]
