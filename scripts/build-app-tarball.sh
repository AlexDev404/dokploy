#!/bin/bash
set -e

# Build application tarball for hot-deployment into running containers
# This creates a minimal tarball containing only the application artifacts

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="${PROJECT_ROOT}/dist-tarball"
TARBALL_NAME="dokploy-app-$(date +%Y%m%d-%H%M%S).tar.gz"

echo "=== Dokploy Application Tarball Builder ==="
echo "Project root: $PROJECT_ROOT"
echo "Output: $OUTPUT_DIR/$TARBALL_NAME"
echo ""

# Clean previous build artifacts
echo "[1/6] Cleaning previous builds..."
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/staging"

# Build the application
echo "[2/6] Building Dokploy application..."
cd "$PROJECT_ROOT"

# Build server package first
echo "  -> Building @dokploy/server..."
pnpm --filter=@dokploy/server build

# Build main dokploy app
echo "  -> Building dokploy app..."
pnpm --filter=./apps/dokploy run build

echo "[3/6] Staging files for tarball..."
STAGING="${OUTPUT_DIR}/staging/app"
mkdir -p "$STAGING"

# Copy built artifacts
echo "  -> Copying .next build..."
cp -R "${PROJECT_ROOT}/apps/dokploy/.next" "$STAGING/.next"

echo "  -> Copying dist files..."
cp -R "${PROJECT_ROOT}/apps/dokploy/dist" "$STAGING/dist"

echo "  -> Copying configuration..."
cp "${PROJECT_ROOT}/apps/dokploy/next.config.mjs" "$STAGING/"
cp "${PROJECT_ROOT}/apps/dokploy/package.json" "$STAGING/"
cp "${PROJECT_ROOT}/apps/dokploy/components.json" "$STAGING/" 2>/dev/null || true

echo "  -> Copying public assets..."
cp -R "${PROJECT_ROOT}/apps/dokploy/public" "$STAGING/public"

echo "  -> Copying database migrations..."
cp -R "${PROJECT_ROOT}/apps/dokploy/drizzle" "$STAGING/drizzle"

# Create deployment metadata
cat > "$STAGING/deployment-info.json" << EOF
{
  "buildDate": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "gitCommit": "$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')",
  "gitBranch": "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')",
  "tarballName": "$TARBALL_NAME"
}
EOF

echo "[4/6] Creating tarball..."
cd "$OUTPUT_DIR/staging"
tar -czf "../${TARBALL_NAME}" app/

echo "[5/6] Generating deployment script..."
cat > "$OUTPUT_DIR/deploy-tarball.sh" << 'DEPLOY_SCRIPT'
#!/bin/bash
# Auto-generated deployment script for Dokploy application tarball

set -e

CONTAINER_NAME="${1:-dokploy-app}"
TARBALL="${2}"

if [ -z "$TARBALL" ]; then
  echo "Usage: $0 <container-name> <tarball-file>"
  echo "Example: $0 dokploy-app dokploy-app-20240205-123456.tar.gz"
  exit 1
fi

if [ ! -f "$TARBALL" ]; then
  echo "Error: Tarball not found: $TARBALL"
  exit 1
fi

echo "Deploying tarball to container: $CONTAINER_NAME"
echo "Tarball: $TARBALL"
echo ""

# Check container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Error: Container '$CONTAINER_NAME' is not running"
  exit 1
fi

echo "[1/4] Backing up current deployment..."
docker exec "$CONTAINER_NAME" sh -c '
  if [ -d /app/.next ]; then
    timestamp=$(date +%Y%m%d-%H%M%S)
    mkdir -p /app/backups
    tar -czf /app/backups/backup-${timestamp}.tar.gz .next dist public || true
    echo "Backup created: /app/backups/backup-${timestamp}.tar.gz"
  fi
' || echo "No previous deployment to backup"

echo "[2/4] Uploading new tarball..."
docker cp "$TARBALL" "${CONTAINER_NAME}:/tmp/app-update.tar.gz"

echo "[3/4] Extracting and deploying..."
docker exec "$CONTAINER_NAME" sh -c '
  cd /tmp
  tar -xzf app-update.tar.gz
  rm -rf /app/.next /app/dist /app/public
  cp -R app/.next app/dist app/public app/drizzle /app/
  [ -f app/next.config.mjs ] && cp app/next.config.mjs /app/
  [ -f app/components.json ] && cp app/components.json /app/
  rm -rf app app-update.tar.gz
  echo "Deployment extracted successfully"
'

echo "[4/4] Triggering hot-reload..."
if docker exec "$CONTAINER_NAME" kill -HUP 1 2>/dev/null; then
  echo "✅ Hot-reload triggered successfully"
elif docker exec "$CONTAINER_NAME" touch /app/.reload-trigger 2>/dev/null; then
  echo "✅ Reload trigger created"
else
  echo "⚠️  Could not trigger reload - you may need to restart manually"
fi

echo ""
echo "Deployment complete! Application should restart within seconds."
echo "Monitor logs: docker logs -f $CONTAINER_NAME"
DEPLOY_SCRIPT

chmod +x "$OUTPUT_DIR/deploy-tarball.sh"

echo "[6/6] Cleanup..."
rm -rf "$OUTPUT_DIR/staging"

echo ""
echo "=== Build Complete ==="
echo "Tarball: $OUTPUT_DIR/$TARBALL_NAME"
echo "Size: $(du -h "$OUTPUT_DIR/$TARBALL_NAME" | cut -f1)"
echo ""
echo "To deploy:"
echo "  cd $OUTPUT_DIR"
echo "  ./deploy-tarball.sh dokploy-app $TARBALL_NAME"
echo ""
echo "Or manually:"
echo "  docker cp $TARBALL_NAME dokploy-app:/tmp/"
echo "  docker exec dokploy-app tar -xzf /tmp/$TARBALL_NAME -C /"
echo "  docker kill -s HUP dokploy-app"
