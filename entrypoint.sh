#!/bin/bash
# Fix ownership of the mounted volume (mounted as root by Railway)
chown -R claude:claude /data

# Symlink Claude auth dir
ln -sfn /data/claude /home/claude/.claude

# Drop to claude user and run the app
exec su claude -c "node /app/dist/index.js"
