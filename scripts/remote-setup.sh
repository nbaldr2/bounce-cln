#!/bin/bash
# remote-setup.sh — Run this on the remote server after the project is uploaded
set -e

PROJECT_DIR="/opt/bounce-cln"
HOST_IP="80.96.108.180"
cd "$PROJECT_DIR"

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║         Bounce-CLN Production Deployment Setup             ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# ─── 1. Prerequisites ───────────────────────────────────────────
echo "[1/8] Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    echo "    → Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
else
    echo "    ✓ Docker already installed"
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "    → Installing Docker Compose plugin..."
    apt-get update -qq && apt-get install -y -qq docker-compose-plugin
fi

if ! command -v node &> /dev/null || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" != "20" ]; then
    echo "    → Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
else
    echo "    ✓ Node.js $(node -v) already installed"
fi

# ─── 2. Install PM2 ─────────────────────────────────────────────
if ! command -v pm2 &> /dev/null; then
    echo "    → Installing PM2..."
    npm install -g pm2
fi

# ─── 3. Node modules ────────────────────────────────────────────
echo "[2/8] Installing dependencies..."
npm install

# ─── 4. Production .env ─────────────────────────────────────────
echo "[3/8] Setting up production environment..."

HMAC_SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

cat > .env <<EOF
# Database
DATABASE_URL="postgresql://bounce:bounce_secret@localhost:5432/bounce_cln?schema=public"

# Redis
REDIS_URL="redis://localhost:6379"

# API
API_PORT=4000
API_HOST=0.0.0.0

# HMAC Secret (auto-generated)
HMAC_SECRET="$HMAC_SECRET"

# SSH Default Credentials
SSH_DEFAULT_PORT=22
SSH_DEFAULT_USER=root

# Dashboard
NEXT_PUBLIC_API_URL=http://$HOST_IP:4000

# Node Agent
MASTER_API_URL=http://$HOST_IP:4000
NODE_HMAC_SECRET="$HMAC_SECRET"
HEARTBEAT_INTERVAL=30
EOF

cp .env apps/api/.env
cp .env apps/dashboard/.env

echo "    ✓ HMAC_SECRET generated and written to all .env files"

# ─── 5. Docker services ─────────────────────────────────────────
echo "[4/8] Starting PostgreSQL & Redis..."
docker compose up -d

echo "    ⏳ Waiting for PostgreSQL to be ready (10s)..."
sleep 10

# ─── 6. Database setup ────────────────────────────────────────────
echo "[5/8] Pushing Prisma schema..."
npm run db:push
echo "[6/8] Generating Prisma client..."
npm run db:generate
echo "[7/8] Seeding defaults..."
npm run db:seed

# ─── 7. Build Dashboard ─────────────────────────────────────────
echo "    → Building Next.js dashboard..."
npm run build --workspace=apps/dashboard

# ─── 8. Start services ──────────────────────────────────────────
echo "[8/8] Starting application services..."

# Stop any existing PM2 processes
pm2 delete bounce-api bounce-dashboard 2>/dev/null || true

# Start API
cd apps/api
pm2 start npm --name "bounce-api" -- run start --cwd "$PROJECT_DIR/apps/api"

# Start Dashboard
cd ../dashboard
pm2 start npm --name "bounce-dashboard" -- run start --cwd "$PROJECT_DIR/apps/dashboard"

pm2 save

# Try to set up PM2 startup (may need manual confirmation)
pm2 startup 2>/dev/null || true

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                  ✅ DEPLOYMENT COMPLETE                     ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "  Dashboard : http://$HOST_IP:3000"
echo "  API       : http://$HOST_IP:4000"
echo "  Health    : http://$HOST_IP:4000/health"
echo ""
echo "  PM2 status:"
pm2 list
echo ""
echo "  To monitor logs:"
echo "    pm2 logs bounce-api"
echo "    pm2 logs bounce-dashboard"
echo ""
