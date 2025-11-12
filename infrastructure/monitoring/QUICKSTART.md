# Monitoring Quick Start Guide

Get the notification system monitoring up and running in 5 minutes.

## Prerequisites

- Docker and Docker Compose installed
- Notification system services running

## Step 1: Start Monitoring Stack

```bash
# From the notification-system root directory
cd C:\Users\Adrian\notification-system

# Start all services including monitoring
docker-compose up -d

# Wait for services to be healthy (30-60 seconds)
docker-compose ps
```

## Step 2: Verify Services

Check that monitoring services are running:

```bash
# Check Prometheus
curl http://localhost:9090/-/healthy
# Expected: Prometheus is Healthy.

# Check Grafana
curl http://localhost:3001/api/health
# Expected: {"commit":"...","database":"ok",...}

# Check a service metrics endpoint
curl http://localhost:3000/metrics
# Expected: Prometheus metrics output
```

## Step 3: Access Dashboards

Open in your browser:

### Grafana (Primary Interface)
**URL:** http://localhost:3001
**Credentials:** admin / admin

**Pre-configured Dashboards:**
1. **Notification System - Overview**
   - Navigate to: Dashboards → Notification System folder
   - Shows: Overall system health, throughput, success rates, latency

2. **Service Details**
   - Navigate to: Dashboards → Notification System folder
   - Shows: Individual service metrics, resource usage

3. **SLO Tracking**
   - Navigate to: Dashboards → Notification System folder
   - Shows: SLO compliance, error budgets

### Prometheus (Advanced Queries)
**URL:** http://localhost:9090
- Go to "Graph" tab to run custom queries
- Go to "Targets" to see scrape status
- Go to "Alerts" to see active alerts

### AlertManager (Alert Configuration)
**URL:** http://localhost:9093
- View active alerts
- Test alert routing
- Silence alerts

## Step 4: Generate Test Traffic

To see metrics in action, generate some traffic:

```bash
# Send a test notification
curl -X POST http://localhost:3000/api/v1/notifications \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "channels": ["email"],
    "priority": "high",
    "template": "welcome",
    "data": {
      "name": "Test User",
      "message": "Hello from monitoring test"
    }
  }'

# Check metrics updated
curl http://localhost:3000/metrics | grep notification_delivery_total
```

## Step 5: Explore Key Metrics

### In Grafana

1. **Overview Dashboard**
   - Check "Services Up" - should show all services healthy
   - Monitor "Total Throughput" - should increase after test notification
   - Verify "Success Rate" - should be 100% or close to SLO (99.9%)

2. **View by Channel**
   - Scroll to "Notifications per Channel" graph
   - Should see spike in email channel after test

3. **Check Latency**
   - Look at "P95 Latency" gauge
   - Should be well below SLO target (< 1 second)

### In Prometheus

Run these queries in Prometheus UI (http://localhost:9090/graph):

```promql
# Total notifications sent
sum(notification_delivery_total)

# Success rate
sum(rate(notification_delivery_total{status="success"}[5m]))
/
sum(rate(notification_delivery_total[5m]))

# P95 latency
histogram_quantile(0.95,
  sum(rate(notification_delivery_duration_seconds_bucket[5m])) by (le)
)

# Services up
up{job=~".*-service"}
```

## Common Issues

### Services not showing metrics

**Problem:** Prometheus targets show "DOWN" status

**Solution:**
```bash
# Check service is running
docker-compose ps notification-service

# Check metrics endpoint manually
curl http://localhost:3000/metrics

# Restart Prometheus
docker-compose restart prometheus
```

### Grafana dashboards are empty

**Problem:** No data in dashboards

**Solutions:**
1. **Check time range:** Set to "Last 15 minutes" or "Last 1 hour"
2. **Verify datasource:** Configuration → Data Sources → Prometheus → Test
3. **Generate traffic:** Run test notification request above
4. **Wait:** Initial metrics may take 15-30 seconds to appear

### Cannot access Grafana

**Problem:** Connection refused on port 3001

**Solutions:**
```bash
# Check Grafana is running
docker-compose ps grafana

# Check logs
docker-compose logs grafana

# Restart Grafana
docker-compose restart grafana
```

## Next Steps

### Configure Alerts

1. Edit alert rules: `infrastructure/monitoring/prometheus/rules/notification-alerts.yml`
2. Configure AlertManager: `infrastructure/monitoring/alertmanager/alertmanager.yml`
3. Add your Slack webhook, email, PagerDuty keys
4. Restart services: `docker-compose restart prometheus alertmanager`

### Create Custom Dashboards

1. Log into Grafana: http://localhost:3001
2. Click "+" → "Dashboard"
3. Add panels with Prometheus queries
4. Save dashboard to "Notification System" folder
5. Export JSON and save to `infrastructure/monitoring/grafana/dashboards/`

### Set Up Production Monitoring

1. **Update retention:** Increase Prometheus retention in docker-compose.yml
2. **Enable remote storage:** Configure Thanos or Cortex for long-term storage
3. **Secure access:** Add authentication to Grafana and Prometheus
4. **Configure alerts:** Set up real notification channels (Slack, PagerDuty, email)
5. **Review SLOs:** Adjust based on business requirements

## Useful Commands

```bash
# View all metrics from notification-service
curl http://localhost:3000/metrics

# Check Prometheus targets
curl http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health: .health}'

# View active alerts
curl http://localhost:9090/api/v1/alerts | jq '.data.alerts'

# Restart monitoring stack
docker-compose restart prometheus grafana alertmanager

# View logs
docker-compose logs -f prometheus
docker-compose logs -f grafana

# Stop monitoring stack
docker-compose stop prometheus grafana alertmanager
```

## Monitoring Checklist

- [ ] All services showing as UP in Prometheus targets
- [ ] Grafana dashboards loading with data
- [ ] Test notification sent successfully
- [ ] Metrics visible in overview dashboard
- [ ] SLO tracking dashboard shows 100% availability
- [ ] Alerts configured (optional for dev)
- [ ] Custom dashboards created (optional)

## Support

For detailed documentation, see: [infrastructure/monitoring/README.md](./README.md)

For issues:
- Check service logs: `docker-compose logs <service-name>`
- Verify configuration files
- Ensure all dependencies are running
