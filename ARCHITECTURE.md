# Architecture Diagram

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Applications                      │
│                    (REST API Clients, Scripts)                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ HTTP/REST
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    Express HTTP Server                          │
│                    (Port 3000)                                  │
│                                                                  │
│  ┌──────────────────────┐    ┌──────────────────────────────┐  │
│  │    Jobs Router       │    │  Observability Router        │  │
│  │                      │    │                              │  │
│  │  POST   /jobs        │    │  GET  /observability/health  │  │
│  │  PUT    /jobs/:id    │    │  GET  /observability/metrics │  │
│  │  GET    /jobs/:id    │    │  GET  /observability/alerts  │  │
│  │  DELETE /jobs/:id    │    │  GET  /observability/        │  │
│  │  GET    /jobs/:id/   │    │        executions/recent     │  │
│  │        executions    │    │  GET  /observability/        │  │
│  │  POST   /jobs/:id/   │    │        executions/failed     │  │
│  │        trigger       │    │                              │  │
│  │  GET    /jobs/:id/   │    │                              │  │
│  │        alerts        │    │                              │  │
│  └──────────┬───────────┘    └──────────────────────────────┘  │
└─────────────┼────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Service Layer                             │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    JobService                            │   │
│  │  • createJob()                                           │   │
│  │  • updateJob()                                           │   │
│  │  • getJob()                                              │   │
│  │  • deleteJob()                                           │   │
│  │  • getJobExecutions()                                    │   │
│  │  • triggerJob()                                          │   │
│  └────────────┬─────────────────────────────────────────────┘   │
│               │                                                   │
│  ┌────────────▼─────────────────────────────────────────────┐   │
│  │                    Scheduler                             │   │
│  │  • scheduleJob()                                         │   │
│  │  • unscheduleJob()                                       │   │
│  │  • executeJob()                                          │   │
│  │  • loadActiveJobs()                                      │   │
│  │                                                          │   │
│  │  Uses: node-cron (in-memory scheduling)                 │   │
│  └────────────┬───────────────────────────┬─────────────────┘   │
│               │                           │                       │
│               │                           ▼                       │
│               │              ┌──────────────────────┐            │
│               │              │   HttpExecutor       │            │
│               │              │                      │            │
│               │              │  • execute()         │            │
│               │              │  • Retry logic       │            │
│               │              │  • Timeout handling  │            │
│               │              └──────────┬───────────┘            │
│               │                         │                        │
│               │                         │ HTTP POST              │
│               │                         │                        │
│               │                         ▼                        │
│               │              ┌──────────────────────┐            │
│               │              │   External APIs      │            │
│               │              │   (Target Endpoints) │            │
│               │              └──────────────────────┘            │
│               │                                                   │
│  ┌────────────▼─────────────────────────────────────────────┐   │
│  │                  AlertService                            │   │
│  │  • sendFailureAlert()                                    │   │
│  │  • getRecentAlerts()                                     │   │
│  │  • getJobAlerts()                                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Data Layer (SQLite)                           │
│                                                                  │
│  ┌──────────────────────┐    ┌──────────────────────────────┐  │
│  │      Jobs Table      │    │  Job Executions Table        │  │
│  │                      │    │                              │  │
│  │  • id (PK)           │    │  • id (PK)                   │  │
│  │  • schedule          │◄───┤  • job_id (FK)               │  │
│  │  • api               │    │  • status                    │  │
│  │  • type              │    │  • scheduled_at              │  │
│  │  • is_active         │    │  • started_at                │  │
│  │  • created_at        │    │  • completed_at              │  │
│  │  • updated_at        │    │  • duration                  │  │
│  │                      │    │  • http_status               │  │
│  │                      │    │  • error                     │  │
│  │                      │    │  • retry_count               │  │
│  └──────────────────────┘    └──────────────────────────────┘  │
│                                                                  │
│  Indexes:                                                        │
│  • idx_job_executions_job_id                                    │
│  • idx_job_executions_scheduled_at                              │
│  • idx_jobs_is_active                                           │
│                                                                  │
│  Mode: WAL (Write-Ahead Logging) for concurrency                │
└─────────────────────────────────────────────────────────────────┘
```

## Job Execution Flow

```
┌──────────────┐
│ node-cron    │ Triggers at scheduled time
│ (Timer)      │
└──────┬───────┘
       │
       ▼
┌─────────────────────────────────────────┐
│ Scheduler.executeJob()                  │
│  • Create execution record (PENDING)    │
│  • Update to RUNNING                    │
└──────┬──────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│ HttpExecutor.execute()                  │
│  • Make HTTP POST request               │
│  • Handle timeout (30s default)         │
└──────┬──────────────────────────────────┘
       │
       ├─── Success (2xx) ──────────────┐
       │                                 │
       ├─── Failure (4xx/5xx) ────────┐ │
       │                               │ │
       ├─── Network Error ───────────┐ │ │
       │                             │ │ │
       │                             │ │ │
       ▼                             ▼ ▼ ▼
┌──────────────────────────────────────────────┐
│ Retry Logic (ATLEAST_ONCE)                   │
│  • Max 3 retries                             │
│  • Exponential backoff (1s, 2s, 3s)          │
└──────┬───────────────────────────────────────┘
       │
       ├─── Success after retry ────────┐
       │                                 │
       └─── All retries exhausted ──────┤
                                         │
                                         ▼
┌──────────────────────────────────────────────┐
│ Update Execution Record                       │
│  • Status: SUCCESS or FAILED                  │
│  • Record duration, HTTP status               │
│  • Store error message if failed              │
└──────┬───────────────────────────────────────┘
       │
       │ (if FAILED)
       ▼
┌──────────────────────────────────────────────┐
│ AlertService.sendFailureAlert()              │
│  • Log alert                                  │
│  • Store in-memory (extensible to external)  │
└──────────────────────────────────────────────┘
```

## Data Flow: Job Creation

```
Client
  │
  │ POST /jobs {schedule, api, type}
  ▼
Jobs Router
  │
  │ Validate request
  ▼
JobService.createJob()
  │
  ├─► Validate CRON expression
  ├─► Validate API URL
  │
  ▼
JobModel.create()
  │
  │ INSERT INTO jobs
  ▼
Database (Jobs Table)
  │
  │ Return job object
  ▼
Scheduler.scheduleJob()
  │
  │ Register with node-cron
  ▼
node-cron (In-Memory)
  │
  │ Return jobId
  ▼
Client receives response
```

## Concurrency Model

```
┌─────────────────────────────────────────────────────────────┐
│                    Scheduler Thread                          │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │  Job 1     │  │  Job 2     │  │  Job 3     │            │
│  │  Cron Task │  │  Cron Task │  │  Cron Task │            │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘            │
│        │               │               │                    │
│        │               │               │                    │
│        ▼               ▼               ▼                    │
│  ┌───────────────────────────────────────────────┐          │
│  │         Async Execution Pool                  │          │
│  │  (Non-blocking, Concurrent)                   │          │
│  │                                               │          │
│  │  Execution 1 ──┐                             │          │
│  │  Execution 2 ──┼─► Concurrent HTTP Requests  │          │
│  │  Execution 3 ──┘                             │          │
│  └───────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

## Scalability Considerations

### Current Architecture (Single Node)

- ✅ Handles thousands of jobs per second
- ✅ Efficient in-memory scheduling
- ✅ Concurrent async execution
- ⚠️ Single point of failure
- ⚠️ No horizontal scaling

### Future HA Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Load Balancer                             │
└───────────────┬───────────────────────┬─────────────────────┘
                │                       │
        ┌───────▼───────┐       ┌───────▼───────┐
        │  API Server 1 │       │  API Server 2 │
        └───────┬───────┘       └───────┬───────┘
                │                       │
                └───────────┬───────────┘
                            │
        ┌───────────────────▼───────────────────┐
        │         PostgreSQL (Primary)          │
        │         PostgreSQL (Replica)          │
        └───────────────────┬───────────────────┘
                            │
        ┌───────────────────▼───────────────────┐
        │      Redis (Distributed Lock)         │
        │      Redis (Job Queue - Optional)     │
        └───────────────────┬───────────────────┘
                            │
        ┌───────────────────▼───────────────────┐
        │        Scheduler Workers               │
        │  (Leader election for job distribution)│
        └────────────────────────────────────────┘
```

