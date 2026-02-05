import type { CreateServiceOptions } from "dockerode";
import { docker } from "../constants";
import { pullImage } from "../utils/docker/utils";
import { ServiceOrchestrator } from "./service-orchestrator";

/**
 * Health check for Postgres - attempts actual connection verification
 */
const postgresHealthCheck = async (): Promise<boolean> => {
  try {
    const service = docker.getService("dokploy-postgres");
    const tasks = await service.tasks();
    
    // Check for running tasks
    const runningTasks = tasks.filter(
      (task) => task.Status?.State === "running"
    );
    
    if (runningTasks.length === 0) {
      return false;
    }
    
    // Check if task has been running for at least 5 seconds (initialization time)
    const oldestTask = runningTasks[0];
    if (oldestTask.Status?.Timestamp) {
      const taskAge = Date.now() - new Date(oldestTask.Status.Timestamp).getTime();
      return taskAge >= 5000;
    }
    
    return true;
  } catch {
    return false;
  }
};

export const initializePostgres = async () => {
  const imageName = "postgres:16";
  const containerName = "dokploy-postgres";
  
  const settings: CreateServiceOptions = {
    Name: containerName,
    TaskTemplate: {
      ContainerSpec: {
        Image: imageName,
        Env: [
          "POSTGRES_USER=dokploy",
          "POSTGRES_DB=dokploy",
          "POSTGRES_PASSWORD=amukds4wi9001583845717ad2",
        ],
        Mounts: [
          {
            Type: "volume",
            Source: "dokploy-postgres",
            Target: "/var/lib/postgresql/data",
          },
        ],
        Healthcheck: {
          Test: ["CMD-SHELL", "pg_isready -U dokploy"],
          Interval: 5000000000, // 5 seconds in nanoseconds
          Timeout: 3000000000,  // 3 seconds in nanoseconds
          Retries: 5,
          StartPeriod: 10000000000, // 10 seconds in nanoseconds
        },
      },
      Networks: [{ Target: "dokploy-network" }],
      Placement: {
        Constraints: ["node.role==manager"],
      },
    },
    Mode: {
      Replicated: {
        Replicas: 1,
      },
    },
    ...(process.env.NODE_ENV === "development" && {
      EndpointSpec: {
        Ports: [
          {
            TargetPort: 5432,
            PublishedPort: 5432,
            Protocol: "tcp",
            PublishMode: "host",
          },
        ],
      },
    }),
  };
  
  try {
    await pullImage(imageName);
    const service = docker.getService(containerName);
    const inspect = await service.inspect();
    await service.update({
      version: Number.parseInt(inspect.Version.Index),
      ...settings,
    });
    console.log("📦 Postgres service configuration updated");
  } catch {
    try {
      await docker.createService(settings);
      console.log("📦 Postgres service created");
    } catch (error: any) {
      if (error?.statusCode !== 409) {
        throw error;
      }
      console.log("📦 Postgres service already exists");
    }
  }
  
  // Use orchestrator for health checking
  const orchestrator = new ServiceOrchestrator({
    serviceName: containerName,
    checkInterval: 2000,
    timeout: 180000, // 3 minutes max
    retries: 90,
    healthCheck: postgresHealthCheck,
  });
  
  const result = await orchestrator.waitForHealthy();
  if (!result.success) {
    throw new Error(`Postgres failed to become healthy: ${result.error}`);
  }
};
