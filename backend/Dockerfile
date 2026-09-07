FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

FROM node:20-alpine

RUN addgroup -g 1001 -S vishva && adduser -S vishva -u 1001 -G vishva

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY backend/ ./
COPY package.json ./

RUN mkdir -p uploads/avatars uploads/assignments uploads/notices uploads/messages uploads/library uploads/temp
RUN chown -R vishva:vishva /app

USER vishva

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

CMD ["node", "server.js"]
