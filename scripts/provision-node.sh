#!/usr/bin/env bash
# provision-node.sh — Manual SSH provisioning helper
# Usage: ./scripts/provision-node.sh <ip> <ssh_user> [ssh_port]

set -euo pipefail

NODE_IP="${1:?Usage: $0 <ip> <ssh_user> [ssh_port]}"
SSH_USER="${2:-root}"
SSH_PORT="${3:-22}"
MASTER_URL="${MASTER_API_URL:-http://localhost:4000}"
HMAC_SECRET="${HMAC_SECRET:-dev-hmac-secret}"

AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)/agent"

echo "🚀 Provisioning node $NODE_IP as $SSH_USER:$SSH_PORT"

ssh -p "$SSH_PORT" "$SSH_USER@$NODE_IP" "apt-get update -qq && apt-get install -y -qq python3 python3-pip python3-venv"

echo "📦 Uploading agent..."
scp -P "$SSH_PORT" -r "$AGENT_DIR" "$SSH_USER@$NODE_IP:/opt/bounce-agent"

echo "🐍 Installing Python dependencies..."
ssh -p "$SSH_PORT" "$SSH_USER@$NODE_IP" "cd /opt/bounce-agent && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -q"

# Get NODE_ID from master API
NODE_ID=$(curl -s -X POST "$MASTER_URL/api/nodes" \
  -H "Content-Type: application/json" \
  -d "{\"hostname\":\"$(ssh -p $SSH_PORT $SSH_USER@$NODE_IP hostname)\",\"ip\":\"$NODE_IP\",\"sshPort\":$SSH_PORT}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo "✅ Node registered with ID: $NODE_ID"

# Write .env
ssh -p "$SSH_PORT" "$SSH_USER@$NODE_IP" "cat > /opt/bounce-agent/.env <<EOF
MASTER_API_URL=$MASTER_URL
NODE_ID=$NODE_ID
HMAC_SECRET=$HMAC_SECRET
HEARTBEAT_INTERVAL=30
CONCURRENCY=50
EOF"

# Install systemd service
ssh -p "$SSH_PORT" "$SSH_USER@$NODE_IP" "cat > /etc/systemd/system/bounce-agent.service <<EOF
[Unit]
Description=Bounce-CLN Verification Agent
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/bounce-agent
ExecStart=/opt/bounce-agent/.venv/bin/python agent.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=/opt/bounce-agent/.env

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable bounce-agent && systemctl restart bounce-agent"

echo "🎉 Agent installed and running on $NODE_IP"
