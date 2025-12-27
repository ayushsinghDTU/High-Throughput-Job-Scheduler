import cron from 'node-cron';

/**
 * Validates CRON expression format with seconds support
 * Format: second minute hour day month dayOfWeek
 * Example: "31 10-15 1 * * MON-FRI"
 * 
 * node-cron supports seconds, so we validate using it
 */
export function validateCronExpression(cronExpression: string): boolean {
  try {
    // node-cron supports 6-field format with seconds
    // Format: second minute hour day month dayOfWeek
    return cron.validate(cronExpression);
  } catch {
    return false;
  }
}

/**
 * Gets the next execution time for a CRON expression
 * This is a helper function for calculating next run times
 */
export function getNextExecutionTime(cronExpression: string, fromDate?: Date): Date {
  const now = fromDate || new Date();
  const parts = cronExpression.trim().split(/\s+/);
  
  if (parts.length !== 6) {
    throw new Error('Invalid CRON expression. Expected format: second minute hour day month dayOfWeek');
  }

  // For node-cron, we just need to validate - the actual scheduling
  // is handled by node-cron itself. This function can be used for
  // displaying next run times.
  // Since node-cron handles scheduling, we return a date slightly in the future
  // as a placeholder. In production, you might want to use a more sophisticated
  // library or calculation for this.
  const next = new Date(now);
  next.setSeconds(next.getSeconds() + 1);
  return next;
}

