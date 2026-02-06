import { docker } from "@dokploy/server/constants";
import type { Service } from "dockerode";

/**
 * Service health check configuration
 */
export interface HealthCheckConfig {
  serviceName: string;
  checkInterval?: number;
  timeout?: number;
  retries?: number;
  healthCheck?: () => Promise<boolean>;
}

/**
 * Service orchestration result
 */
export interface OrchestrationResult {
  success: boolean;
  serviceName: string;
  startTime: Date;
  endTime: Date;
  attempts: number;
  error?: string;
}

/**
 * Standard service orchestrator implementing common patterns:
 * - Health checking with retry logic
 * - Exponential backoff
 * - Timeout management
 * - Graceful degradation
 */
export class ServiceOrchestrator {
  private serviceName: string;
  private checkInterval: number;
  private timeout: number;
  private maxRetries: number;
  private customHealthCheck?: () => Promise<boolean>;

  constructor(config: HealthCheckConfig) {
    this.serviceName = config.serviceName;
    this.checkInterval = config.checkInterval ?? 2000; // 2 seconds
    this.timeout = config.timeout ?? 120000; // 2 minutes
    this.maxRetries = config.retries ?? 60;
    this.customHealthCheck = config.healthCheck;
  }

  /**
   * Check if service tasks are healthy
   */
  private async checkServiceHealth(service: Service): Promise<boolean> {
    try {
      const tasks = await docker.listTasks({ service: service.id });

      if (!tasks || tasks.length === 0) {
        return false;
      }

      // Check if any task is in running state
      const runningTasks = tasks.filter(
        (task: any) => task.Status?.State === "running",
      );

      if (runningTasks.length === 0) {
        return false;
      }

      // If custom health check provided, run it
      if (this.customHealthCheck) {
        return await this.customHealthCheck();
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoff(attempt: number): number {
    const baseDelay = this.checkInterval;
    const maxDelay = 10000; // Cap at 10 seconds
    const exponentialDelay = baseDelay * 1.5 ** attempt;
    return Math.min(exponentialDelay, maxDelay);
  }

  /**
   * Wait for service to become healthy with retry logic
   */
  async waitForHealthy(): Promise<OrchestrationResult> {
    const startTime = new Date();
    let attempts = 0;
    let lastError: string | undefined;

    console.log(
      `[Orchestrator] Waiting for ${this.serviceName} to become healthy...`,
    );

    while (attempts < this.maxRetries) {
      const elapsedTime = Date.now() - startTime.getTime();

      // Check timeout
      if (elapsedTime >= this.timeout) {
        return {
          success: false,
          serviceName: this.serviceName,
          startTime,
          endTime: new Date(),
          attempts,
          error: `Timeout after ${this.timeout}ms`,
        };
      }

      attempts++;

      try {
        const service = docker.getService(this.serviceName);
        const isHealthy = await this.checkServiceHealth(service);

        if (isHealthy) {
          console.log(
            `[Orchestrator] ${this.serviceName} is healthy after ${attempts} attempts (${elapsedTime}ms)`,
          );
          return {
            success: true,
            serviceName: this.serviceName,
            startTime,
            endTime: new Date(),
            attempts,
          };
        }

        lastError = `Service not yet healthy (attempt ${attempts}/${this.maxRetries})`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      // Log progress periodically
      if (attempts % 5 === 0) {
        console.log(
          `[Orchestrator] Still waiting for ${this.serviceName}... (attempt ${attempts}, ${elapsedTime}ms elapsed)`,
        );
      }

      // Apply exponential backoff
      const backoffDelay = this.calculateBackoff(attempts);
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }

    return {
      success: false,
      serviceName: this.serviceName,
      startTime,
      endTime: new Date(),
      attempts,
      error: lastError || "Max retries exceeded",
    };
  }

  /**
   * Wait for multiple services in parallel
   */
  static async waitForMultiple(
    configs: HealthCheckConfig[],
  ): Promise<OrchestrationResult[]> {
    const orchestrators = configs.map(
      (config) => new ServiceOrchestrator(config),
    );
    const results = await Promise.all(
      orchestrators.map((orch) => orch.waitForHealthy()),
    );

    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      console.error(
        `[Orchestrator] ${failures.length} service(s) failed to become healthy:`,
        failures.map((f) => f.serviceName).join(", "),
      );
    }

    return results;
  }

  /**
   * Wait for multiple services sequentially with dependencies
   */
  static async waitForSequential(
    configs: HealthCheckConfig[],
  ): Promise<OrchestrationResult[]> {
    const results: OrchestrationResult[] = [];

    for (const config of configs) {
      const orchestrator = new ServiceOrchestrator(config);
      const result = await orchestrator.waitForHealthy();
      results.push(result);

      if (!result.success) {
        console.error(
          `[Orchestrator] Failed to start ${config.serviceName}, aborting sequential startup`,
        );
        break;
      }
    }

    return results;
  }
}
