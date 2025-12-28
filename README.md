# High-Throughput Job Scheduler

# Quick Start
npm install
npm run build
npm start

A scalable, high-performance job scheduler system designed to execute thousands of scheduled HTTP POST requests per second with high accuracy and reliability.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [System Design](#system-design)
- [Features](#features)
- [API Documentation](#api-documentation)
- [Installation](#installation)
- [Usage](#usage)
- [Data Flow](#data-flow)
- [Trade-offs & Design Decisions](#trade-offs--design-decisions)
- [Docker Deployment](#docker-deployment)
- [High Availability](#high-availability)

## Overview

This job scheduler system provides:

- **High Throughput**: Designed to handle thousands of job executions per second
- **Accurate Scheduling**: Minimal drift from configured schedules, even under load
- **Reliability**: At-least-once execution semantics with retry mechanisms
- **Observability**: Comprehensive logging, metrics, and alerting
- **Durability**: Persistent storage of all jobs and execution history
- **Scalability**: Modular architecture that can scale horizontally

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client Layer                          │
│                    (REST API Clients)                        │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      API Layer (Express)                     │
│  ┌──────────────┐  ┌─────────────────────────────────────┐  │
│  │  Jobs Router │  │  Observability Router               │  │
│  │              │  │  - /health                          │  │
│  │  - POST /    │  │  - /metrics                         │  │
│  │  - PUT /:id  │  │  - /alerts                          │  │
│  │  - GET /:id  │  │  - /executions/recent               │  │
│  │  - DELETE/:id│  │  - /executions/failed               │  │
│  └──────┬───────┘  └─────────────────────────────────────┘  │
└─────────┼────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Service Layer                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ JobService   │  │  Scheduler   │  │ AlertService │      │
│  │              │  │              │  │              │      │
│  │ - Create     │  │ - Schedule   │  │ - Send       │      │
│  │ - Update     │  │ - Execute    │  │   Alerts     │      │
│  │ - Get        │  │ - Load Jobs  │  │ - Get Alerts │      │
│  │ - Delete     │  │              │  │              │      │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘      │
│         │                  │                                  │
│         │                  ▼                                  │
│         │         ┌──────────────┐                           │
│         │         │ HttpExecutor │                           │
│         │         │              │                           │
│         │         │ - POST       │                           │
│         │         │ - Retry      │                           │
│         │         │ - Timeout    │                           │
│         │         └──────────────┘                           │
└─────────┼──────────┼──────────────────────────────────────────┘
          │          │
          ▼          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Data Layer (SQLite)                        │
│  ┌──────────────┐  ┌──────────────────────────────┐        │
│  │    Jobs      │  │    Job Executions            │        │
│  │              │  │                              │        │
│  │ - id         │  │ - id                         │        │
│  │ - schedule   │  │ - job_id                     │        │
│  │ - api        │  │ - status                     │        │
│  │ - type       │  │ - scheduled_at               │        │
│  │ - is_active  │  │ - started_at                 │        │
│  │ - timestamps │  │ - completed_at               │        │
│  │              │  │ - duration                   │        │
│  │              │  │ - http_status                │        │
│  │              │  │ - error                      │        │
│  │              │  │ - retry_count                │        │
│  └──────────────┘  └──────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

1. **API Layer**: REST endpoints for job management and observability
2. **Service Layer**: Business logic for job management, scheduling, and execution
3. **Data Layer**: Persistent storage using SQLite with WAL mode for concurrency
4. **Scheduler**: Uses `node-cron` for precise scheduling with second-level precision
5. **HttpExecutor**: Handles HTTP POST requests with retry logic for at-least-once semantics

## System Design

### Job Specification Format

```json
{
  "schedule": "31 10-15 1 * * MON-FRI",
  "api": "https://localhost:4444/foo",
  "type": "ATLEAST_ONCE"
}
```

**CRON Format (with seconds)**:
- Format: `second minute hour day month dayOfWeek`
- Example: `"31 10-15 1 * * MON-FRI"` means:
  - Every 31st second
  - Of minutes 10-15
  - At hour 1 (01:xx AM)
  - Every day of the month
  - Every month
  - On Monday through Friday

### Execution Semantics

- **ATLEAST_ONCE**: The job will be executed at least once per schedule, with automatic retries on failure (up to 3 retries with exponential backoff)

### High-Throughput Design

1. **Non-blocking Execution**: Each job execution is async and independent
2. **Concurrent Processing**: Multiple jobs can execute simultaneously
3. **Database Optimization**: 
   - WAL (Write-Ahead Logging) mode for better concurrency
   - Indexed queries for fast lookups
   - Prepared statements for performance
4. **Minimal Scheduling Drift**: `node-cron` provides precise scheduling, and async execution prevents blocking

## Features

### Functional Requirements

✅ **Create Job**: Accepts a Job Specification and returns a unique jobId  
✅ **Modify Job**: Update job schedule, API endpoint, type, or active status  
✅ **View Job Executions**: Fetch last N executions with detailed information  
✅ **Job Failure Alerts**: Automatic alerts on job execution failures  
✅ **High Throughput**: Supports thousands of executions per second  
✅ **Schedule Accuracy**: Minimal drift from configured schedules  
✅ **Execution Tracking**: Complete history of all job executions  
✅ **At-Least-Once Semantics**: Automatic retries ensure job execution

### Observability Features

- **Health Check**: `/observability/health` - System health status
- **Metrics**: `/observability/metrics` - Job success rates, execution counts, average durations
- **Alerts**: `/observability/alerts` - Recent failure alerts
- **Execution History**: View recent or failed executions
- **Structured Logging**: Winston-based logging with JSON format

## API Documentation

### Create Job

**POST** `/jobs`

Request Body:
```json
{
  "schedule": "31 10-15 1 * * MON-FRI",
  "api": "https://localhost:4444/foo",
  "type": "ATLEAST_ONCE"
}
```

Response:
```json
{
  "jobId": "uuid-here",
  "message": "Job created successfully"
}
```

### Update Job

**PUT** `/jobs/:id`

Request Body (all fields optional):
```json
{
  "schedule": "0 0 * * *",
  "api": "https://new-endpoint.com/api",
  "type": "ATLEAST_ONCE",
  "isActive": true
}
```

### Get Job Details

**GET** `/jobs/:id`

Response:
```json
{
  "id": "uuid-here",
  "spec": {
    "schedule": "31 10-15 1 * * MON-FRI",
    "api": "https://localhost:4444/foo",
    "type": "ATLEAST_ONCE"
  },
  "createdAt": 1234567890,
  "updatedAt": 1234567890,
  "isActive": true
}
```

### Get Job Executions

**GET** `/jobs/:id/executions?limit=5`

Response:
```json
{
  "jobId": "uuid-here",
  "executions": [
    {
      "id": "execution-uuid",
      "status": "SUCCESS",
      "scheduledAt": 1234567890,
      "startedAt": 1234567891,
      "completedAt": 1234567941,
      "duration": 50,
      "httpStatus": 200,
      "retryCount": 0
    }
  ]
}
```

### Trigger Job Immediately

**POST** `/jobs/:id/trigger`

### Delete Job

**DELETE** `/jobs/:id`

### Get Metrics

**GET** `/observability/metrics`

Response:
```json
{
  "jobs": {
    "total": 100,
    "active": 95
  },
  "executions": {
    "total": 10000,
    "successful": 9850,
    "failed": 150,
    "successRate": "98.50%",
    "recentHour": 500,
    "averageDurationMs": 245
  },
  "alerts": {
    "recentFailures": 10
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Health Check

**GET** `/observability/health`

### Get Recent Alerts

**GET** `/observability/alerts?limit=50`

### Get Recent Executions

**GET** `/observability/executions/recent?limit=20`

### Get Failed Executions

**GET** `/observability/executions/failed?jobId=uuid&limit=50`

## Installation

### Prerequisites

- Node.js 18+ 
- npm or yarn
- (Optional) Docker for containerized deployment

### Local Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd lenskart_task
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

4. Start the server:
```bash
npm start
```

For development with hot-reload:
```bash
npm run dev
```

The server will start on `http://localhost:3000` by default.

### Environment Variables

Create a `.env` file:

```env
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
DB_PATH=./data/jobs.db
DB_VERBOSE=false
```

## Usage

### Example: Create a Job

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "schedule": "0 * * * * *",
    "api": "https://httpbin.org/post",
    "type": "ATLEAST_ONCE"
  }'
```

### Example: Get Job Executions

```bash
curl http://localhost:3000/jobs/{jobId}/executions?limit=5
```

### Example: Check Metrics

```bash
curl http://localhost:3000/observability/metrics
```

## Data Flow

### Job Creation Flow

1. Client sends POST request to `/jobs` with job specification
2. API validates the request (CRON expression, URL format)
3. JobService creates job record in database
4. Scheduler registers the job with `node-cron`
5. Response returns jobId to client

### Job Execution Flow

1. `node-cron` triggers scheduled job at specified time
2. Scheduler creates execution record with PENDING status
3. Execution status updated to RUNNING
4. HttpExecutor makes HTTP POST request to target API
5. On success: Status updated to SUCCESS, duration and HTTP status recorded
6. On failure: Status updated to FAILED, retry logic invoked (for ATLEAST_ONCE)
7. AlertService sends failure alert if execution fails
8. Execution record persisted with all details

### At-Least-Once Semantics

1. Job execution attempted at scheduled time
2. If HTTP request fails (network error or 5xx status):
   - Wait with exponential backoff (1s, 2s, 3s)
   - Retry up to 3 times
   - Each retry attempt is logged
3. Only after all retries fail, job is marked as FAILED
4. Execution record includes retry count

## Trade-offs & Design Decisions

### 1. SQLite vs PostgreSQL/MySQL

**Decision**: SQLite with WAL mode

**Rationale**:
- **Pros**: 
  - Zero configuration, file-based, perfect for single-node deployment
  - WAL mode provides good concurrency for read-heavy workloads
  - Fast for thousands of writes per second in this use case
  - Easy deployment and backup
- **Cons**: 
  - Limited concurrent writers (mitigated by WAL mode)
  - Not ideal for distributed systems (addressed in HA section)

**Trade-off**: Simplicity and deployment ease over distributed database complexity

### 2. In-Memory Scheduling vs Persistent Scheduling

**Decision**: Schedule jobs in memory using `node-cron`, reload on startup

**Rationale**:
- **Pros**: 
  - Low latency, no database polling needed
  - Precise scheduling with minimal drift
  - Efficient for high-throughput scenarios
- **Cons**: 
  - Jobs lost on crash (mitigated by reloading active jobs on startup)
  - No distributed scheduling support (single node limitation)

**Trade-off**: Performance and accuracy over distributed scheduling (addressed in HA section)

### 3. Synchronous vs Asynchronous Job Execution

**Decision**: Async, non-blocking execution with fire-and-forget pattern

**Rationale**:
- **Pros**: 
  - High throughput - multiple jobs execute concurrently
  - No blocking of scheduler thread
  - Handles thousands of jobs per second
- **Cons**: 
  - No guarantee of execution order
  - Error handling requires careful async management

**Trade-off**: Throughput and scalability over execution ordering guarantees

### 4. Alert Service: In-Memory vs Persistent

**Decision**: In-memory alerts array (extensible to external services)

**Rationale**:
- **Pros**: 
  - Fast, no database overhead
  - Easy to extend with external alerting (email, SMS, Slack)
  - Suitable for development and moderate production use
- **Cons**: 
  - Alerts lost on restart
  - Not suitable for long-term alert history

**Trade-off**: Simplicity and performance over persistence (can be enhanced for production)

### 5. Retry Strategy: Exponential Backoff

**Decision**: Fixed delays with multiplier (1s, 2s, 3s)

**Rationale**:
- Simple and predictable
- Prevents overwhelming failed endpoints
- Fast enough for at-least-once semantics
- Can be enhanced with exponential backoff if needed

## Docker Deployment

### Dockerfile

See `Dockerfile` in the repository.

### Build and Run

```bash
# Build image
docker build -t job-scheduler .

# Run container
docker run -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e PORT=3000 \
  -e NODE_ENV=production \
  job-scheduler
```

### Docker Compose

See `docker-compose.yml` for a complete setup with volume mounting.

```bash
docker-compose up -d
```

## High Availability

### Current Limitations

The current implementation is designed for single-node deployment. For high availability, consider:

### HA Architecture (Optional Enhancement)

1. **Distributed Scheduler**:
   - Use a distributed lock (Redis, etcd) to ensure only one node executes each job
   - Leader election for job distribution
   - Shared job state across nodes

2. **Database**:
   - Migrate from SQLite to PostgreSQL/MySQL for multi-node support
   - Connection pooling and read replicas

3. **Message Queue** (Optional):
   - Use Redis/RabbitMQ for job execution queue
   - Enables better load distribution and fault tolerance
   - Allows job prioritization and rate limiting

4. **Health Checks & Load Balancing**:
   - Kubernetes health checks
   - Load balancer in front of API servers
   - Stateless API servers for horizontal scaling

### Implementation Notes

To add HA support:
1. Replace SQLite with PostgreSQL
2. Implement distributed locking (e.g., Redis Redlock)
3. Add leader election mechanism
4. Separate API servers from scheduler workers
5. Use message queue for job execution

## Sample Dataset

See `sample-data.json` for example job specifications that can be imported.

## Performance Considerations

- **Database**: SQLite with WAL mode handles thousands of concurrent reads and hundreds of writes per second
- **Scheduler**: `node-cron` is efficient and accurate, handling thousands of scheduled jobs
- **HTTP Execution**: Async execution allows concurrent job processing
- **Scalability**: For higher throughput, consider:
  - Horizontal scaling with load balancer
  - Database connection pooling
  - Worker pool for HTTP execution
  - Caching layer for frequently accessed data

## Logging

Logs are written to:
- Console (colored, human-readable)
- `combined.log` (all logs)
- `error.log` (errors only)

Log format: JSON with timestamps, levels, and structured metadata.

## 📽️Project Demo
[Watch Demo Video](./demo.mp4).

## License

MIT

## Author

Ayush
Built for High-Throughput Job Scheduler Challenge.
