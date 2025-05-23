import type { CreateServiceOptions } from "dockerode";
import { docker } from "../constants";
import { pullImage } from "../utils/docker/utils";

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
            Source: "redis-data-volume",
            Target: "/data",
          },
        ],
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
    console.log("Redis Started ✅");
    await new Promise((resolve) => setTimeout(resolve, 1000 * 60 * 2.5));
  } catch {
    try {
      await docker.createService(settings);
      console.log("Redis Not Found: Starting ✅");
      await new Promise((resolve) => setTimeout(resolve, 1000 * 60 * 2.5));
    } catch (error: any) {
      if (error?.statusCode !== 409) {
        throw error;
      }
      console.log("Redis service already exists, continuing...");
      await new Promise((resolve) => setTimeout(resolve, 1000 * 60 * 1.5));
    }
  }
};
