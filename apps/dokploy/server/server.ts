import { IS_CLOUD } from "@dokploy/server/constants/index";
import { setupDirectories } from "@dokploy/server/setup/config-paths";
import { initializePostgres } from "@dokploy/server/setup/postgres-setup";
import { initializeRedis } from "@dokploy/server/setup/redis-setup";
import {
  initializeNetwork,
  initializeSwarm,
} from "@dokploy/server/setup/setup";
import {
  createDefaultMiddlewares,
  createDefaultServerTraefikConfig,
  createDefaultTraefikConfig,
  initializeStandaloneTraefik as initializeTraefik,
} from "@dokploy/server/setup/traefik-setup";
import { initCronJobs } from "@dokploy/server/utils/backups/index";
import { initEnterpriseBackupCronJobs } from "@dokploy/server/utils/crons/enterprise";
import { logDockerMode } from "@dokploy/server/utils/docker/mode-detection";
import { sendDokployRestartNotifications } from "@dokploy/server/utils/notifications/dokploy-restart";
import { initSchedules } from "@dokploy/server/utils/schedules/index";
import { initCancelDeployments } from "@dokploy/server/utils/startup/cancell-deployments";
import { initVolumeBackupsCronJobs } from "@dokploy/server/utils/volume-backups/index";
import { config } from "dotenv";
import next from "next";
import { writeFileSync } from "node:fs";
import http from "node:http";
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

async function bootstrapInfrastructure() {
	console.log("🔃  [BOOTSTRAP]: Initializing infrastructure...");

	// Initialize Docker Swarm and network
	await initializeNetwork();
	console.log("✅ Docker network initialized");
	await initializeSwarm();
	console.log("✅ Docker Swarm initialized");
	// Initialize data services in parallel for faster startup
	console.log("🚀 Starting Redis and Postgres in parallel...");
	await Promise.all([initializePostgres(), initializeRedis()]);
	console.log("✅ Data services ready");

	// Run the migration immediately and bail out if it fails, to prevent starting the app in a broken state
	const { migration } = await import("@/server/db/migration");

	// Run migrations after Postgres is confirmed healthy
	await migration().catch((e) => {
		console.error("Database Migration Error:", e);
		console.warn("⚠️ Bailing out...");
		process.exit(1);
	});
	console.log("✅ Database migrations completed");

	// Initialize critical directories and Traefik config BEFORE Next.js starts
	// This prevents race conditions with the install script
	if (process.env.NODE_ENV === "production" && !IS_CLOUD) {
		setupDirectories();
		createDefaultTraefikConfig();
		createDefaultServerTraefikConfig();

		console.log("✅ Initialization complete");
	}
}

// Call bootstrap before Next.js setup
bootstrapInfrastructure()
	.then(() => {
		const app = next({ dev, turbopack: process.env.TURBOPACK === "1" });
		const handle = app.getRequestHandler();
		void app.prepare().then(async () => {
			try {
				console.log("Running Dokploy version: ", packageInfo.version);
				const server = http.createServer((req, res) => {
					handle(req, res);
				});

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
					await initializeTraefik();
					console.log("✅ Traefik initialized");
					// WEBSOCKET
					setupDrawerLogsWebSocketServer(server);
					setupDeploymentLogsWebSocketServer(server);
					setupDockerContainerLogsWebSocketServer(server);
					setupDockerContainerTerminalWebSocketServer(server);
					setupTerminalWebSocketServer(server);
					console.log("✅ WebSocket services initialized");
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
				server.listen(PORT, HOST);
				console.log(`Serving on: http://${HOST}:${PORT}`);
				await initEnterpriseBackupCronJobs();
				if (!IS_CLOUD) {
					console.log("Starting Deployment Worker");
					const { deploymentWorker } = await import(
						"./queues/deployments-queue"
					);
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
	})
	.catch((err) => {
		console.error("[Dokploy-Init] App crashed during bootstrap:", err);
		process.exit(1);
	});
