import { db } from './schema';
import { Job, JobExecution, ExecutionStatus, JobType } from '../types';
import { v4 as uuidv4 } from 'uuid';

export class JobModel {
  static create(job: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>): Job {
    const id = uuidv4();
    const now = Date.now();

    db.prepare(`
      INSERT INTO jobs (id, schedule, api, type, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      job.spec.schedule,
      job.spec.api,
      job.spec.type,
      job.isActive ? 1 : 0,
      now,
      now
    );

    return {
      id,
      spec: job.spec,
      createdAt: now,
      updatedAt: now,
      isActive: job.isActive,
    };
  }

  static getById(id: string): Job | null {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      spec: {
        schedule: row.schedule,
        api: row.api,
        type: row.type as JobType,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isActive: row.is_active === 1,
    };
  }

  static getAllActive(): Job[] {
    const rows = db.prepare('SELECT * FROM jobs WHERE is_active = 1').all() as any[];
    
    return rows.map(row => ({
      id: row.id,
      spec: {
        schedule: row.schedule,
        api: row.api,
        type: row.type as JobType,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isActive: row.is_active === 1,
    }));
  }

  static update(id: string, updates: Partial<Job>): Job | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const updatedAt = Date.now();
    const updateFields: string[] = [];
    const updateValues: any[] = [];

    if (updates.spec?.schedule !== undefined) {
      updateFields.push('schedule = ?');
      updateValues.push(updates.spec.schedule);
    }
    if (updates.spec?.api !== undefined) {
      updateFields.push('api = ?');
      updateValues.push(updates.spec.api);
    }
    if (updates.spec?.type !== undefined) {
      updateFields.push('type = ?');
      updateValues.push(updates.spec.type);
    }
    if (updates.isActive !== undefined) {
      updateFields.push('is_active = ?');
      updateValues.push(updates.isActive ? 1 : 0);
    }
    updateFields.push('updated_at = ?');
    updateValues.push(updatedAt);
    updateValues.push(id);

    if (updateFields.length > 1) {
      db.prepare(`UPDATE jobs SET ${updateFields.join(', ')} WHERE id = ?`).run(...updateValues);
    }

    const updated = this.getById(id)!;
    return updated;
  }

  static delete(id: string): boolean {
    const result = db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
    return result.changes > 0;
  }
}

export class JobExecutionModel {
  static create(execution: Omit<JobExecution, 'id'>): JobExecution {
    const id = uuidv4();
    const now = Date.now();

    db.prepare(`
      INSERT INTO job_executions 
      (id, job_id, status, scheduled_at, started_at, completed_at, duration, http_status, error, retry_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      execution.jobId,
      execution.status,
      execution.scheduledAt,
      execution.startedAt || null,
      execution.completedAt || null,
      execution.duration || null,
      execution.httpStatus || null,
      execution.error || null,
      execution.retryCount
    );

    return {
      id,
      ...execution,
    };
  }

  static update(id: string, updates: Partial<JobExecution>): JobExecution | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const updateFields: string[] = [];
    const updateValues: any[] = [];

    if (updates.status !== undefined) {
      updateFields.push('status = ?');
      updateValues.push(updates.status);
    }
    if (updates.startedAt !== undefined) {
      updateFields.push('started_at = ?');
      updateValues.push(updates.startedAt);
    }
    if (updates.completedAt !== undefined) {
      updateFields.push('completed_at = ?');
      updateValues.push(updates.completedAt);
    }
    if (updates.duration !== undefined) {
      updateFields.push('duration = ?');
      updateValues.push(updates.duration);
    }
    if (updates.httpStatus !== undefined) {
      updateFields.push('http_status = ?');
      updateValues.push(updates.httpStatus);
    }
    if (updates.error !== undefined) {
      updateFields.push('error = ?');
      updateValues.push(updates.error);
    }
    if (updates.retryCount !== undefined) {
      updateFields.push('retry_count = ?');
      updateValues.push(updates.retryCount);
    }

    updateValues.push(id);

    if (updateFields.length > 0) {
      db.prepare(`UPDATE job_executions SET ${updateFields.join(', ')} WHERE id = ?`).run(...updateValues);
    }

    return this.getById(id);
  }

  static getById(id: string): JobExecution | null {
    const row = db.prepare('SELECT * FROM job_executions WHERE id = ?').get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      jobId: row.job_id,
      status: row.status as ExecutionStatus,
      scheduledAt: row.scheduled_at,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
      duration: row.duration || undefined,
      httpStatus: row.http_status || undefined,
      error: row.error || undefined,
      retryCount: row.retry_count,
    };
  }

  static getLastExecutions(jobId: string, limit: number = 5): JobExecution[] {
    const rows = db.prepare(`
      SELECT * FROM job_executions 
      WHERE job_id = ? 
      ORDER BY scheduled_at DESC 
      LIMIT ?
    `).all(jobId, limit) as any[];

    return rows.map(row => ({
      id: row.id,
      jobId: row.job_id,
      status: row.status as ExecutionStatus,
      scheduledAt: row.scheduled_at,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
      duration: row.duration || undefined,
      httpStatus: row.http_status || undefined,
      error: row.error || undefined,
      retryCount: row.retry_count,
    }));
  }

  static getFailedExecutions(jobId?: string): JobExecution[] {
    const query = jobId
      ? 'SELECT * FROM job_executions WHERE status = ? AND job_id = ? ORDER BY scheduled_at DESC'
      : 'SELECT * FROM job_executions WHERE status = ? ORDER BY scheduled_at DESC';
    
    const params = jobId ? ['FAILED', jobId] : ['FAILED'];
    const rows = db.prepare(query).all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      jobId: row.job_id,
      status: row.status as ExecutionStatus,
      scheduledAt: row.scheduled_at,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
      duration: row.duration || undefined,
      httpStatus: row.http_status || undefined,
      error: row.error || undefined,
      retryCount: row.retry_count,
    }));
  }
}

