#!/bin/bash
# deploy.sh — Local wrapper that installs expect (if needed) and runs deploy.exp
# Usage: ./scripts/deploy.sh <ssh_password>

set -e

PASS="$1"
HOST="80.96.108.180"

if [ -z "$PASS" ]; then
    echo "Usage: $0 <ssh_password>"
    echo ""
    echo "This will deploy Bounce-CLN to root@$HOST"
    exit 1
fi

# Ensure we're in the project root
if [ ! -f "package.json" ] || [ ! -d "apps" ]; then
    echo "❌ Run this script from the project root directory"
    exit 1
fi

# Install expect if missing
if ! command -v expect &> /dev/null; then
    echo "📦 expect not found — installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        if command -v brew &> /dev/null; then
            brew install expect
        else
            echo "❌ Homebrew not found. Please install expect manually."
            exit 1
        fi
    elif command -v apt-get &> /dev/null; then
        sudo apt-get update -qq && sudo apt-get install -y -qq expect
    elif command -v yum &> /dev/null; then
        sudo yum install -y expect
    else
        echo "❌ Cannot auto-install expect. Please install it manually."
        exit 1
    fi
fi

# Run the expect script
expect "$(dirname "$0")/deploy.exp" "$PASS"
