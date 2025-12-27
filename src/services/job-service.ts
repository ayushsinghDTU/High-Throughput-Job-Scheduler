import { Job, CreateJobRequest, UpdateJobRequest } from '../types';
import { JobModel, JobExecutionModel } from '../database/models';
import { validateCronExpression } from '../utils/cron-parser';
import { Scheduler } from './scheduler';
import { logger } from '../utils/logger';

export class JobService {
  constructor(private scheduler: Scheduler) {}

  /**
   * Create a new job
   */
  createJob(request: CreateJobRequest): Job {
    // Validate CRON expression
    if (!validateCronExpression(request.schedule)) {
      throw new Error('Invalid CRON expression');
    }

    // Validate API URL
    try {
      new URL(request.api);
    } catch {
      throw new Error('Invalid API URL');
    }

    const job = JobModel.create({
      spec: {
        schedule: request.schedule,
        api: request.api,
        type: request.type,
      },
      isActive: true,
    });

    // Schedule the job
    this.scheduler.scheduleJob(job);

    logger.info(`Created job ${job.id}`, { schedule: request.schedule, api: request.api });

    return job;
  }

  /**
   * Update an existing job
   */
  updateJob(jobId: string, request: UpdateJobRequest): Job | null {
    const existing = JobModel.getById(jobId);
    if (!existing) {
      return null;
    }

    // Validate CRON expression if provided
    if (request.schedule && !validateCronExpression(request.schedule)) {
      throw new Error('Invalid CRON expression');
    }

    // Validate API URL if provided
    if (request.api) {
      try {
        new URL(request.api);
      } catch {
        throw new Error('Invalid API URL');
      }
    }

    const updates: Partial<Job> = {};

    if (request.schedule !== undefined || request.api !== undefined || request.type !== undefined) {
      updates.spec = {
        ...existing.spec,
        ...(request.schedule !== undefined && { schedule: request.schedule }),
        ...(request.api !== undefined && { api: request.api }),
        ...(request.type !== undefined && { type: request.type }),
      };
    }

    if (request.isActive !== undefined) {
      updates.isActive = request.isActive;
    }

    const updated = JobModel.update(jobId, updates);

    if (updated) {
      // Reschedule the job
      if (updated.isActive) {
        this.scheduler.scheduleJob(updated);
      } else {
        this.scheduler.unscheduleJob(jobId);
      }

      logger.info(`Updated job ${jobId}`, updates);
    }

    return updated;
  }

  /**
   * Get job by ID
   */
  getJob(jobId: string): Job | null {
    return JobModel.getById(jobId);
  }

  /**
   * Get all active jobs
   */
  getAllJobs(): Job[] {
    return JobModel.getAllActive();
  }

  /**
   * Get last N executions for a job
   */
  getJobExecutions(jobId: string, limit: number = 5) {
    // Verify job exists
    const job = JobModel.getById(jobId);
    if (!job) {
      return null;
    }

    return JobExecutionModel.getLastExecutions(jobId, limit);
  }

  /**
   * Delete a job
   */
  deleteJob(jobId: string): boolean {
    // Unschedule first
    this.scheduler.unscheduleJob(jobId);
    
    const deleted = JobModel.delete(jobId);
    if (deleted) {
      logger.info(`Deleted job ${jobId}`);
    }
    return deleted;
  }

  /**
   * Trigger a job execution immediately
   * Waits for completion to return
   */
  async triggerJob(jobId: string): Promise<boolean> {
    const job = JobModel.getById(jobId);
    if (!job) {
      return false;
    }

    // Wait for completion when manually triggered
    await this.scheduler.executeJob(job, true);
    return true;
  }
}

