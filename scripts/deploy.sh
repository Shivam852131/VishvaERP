#!/bin/bash
set -e

echo "🚀 VishvaERP Deployment Script"
echo "=============================="

# Check if .env exists
if [ ! -f .env ]; then
  echo "❌ .env file not found. Copy .env.production.example to .env and configure it."
  exit 1
fi

# Build and start
echo "📦 Building Docker images..."
docker compose build --no-cache

echo "🔄 Starting services..."
docker compose up -d

echo "⏳ Waiting for services to be healthy..."
sleep 10

# Check health
echo "🏥 Checking health..."
if curl -sf http://localhost:${PORT:-5000}/api/health > /dev/null 2>&1; then
  echo "✅ VishvaERP is running at http://localhost:${PORT:-5000}"
else
  echo "⚠️  Health check failed. Check logs with: docker compose logs backend"
fi

echo ""
echo "📊 Useful commands:"
echo "  docker compose logs -f backend    # View logs"
echo "  docker compose ps                 # Check status"
echo "  docker compose restart backend    # Restart backend"
echo "  docker compose down               # Stop all"
