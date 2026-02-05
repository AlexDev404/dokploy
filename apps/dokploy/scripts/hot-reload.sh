#!/bin/bash
# Helper script to reload Dokploy without container restart

CONTAINER_NAME="${1:-dokploy-app}"

echo "Triggering hot-reload for container: $CONTAINER_NAME"

# Try signal-based reload first (cleaner)
if docker exec "$CONTAINER_NAME" kill -HUP 1 2>/dev/null; then
  echo "✅ Reload signal sent successfully"
  echo "Application is restarting inside the container..."
  exit 0
fi

# Fallback to file-based trigger
if docker exec "$CONTAINER_NAME" touch /app/.reload-trigger 2>/dev/null; then
  echo "✅ Reload trigger file created"
  echo "Application will restart within 3 seconds..."
  exit 0
fi

echo "❌ Failed to trigger reload. Is the container running?"
echo "Usage: $0 [container-name]"
exit 1
