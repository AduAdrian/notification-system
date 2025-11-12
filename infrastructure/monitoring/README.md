# Notification System - Monitoring and Observability

This directory contains comprehensive monitoring and observability configurations for the Notification System, implementing industry best practices for microservices monitoring with Prometheus and Grafana.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Metrics](#metrics)
- [Dashboards](#dashboards)
- [Alerts](#alerts)
- [SLI/SLO Definitions](#slislo-definitions)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

## Overview

The monitoring stack provides:

- **Real-time metrics collection** with Prometheus
- **Visual dashboards** with Grafana
- **Alerting** with AlertManager
- **Service-level monitoring** for all microservices
- **Infrastructure monitoring** (Postgres, Redis, Kafka)
- **Custom business metrics** for notification delivery tracking
- **SLO tracking** and error budget monitoring

## Architecture

### Monitoring Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Notification System                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Notification │  │   Channel    │  │   Email      │      │
│  │   Service    │  │ Orchestrator │  │   Service    │      │
│  │              │  │              │  │              │      │
│  │  /metrics    │  │  /metrics    │  │  /metrics    │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │              │
│         └──────────────────┼──────────────────┘              │
│                            │                                 │
│  ┌─────────────────────────▼─────────────────────────┐      │
│  │             Prometheus                             │      │
│  │  - Scrapes /metrics endpoints every 15s           │      │
│  │  - Stores time-series data (30-day retention)     │      │
│  │  - Evaluates alert rules                          │      │
│  │  - Records SLI metrics                            │      │
│  └─────────┬───────────────────────────┬─────────────┘      │
│            │                           │                     │
│  ┌─────────▼──────────┐      ┌────────▼────────┐           │
│  │     Grafana        │      │  AlertManager   │           │
│  │  - Dashboards      │      │  - Routes alerts│           │
│  │  - Visualization   │      │  - Notifications│           │
│  └────────────────────┘      └─────────────────┘           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Metrics Flow

1. **Services expose metrics** on `/metrics` endpoint
2. **Prometheus scrapes** metrics every 15 seconds
3. **Alert rules** are evaluated continuously
4. **Grafana queries** Prometheus for dashboard data
5. **AlertManager** handles alert routing and notifications

## Quick Start

### Docker Compose

Start the entire monitoring stack:

```bash
# Start all services including monitoring
docker-compose up -d

# Access monitoring interfaces
# Prometheus: http://localhost:9090
# Grafana: http://localhost:3001 (admin/admin)
# AlertManager: http://localhost:9093
```

### Kubernetes

Deploy monitoring components:

```bash
# Apply ServiceMonitors
kubectl apply -f infrastructure/monitoring/kubernetes/

# Verify ServiceMonitors
kubectl get servicemonitor -n notification-system

# Check Prometheus targets
kubectl port-forward -n monitoring svc/prometheus 9090:9090
# Then visit: http://localhost:9090/targets
```

## Metrics

### Metric Categories

#### 1. HTTP Request Metrics

Collected automatically via middleware:

```
http_requests_total{method, route, status_code}      # Counter
http_request_duration_seconds{method, route}         # Histogram
http_requests_in_flight                               # Gauge
http_requests_rate_limited_total{route}               # Counter
```

#### 2. Notification Delivery Metrics

Custom business metrics:

```
notification_delivery_total{channel, status, provider}        # Counter
notification_delivery_duration_seconds{channel, provider}     # Histogram
notification_dead_letter_queue_total{channel, reason}         # Counter
notification_queue_depth{channel}                             # Gauge
notification_retry_total{channel, attempt}                    # Counter
notification_batch_size{channel}                              # Histogram
```

#### 3. Infrastructure Metrics

##### Kafka
```
kafka_messages_produced_total{topic}                          # Counter
kafka_messages_consumed_total{topic, consumer_group}          # Counter
kafka_consumer_lag{topic, partition, consumer_group}          # Gauge
kafka_connected                                                # Gauge (0/1)
```

##### Database
```
db_connections_active                                          # Gauge
db_connections_idle                                            # Gauge
db_connections_waiting                                         # Gauge
db_connections_max                                             # Gauge
db_query_duration_seconds{operation, table}                   # Histogram
db_queries_total{operation, table, status}                    # Counter
```

##### Redis
```
redis_connected                                                # Gauge (0/1)
redis_command_duration_seconds{command}                       # Histogram
redis_commands_total{command, status}                         # Counter
```

#### 4. Node.js Metrics

Automatically collected:

```
nodejs_heap_size_total_bytes                                  # Gauge
nodejs_heap_size_used_bytes                                   # Gauge
process_cpu_seconds_total                                     # Counter
process_resident_memory_bytes                                 # Gauge
nodejs_eventloop_lag_seconds                                  # Gauge
```

### Using Metrics in Code

```typescript
import { MetricsCollector, createTimer } from '@notification-system/utils';

// Initialize metrics
const metrics = new MetricsCollector('my-service');

// Track notification delivery
const endTimer = createTimer();
try {
  await sendNotification(payload);
  metrics.trackNotificationDelivery('email', 'success', 'sendgrid', endTimer());
} catch (error) {
  metrics.trackNotificationDelivery('email', 'failed', 'sendgrid', endTimer());
}

// Track database queries
const queryTimer = createTimer();
const result = await db.query('SELECT * FROM notifications');
metrics.trackDbQuery('SELECT', 'notifications', 'success', queryTimer());

// Update connection status
metrics.updateKafkaConnectionStatus(true);
metrics.updateRedisConnectionStatus(true);
```

## Dashboards

### Available Dashboards

#### 1. Notification System - Overview
**File:** `grafana/dashboards/overview.json`

Key panels:
- Services Up count
- Total throughput (requests/sec)
- Success rate with SLO target (99.9%)
- P95 latency with SLO target (<1s)
- Notifications per channel
- Success rate by channel
- Latency percentiles (p50, p95, p99)
- Error rate by channel

**Access:** http://localhost:3001/d/notification-overview

#### 2. Service Details
**File:** `grafana/dashboards/service-details.json`

Key panels:
- HTTP request rate by method and status
- HTTP request duration (p50, p95, p99)
- Memory usage (RSS, heap total, heap used)
- CPU usage
- Database connection pool metrics
- Kafka consumer lag

**Access:** http://localhost:3001/d/notification-service-details

#### 3. SLO Tracking
**File:** `grafana/dashboards/slo-tracking.json`

Key panels:
- Availability SLO (30-day rolling window)
- Latency SLO (30-day rolling window)
- Error budget remaining
- Error budget burn rate
- Total notifications delivered
- Availability SLI by channel
- Latency SLI by channel

**Access:** http://localhost:3001/d/notification-slo

### Creating Custom Dashboards

Dashboards can be created in Grafana UI and exported, or defined as JSON:

```bash
# Export dashboard from Grafana
curl -H "Authorization: Bearer <api-key>" \
  http://localhost:3001/api/dashboards/uid/<dashboard-uid> | \
  jq .dashboard > custom-dashboard.json

# Place in dashboards directory
cp custom-dashboard.json infrastructure/monitoring/grafana/dashboards/
```

## Alerts

### Alert Rules

Alert rules are defined in `prometheus/rules/notification-alerts.yml`

#### Critical Alerts

1. **ServiceDown** - Service is unreachable for >1 minute
2. **CriticalErrorRate** - Error rate >5% for 2 minutes
3. **CriticalLatency** - P95 latency >3s for 2 minutes
4. **DatabaseConnectionPoolExhaustion** - >90% pool utilization
5. **NotificationDeliverySLOBreach** - Success rate <99.9%
6. **KafkaConnectionLost** - Kafka connection lost
7. **RedisConnectionLost** - Redis connection lost

#### Warning Alerts

1. **HighErrorRate** - Error rate >0.1% for 5 minutes
2. **HighLatency** - P95 latency >1s for 5 minutes
3. **HighQueueDepth** - Kafka consumer lag >1000 messages
4. **HighMemoryUsage** - Memory usage >90%
5. **HighCPUUsage** - CPU usage >80%
6. **RateLimitExceeded** - >10 rate limit rejections/minute
7. **HighDeadLetterQueueRate** - >1 message/second to DLQ

### Alert Routing

AlertManager configuration (`alertmanager/alertmanager.yml`):

- **Critical alerts** → PagerDuty + Slack #alerts-critical + Email oncall@
- **SLO breaches** → Slack #slo-alerts + Email sre-team@
- **Performance alerts** → Slack #performance + Email performance-team@
- **Infrastructure alerts** → Slack #infrastructure + Email infra-team@

### Testing Alerts

```bash
# Trigger test alert
curl -X POST http://localhost:9093/api/v1/alerts \
  -H 'Content-Type: application/json' \
  -d '[{
    "labels": {
      "alertname": "TestAlert",
      "severity": "warning"
    },
    "annotations": {
      "summary": "Test alert"
    }
  }]'
```

## SLI/SLO Definitions

### Service Level Indicators (SLIs)

#### 1. Availability SLI
**Definition:** Percentage of notification delivery attempts that succeed

**Metric:**
```promql
sum(rate(notification_delivery_total{status="success"}[5m])) by (channel)
/
sum(rate(notification_delivery_total[5m])) by (channel)
```

#### 2. Latency SLI
**Definition:** Time from notification request to delivery completion

**Metrics:**
- P95 latency: 95% of requests complete within threshold
- P99 latency: 99% of requests complete within threshold

```promql
histogram_quantile(0.95,
  sum(rate(notification_delivery_duration_seconds_bucket[5m])) by (channel, le)
)
```

#### 3. Throughput SLI
**Definition:** Number of notifications processed per second

**Metric:**
```promql
sum(rate(notification_delivery_total[5m])) by (channel, service)
```

### Service Level Objectives (SLOs)

| Channel | Availability SLO | Latency SLO (P95) | Latency SLO (P99) |
|---------|------------------|-------------------|-------------------|
| Email   | 99.9%           | < 1s              | < 3s              |
| SMS     | 99.9%           | < 2s              | < 5s              |
| Push    | 99.95%          | < 500ms           | < 1s              |
| In-App  | 99.99%          | < 100ms           | < 500ms           |

### Error Budgets

**30-day error budget:** 0.1% (99.9% SLO)
- Total allowed failures: 43,200 seconds × 0.001 = 43.2 seconds of downtime
- Daily budget: 1.44 seconds

**Tracking:**
```promql
# Error budget consumed (30-day)
1 - (
  sum(rate(notification_delivery_total{status="success"}[30d]))
  /
  sum(rate(notification_delivery_total[30d]))
)
```

**Burn rate alerts:**
- Fast burn (6x): Alert if consuming 6 days worth of budget in 1 hour
- Slow burn (3x): Alert if consuming 3 days worth of budget in 6 hours

## Deployment

### Docker Compose Deployment

The monitoring stack is fully integrated into `docker-compose.yml`:

```yaml
services:
  prometheus:      # Metrics collection
  grafana:         # Dashboards
  alertmanager:    # Alert routing
  postgres-exporter:  # Database metrics
  redis-exporter:     # Cache metrics
  kafka-exporter:     # Message queue metrics
```

**Access URLs:**
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001 (admin/admin)
- AlertManager: http://localhost:9093

### Kubernetes Deployment

#### Prerequisites
- Prometheus Operator installed
- Kubernetes cluster with monitoring namespace

#### Deploy ServiceMonitors

```bash
# Create namespace
kubectl create namespace notification-system

# Apply ServiceMonitors
kubectl apply -f infrastructure/monitoring/kubernetes/servicemonitor-notification-service.yaml
kubectl apply -f infrastructure/monitoring/kubernetes/servicemonitor-channel-services.yaml
kubectl apply -f infrastructure/monitoring/kubernetes/podmonitor.yaml
kubectl apply -f infrastructure/monitoring/kubernetes/prometheusrule.yaml

# Verify
kubectl get servicemonitor -n notification-system
kubectl get prometheusrule -n notification-system
```

#### Access Grafana

```bash
# Port forward Grafana
kubectl port-forward -n monitoring svc/grafana 3000:3000

# Access at http://localhost:3000
```

## Troubleshooting

### Metrics Not Appearing

1. **Check service is exposing metrics:**
```bash
curl http://localhost:3000/metrics
```

2. **Verify Prometheus is scraping:**
- Visit http://localhost:9090/targets
- Check for UP status

3. **Check Prometheus logs:**
```bash
docker logs prometheus
# or
kubectl logs -n monitoring prometheus-0
```

### Dashboard Not Loading Data

1. **Verify Prometheus datasource:**
- Grafana → Configuration → Data Sources
- Test connection

2. **Check query syntax:**
- Use Prometheus UI to test queries: http://localhost:9090/graph

3. **Verify time range:**
- Ensure dashboard time range has data

### Alerts Not Firing

1. **Check alert rules are loaded:**
```bash
curl http://localhost:9090/api/v1/rules
```

2. **Verify alert evaluation:**
- Prometheus → Alerts tab
- Check "pending" or "firing" state

3. **Check AlertManager:**
```bash
curl http://localhost:9093/api/v2/alerts
```

### High Cardinality Issues

If Prometheus memory usage is high:

1. **Check metric cardinality:**
```promql
# Top 10 metrics by cardinality
topk(10, count by (__name__)({__name__=~".+"}))
```

2. **Reduce label cardinality:**
- Avoid high-cardinality labels (user IDs, request IDs)
- Use fixed label sets

3. **Adjust retention:**
```yaml
# prometheus.yml
--storage.tsdb.retention.time=15d
```

## Best Practices

### Metric Naming

✅ **Good:**
```
notification_delivery_duration_seconds
http_requests_total
db_connections_active
```

❌ **Bad:**
```
NotificationDeliveryTime  # Use snake_case
request_count             # Missing _total suffix
connections               # Missing unit
```

### Label Usage

✅ **Good:**
```
notification_delivery_total{channel="email", status="success"}
```

❌ **Bad:**
```
email_notifications_success_total  # Don't encode dimensions in metric name
notification_delivery_total{user_id="12345"}  # High cardinality
```

### Recording Rules

Use recording rules for complex queries used in dashboards:

```yaml
- record: notification:availability:ratio
  expr: |
    sum(rate(notification_delivery_total{status="success"}[5m])) by (channel)
    /
    sum(rate(notification_delivery_total[5m])) by (channel)
```

### Alert Hygiene

- **Alert on symptoms, not causes** (e.g., high latency, not high CPU)
- **Use appropriate thresholds** (avoid alert fatigue)
- **Include actionable information** in annotations
- **Test alerts** before deploying to production

## Resources

### Documentation
- [Prometheus Best Practices](https://prometheus.io/docs/practices/)
- [Grafana Dashboards](https://grafana.com/docs/grafana/latest/dashboards/)
- [AlertManager Configuration](https://prometheus.io/docs/alerting/latest/configuration/)
- [Google SRE Book - Monitoring](https://sre.google/sre-book/monitoring-distributed-systems/)

### Useful Queries

#### Find slow requests
```promql
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])) > 1
```

#### Calculate error rate
```promql
sum(rate(http_requests_total{status_code=~"5.."}[5m]))
/
sum(rate(http_requests_total[5m]))
```

#### Check service availability
```promql
up{job="notification-service"}
```

#### Monitor queue depth
```promql
kafka_consumer_lag > 100
```

## Support

For issues or questions:
- Check logs: `docker-compose logs <service>`
- Review metrics: http://localhost:9090
- Inspect dashboards: http://localhost:3001
- Contact SRE team: sre-team@notification-system.com
