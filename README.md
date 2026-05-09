# Bounce-CLN — Distributed SMTP Verification Orchestrator

Multi-VPS PowerMTA orchestration platform for high-throughput email list verification.

## Stack
| Layer | Tech |
|---|---|
| Dashboard | Next.js 15 + React 19 |
| API | Express.js + TypeScript |
| Database | PostgreSQL 16 + Prisma |
| Queue | Redis + BullMQ |
| Node Agent | Python 3.11 + asyncio |
| Auth | HMAC-SHA256 |

## Quick Start

### 1. Start backing services
```bash
docker-compose up -d
```

### 2. Install all dependencies
```bash
npm install
```

### 3. Push database schema + seed defaults
```bash
npm run db:push
npm run db:seed
```

### 4. Start development servers
```bash
npm run dev
```

- **Dashboard** → http://localhost:3000  
- **API**       → http://localhost:4000  
- **Prisma Studio** → `npm run db:studio --workspace=apps/api`

## Adding a VPS Node

**Via Dashboard:**  
Nodes → Add Node → Enter IP + SSH credentials → Click "Add & Provision"

**Via CLI:**
```bash
export MASTER_API_URL=http://your-master:4000
export HMAC_SECRET=your-hmac-secret
./scripts/provision-node.sh 1.2.3.4 root 22
```

## Agent Manual Install (on VPS)
```bash
cd /opt/bounce-agent
cat > .env <<EOF
MASTER_API_URL=http://your-master:4000
NODE_ID=<uuid-from-dashboard>
HMAC_SECRET=your-hmac-secret
HEARTBEAT_INTERVAL=30
CONCURRENCY=50
EOF
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
systemctl start bounce-agent
```

## PowerMTA Config
1. Add node in Dashboard → Nodes
2. Add sending domain → Domains → generates DKIM automatically
3. Add required DNS records shown in Dashboard
4. Click "Verify DNS" when propagated
5. Go to PMTA Config → select node + domain → Generate → Deploy via SSH

## Environment Variables
See `.env.example` for all options.

## Workflow
```
Upload CSV → Chunk into batches → BullMQ assigns to best node
→ Agent polls for jobs → MX resolve → Catch-all probe
→ Async SMTP verify → Classify result → POST back to master
→ Hard bounces → Suppression list
→ Soft bounces → Retry queue (4hr delay, 3 max retries)
→ Dead letter → Mark UNKNOWN
```
