import { docker } from "@dokploy/server/constants";
import { existsSync } from "node:fs";

/**
 * Docker runtime mode detection
 */
export enum DockerMode {
  SOCKET = "socket",
  DIND = "dind",
  UNKNOWN = "unknown",
}

/**
 * Detect how Docker is available to the application
 */
export const detectDockerMode = async (): Promise<DockerMode> => {
  try {
    // Check if socket exists and is accessible
    const socketPath = "/var/run/docker.sock";
    
    if (existsSync(socketPath)) {
      // Verify we can actually connect
      try {
        await docker.ping();
        
        // Check if we're running inside a container with access to host socket
        // by looking at cgroup or checking if dockerd is running locally
        try {
          const containers = await docker.listContainers({ limit: 1 });
          // If we can list containers via socket, we're in socket mode
          return DockerMode.SOCKET;
        } catch {
          // Socket exists but can't list - might be DinD
          return DockerMode.DIND;
        }
      } catch {
        // Socket exists but not accessible
        return DockerMode.UNKNOWN;
      }
    }
    
    // No socket found - likely DinD mode where dockerd runs in this container
    try {
      await docker.ping();
      return DockerMode.DIND;
    } catch {
      return DockerMode.UNKNOWN;
    }
  } catch (error) {
    console.error("Error detecting Docker mode:", error);
    return DockerMode.UNKNOWN;
  }
};

/**
 * Get optimized configuration based on Docker mode
 */
export const getDockerModeConfig = async () => {
  const mode = await detectDockerMode();
  
  return {
    mode,
    isSocket: mode === DockerMode.SOCKET,
    isDinD: mode === DockerMode.DIND,
    // DinD may need slightly longer waits for dockerd initialization
    serviceStartupBuffer: mode === DockerMode.DIND ? 1000 : 500,
    // Socket mode can be more aggressive with parallelization
    maxParallelServices: mode === DockerMode.SOCKET ? 5 : 3,
  };
};

/**
 * Log Docker mode for debugging
 */
export const logDockerMode = async (): Promise<void> => {
  const config = await getDockerModeConfig();
  console.log(`[Docker Mode] Running in ${config.mode.toUpperCase()} mode`);
  
  if (config.isSocket) {
    console.log("[Docker Mode] Using host Docker socket for optimal performance");
  } else if (config.isDinD) {
    console.log("[Docker Mode] Using Docker-in-Docker (privileged mode)");
  } else {
    console.warn("[Docker Mode] Could not determine Docker mode - proceeding with defaults");
  }
};
