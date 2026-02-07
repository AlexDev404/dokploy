import { docker } from "@dokploy/server/constants";
import type { CreateServiceOptions } from "dockerode";
import { pullImage } from "../utils/docker/utils";
import { ServiceOrchestrator } from "./service-orchestrator";

/**
 * Health check for Redis - verifies running state
 */
const redisHealthCheck = async (): Promise<boolean> => {
  try {
    const service = docker.getService("dokploy-redis");
    const tasks = await docker.listTasks({ service: service.id });

    // Check for running tasks
    const runningTasks = tasks.filter(
      (task: any) => task.Status?.State === "running",
    );

    if (runningTasks.length === 0) {
      return false;
    }

    // Redis starts quickly, check if task has been running for at least 3 seconds
    const oldestTask = runningTasks[0];
    if (oldestTask.Status?.Timestamp) {
      const taskAge =
        Date.now() - new Date(oldestTask.Status.Timestamp).getTime();
      return taskAge >= 3000;
    }

    return true;
  } catch {
    return false;
  }
};

export const initializeRedis = async () => {
  const imageName = "redis:7";
  const containerName = "dokploy-redis";

  const settings: CreateServiceOptions = {
    Name: containerName,
    TaskTemplate: {
      ContainerSpec: {
        Image: imageName,
        Mounts: [
          {
            Type: "volume",
            Source: "dokploy-redis",
            Target: "/data",
          },
        ],
        HealthCheck: {
          Test: ["CMD", "redis-cli", "ping"],
          Interval: 5000000000, // 5 seconds in nanoseconds
          Timeout: 3000000000, // 3 seconds in nanoseconds
          Retries: 5,
          StartPeriod: 8000000000, // 8 seconds in nanoseconds
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
    EndpointSpec: {
      Ports: [
        {
          TargetPort: 6379,
          PublishedPort: 6379,
          Protocol: "tcp",
          PublishMode: "host",
        },
      ],
    },
  };

  try {
    await pullImage(imageName);
    const service = docker.getService(containerName);
    const inspect = await service.inspect();
    await service.update({
      version: Number.parseInt(inspect.Version.Index),
      ...settings,
    });
    console.log("📦 Redis service configuration updated");
  } catch {
    try {
      await docker.createService(settings);
      console.log("📦 Redis service created");
    } catch (error: any) {
      if (error?.statusCode !== 409) {
        throw error;
      }
      console.log("📦 Redis service already exists");
    }
  }

  // Use orchestrator for health checking
  const orchestrator = new ServiceOrchestrator({
    serviceName: containerName,
    checkInterval: 2000,
    timeout: 120000, // 2 minutes max
    retries: 60,
    healthCheck: redisHealthCheck,
  });

  const result = await orchestrator.waitForHealthy();
  if (!result.success) {
    throw new Error(`Redis failed to become healthy: ${result.error}`);
  }
};
