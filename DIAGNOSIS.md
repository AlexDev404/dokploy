# Dokploy App Crash Diagnosis

## Error Summary
```
dokploy-app  | [RUNTIME] Connecting to database: postgres://dokploy:***@127.0.0.1:5432/dokploy
dokploy-app  | ELIFECYCLE Command failed with exit code 1.
dokploy-app  | [Dokploy-Init] App crashed
```

## Root Cause Analysis

### Primary Issue: Missing Build Artifacts
The application is crashing because the `dist/` directory is missing. The start command in `package.json` tries to run:
```json
"start": "node -r dotenv/config dist/server.mjs"
```

But the `dist/server.mjs` file doesn't exist because the build step hasn't been run.

### Why the Database Connection Appears Twice
The "[RUNTIME] Connecting to database" message appears twice because:
1. **First occurrence**: When `@/server/db/migration` is imported (line 1 of `server/server.ts`), it imports `dbUrl` from `@dokploy/server/db`, which initializes the database module
2. **Second occurrence**: When other `@dokploy/server` imports are loaded, they also trigger the db module initialization

This is normal behavior for ES modules with side effects.

### Build Process Issue
The Dockerfile expects a `.env.production` file to exist in the repository root:
```dockerfile
COPY .env.production ./.env
```

However:
- This file is in `.gitignore` (line 48)
- It should be created before the Docker build
- The `.env.production.example` file in `apps/dokploy/` shows the expected format

## Diagnosis Steps to Verify

1. **Check if PostgreSQL is accessible**:
   ```bash
   # From within the dokploy-app container
   nc -zv 127.0.0.1 5432
   ```

2. **Verify the dist directory exists**:
   ```bash
   # From within the dokploy-app container
   ls -la /app/dist/
   ```

3. **Check environment variables**:
   ```bash
   # From within the dokploy-app container
   env | grep DATABASE_URL
   env | grep NODE_ENV
   ```

4. **Test database connection**:
   ```bash
   # From within the dokploy-app container
   psql postgres://dokploy:PASSWORD@127.0.0.1:5432/dokploy -c "SELECT 1;"
   ```

## Solution Recommendations

### Immediate Fix
1. Ensure the application is properly built before running:
   ```bash
   pnpm run build  # This runs both build-server and build-next
   ```

2. Verify the `dist/server.mjs` file exists before starting the app

### Long-term Fixes
1. **Add build verification**: Update the Dockerfile to verify build artifacts exist
2. **Improve error messages**: Add better error handling for missing build files
3. **Document build process**: Clarify the build process in documentation

## Questions to Answer

1. **Is the database actually running and accessible at 127.0.0.1:5432?**
   - This needs to be verified in your environment

2. **Did the Docker build complete successfully?**
   - Check Docker build logs for any errors during the `pnpm run build` step

3. **Are there any other missing dependencies or files?**
   - The dist directory is required, but there may be other missing files

## Next Steps

Please provide:
1. The full Docker build logs
2. Output of `ls -la /app/dist/` from within the container
3. Output of `env | grep DATABASE` from within the container
4. PostgreSQL connection test results from within the container
