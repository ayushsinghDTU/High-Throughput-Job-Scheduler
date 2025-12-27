import { Job } from '../types';
import { logger } from '../utils/logger';

export class AlertService {
  private failureAlerts: Array<{
    jobId: string;
    executionId: string;
    timestamp: number;
    error: string;
  }> = [];

  /**
   * Send an alert when a job execution fails
   */
  async sendFailureAlert(job: Job, executionId: string, error: string): Promise<void> {
    const alert = {
      jobId: job.id,
      executionId,
      timestamp: Date.now(),
      error,
    };

    this.failureAlerts.push(alert);

    // Log the alert
    logger.error('Job execution failure alert', {
      jobId: job.id,
      executionId,
      api: job.spec.api,
      schedule: job.spec.schedule,
      error,
      timestamp: new Date(alert.timestamp).toISOString(),
    });

    // In a production system, you would integrate with:
    // - Email service (SendGrid, AWS SES)
    // - SMS service (Twilio)
    // - Slack/Teams webhooks
    // - PagerDuty
    // - etc.
  }

  /**
   * Get recent failure alerts
   */
  getRecentAlerts(limit: number = 50): typeof this.failureAlerts {
    return this.failureAlerts
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get alerts for a specific job
   */
  getJobAlerts(jobId: string): typeof this.failureAlerts {
    return this.failureAlerts
      .filter(alert => alert.jobId === jobId)
      .sort((a, b) => b.timestamp - a.timestamp);
  }
}

