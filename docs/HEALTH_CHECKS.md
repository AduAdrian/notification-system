# Health Checks and Kubernetes Probes

This document explains the health check implementation and Kubernetes probe configuration for all services in the notification system.

## Table of Contents
- [Overview](#overview)
- [Health Check Endpoints](#health-check-endpoints)
- [Kubernetes Probe Configuration](#kubernetes-probe-configuration)
- [Service-Specific Details](#service-specific-details)
- [Monitoring and Alerts](#monitoring-and-alerts)
- [Troubleshooting](#troubleshooting)

## Overview

The notification system implements **three distinct health check endpoints** following Kubernetes 2025 best practices:

1. **Liveness Probe** (`/health/live`) - Is the process running?
2. **Readiness Probe** (`/health/ready`) - Can the service handle traffic?
3. **Startup Probe** (`/health/startup`) - Has initialization completed?

### Why Three Separate Probes?

| Probe | Purpose | Checks | On Failure |
|-------|---------|--------|------------|
| Liveness | Detect deadlocks | Process alive | Restart container |
| Readiness | Traffic routing | Dependencies ready | Remove from endpoints |
| Startup | Initial boot | Service initialized | Allow more time |

## Health Check Endpoints

### 1. Liveness Probe: `/health/live`

**Purpose:** Verify the process is running and not deadlocked

**Characteristics:**
- ⚡ **Fast:** < 10ms response time
- 🚫 **No external calls:** Never checks databases, Redis, or Kafka
- ✅ **Simple:** Just returns 200 OK if process is alive

**Response Format:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-13T10:30:00.000Z",
  "uptime": 3600
}
```

**When to Use:**
- Default liveness check for all services
- Detects process crashes, deadlocks, or hangs
- Should NEVER fail unless process is truly broken

**Implementation:**
```typescript
app.get('/health/live', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});
```

### 2. Readiness Probe: `/health/ready`

**Purpose:** Determine if service can handle incoming requests

**Characteristics:**
- 🔍 **Thorough:** Checks all critical dependencies
- ⏱️ **Timeout:** < 500ms response time target
- 🔄 **Non-fatal:** Failures don't restart container

**Response Format (Healthy):**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-13T10:30:00.000Z",
  "responseTime": "45ms",
  "checks": {
    "database": "up",
    "redis": "up",
    "kafka": "up"
  },
  "uptime": 3600
}
```

**Response Format (Degraded):**
```json
{
  "status": "degraded",
  "timestamp": "2025-01-13T10:30:00.000Z",
  "responseTime": "450ms",
  "checks": {
    "database": "down",
    "redis": "up",
    "kafka": "up"
  }
}
```

**HTTP Status Codes:**
- `200` - Service is ready
- `503` - Service is degraded or not ready

**When to Use:**
- Before routing traffic to new pods
- During rolling updates
- When dependencies are temporarily unavailable

**Implementation (notification-service):**
```typescript
app.get('/health/ready', async (req, res) => {
  const startTime = Date.now();

  try {
    const dbHealthy = await dbService.isHealthy();
    const redisHealthy = await redisService.isHealthy();
    const allHealthy = dbHealthy && redisHealthy;

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      responseTime: `${Date.now() - startTime}ms`,
      checks: {
        database: dbHealthy ? 'up' : 'down',
        redis: redisHealthy ? 'up' : 'down',
        kafka: 'up', // Async, don't block on it
      },
      uptime: process.uptime(),
    });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error });
  }
});
```

### 3. Startup Probe: `/health/startup`

**Purpose:** Allow slow-starting containers time to initialize

**Characteristics:**
- 🐢 **Patient:** Up to 150 seconds allowed (30 failures × 5s period)
- 🔧 **Initialization:** Validates service is ready for first traffic
- ⏸️ **Blocks:** Disables liveness/readiness checks until successful

**Response Format:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-13T10:30:00.000Z"
}
```

**When to Use:**
- Services with slow initialization (database migrations, cache warming)
- Prevents premature restarts during startup
- One-time check, then switches to liveness/readiness

**Implementation:**
```typescript
app.get('/health/startup', async (req, res) => {
  try {
    const dbHealthy = await dbService.isHealthy();
    const redisHealthy = await redisService.isHealthy();

    if (dbHealthy && redisHealthy) {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(503).json({
        status: 'unhealthy',
        message: 'Service still initializing',
      });
    }
  } catch (error) {
    res.status(503).json({ status: 'unhealthy' });
  }
});
```

### 4. Legacy Health Endpoint: `/health`

**Purpose:** Backward compatibility and detailed diagnostics

**Response Format:**
```json
{
  "status": "healthy",
  "service": "notification-service",
  "timestamp": "2025-01-13T10:30:00.000Z",
  "responseTime": "52ms",
  "checks": {
    "database": "up",
    "redis": "up",
    "kafka": "up"
  },
  "poolStats": {
    "totalCount": 12,
    "idleCount": 7,
    "waitingCount": 0,
    "utilization": 20
  },
  "uptime": 3600,
  "memory": {
    "rss": 52428800,
    "heapTotal": 20971520,
    "heapUsed": 18874368,
    "external": 1048576
  }
}
```

## Kubernetes Probe Configuration

### Standard Configuration (All Services)

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3000
  initialDelaySeconds: 10    # Wait 10s before first check
  periodSeconds: 10          # Check every 10s
  timeoutSeconds: 5          # 5s timeout per check
  failureThreshold: 3        # 3 consecutive failures = restart
  successThreshold: 1        # 1 success = healthy

readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 5     # Start checking after 5s
  periodSeconds: 5           # Check every 5s
  timeoutSeconds: 3          # 3s timeout per check
  failureThreshold: 2        # 2 consecutive failures = not ready
  successThreshold: 1        # 1 success = ready

startupProbe:
  httpGet:
    path: /health/startup
    port: 3000
  initialDelaySeconds: 0     # Start immediately
  periodSeconds: 5           # Check every 5s
  timeoutSeconds: 3          # 3s timeout per check
  failureThreshold: 30       # 30 failures (150s) before giving up
  successThreshold: 1        # 1 success = started
```

### Probe Behavior

```
Pod Start
    ↓
Startup Probe (0-150s)
    ├── Success → Enable liveness & readiness
    └── 30 failures → Kill pod
        ↓
Liveness Probe (every 10s)
    ├── Success → Container running
    └── 3 failures → Restart container
        ↓
Readiness Probe (every 5s)
    ├── Success → Add to endpoints
    └── 2 failures → Remove from endpoints
```

### Timing Calculations

**Fastest pod ready:** 5 seconds
- Startup succeeds immediately
- Readiness succeeds on first check

**Maximum startup time:** 150 seconds
- 30 failures × 5s period = 150s
- After this, pod is killed and restarted

**Liveness restart delay:** 30 seconds
- 3 failures × 10s period = 30s
- Prevents flapping from transient issues

**Readiness removal delay:** 10 seconds
- 2 failures × 5s period = 10s
- Quick removal from load balancer on issues

## Service-Specific Details

### notification-service
- **Port:** 3000
- **Readiness checks:** PostgreSQL, Redis
- **Startup time:** ~5-10 seconds
- **Special:** Includes database pool statistics in `/health`

### channel-orchestrator
- **Port:** 3001
- **Readiness checks:** Kafka connectivity
- **Startup time:** ~10-15 seconds (Kafka connection)
- **Special:** Tracks orchestrator initialization state

### email-service
- **Port:** 3002
- **Readiness checks:** SendGrid API key configuration, Kafka
- **Startup time:** ~5-8 seconds
- **Special:** Validates external API credentials

### sms-service
- **Port:** 3003
- **Readiness checks:** Twilio credentials, Kafka
- **Startup time:** ~5-8 seconds
- **Special:** Validates Twilio API access

### push-service
- **Port:** 3005
- **Readiness checks:** Firebase initialization, Kafka
- **Startup time:** ~8-12 seconds (Firebase setup)
- **Special:** Firebase credential validation

### inapp-service
- **Port:** 3004
- **Readiness checks:** Kafka, SSE connection capacity
- **Startup time:** ~5-8 seconds
- **Special:** Reports active SSE connection count

## Monitoring and Alerts

### Key Metrics to Track

#### Probe Success Rate
```promql
# Liveness probe success rate
rate(kube_pod_container_status_restarts_total[5m]) < 0.01

# Readiness probe success rate
sum(kube_pod_status_ready) / sum(kube_pod_status_phase) > 0.95
```

#### Health Check Response Times
```promql
# Response time histogram
histogram_quantile(0.95,
  rate(http_request_duration_seconds_bucket{
    path="/health/ready"
  }[5m])
) < 0.5  # Should be < 500ms
```

### Recommended Alerts

#### Critical: High Restart Rate
```yaml
alert: HighPodRestartRate
expr: rate(kube_pod_container_status_restarts_total[15m]) > 0.1
severity: critical
description: "Pod {{ $labels.pod }} is restarting frequently"
```

#### Warning: Pods Not Ready
```yaml
alert: PodsNotReady
expr: kube_pod_status_ready{condition="true"} == 0
for: 5m
severity: warning
description: "Pod {{ $labels.pod }} not ready for 5 minutes"
```

#### Info: Slow Health Checks
```yaml
alert: SlowHealthChecks
expr: http_request_duration_seconds{path="/health/ready"} > 0.5
for: 5m
severity: info
description: "Health checks taking > 500ms"
```

## Troubleshooting

### Pod Keeps Restarting

**Symptom:** Liveness probe failing repeatedly

**Diagnosis:**
```bash
# Check liveness probe failures
kubectl describe pod <pod-name> | grep -A 10 "Liveness"

# Check pod logs around restart
kubectl logs <pod-name> --previous
```

**Common Causes:**
1. **Application deadlock** - Increase `timeoutSeconds` or fix deadlock
2. **Too aggressive settings** - Increase `failureThreshold`
3. **Slow startup** - Increase `initialDelaySeconds`

**Solution:**
```yaml
livenessProbe:
  initialDelaySeconds: 30  # Increased from 10
  failureThreshold: 5      # Increased from 3
```

### Pod Not Receiving Traffic

**Symptom:** Readiness probe failing, pod not in endpoints

**Diagnosis:**
```bash
# Check readiness probe status
kubectl describe pod <pod-name> | grep -A 10 "Readiness"

# Check endpoint membership
kubectl get endpoints <service-name>

# Test health endpoint directly
kubectl port-forward <pod-name> 3000:3000
curl http://localhost:3000/health/ready
```

**Common Causes:**
1. **Database connection failed** - Check DB credentials/connectivity
2. **Redis unavailable** - Verify Redis service
3. **Slow dependency checks** - Optimize health check logic

**Solution:**
```bash
# Check dependency health
kubectl exec -it <pod-name> -- curl http://postgres-service:5432
kubectl exec -it <pod-name> -- curl http://redis-service:6379
```

### Startup Taking Too Long

**Symptom:** Startup probe failures, pods killed during initialization

**Diagnosis:**
```bash
# Check startup events
kubectl get events --field-selector involvedObject.name=<pod-name>

# Monitor startup progress
kubectl logs -f <pod-name>
```

**Common Causes:**
1. **Database migrations** - Run migrations in init container
2. **Large data loading** - Use lazy loading
3. **Slow external API** - Increase `failureThreshold`

**Solution:**
```yaml
startupProbe:
  failureThreshold: 60  # Increased from 30 (300s total)
  periodSeconds: 5
```

### Health Check Performance Issues

**Symptom:** Health checks taking > 500ms

**Diagnosis:**
```typescript
// Add timing to health checks
const startTime = Date.now();
const dbHealthy = await dbService.isHealthy();
const dbTime = Date.now() - startTime;

console.log(`DB health check: ${dbTime}ms`);
```

**Common Causes:**
1. **Database connection pool exhausted** - Increase pool size
2. **Slow network** - Check service-to-service latency
3. **Heavy health check logic** - Simplify checks

**Solution:**
```typescript
// Use connection pooling, not new connections
async isHealthy(): Promise<boolean> {
  try {
    const client = await this.pool.connect(); // Reuses pool
    client.release();
    return true;
  } catch {
    return false;
  }
}
```

## Best Practices

1. **Keep liveness checks simple** - Never call external services
2. **Make readiness checks thorough** - Check all critical dependencies
3. **Set appropriate timeouts** - Balance responsiveness vs stability
4. **Monitor probe success rates** - Alert on trends, not single failures
5. **Test probe configurations** - Use `kubectl port-forward` to test manually
6. **Document service-specific needs** - Some services need longer startup
7. **Use startup probes for slow starts** - Prevents premature liveness restarts
8. **Fail fast on unrecoverable errors** - Return 503 immediately, don't retry internally

## Performance Targets

| Metric | Target | Critical Threshold |
|--------|--------|-------------------|
| Liveness response time | < 100ms | < 500ms |
| Readiness response time | < 500ms | < 3000ms |
| Startup response time | < 500ms | < 3000ms |
| Probe success rate | > 99% | > 95% |
| Pod restart rate | < 1/hour | < 5/hour |
| Ready pods ratio | > 95% | > 80% |

## Additional Resources

- [Kubernetes Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Health Check Best Practices](https://cloud.google.com/blog/products/containers-kubernetes/kubernetes-best-practices-setting-up-health-checks-with-readiness-and-liveness-probes)
- [Probe Configuration Reference](https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/pod-v1/#Probe)
