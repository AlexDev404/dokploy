#!/bin/bash
set -e

# Universal entrypoint supporting both DinD and socket mounting
echo "[Dokploy-Init] Initializing container environment..."

# Detect if we're using socket mounting or DinD
detect_docker_mode() {
  if [ -S "/var/run/docker.sock" ] && docker info > /dev/null 2>&1; then
    echo "socket"
  else
    echo "dind"
  fi
}

MODE=$(detect_docker_mode)
echo "[Dokploy-Init] Running in mode: $MODE"

# Cleanup any leftover files
rm -f /var/run/docker.pid /var/run/sshd.pid /app/.reload-trigger

# Start SSH if available
if command -v sshd > /dev/null 2>&1; then
  echo "[Dokploy-Init] Starting SSH server..."
  /usr/sbin/sshd 2>/dev/null || echo "[Dokploy-Init] SSH not critical, continuing..."
fi

# DinD-specific initialization
if [ "$MODE" = "dind" ]; then
  echo "[Dokploy-Init] Configuring Docker-in-Docker environment..."
  
  # Ensure log directory exists
  mkdir -p /var/log
  # Start dockerd in background
  dockerd > /var/log/dockerd.log 2>&1 &
  DOCKERD_PID=$!
  
  # Wait for Docker to be ready
  echo "[Dokploy-Init] Waiting for Docker daemon..."
  attempt=0
  while [ $attempt -lt 60 ]; do
    if docker info > /dev/null 2>&1; then
      echo "[Dokploy-Init] Docker daemon ready (${attempt}s)"
      break
    fi
    
    if ! kill -0 $DOCKERD_PID 2>/dev/null; then
      echo "[Dokploy-Init] ERROR: dockerd died during startup"
      cat /var/log/dockerd.log
      exit 1
    fi
    
    [ $((attempt % 10)) -eq 0 ] && echo "[Dokploy-Init] Still waiting... (${attempt}s)"
    sleep 1
    attempt=$((attempt + 1))
  done
  
  if [ $attempt -ge 60 ]; then
    echo "[Dokploy-Init] ERROR: Docker failed to start"
    cat /var/log/dockerd.log
    exit 1
  fi
  
  # Initialize swarm if needed
  if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
    echo "[Dokploy-Init] Initializing Docker Swarm..."
    docker swarm init --advertise-addr 127.0.0.1 2>/dev/null || \
      echo "[Dokploy-Init] Swarm init warning (may already exist)"
  fi
else
  echo "[Dokploy-Init] Using host Docker socket"
  
  # Verify socket access
  if ! docker info > /dev/null 2>&1; then
    echo "[Dokploy-Init] ERROR: Cannot access Docker socket"
    exit 1
  fi
  
  # Check swarm status
  if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
    echo "[Dokploy-Init] Warning: Swarm not initialized on host Docker"
  fi
fi

# Application lifecycle management
APP_PID=""

launch_application() {
  echo "[Dokploy-Init] Launching application..."
  cd /app
  pnpm start &
  APP_PID=$!
  echo "[Dokploy-Init] App running (PID: $APP_PID)"
}

restart_application() {
  echo "[Dokploy-Init] Restarting application..."
  
  if [ -n "$APP_PID" ] && kill -0 $APP_PID 2>/dev/null; then
    kill -TERM $APP_PID
    
    # Graceful wait using a counter loop for better compatibility
    local wait_count=0
    while kill -0 $APP_PID 2>/dev/null && [ $wait_count -lt 10 ]; do
      sleep 1
      wait_count=$((wait_count + 1))
    done
    
    # Force if needed
    kill -0 $APP_PID 2>/dev/null && kill -9 $APP_PID
  fi
  
  sleep 1
  launch_application
}

# Signal handling
handle_sighup() {
  echo "[Dokploy-Init] Caught SIGHUP - reloading..."
  restart_application
}

handle_sigterm() {
  echo "[Dokploy-Init] Caught SIGTERM - shutting down..."
  
  [ -n "$APP_PID" ] && kill -0 $APP_PID 2>/dev/null && kill -TERM $APP_PID
  
  if [ "$MODE" = "dind" ] && [ -n "$DOCKERD_PID" ]; then
    kill -TERM $DOCKERD_PID 2>/dev/null || true
  fi
  
  exit 0
}

trap handle_sighup HUP
trap handle_sigterm TERM INT

# Start the application
launch_application

# Monitoring loop
echo "[Dokploy-Init] Ready. Monitoring for reload triggers..."
echo "[Dokploy-Init] - File trigger: touch /app/.reload-trigger"
echo "[Dokploy-Init] - Signal trigger: docker kill -s HUP <container>"

while true; do
  # File-based reload
  if [ -f /app/.reload-trigger ]; then
    rm -f /app/.reload-trigger
    restart_application
  fi
  
  # Auto-restart on crash
  if [ -n "$APP_PID" ] && ! kill -0 $APP_PID 2>/dev/null; then
    echo "[Dokploy-Init] App crashed, auto-restarting..."
    launch_application
  fi
  
  sleep 3
done
