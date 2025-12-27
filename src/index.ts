import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeDatabase, closeDatabase } from './database/schema';
import { Scheduler } from './services/scheduler';
import { JobService } from './services/job-service';
import { AlertService } from './services/alert-service';
import { createJobsRouter } from './routes/jobs';
import { createObservabilityRouter } from './routes/observability';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;

// Initialize services
const scheduler = new Scheduler();
const alertService = new AlertService();
const jobService = new JobService(scheduler);

// Initialize Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path}`, {
      statusCode: res.statusCode,
      duration: `${duration}ms`,
    });
  });
  next();
});

// Routes
app.use('/jobs', createJobsRouter(jobService, alertService));
app.use('/observability', createObservabilityRouter(alertService));

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'High-Throughput Job Scheduler',
    version: '1.0.0',
    endpoints: {
      jobs: '/jobs',
      observability: '/observability',
      health: '/observability/health',
      metrics: '/observability/metrics',
    },
  });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
  });

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
  });
});

// Initialize database and start server
async function start() {
  try {
    // Initialize database
    initializeDatabase();
    logger.info('Database initialized');

    // Load and schedule all active jobs
    scheduler.loadActiveJobs();

    // Start server
    app.listen(PORT, () => {
      logger.info(`Job Scheduler server started on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Graceful shutdown
    const shutdown = () => {
      logger.info('Shutting down gracefully...');
      scheduler.shutdown();
      closeDatabase();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

start();

