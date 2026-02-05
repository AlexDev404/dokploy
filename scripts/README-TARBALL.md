# Application Tarball Build System

## Overview

This directory contains scripts to build and deploy application-only updates without rebuilding the entire Docker image. Perfect for rapid iteration and hot-deployment scenarios.

## Quick Start

```bash
# Build tarball
pnpm build:tarball

# Deploy to running container
cd dist-tarball
./deploy-tarball.sh dokploy-app dokploy-app-*.tar.gz
```

## How It Works

### Build Process
1. Builds `@dokploy/server` package
2. Builds main `dokploy` application
3. Collects artifacts: `.next`, `dist`, `public`, `drizzle`
4. Creates timestamped tarball with deployment metadata
5. Generates deployment script

### Deployment Process
1. Backs up current deployment in container
2. Uploads tarball to container
3. Extracts and replaces application files
4. Triggers hot-reload (no restart needed)

## What's Included

The tarball contains:
- `.next/` - Next.js production build
- `dist/` - Compiled server code
- `public/` - Static assets
- `drizzle/` - Database migrations
- `next.config.mjs` - Next.js configuration
- `package.json` - Package metadata
- `deployment-info.json` - Build metadata (commit, timestamp)

## What's NOT Included

The tarball does NOT contain:
- `node_modules` (already in container)
- Docker configuration
- Environment files
- Database data
- System dependencies

## Build Script Details

### Location
`scripts/build-app-tarball.sh`

### Output
`dist-tarball/dokploy-app-YYYYMMDD-HHMMSS.tar.gz`

### Size
Typically 50-150 MB (vs 2+ GB for full Docker image)

### Build Time
~2 minutes (vs ~10 minutes for full image)

## Deployment Script

Auto-generated at: `dist-tarball/deploy-tarball.sh`

### Usage
```bash
./deploy-tarball.sh <container-name> <tarball-file>
```

### Features
- ✅ Validates container is running
- ✅ Automatic backup of current deployment
- ✅ Atomic deployment (all files or none)
- ✅ Automatic hot-reload trigger
- ✅ Error handling and rollback capability

## Manual Deployment

If you prefer manual control:

```bash
# Copy tarball to container
docker cp dokploy-app-20240205-123456.tar.gz dokploy-app:/tmp/

# Extract in container
docker exec dokploy-app bash -c '
  cd /tmp
  tar -xzf dokploy-app-*.tar.gz
  rm -rf /app/.next /app/dist /app/public
  cp -R app/* /app/
  rm -rf app dokploy-app-*.tar.gz
'

# Trigger reload
docker kill -s HUP dokploy-app
```

## Rollback

Backups are stored in the container at `/app/backups/`:

```bash
# List backups
docker exec dokploy-app ls -lh /app/backups/

# Restore from backup
docker exec dokploy-app bash -c '
  cd /app
  tar -xzf backups/backup-YYYYMMDD-HHMMSS.tar.gz
'

# Trigger reload
docker kill -s HUP dokploy-app
```

## CI/CD Integration

Example GitHub Actions workflow:

```yaml
- name: Build App Tarball
  run: pnpm build:tarball

- name: Upload Artifact
  uses: actions/upload-artifact@v3
  with:
    name: dokploy-app
    path: dist-tarball/*.tar.gz

- name: Deploy to Production
  run: |
    cd dist-tarball
    ./deploy-tarball.sh production-container *.tar.gz
```

## Troubleshooting

### Build fails
```bash
# Ensure dependencies installed
pnpm install

# Clean and rebuild
rm -rf dist-tarball
pnpm build:tarball
```

### Deployment fails
```bash
# Check container is running
docker ps | grep dokploy-app

# Check disk space
docker exec dokploy-app df -h /app

# Check logs
docker logs dokploy-app
```

### Application won't reload
```bash
# Check process status
docker exec dokploy-app ps aux | grep pnpm

# Manual restart
docker exec dokploy-app touch /app/.reload-trigger

# Force container restart as last resort
docker restart dokploy-app
```

## Performance Comparison

| Method | Build Time | Deploy Time | Downtime | Size |
|--------|-----------|-------------|----------|------|
| Full Image | 10 min | 2-3 min | 2-3 min | 2+ GB |
| Tarball | 2 min | 5 sec | 0 sec | 50-150 MB |
| Hot-Reload | 0 min | 3 sec | 0 sec | N/A |

## Best Practices

1. **Always test in staging** before deploying to production
2. **Check deployment-info.json** to verify build metadata
3. **Keep backups** for at least 24 hours
4. **Monitor logs** during deployment
5. **Use CI/CD** for automated builds and deployments

## Advanced Usage

### Custom staging
```bash
# Edit the script to customize staging location
STAGING="/your/custom/path"
```

### Include additional files
```bash
# Add to the staging section in build-app-tarball.sh
cp -R "${PROJECT_ROOT}/your-files" "$STAGING/"
```

### Parallel deployments
```bash
# Deploy to multiple containers
for container in app1 app2 app3; do
  ./deploy-tarball.sh $container dokploy-app-*.tar.gz &
done
wait
```
