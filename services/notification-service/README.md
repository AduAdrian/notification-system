# Notification Service

Main API gateway for the notification system. Handles notification creation, retrieval, and management.

## Features

- Multi-channel notification creation (Email, SMS, Push, In-App)
- Priority-based routing
- Real-time status tracking
- JWT and API Key authentication
- Rate limiting and throttling
- Prometheus metrics
- Health check endpoints

## API Documentation

### Interactive Documentation

**Swagger UI** is available when the service is running:

- Local: http://localhost:3000/api-docs
- Production: https://api.notification-system.com/api-docs

### OpenAPI Specification

- YAML: [openapi.yaml](./openapi.yaml)
- JSON: http://localhost:3000/api-docs.json (when running)

## Quick Start

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env` file:

```env
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/notifications
REDIS_URL=redis://localhost:6379

# Kafka
KAFKA_BROKERS=localhost:9092

# Authentication
JWT_SECRET=your-secret-key
API_KEYS=key1,key2,key3

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

### Running the Service

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

### Running with Docker

```bash
docker build -t notification-service .
docker run -p 3000:3000 notification-service
```

## API Endpoints

### Create Notification

```bash
POST /api/v1/notifications
Authorization: Bearer <token>
Content-Type: application/json

{
  "userId": "user123",
  "channels": ["email", "sms"],
  "priority": "high",
  "subject": "Welcome!",
  "message": "Thanks for signing up"
}
```

### Get Notification

```bash
GET /api/v1/notifications/:id
Authorization: Bearer <token>
```

### Get User Notifications

```bash
GET /api/v1/notifications/user/:userId?limit=50&offset=0
Authorization: Bearer <token>
```

### Update Notification Status

```bash
PATCH /api/v1/notifications/:id/status
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "delivered"
}
```

### Health Check

```bash
GET /health
```

### Metrics

```bash
GET /metrics
```

## Authentication

### JWT Bearer Token

```bash
curl -X POST http://localhost:3000/api/v1/notifications \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{"userId": "user123", "channels": ["email"], "message": "Hello"}'
```

### API Key

```bash
curl -X POST http://localhost:3000/api/v1/notifications \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"userId": "user123", "channels": ["email"], "message": "Hello"}'
```

## Rate Limiting

Default limits:
- 100 requests per minute per IP
- Rate limit headers included in all responses

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1699876543
```

## Testing

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# Coverage
npm run test:coverage
```

## Monitoring

### Prometheus Metrics

Available at `/metrics`:

- `http_requests_total` - Total HTTP requests by method/route/status
- `http_request_duration_seconds` - Request duration histogram
- `notification_created_total` - Total notifications created
- `notification_status_total` - Notifications by status

### Health Checks

- `/health` - Overall health status
- `/ready` - Kubernetes readiness probe
- `/live` - Kubernetes liveness probe

## Architecture

```
┌─────────────┐
│   Client    │
└─────┬───────┘
      │ HTTP
      ▼
┌─────────────────────┐
│ Notification Service│
│   (Port 3000)       │
│                     │
│ • JWT Auth          │
│ • Rate Limiting     │
│ • Validation        │
└──┬────────────────┬─┘
   │                │
   ▼                ▼
┌──────┐      ┌─────────┐
│ DB   │      │ Kafka   │
│(PG)  │      │         │
└──────┘      └────┬────┘
                   │
                   ▼
         ┌─────────────────┐
         │ Channel Services│
         └─────────────────┘
```

## Dependencies

- express - Web framework
- kafkajs - Kafka client
- pg - PostgreSQL client
- redis - Redis client
- helmet - Security headers
- joi - Validation
- jsonwebtoken - JWT authentication
- swagger-ui-express - API documentation
- swagger-jsdoc - OpenAPI generation

## Related Services

- [In-App Service](../inapp-service/) - Real-time notifications
- [Channel Orchestrator](../channel-orchestrator/) - Routing logic
- [Email Service](../email-service/) - Email delivery
- [SMS Service](../sms-service/) - SMS delivery
- [Push Service](../push-service/) - Push notifications

## Documentation

- [Complete API Reference](../../docs/API_REFERENCE.md)
- [Architecture Overview](../../notification_system_architecture.md)
- [Performance Guide](../../PERFORMANCE_OPTIMIZATIONS_SUMMARY.md)

## Support

For issues or questions:
- GitHub Issues: [repository-url]
- Email: support@notification-system.com
- Slack: #notification-system

## License

MIT
