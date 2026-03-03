#!/bin/bash
set -e

# Fix ownership of the mounted volume (mounted as root by Railway)
chown -R claude:claude /data

# Ensure the persistent claude auth dir exists on the volume
mkdir -p /data/claude
chown -R claude:claude /data/claude

# Symlink Claude auth dir from home to persistent volume
# This ensures claude login tokens survive redeploys
# Remove existing dir/link first to avoid nested symlink issues
rm -rf /home/claude/.claude
ln -sfn /data/claude /home/claude/.claude
chown -h claude:claude /home/claude/.claude

# Configure gh CLI auth for the claude user using GITHUB_TOKEN
if [ -n "$GITHUB_TOKEN" ]; then
  su claude -c "echo '$GITHUB_TOKEN' | gh auth login --with-token 2>/dev/null || true"
fi

# Drop to claude user and run the app
exec su claude -c "node /app/dist/index.js"
