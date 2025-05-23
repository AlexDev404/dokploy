import type { CreateServiceOptions } from "dockerode";
import { docker } from "../constants";
import { pullImage } from "../utils/docker/utils";
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
            Source: "dokploy-postgres-database",
            Target: "/var/lib/postgresql/data",
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
          TargetPort: 5432,
          PublishedPort: 5432,
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
    console.log("Postgres Started ✅");
    await new Promise((resolve) => setTimeout(resolve, 1000 * 60 * 8));
  } catch {
    try {
      await docker.createService(settings);
      console.log("Postgres Not Found: Starting ✅");
      await new Promise((resolve) => setTimeout(resolve, 1000 * 60 * 2.5));
    } catch (error: any) {
      if (error?.statusCode !== 409) {
        throw error;
      }
      console.log("Postgres service already exists, continuing...");
      await new Promise((resolve) => setTimeout(resolve, 1000 * 60 * 1.5));
    }
  }
};
