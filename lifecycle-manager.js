#!/usr/bin/env node

/**
 * Custom application lifecycle manager for Dokploy
 * Handles graceful restarts via SIGHUP signal
 */

const { spawn } = require('child_process');
const path = require('path');

let appProcess = null;
let shuttingDown = false;

function startApplication() {
  console.log('[Lifecycle] Starting Dokploy application...');
  
  appProcess = spawn('pnpm', ['start'], {
    cwd: '/app',
    stdio: 'inherit',
    env: { ...process.env }
  });

  appProcess.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`[Lifecycle] App exited with code ${code}. Restarting in 5s...`);
      setTimeout(startApplication, 5000);
    }
  });
}

function gracefulRestart() {
  if (shuttingDown) return;
  
  console.log('[Lifecycle] Received restart signal, gracefully restarting...');
  shuttingDown = true;
  
  if (appProcess) {
    appProcess.kill('SIGTERM');
    
    setTimeout(() => {
      shuttingDown = false;
      startApplication();
    }, 2000);
  } else {
    shuttingDown = false;
    startApplication();
  }
}

function gracefulShutdown() {
  console.log('[Lifecycle] Shutting down...');
  shuttingDown = true;
  
  if (appProcess) {
    appProcess.kill('SIGTERM');
  }
  
  setTimeout(() => process.exit(0), 5000);
}

// Handle signals
process.on('SIGHUP', gracefulRestart);
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start the app
startApplication();

console.log('[Lifecycle] Manager started. Send SIGHUP to restart app.');
