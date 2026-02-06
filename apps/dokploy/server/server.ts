import { migration } from "@/server/db/migration";
import {
  createDefaultMiddlewares,
  createDefaultServerTraefikConfig,
  createDefaultTraefikConfig,
  initCancelDeployments,
  initCronJobs,
  initEnterpriseBackupCronJobs,
  initializeNetwork,
  initSchedules,
  initVolumeBackupsCronJobs,
  IS_CLOUD,
  sendDokployRestartNotifications,
  setupDirectories,
} from "@dokploy/server";
import {
  initializePostgres,
  initializeRedis,
  initializeSwarm,
  initializeStandaloneTraefik as initializeTraefik,
} from "@dokploy/server/index";
import { logDockerMode } from "@dokploy/server/utils/docker/mode-detection";
import { config } from "dotenv";
import http from "http";
import next from "next";
import { writeFileSync } from "node:fs";
import packageInfo from "../package.json";
import { setupDockerContainerLogsWebSocketServer } from "./wss/docker-container-logs";
import { setupDockerContainerTerminalWebSocketServer } from "./wss/docker-container-terminal";
import { setupDockerStatsMonitoringSocketServer } from "./wss/docker-stats";
import { setupDrawerLogsWebSocketServer } from "./wss/drawer-logs";
import { setupDeploymentLogsWebSocketServer } from "./wss/listen-deployment";
import { setupTerminalWebSocketServer } from "./wss/terminal";

config({ path: ".env" });
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const dev = process.env.NODE_ENV !== "production";

// Initialize critical directories and Traefik config BEFORE Next.js starts
// This prevents race conditions with the install script
if (process.env.NODE_ENV === "production" && !IS_CLOUD) {
  setupDirectories();
  createDefaultTraefikConfig();
  createDefaultServerTraefikConfig();
  console.log("✅ initialization complete");
}

const app = next({ dev, turbopack: process.env.TURBOPACK === "1" });
const handle = app.getRequestHandler();
void app.prepare().then(async () => {
  try {
    console.log("Running DokployVersion: ", packageInfo.version);
    const server = http.createServer((req, res) => {
      handle(req, res);
    });

    // WEBSOCKET
    setupDrawerLogsWebSocketServer(server);
    setupDeploymentLogsWebSocketServer(server);
    setupDockerContainerLogsWebSocketServer(server);
    setupDockerContainerTerminalWebSocketServer(server);
    setupTerminalWebSocketServer(server);
    if (!IS_CLOUD) {
      setupDockerStatsMonitoringSocketServer(server);
    }

    if (process.env.NODE_ENV === "production" && !IS_CLOUD) {
      // Detect and log Docker mode for debugging
      await logDockerMode();

      // Setup directories and configs first
      setupDirectories();
      createDefaultMiddlewares();
      createDefaultTraefikConfig();
      createDefaultServerTraefikConfig();

      console.log("🔃  [BOOTSTRAP]: Initializing infrastructure...");

      // Initialize Docker Swarm and network
      await initializeNetwork();
      await initializeSwarm();

      // Initialize data services in parallel for faster startup
      console.log("🚀 Starting Redis and Postgres in parallel...");
      await Promise.all([initializeRedis(), initializePostgres()]);
      console.log("✅ Data services ready");

      // Run migrations after Postgres is confirmed healthy
      await migration();
      console.log("✅ Database migrations completed");

      // Initialize Traefik after data services are ready
      await initializeTraefik();
      console.log("✅ Traefik initialized");

      // Initialize application features in parallel
      console.log("🚀 Initializing application features...");
      await Promise.all([
        initCronJobs(),
        initSchedules(),
        initCancelDeployments(),
        initVolumeBackupsCronJobs(),
      ]);
      console.log("✅ Application features initialized");

      // Send notifications after everything is ready
      await sendDokployRestartNotifications();
    }

    if (IS_CLOUD && process.env.NODE_ENV === "production") {
      await migration();
    }
    server.listen(PORT, HOST);
    console.log(`Server Started on: http://${HOST}:${PORT}`);
    await initEnterpriseBackupCronJobs();

    if (!IS_CLOUD) {
      console.log("Starting Deployment Worker");
      const { deploymentWorker } = await import("./queues/deployments-queue");
      await deploymentWorker.run();
    }
  } catch (e) {
    console.error("Main Server Error", e);
    try {
      writeFileSync("/app/.reload-trigger", Date.now().toString());
    } catch {
      console.error(
        "[RECOVERY]: Failed to write reload trigger file. You're probably not running in Docker.",
      );
    }
    process.exit(1);
  }
});
