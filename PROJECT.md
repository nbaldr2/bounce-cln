# Bounce-CLN — Project Overview & Progress

## What Is Bounce-CLN?

Bounce-CLN is a **distributed SMTP email verification orchestrator** designed for high-throughput list cleaning across multiple VPS nodes. It coordinates a fleet of remote agents (each running PowerMTA) to verify large email lists by performing real SMTP handshake checks — without ever sending a message.

### Core Problem It Solves

Email marketers and list owners need to know which addresses are valid, which are hard bounces, and which are catch-all or greylisted. Doing this at scale (millions of emails) requires:

- **Multiple sending IPs** spread across VPS nodes to avoid rate-limits and blacklisting
- **IP warm-up management** so new IPs don't get flagged
- **Intelligent routing** — send Gmail checks to nodes with good Gmail reputation, Yahoo checks to Yahoo-optimized nodes, etc.
- **Catch-all detection** — some domains accept every address; these need to be flagged without wasting SMTP connections
- **Retry logic** — soft bounces and greylisted addresses deserve another chance
- **Suppression management** — hard bounces should never be mailed again

Bounce-CLN automates all of this from a single dashboard.

---

## Architecture

```
┌──────────────────┐     ┌──────────────────┐
│   Next.js 15     │     │   Express.js API  │
│   Dashboard      │────▶│   (TypeScript)    │
│   (React 19)     │     │   Port 4000       │
└──────────────────┘     └───────┬──────────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
              ┌─────▼─────┐ ┌───▼───┐ ┌─────▼──────┐
              │ PostgreSQL │ │ Redis │ │ BullMQ     │
              │ 16 + Prisma│ │  7    │ │ Workers    │
              └───────────┘ └───────┘ └─────┬──────┘
                                         │
                          ┌───────────────┼───────────────┐
                          │               │               │
                    ┌─────▼─────┐  ┌──────▼──────┐  ┌─────▼─────┐
                    │ VPS Node 1│  │ VPS Node 2  │  │ VPS Node N│
                    │ Python    │  │ Python      │  │ Python    │
                    │ Agent     │  │ Agent       │  │ Agent     │
                    │ + PMTA    │  │ + PMTA      │  │ + PMTA    │
                    └───────────┘  └─────────────┘  └───────────┘
```

| Layer | Technology |
|---|---|
| Dashboard | Next.js 15, React 19, Recharts, Lucide Icons |
| API | Express.js 5, TypeScript, Prisma ORM |
| Database | PostgreSQL 16 (Docker), Prisma schema |
| Queue | Redis 7 (Docker), BullMQ |
| Node Agent | Python 3.11, asyncio, aiohttp, aiodns, psutil |
| Auth | HMAC-SHA256 signed requests |
| VPS Provisioning | SSH + systemd + PowerMTA |

---

## What Has Been Built

### 1. API Server (`apps/api`)

**9 Route Modules:**

- **Nodes** — CRUD + heartbeat processing + SSH provisioning
- **Lists** — CSV upload, chunking into batches, status tracking
- **Jobs** — Batch assignment status, node job polling
- **Results** — Email verification result ingestion, CSV export, pagination
- **Domains** — Sending domain management, DKIM key generation, DNS verification
- **PMTA** — PowerMTA config generation per node+domain, SSH deployment
- **Dashboard** — Overview stats, throughput, provider breakdown, alerts
- **Rate Limits** — Per-provider SMTP rate configuration
- **Settings** — Global app settings (batch size, warm-up limits, etc.)

**7 Service Modules:**

- **`bounceClassifier.ts`** — Full RFC 5321 SMTP code map (2xx/4xx/5xx), MX provider detection (Gmail, Outlook, Yahoo, iCloud, etc.)
- **`dkimGenerator.ts`** — RSA-2048 DKIM key pair generation, SPF record builder, DNS instruction generator
- **`loadBalancer.ts`** — Weighted scoring algorithm: queue depth (40%), CPU (20%), IP reputation (25%), warmup capacity (15%)
- **`nodeManager.ts`** — SSH-based VPS provisioning (Python + agent + PMTA install + systemd), heartbeat timeout detection, auto-alerting
- **`warmupScheduler.ts`** — 4-phase IP warm-up: Day 1-3 (200/IP/day) → Day 4-7 (500) → Day 8-14 (1500) → Day 15+ (5000), daily counter resets
- **`suppressionSync.ts`** — Global suppression list with Redis pub/sub for real-time agent notification
- **`nodeManager.ts`** — Node health tracking, offline detection, alert creation

**3 BullMQ Workers:**

- **`batchAssigner.ts`** — Picks queued jobs, detects dominant MX provider, assigns to best node via load balancer, exponential backoff on failure
- **`retryWorker.ts`** — Processes due retries every 5 min, dead-letters after 3 failures, re-assigns to different nodes
- **`alertWorker.ts`** — Scheduled tasks: heartbeat checks (30s), daily warm-up advance (midnight UTC), daily counter reset

### 2. Dashboard (`apps/dashboard`)

**8 Pages with dark-themed UI:**

- **Overview** — Real-time stats (total verified, valid, hard bounces, nodes online, retry queue depth, active alerts), throughput area chart (24h), result breakdown donut chart, MX provider bar chart, alert banners with resolve action
- **Nodes** — Add/provision VPS nodes, view IP list + reputation + warm-up status, SSH credentials, online/offline/error state
- **Lists** — CSV upload, processing progress (valid/invalid/unknown/catch-all counts), status tracking
- **Domains** — Add sending domains, auto-generated DKIM keys, DNS record instructions, SPF records, DNS verification
- **PMTA** — Select node + domain → generate PowerMTA config → deploy via SSH
- **Jobs** — View batch assignment status, per-job email counts, node assignments
- **Rate Limits** — Per-provider SMTP concurrency and rate limits (Gmail, Outlook, Yahoo, etc.)
- **Settings** — Global configuration (batch size, heartbeat timeout, warm-up limits, catch-all recheck interval, alert thresholds)

### 3. Python Agent (`agent/`)

**5 Modules:**

- **`agent.py`** — Main loop: heartbeats every 30s, polls master for assigned jobs, groups emails by domain, resolves MX records, detects catch-all domains, runs async SMTP verification with concurrency control (default 50), POSTs results back with HMAC signing
- **`smtp_verifier.py`** — Raw asyncio TCP SMTP handshake: connect → read 220 banner → EHLO/HELO → MAIL FROM → RCPT TO → QUIT. No email is ever sent. Handles multi-line responses, timeouts, connection refused, network errors
- **`catchall_detector.py`** — Probes a random unlikely email (12-char prefix) on the domain's MX server. If 250 returned → catch-all. In-memory cache for the agent's lifetime
- **`bounce_codes.py`** — Full RFC 5321 SMTP code classification (2xx=VALID, 4xx=SOFT_BOUNCE/GREYLISTED, 5xx=INVALID), content-based hints (greylist, blacklist detection), fallback by code range
- **`heartbeat.py`** — Periodic CPU/memory/queue-depth reporter via HMAC-signed POST to master

### 4. Database Schema (`prisma/schema.prisma`)

**12 Models + 7 Enums:**

| Model | Purpose |
|---|---|
| `Node` | VPS node with SSH credentials, status, warm-up day, tags |
| `NodeIp` | Per-IP reputation, warm-up day, daily count, provider |
| `SendingDomain` | Domain with DKIM keys, SPF, DNS verification status |
| `EmailList` | Uploaded CSV list with processing stats |
| `EmailJob` | Batch chunk with email array, assignment, status |
| `EmailResult` | Individual verification result with SMTP code/message |
| `SuppressionEntry` | Global hard-bounce suppression list |
| `CatchAllDomain` | Detected catch-all domains with last-checked timestamp |
| `RetryQueue` | Soft-bounce retry entries with retry count and scheduling |
| `RateLimit` | Per-provider SMTP rate configuration |
| `Alert` | System alerts (node offline, high bounce rate, IP blacklisted, etc.) |
| `Setting` | Key-value global settings |

### 5. Infrastructure

- **`docker-compose.yml`** — PostgreSQL 16 Alpine + Redis 7 Alpine with health checks and persistent volumes
- **`scripts/provision-node.sh`** — CLI tool to SSH into a VPS, install Python, upload agent, register with master, configure systemd service
- **`.env.example`** — All environment variables documented
- **Monorepo** — npm workspaces with `apps/api` and `apps/dashboard`

### 6. Seed Data (`prisma/seed.ts`)

- **9 provider rate limits** — Gmail, Outlook, Hotmail, Live, Yahoo, AOL, iCloud, default
- **11 app settings** — batch size, heartbeat timeout, max retries, warm-up limits, catch-all recheck interval, alert thresholds, probe email prefix

---

## Verification Workflow

```
1. Upload CSV via Dashboard
2. API chunks list into batches → creates EmailJobs
3. BullMQ batchAssigner picks jobs → detects MX provider
4. Load balancer scores online nodes → assigns to best node
5. Agent polls for assigned jobs → resolves MX per domain
6. Catch-all probe: random email → if 250, flag all emails on that domain
7. Async SMTP verify: EHLO → MAIL FROM → RCPT TO → QUIT (no email sent)
8. Agent POSTs results back (HMAC-signed)
9. API classifies via bounce code map:
   - VALID → keep
   - INVALID (hard bounce) → add to suppression list
   - SOFT_BOUNCE / GREYLISTED → enqueue in retry queue
   - CATCH_ALL → flag, skip future SMTP checks
   - TIMEOUT / UNKNOWN → flag for review
10. Retry worker: re-attempts soft bounces every 4h (max 3 retries)
11. Dead letters after max retries → marked UNKNOWN
12. Dashboard shows real-time stats, charts, alerts
```

---

## Key Design Decisions

- **No email is ever sent** — the SMTP handshake stops at RCPT TO, making this a pure verification tool
- **HMAC-SHA256 auth** — all agent-to-master communication is cryptographically signed with timestamps
- **Weighted load balancing** — not round-robin; considers real-time node health, IP reputation, and warm-up state
- **Catch-all caching** — detected once per agent process lifetime, avoids redundant probes
- **Suppression via Redis pub/sub** — when a hard bounce is recorded, all agents are notified in real-time
- **PowerMTA integration** — config generation and SSH deployment for production mail infrastructure
- **IP warm-up as first-class concept** — gradual ramp-up prevents new IPs from being blacklisted

---

## Current Status

| Component | Status |
|---|---|
| Database schema | ✅ Complete (12 models, 7 enums, seed data) |
| API routes | ✅ Complete (9 route modules) |
| API services | ✅ Complete (7 service modules) |
| BullMQ workers | ✅ Complete (3 workers with scheduled tasks) |
| Python agent | ✅ Complete (5 modules, full SMTP verification) |
| Dashboard pages | ✅ Complete (8 pages with charts and CRUD) |
| Docker infrastructure | ✅ Complete (Postgres + Redis) |
| Provisioning scripts | ✅ Complete (SSH + systemd) |
| DKIM/SPF generation | ✅ Complete (RSA-2048 + DNS instructions) |
| PowerMTA config | ✅ Complete (generation + SSH deploy) |
| Load balancer | ✅ Complete (weighted scoring) |
| IP warm-up scheduler | ✅ Complete (4-phase schedule) |
| Retry queue | ✅ Complete (4h delay, 3 max, dead letter) |
| Suppression list | ✅ Complete (Redis pub/sub sync) |
| Alert system | ✅ Complete (6 alert types, auto-resolve) |
| Auth (HMAC) | ✅ Complete (signed agent ↔ master) |

### Known Issues

- **Database push fails** with Prisma P1010 error — the `apps/api/.env` had `postgres` user instead of `bounce` (the actual Docker user). Requires fixing `DATABASE_URL` and granting schema ownership to the `bounce` user.
