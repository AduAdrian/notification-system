# Kubernetes Deployment Guide

This directory contains Kubernetes manifests for deploying the notification system to a Kubernetes cluster.

## Table of Contents
- [Overview](#overview)
- [Services](#services)
- [Health Probes Configuration](#health-probes-configuration)
- [Deployment](#deployment)
- [Scaling](#scaling)
- [Monitoring](#monitoring)

## Overview

The notification system consists of 6 microservices, each with dedicated Kubernetes resources:

1. **notification-service** - Core API service (LoadBalancer)
2. **channel-orchestrator** - Routes notifications to channels (ClusterIP)
3. **email-service** - Email delivery via SendGrid (ClusterIP)
4. **sms-service** - SMS delivery via Twilio (ClusterIP)
5. **push-service** - Push notifications via Firebase (ClusterIP)
6. **inapp-service** - Real-time SSE notifications (LoadBalancer)

## Services

### notification-service
- **Manifest:** `notification-service.yaml`
- **Replicas:** 3 (min), 10 (max with HPA)
- **Port:** 3000
- **Type:** LoadBalancer
- **Resources:**
  - Requests: 256Mi RAM, 250m CPU
  - Limits: 512Mi RAM, 500m CPU
- **Dependencies:** PostgreSQL, Redis, Kafka

### channel-orchestrator
- **Manifest:** `channel-orchestrator.yaml`
- **Replicas:** 2 (min), 5 (max with HPA)
- **Port:** 3001 (metrics)
- **Type:** ClusterIP
- **Resources:**
  - Requests: 128Mi RAM, 100m CPU
  - Limits: 256Mi RAM, 250m CPU
- **Dependencies:** Kafka

### email-service
- **Manifest:** `email-service.yaml`
- **Replicas:** 2 (min), 8 (max with HPA)
- **Port:** 3002 (metrics)
- **Type:** ClusterIP
- **Resources:**
  - Requests: 128Mi RAM, 100m CPU
  - Limits: 256Mi RAM, 250m CPU
- **Dependencies:** Kafka, SendGrid API

### sms-service
- **Manifest:** `sms-service.yaml`
- **Replicas:** 2 (min), 8 (max with HPA)
- **Port:** 3003 (metrics)
- **Type:** ClusterIP
- **Resources:**
  - Requests: 128Mi RAM, 100m CPU
  - Limits: 256Mi RAM, 250m CPU
- **Dependencies:** Kafka, Twilio API

### push-service
- **Manifest:** `push-service.yaml`
- **Replicas:** 2 (min), 8 (max with HPA)
- **Port:** 3005 (metrics)
- **Type:** ClusterIP
- **Resources:**
  - Requests: 128Mi RAM, 100m CPU
  - Limits: 256Mi RAM, 250m CPU
- **Dependencies:** Kafka, Firebase

### inapp-service
- **Manifest:** `inapp-service.yaml`
- **Replicas:** 2 (min), 6 (max with HPA)
- **Port:** 3004
- **Type:** LoadBalancer
- **Resources:**
  - Requests: 128Mi RAM, 100m CPU
  - Limits: 256Mi RAM, 250m CPU
- **Dependencies:** Kafka

## Health Probes Configuration

All services implement **three distinct health check endpoints** following 2025 best practices:

### Liveness Probe
**Purpose:** Detect if container is alive and should be restarted

**Configuration:**
```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: <service-port>
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
  successThreshold: 1
```

**Behavior:**
- Checks every 10 seconds
- 3 consecutive failures triggers container restart
- Fast response (< 100ms) - no external dependency checks

### Readiness Probe
**Purpose:** Determine if container should receive traffic

**Configuration:**
```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: <service-port>
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 2
  successThreshold: 1
```

**Behavior:**
- Checks every 5 seconds
- 2 consecutive failures removes pod from endpoints
- Validates all dependencies (DB, Redis, Kafka)
- Target response time: < 500ms

### Startup Probe
**Purpose:** Allow slow-starting containers to initialize

**Configuration:**
```yaml
startupProbe:
  httpGet:
    path: /health/startup
    port: <service-port>
  initialDelaySeconds: 0
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 30
  successThreshold: 1
```

**Behavior:**
- Allows up to 150 seconds for startup (30 × 5s)
- Disables liveness/readiness checks until successful
- Prevents premature restarts during initialization

### Health Check Endpoints

All services expose:
- `GET /health/live` - Liveness probe
- `GET /health/ready` - Readiness probe
- `GET /health/startup` - Startup probe
- `GET /health` - Legacy endpoint (detailed diagnostics)
- `GET /metrics` - Prometheus metrics

**Example Response:**
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

For detailed health check documentation, see [docs/HEALTH_CHECKS.md](../../docs/HEALTH_CHECKS.md).

## Deployment

### Prerequisites

1. **Kubernetes cluster** (v1.27+)
2. **kubectl** configured
3. **ConfigMap** with service configuration:
```bash
kubectl create configmap notification-config \
  --from-literal=db_host=postgres-service \
  --from-literal=redis_url=redis://redis-service:6379 \
  --from-literal=kafka_brokers=kafka-service:9092 \
  --from-literal=jaeger_endpoint=http://jaeger-collector:14268
```

4. **Secrets** with sensitive credentials:
```bash
kubectl create secret generic notification-secrets \
  --from-literal=db_user=postgres \
  --from-literal=db_password=yourpassword \
  --from-literal=jwt_secret=yourjwtsecret \
  --from-literal=sendgrid_api_key=SG.xxx \
  --from-literal=twilio_account_sid=ACxxx \
  --from-literal=twilio_auth_token=xxx
```

### Deploy All Services

```bash
# Deploy infrastructure (if not already running)
kubectl apply -f jaeger.yaml

# Deploy notification services
kubectl apply -f notification-service.yaml
kubectl apply -f channel-orchestrator.yaml
kubectl apply -f email-service.yaml
kubectl apply -f sms-service.yaml
kubectl apply -f push-service.yaml
kubectl apply -f inapp-service.yaml
```

### Verify Deployment

```bash
# Check all pods are running
kubectl get pods

# Expected output:
# notification-service-xxx-xxx      1/1   Running   0   2m
# channel-orchestrator-xxx-xxx      1/1   Running   0   2m
# email-service-xxx-xxx             1/1   Running   0   2m
# sms-service-xxx-xxx               1/1   Running   0   2m
# push-service-xxx-xxx              1/1   Running   0   2m
# inapp-service-xxx-xxx             1/1   Running   0   2m

# Check services
kubectl get svc

# Check health of pods
kubectl exec -it notification-service-xxx-xxx -- curl localhost:3000/health
```

### Rolling Updates

```bash
# Update image version
kubectl set image deployment/notification-service \
  notification-service=ghcr.io/aduadrian/notification-system/notification-service:v2.0.0

# Monitor rollout
kubectl rollout status deployment/notification-service

# Rollback if needed
kubectl rollout undo deployment/notification-service
```

## Scaling

### Horizontal Pod Autoscaler (HPA)

All services include HPA configurations that automatically scale based on CPU and memory utilization.

**Configuration:**
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: notification-service-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: notification-service
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

**Behavior:**
- Scales up when CPU > 70% or Memory > 80%
- Scales down when below thresholds for 5 minutes
- Respects min/max replica bounds

### Manual Scaling

```bash
# Scale notification-service to 5 replicas
kubectl scale deployment notification-service --replicas=5

# Scale email-service
kubectl scale deployment email-service --replicas=4
```

### View HPA Status

```bash
# Check HPA status
kubectl get hpa

# Expected output:
# NAME                         REFERENCE                       TARGETS         MINPODS   MAXPODS   REPLICAS
# notification-service-hpa     Deployment/notification-service 45%/70%, 30%/80%   3         10        3
# channel-orchestrator-hpa     Deployment/channel-orchestrator 25%/70%, 20%/80%   2         5         2
```

## Monitoring

### Health Check Monitoring

```bash
# Check readiness status
kubectl get pods -o wide

# Describe pod to see probe details
kubectl describe pod notification-service-xxx-xxx

# View probe events
kubectl get events --field-selector involvedObject.name=notification-service-xxx-xxx
```

### Metrics Collection

All services expose Prometheus metrics on their respective ports:

```bash
# Port-forward to access metrics
kubectl port-forward svc/notification-service 3000:80
curl http://localhost:3000/metrics

# For channel services (metrics port)
kubectl port-forward svc/email-service 3002:3002
curl http://localhost:3002/metrics
```

### Logs

```bash
# View logs for a service
kubectl logs -f deployment/notification-service

# View logs for all replicas
kubectl logs -f -l app=notification-service

# View logs from previous container (after restart)
kubectl logs notification-service-xxx-xxx --previous

# Stream logs from multiple services
kubectl logs -f -l tier=backend --all-containers=true
```

### Common Monitoring Commands

```bash
# Resource usage
kubectl top pods
kubectl top nodes

# Pod status
kubectl get pods --watch

# Describe deployment
kubectl describe deployment notification-service

# Check endpoints
kubectl get endpoints notification-service
```

## Troubleshooting

### Pod Not Starting

```bash
# Check pod status
kubectl describe pod <pod-name>

# Common issues:
# - ImagePullBackOff: Check image name and registry access
# - CrashLoopBackOff: Check logs for startup errors
# - Pending: Check resource availability
```

### Health Check Failures

```bash
# Test health endpoints directly
kubectl port-forward <pod-name> 3000:3000
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready

# Check probe configuration
kubectl describe pod <pod-name> | grep -A 10 "Liveness"
kubectl describe pod <pod-name> | grep -A 10 "Readiness"
```

### Database Connection Issues

```bash
# Verify ConfigMap
kubectl get configmap notification-config -o yaml

# Verify Secrets
kubectl get secret notification-secrets -o yaml

# Test database connectivity from pod
kubectl exec -it <pod-name> -- sh
nc -zv postgres-service 5432
```

### Service Not Receiving Traffic

```bash
# Check service endpoints
kubectl get endpoints notification-service

# If no endpoints, check readiness probe
kubectl describe pod <pod-name> | grep -A 10 "Readiness"

# Check service selector matches pod labels
kubectl get svc notification-service -o yaml | grep selector
kubectl get pod <pod-name> --show-labels
```

## Performance Optimization

### Resource Tuning

Based on monitoring, adjust resource requests/limits:

```yaml
resources:
  requests:
    memory: "256Mi"  # Increase if pods are OOMKilled
    cpu: "250m"      # Increase if CPU throttling occurs
  limits:
    memory: "512Mi"  # 2x requests recommended
    cpu: "500m"      # 2x requests recommended
```

### Connection Pool Sizing

For notification-service, ensure database connection pool doesn't exceed:
```
(replicas × maxPoolSize) < PostgreSQL max_connections
```

Example:
- 10 replicas × 25 max pool = 250 connections
- PostgreSQL max_connections should be ≥ 300

### Health Check Optimization

If health checks cause performance issues:

```yaml
# Increase check interval
readinessProbe:
  periodSeconds: 10  # Instead of 5

# Increase timeout
readinessProbe:
  timeoutSeconds: 5  # Instead of 3
```

## Additional Resources

- [Health Checks Documentation](../../docs/HEALTH_CHECKS.md)
- [Database Optimization](../../docs/DATABASE_OPTIMIZATION.md)
- [Kubernetes Probes Best Practices](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [HPA Documentation](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
