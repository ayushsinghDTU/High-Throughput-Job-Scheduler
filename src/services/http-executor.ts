import axios, { AxiosError } from 'axios';
import { logger } from '../utils/logger';
import { ExecutionStatus, JobType } from '../types';

export interface ExecutionResult {
  success: boolean;
  httpStatus?: number;
  duration: number;
  error?: string;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export class HttpExecutor {
  async execute(
    url: string,
    jobType: JobType,
    timeout: number = 30000
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    let lastError: Error | null = null;
    let lastHttpStatus: number | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post(url, {}, {
          timeout,
          validateStatus: () => true, // Don't throw on any status code
        });

        const duration = Date.now() - startTime;
        const success = response.status >= 200 && response.status < 300;

        if (success) {
          return {
            success: true,
            httpStatus: response.status,
            duration,
          };
        }

        // For ATLEAST_ONCE, retry on 5xx (server errors) but not 4xx (client errors)
        const isRetryable = jobType === JobType.ATLEAST_ONCE && 
                           response.status >= 500 && 
                           response.status < 600;

        if (!isRetryable) {
          // Not retryable, return failure immediately
          return {
            success: false,
            httpStatus: response.status,
            duration,
            error: `HTTP ${response.status}: ${response.statusText}`,
          };
        }

        // Retryable error, store for retry
        lastHttpStatus = response.status;
        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);

        if (attempt < MAX_RETRIES - 1) {
          logger.warn(`Execution attempt ${attempt + 1} failed for ${url} with status ${response.status}, retrying...`);
          await this.delay(RETRY_DELAY_MS * (attempt + 1));
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        lastError = error instanceof Error ? error : new Error(String(error));

        if (axios.isAxiosError(error)) {
          lastHttpStatus = error.response?.status;
          
          // For ATLEAST_ONCE, retry on network errors (no response) or 5xx errors
          const isNetworkError = !error.response;
          const isServerError = error.response?.status && error.response.status >= 500 && error.response.status < 600;
          const isRetryable = jobType === JobType.ATLEAST_ONCE && (isNetworkError || isServerError);

          if (isRetryable && attempt < MAX_RETRIES - 1) {
            logger.warn(`Execution attempt ${attempt + 1} failed for ${url}, retrying...`, {
              error: error.message,
              status: error.response?.status,
            });
            await this.delay(RETRY_DELAY_MS * (attempt + 1));
            continue;
          }
        }

        // If not retrying, return failure
        return {
          success: false,
          httpStatus: lastHttpStatus,
          duration,
          error: lastError.message,
        };
      }
    }

    const duration = Date.now() - startTime;
    return {
      success: false,
      httpStatus: lastHttpStatus,
      duration,
      error: lastError?.message || 'Unknown error after retries',
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}


