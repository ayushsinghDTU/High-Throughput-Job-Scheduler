import express, { Request, Response, Router } from 'express';
import { JobService } from '../services/job-service';
import { CreateJobRequest, UpdateJobRequest, JobType } from '../types';
import { AlertService } from '../services/alert-service';

export function createJobsRouter(jobService: JobService, alertService: AlertService): Router {
  const router = express.Router();

  /**
   * POST /jobs
   * Create a new job
   */
  router.post('/', (req: Request, res: Response) => {
    try {
      const request: CreateJobRequest = req.body;

      // Validate required fields
      if (!request.schedule || !request.api || !request.type) {
        return res.status(400).json({
          error: 'Missing required fields: schedule, api, type',
        });
      }

      // Validate job type
      if (!Object.values(JobType).includes(request.type)) {
        return res.status(400).json({
          error: `Invalid job type. Must be one of: ${Object.values(JobType).join(', ')}`,
        });
      }

      const job = jobService.createJob(request);

      res.status(201).json({
        jobId: job.id,
        message: 'Job created successfully',
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to create job',
      });
    }
  });

  /**
   * PUT /jobs/:id
   * Update an existing job
   */
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const jobId = req.params.id;
      const request: UpdateJobRequest = req.body;

      const updated = jobService.updateJob(jobId, request);

      if (!updated) {
        return res.status(404).json({
          error: 'Job not found',
        });
      }

      res.json({
        jobId: updated.id,
        message: 'Job updated successfully',
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to update job',
      });
    }
  });

  /**
   * GET /jobs/:id
   * Get job details
   */
  router.get('/:id', (req: Request, res: Response) => {
    const jobId = req.params.id;
    const job = jobService.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
      });
    }

    res.json(job);
  });

  /**
   * GET /jobs/:id/executions
   * Get last 5 executions for a job
   */
  router.get('/:id/executions', (req: Request, res: Response) => {
    const jobId = req.params.id;
    const limit = parseInt(req.query.limit as string) || 5;

    const executions = jobService.getJobExecutions(jobId, limit);

    if (executions === null) {
      return res.status(404).json({
        error: 'Job not found',
      });
    }

    res.json({
      jobId,
      executions: executions.map(exec => ({
        id: exec.id,
        status: exec.status,
        scheduledAt: exec.scheduledAt,
        startedAt: exec.startedAt,
        completedAt: exec.completedAt,
        duration: exec.duration,
        httpStatus: exec.httpStatus,
        error: exec.error,
        retryCount: exec.retryCount,
      })),
    });
  });

  /**
   * POST /jobs/:id/trigger
   * Trigger a job execution immediately
   */
  router.post('/:id/trigger', async (req: Request, res: Response) => {
    const jobId = req.params.id;
    const triggered = await jobService.triggerJob(jobId);

    if (!triggered) {
      return res.status(404).json({
        error: 'Job not found',
      });
    }

    res.json({
      message: 'Job triggered successfully',
      jobId,
    });
  });

  /**
   * DELETE /jobs/:id
   * Delete a job
   */
  router.delete('/:id', (req: Request, res: Response) => {
    const jobId = req.params.id;
    const deleted = jobService.deleteJob(jobId);

    if (!deleted) {
      return res.status(404).json({
        error: 'Job not found',
      });
    }

    res.json({
      message: 'Job deleted successfully',
      jobId,
    });
  });

  /**
   * GET /jobs/:id/alerts
   * Get failure alerts for a job
   */
  router.get('/:id/alerts', (req: Request, res: Response) => {
    const jobId = req.params.id;
    const alerts = alertService.getJobAlerts(jobId);

    res.json({
      jobId,
      alerts,
    });
  });

  return router;
}

