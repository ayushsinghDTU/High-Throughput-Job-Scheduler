import cron from 'node-cron';
import { Job, ExecutionStatus } from '../types';
import { JobModel, JobExecutionModel } from '../database/models';
import { HttpExecutor } from './http-executor';
import { logger } from '../utils/logger';
import { AlertService } from './alert-service';

export class Scheduler {
  private tasks: Map<string, cron.ScheduledTask> = new Map();
  private httpExecutor: HttpExecutor;
  private alertService: AlertService;

  constructor() {
    this.httpExecutor = new HttpExecutor();
    this.alertService = new AlertService();
  }

  /**
   * Start scheduling a job
   */
  scheduleJob(job: Job): void {
    // Remove existing schedule if any
    this.unscheduleJob(job.id);

    if (!job.isActive) {
      return;
    }

    try {
      // Convert our CRON format (with seconds) to node-cron format
      const cronExpression = this.convertToNodeCronFormat(job.spec.schedule);

      const task = cron.schedule(
        cronExpression,
        async () => {
          await this.executeJob(job);
        },
        {
          scheduled: true,
          timezone: 'UTC',
        }
      );

      this.tasks.set(job.id, task);
      logger.info(`Scheduled job ${job.id} with schedule ${job.spec.schedule}`);
    } catch (error) {
      logger.error(`Failed to schedule job ${job.id}`, { error });
    }
  }

  /**
   * Stop scheduling a job
   */
  unscheduleJob(jobId: string): void {
    const task = this.tasks.get(jobId);
    if (task) {
      task.stop();
      this.tasks.delete(jobId);
      logger.info(`Unscheduled job ${jobId}`);
    }
  }

  /**
   * Execute a job immediately
   * For scheduled jobs, this is called by node-cron and can be fire-and-forget
   * For manual triggers, the caller can await this to know when execution completes
   */
  async executeJob(job: Job, waitForCompletion: boolean = false): Promise<void> {
    if (waitForCompletion) {
      // For manual triggers, wait for completion
      return this.executeJobInternal(job);
    } else {
      // Fire and forget for scheduled executions - high throughput
      this.executeJobInternal(job).catch(error => {
        logger.error(`Unhandled error in job execution for ${job.id}`, { error });
      });
    }
  }

  /**
   * Internal execution method
   * Separated for better error handling
   */
  private async executeJobInternal(job: Job): Promise<void> {
    const scheduledAt = Date.now();
    
    // Fetch latest job state in case it was updated
    const currentJob = JobModel.getById(job.id);
    if (!currentJob || !currentJob.isActive) {
      logger.warn(`Skipping execution for inactive/deleted job ${job.id}`);
      return;
    }

    const execution = JobExecutionModel.create({
      jobId: currentJob.id,
      status: ExecutionStatus.PENDING,
      scheduledAt,
      retryCount: 0,
    });

    try {
      // Update to running
      JobExecutionModel.update(execution.id, {
        status: ExecutionStatus.RUNNING,
        startedAt: Date.now(),
      });

      logger.debug(`Executing job ${currentJob.id}`, { executionId: execution.id });

      const result = await this.httpExecutor.execute(
        currentJob.spec.api,
        currentJob.spec.type
      );

      const completedAt = Date.now();
      const duration = completedAt - (execution.startedAt || scheduledAt);

      if (result.success) {
        JobExecutionModel.update(execution.id, {
          status: ExecutionStatus.SUCCESS,
          completedAt,
          duration,
          httpStatus: result.httpStatus,
        });

        logger.debug(`Job ${currentJob.id} executed successfully`, {
          executionId: execution.id,
          duration,
          httpStatus: result.httpStatus,
        });
      } else {
        JobExecutionModel.update(execution.id, {
          status: ExecutionStatus.FAILED,
          completedAt,
          duration,
          httpStatus: result.httpStatus,
          error: result.error,
        });

        logger.warn(`Job ${currentJob.id} execution failed`, {
          executionId: execution.id,
          error: result.error,
          httpStatus: result.httpStatus,
        });

        // Alert on failure
        await this.alertService.sendFailureAlert(currentJob, execution.id, result.error || 'Unknown error');
      }
    } catch (error) {
      const completedAt = Date.now();
      const duration = completedAt - (execution.startedAt || scheduledAt);
      const errorMessage = error instanceof Error ? error.message : String(error);

      JobExecutionModel.update(execution.id, {
        status: ExecutionStatus.FAILED,
        completedAt,
        duration,
        error: errorMessage,
      });

      logger.error(`Job ${currentJob.id} execution error`, {
        executionId: execution.id,
        error: errorMessage,
      });

      await this.alertService.sendFailureAlert(currentJob, execution.id, errorMessage);
    }
  }

  /**
   * Convert our CRON format (with seconds) to node-cron format
   * Our format: "second minute hour day month dayOfWeek"
   * node-cron format: "second minute hour day month dayOfWeek"
   * They're the same, but we need to validate and handle edge cases
   */
  private convertToNodeCronFormat(schedule: string): string {
    // node-cron supports seconds, so we can use it directly
    // But we need to ensure it's valid
    const parts = schedule.trim().split(/\s+/);
    if (parts.length !== 6) {
      throw new Error('Invalid CRON format. Expected: second minute hour day month dayOfWeek');
    }
    return schedule;
  }

  /**
   * Load and schedule all active jobs
   */
  loadActiveJobs(): void {
    const jobs = JobModel.getAllActive();
    logger.info(`Loading ${jobs.length} active jobs`);
    
    jobs.forEach(job => {
      try {
        this.scheduleJob(job);
      } catch (error) {
        logger.error(`Failed to load job ${job.id}`, { error });
      }
    });
  }

  /**
   * Shutdown scheduler
   */
  shutdown(): void {
    logger.info('Shutting down scheduler...');
    this.tasks.forEach((task, jobId) => {
      task.stop();
      logger.info(`Stopped job ${jobId}`);
    });
    this.tasks.clear();
  }
}

