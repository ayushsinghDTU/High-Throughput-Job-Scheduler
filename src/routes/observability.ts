import express, { Request, Response, Router } from 'express';
import { JobModel, JobExecutionModel } from '../database/models';
import { AlertService } from '../services/alert-service';
import { db } from '../database/schema';
import { ExecutionStatus } from '../types';

export function createObservabilityRouter(alertService: AlertService): Router {
  const router = express.Router();

  /**
   * GET /metrics
   * Get system metrics
   */
  router.get('/metrics', (req: Request, res: Response) => {
    try {
      // Total jobs
      const totalJobs = db.prepare('SELECT COUNT(*) as count FROM jobs').get() as { count: number };
      
      // Active jobs
      const activeJobs = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE is_active = 1').get() as { count: number };

      // Total executions
      const totalExecutions = db.prepare('SELECT COUNT(*) as count FROM job_executions').get() as { count: number };

      // Success rate
      const successfulExecutions = db.prepare(`
        SELECT COUNT(*) as count FROM job_executions WHERE status = ?
      `).get(ExecutionStatus.SUCCESS) as { count: number };

      // Failed executions
      const failedExecutions = db.prepare(`
        SELECT COUNT(*) as count FROM job_executions WHERE status = ?
      `).get(ExecutionStatus.FAILED) as { count: number };

      // Average execution duration
      const avgDuration = db.prepare(`
        SELECT AVG(duration) as avg FROM job_executions 
        WHERE duration IS NOT NULL AND status IN (?, ?)
      `).get(ExecutionStatus.SUCCESS, ExecutionStatus.FAILED) as { avg: number | null };

      // Recent executions (last hour)
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      const recentExecutions = db.prepare(`
        SELECT COUNT(*) as count FROM job_executions WHERE scheduled_at > ?
      `).get(oneHourAgo) as { count: number };

      const successRate = totalExecutions.count > 0
        ? (successfulExecutions.count / totalExecutions.count) * 100
        : 0;

      res.json({
        jobs: {
          total: totalJobs.count,
          active: activeJobs.count,
        },
        executions: {
          total: totalExecutions.count,
          successful: successfulExecutions.count,
          failed: failedExecutions.count,
          successRate: successRate.toFixed(2) + '%',
          recentHour: recentExecutions.count,
          averageDurationMs: avgDuration.avg ? Math.round(avgDuration.avg) : null,
        },
        alerts: {
          recentFailures: alertService.getRecentAlerts(10).length,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to fetch metrics',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /health
   * Health check endpoint
   */
  router.get('/health', (req: Request, res: Response) => {
    try {
      // Check database connection
      db.prepare('SELECT 1').get();

      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * GET /alerts
   * Get recent failure alerts
   */
  router.get('/alerts', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const alerts = alertService.getRecentAlerts(limit);

    res.json({
      alerts,
      count: alerts.length,
    });
  });

  /**
   * GET /executions/recent
   * Get recent executions across all jobs
   */
  router.get('/executions/recent', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 20;

    const rows = db.prepare(`
      SELECT * FROM job_executions 
      ORDER BY scheduled_at DESC 
      LIMIT ?
    `).all(limit) as any[];

    const executions = rows.map(row => ({
      id: row.id,
      jobId: row.job_id,
      status: row.status,
      scheduledAt: row.scheduled_at,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
      duration: row.duration || undefined,
      httpStatus: row.http_status || undefined,
      error: row.error || undefined,
      retryCount: row.retry_count,
    }));

    res.json({
      executions,
      count: executions.length,
    });
  });

  /**
   * GET /executions/failed
   * Get failed executions
   */
  router.get('/executions/failed', (req: Request, res: Response) => {
    const jobId = req.query.jobId as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;

    const failedExecutions = JobExecutionModel.getFailedExecutions(jobId);

    res.json({
      executions: failedExecutions.slice(0, limit),
      count: failedExecutions.length,
    });
  });

  return router;
}

