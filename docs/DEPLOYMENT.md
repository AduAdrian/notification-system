# Deployment Guide

## Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Kubernetes cluster (for production)
- PostgreSQL 16+
- Redis 7+
- Apache Kafka 3.x
- MongoDB 7+

## Local Development

### 1. Clone and Install

```bash
git clone https://github.com/AduAdrian/notification-system.git
cd notification-system
npm install --workspaces
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Start Infrastructure with Docker Compose

```bash
docker-compose up -d postgres redis kafka zookeeper mongodb
```

### 4. Initialize Database

```bash
psql -h localhost -U postgres -d notifications -f infrastructure/database/schema.sql
```

### 5. Run Services in Development

```bash
# All services
npm run dev

# Or individual services
npm run dev --workspace=@notification-system/notification-service
npm run dev --workspace=@notification-system/channel-orchestrator
npm run dev --workspace=@notification-system/email-service
```

## Docker Deployment

### Build and Run All Services

```bash
# Build images
make docker-build

# Start all services
make docker-up

# View logs
make docker-logs

# Stop services
make docker-down
```

## Kubernetes Deployment

### 1. Create ConfigMap and Secrets

```bash
kubectl create configmap notification-config \
  --from-literal=db_host=postgres-service \
  --from-literal=redis_url=redis://redis-service:6379 \
  --from-literal=kafka_brokers=kafka-service:9092

kubectl create secret generic notification-secrets \
  --from-literal=db_user=postgres \
  --from-literal=db_password=your-password \
  --from-literal=jwt_secret=your-jwt-secret \
  --from-literal=sendgrid_api_key=your-sendgrid-key \
  --from-literal=twilio_account_sid=your-twilio-sid \
  --from-literal=twilio_auth_token=your-twilio-token
```

### 2. Deploy Services

```bash
make k8s-deploy
```

### 3. Verify Deployment

```bash
kubectl get pods
kubectl get services
kubectl logs -f deployment/notification-service
```

## Production Considerations

### High Availability

- Run minimum 3 replicas per service
- Use Horizontal Pod Autoscaler (HPA)
- Configure proper resource limits
- Set up health checks

### Monitoring

- Prometheus for metrics
- Grafana for visualization
- ELK Stack for logging
- Jaeger for distributed tracing

### Security

- Use TLS/SSL for all connections
- Rotate secrets regularly
- Enable network policies
- Use private container registry
- Implement rate limiting
- Enable audit logging

### Backup Strategy

- Daily PostgreSQL backups
- Kafka topic replication factor ≥ 3
- Redis persistence with AOF
- MongoDB replica set

### Scaling Guidelines

| Component | Min Replicas | Max Replicas | CPU (request/limit) | Memory (request/limit) |
|-----------|--------------|--------------|---------------------|------------------------|
| Notification Service | 3 | 10 | 250m/500m | 256Mi/512Mi |
| Channel Orchestrator | 2 | 5 | 200m/400m | 256Mi/512Mi |
| Email Service | 2 | 8 | 200m/400m | 256Mi/512Mi |
| SMS Service | 2 | 8 | 200m/400m | 256Mi/512Mi |
| Push Service | 2 | 8 | 200m/400m | 256Mi/512Mi |
| In-App Service | 2 | 5 | 200m/400m | 256Mi/512Mi |

## Troubleshooting

### Services Not Starting

```bash
# Check logs
docker-compose logs <service-name>

# Verify database connection
psql -h localhost -U postgres -d notifications

# Test Kafka connection
kafka-console-consumer --bootstrap-server localhost:9092 --topic notification.created
```

### High Latency

- Check Kafka consumer lag
- Verify database query performance
- Review Redis hit rate
- Scale up replicas

### Failed Deliveries

- Check provider API keys
- Verify network connectivity
- Review delivery logs in PostgreSQL
- Monitor Kafka dead letter queue

## URLs

- **Notification API**: http://localhost:3000
- **In-App Service (SSE)**: http://localhost:3004
- **Kafka UI**: http://localhost:8080 (if installed)
- **Prometheus**: http://localhost:9090 (if installed)
- **Grafana**: http://localhost:3001 (if installed)
