export enum JobType {
  ATLEAST_ONCE = 'ATLEAST_ONCE',
}

export interface JobSpec {
  schedule: string; // CRON format with seconds
  api: string; // HTTP endpoint
  type: JobType;
}

export interface Job {
  id: string;
  spec: JobSpec;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
}

export enum ExecutionStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export interface JobExecution {
  id: string;
  jobId: string;
  status: ExecutionStatus;
  scheduledAt: number;
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  httpStatus?: number;
  error?: string;
  retryCount: number;
}

export interface CreateJobRequest {
  schedule: string;
  api: string;
  type: JobType;
}

export interface UpdateJobRequest {
  schedule?: string;
  api?: string;
  type?: JobType;
  isActive?: boolean;
}

