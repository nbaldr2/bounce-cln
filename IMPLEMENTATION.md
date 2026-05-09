# Bounce-CLN Implementation Details

## 1. System Architecture
Bounce-CLN is a distributed SMTP verification orchestrator designed to scale email list hygiene across multiple VPS nodes.

### Components
- **Master API (Express.js + TypeScript)**: Central brain managing nodes, jobs, lists, and results.
- **Dashboard (Next.js 15)**: Real-time glassmorphic UI for orchestration and monitoring.
- **Node Agent (Python 3.11)**: Distributed agents running on VPS nodes for async SMTP probing.
- **PowerMTA Integration**: Automated configuration and deployment for high-reputation sending.
- **Redis + BullMQ**: Distributed task queuing for batch processing and retries.
- **PostgreSQL + Prisma**: Relational storage for nodes, jobs, and email results.

---

## 2. Core Features Implemented

### 🚀 Distributed Verification
- **Batch Processing**: Large email lists are chunked and assigned to nodes based on load and reputation.
- **Async SMTP Probing**: Python agents use `asyncio` to perform non-intrusive SMTP handshakes (EHLO -> MAIL FROM -> RCPT TO -> QUIT).
- **Catch-all Detection**: Automated probing for catch-all domains to prevent false positives and protect IP reputation.

### 🛡️ Security & Authentication
- **HMAC-SHA256**: All agent-to-master communication is signed and verified using HMAC headers to prevent unauthorized result posting.
- **SSH Provisioning**: Automated deployment of agents and systemd services to remote VPS nodes via SSH.

### ⚙️ PowerMTA Orchestration
- **Dynamic Config Generation**: API generates PowerMTA XML configs with Virtual-MTAs per IP.
- **DKIM/SPF Automation**: Automatic RSA-2048 key generation and DNS record formatting.
- **Warm-up Scheduling**: Progressive volume scaling per IP to maintain sender reputation.

### 📊 Real-time Monitoring
- **Glassmorphic Dashboard**: Modern UI with live metrics for nodes, jobs, and global statistics.
- **Batch Monitor**: Detailed tracking of every verification batch.
- **Bounce Classification**: RFC-compliant categorization of SMTP response codes.

---

## 3. Technology Stack
- **Frontend**: Next.js 15, React 19, Lucide Icons, Glassmorphic CSS.
- **Backend**: Express.js, TypeScript, Prisma ORM, BullMQ.
- **Infrastructure**: PostgreSQL, Redis, Docker Compose.
- **Agent**: Python 3.11, `aiosmtplib`, `aiodns`, `psutil`.

---

## 4. Current Implementation Status
| Phase | Feature | Status |
|---|---|---|
| 1 | Monorepo & Infrastructure | ✅ Complete |
| 2 | Node Management & SSH | ✅ Complete |
| 3 | Python Agent (SMTP/MX) | ✅ Complete |
| 4 | PowerMTA Config & DKIM | ✅ Complete |
| 5 | Dashboard UI (Nodes/Lists/Jobs) | ✅ Complete |
| 6 | End-to-End Integration | ✅ Complete (Flow verified & DB fixed) |

---

## 5. How to Run
1. **Prerequisites**: Docker, Node.js 20+, Python 3.11.
2. **Infrastructure**: `docker-compose up -d`.
3. **API & Dashboard**:
   - `npm install`
   - `npm run db:push`
   - `npm run dev`
4. **Agent**:
   - `cd agent && pip install -r requirements.txt`
   - `python agent.py` (ensure `.env` is configured with `NODE_ID` and `HMAC_SECRET`)
