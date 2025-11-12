# Observability & Distributed Tracing Guide

This guide explains how to use the distributed tracing capabilities in the notification system, powered by OpenTelemetry and Jaeger.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Viewing Traces in Jaeger](#viewing-traces-in-jaeger)
- [Understanding Traces](#understanding-traces)
- [Custom Instrumentation](#custom-instrumentation)
- [Circuit Breaker Monitoring](#circuit-breaker-monitoring)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

The notification system implements distributed tracing using **OpenTelemetry** with **Jaeger** as the tracing backend. This provides:

- End-to-end request tracing across all microservices
- Performance bottleneck identification
- Error tracking and debugging
- Service dependency visualization
- Circuit breaker state monitoring

## Architecture

### Components

1. **OpenTelemetry SDK**: Automatic instrumentation of HTTP, Kafka, Database, and Redis operations
2. **Jaeger**: Tracing backend for collecting, storing, and visualizing traces
3. **Circuit Breakers**: Protected external API calls with Opossum
4. **Custom Spans**: Manual instrumentation for business logic

### Instrumented Operations

The following operations are automatically traced:

- **HTTP/HTTPS requests** (incoming and outgoing)
- **Kafka message production and consumption**
- **PostgreSQL database queries**
- **MongoDB operations**
- **Redis commands**
- **Express.js route handlers**

## Getting Started

### 1. Start the Services

```bash
# Start all services including Jaeger
docker-compose up -d

# Or use make command
make docker-up
```

### 2. Verify Jaeger is Running

Open your browser and navigate to:
```
http://localhost:16686
```

You should see the Jaeger UI.

### 3. Generate Some Traffic

Send test notifications to generate traces:

```bash
# Create a test notification
curl -X POST http://localhost:3000/api/v1/notifications \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "type": "email",
    "channels": ["email"],
    "priority": "high",
    "content": {
      "subject": "Test Notification",
      "body": "This is a test"
    }
  }'
```

## Viewing Traces in Jaeger

### Accessing Jaeger UI

1. Navigate to `http://localhost:16686`
2. You'll see the Jaeger search interface

### Finding Traces

#### By Service
1. Select a service from the **Service** dropdown (e.g., `email-service`)
2. Select an operation (e.g., `kafka-consume`)
3. Click **Find Traces**

#### By Time Range
- Adjust the **Lookback** dropdown to search different time periods
- Default is "Last Hour"

#### By Tags
Add tags to filter traces:
- `http.status_code=200` - Only successful HTTP requests
- `error=true` - Only traces with errors
- `notification.id=<id>` - Specific notification

### Trace Visualization

Each trace shows:
- **Service name** (color-coded)
- **Operation name** (span name)
- **Duration** (bar length)
- **Tags** (metadata)
- **Logs** (events within span)

#### Trace Details

Click on a trace to see:
1. **Timeline View**: Visual representation of service calls
2. **Span Details**: Click any span to see:
   - Duration
   - Tags (e.g., `kafka.topic`, `notification.id`)
   - Logs/Events
   - Stack traces (if errors occurred)

## Understanding Traces

### Common Trace Patterns

#### 1. Email Notification Flow

```
notification-service (HTTP POST /api/v1/notifications)
  └─> kafka-publish (topic: notification.created)
        └─> channel-orchestrator (kafka-consume)
              └─> kafka-publish (topic: channel.email.queued)
                    └─> email-service (kafka-consume)
                          ├─> email-delivery (custom span)
                          │   └─> sendgrid-api (circuit breaker)
                          └─> kafka-publish (topic: email.sent)
```

#### 2. Failed Notification with Retry

```
email-service (kafka-consume)
  └─> email-delivery
        ├─> sendgrid-api (failed - connection timeout)
        ├─> DLQ: retry attempt 1
        ├─> sendgrid-api (failed - 500 error)
        ├─> DLQ: retry attempt 2
        ├─> sendgrid-api (success)
        └─> kafka-publish (topic: email.sent)
```

### Key Span Tags

| Tag | Description | Example |
|-----|-------------|---------|
| `service.name` | Service that created the span | `email-service` |
| `kafka.topic` | Kafka topic name | `channel.email.queued` |
| `notification.id` | Notification identifier | `uuid-1234-5678` |
| `http.status_code` | HTTP response code | `200` |
| `error` | Whether an error occurred | `true` |
| `circuit_breaker.state` | Circuit breaker state | `open`, `closed`, `half-open` |

## Custom Instrumentation

### Adding Custom Spans

```typescript
import { withSpan, addSpanEvent, setSpanAttributes } from '@notification-system/utils';

async function processNotification(data: any) {
  return withSpan('process-notification', async () => {
    // Add event markers
    addSpanEvent('validation-start');

    await validateNotification(data);

    addSpanEvent('validation-complete');

    // Add custom attributes
    setSpanAttributes({
      'notification.type': data.type,
      'notification.priority': data.priority,
      'user.id': data.userId
    });

    await sendNotification(data);
  }, {
    // Initial attributes
    'service.operation': 'notification-processing'
  });
}
```

### Wrapping Async Functions

```typescript
import { traceAsync, SpanStatusCode } from '@notification-system/utils';

const sendEmailWithTracing = traceAsync(
  'send-email-operation',
  async (email: string, content: string) => {
    await sgMail.send({ to: email, html: content });
  },
  { 'email.provider': 'sendgrid' }
);

await sendEmailWithTracing('user@example.com', '<h1>Hello</h1>');
```

### Recording Exceptions

```typescript
import { recordException } from '@notification-system/utils';

try {
  await riskyOperation();
} catch (error) {
  recordException(error); // Automatically adds error to active span
  throw error;
}
```

## Circuit Breaker Monitoring

### Viewing Circuit Breaker State

Circuit breaker metrics are available in:

1. **Jaeger Traces**: Look for spans with `circuit_breaker.*` tags
2. **Prometheus Metrics**: `circuit_breaker_state` gauge
3. **Logs**: Circuit state changes are logged

### Circuit Breaker States

- **CLOSED (0)**: Normal operation, requests pass through
- **HALF_OPEN (1)**: Testing if service has recovered
- **OPEN (2)**: Too many failures, requests blocked

### Identifying Circuit Breaker Trips

In Jaeger, search for traces with:
- Tag: `circuit_breaker.state=open`
- Operation: `sendgrid-api`, `twilio-api`, `firebase-messaging-api`

Example circuit breaker trace:
```
email-service
  └─> email-delivery
        └─> sendgrid-api [REJECTED - circuit open]
              └─> fallback executed (queued for retry)
```

## Best Practices

### 1. Use Descriptive Span Names

```typescript
// Good
withSpan('user-notification-validation', async () => { ... });

// Bad
withSpan('process', async () => { ... });
```

### 2. Add Relevant Attributes

```typescript
setSpanAttributes({
  'notification.id': notificationId,
  'notification.channel': 'email',
  'user.id': userId,
  'priority': 'high'
});
```

### 3. Add Events for Key Milestones

```typescript
addSpanEvent('validation-started');
addSpanEvent('api-call-initiated');
addSpanEvent('response-received');
```

### 4. Don't Over-Instrument

- Avoid creating spans for trivial operations (< 1ms)
- Don't add high-cardinality tags (e.g., full email addresses)
- Batch-related operations into single spans

### 5. Use Sampling in Production

Configure sampling rate in production to reduce overhead:

```typescript
initTracing({
  serviceName: 'email-service',
  environment: 'production',
  samplingRate: 0.1 // Sample 10% of requests
});
```

## Troubleshooting

### No Traces Appearing

1. **Check Jaeger is running**:
   ```bash
   docker ps | grep jaeger
   ```

2. **Verify JAEGER_ENDPOINT**:
   ```bash
   echo $JAEGER_ENDPOINT
   # Should output: http://jaeger:14268/api/traces (in Docker)
   # or http://localhost:14268/api/traces (local)
   ```

3. **Check service logs** for tracing initialization:
   ```bash
   docker logs email-service | grep "OpenTelemetry tracing initialized"
   ```

### Traces Missing Spans

- Ensure tracing is initialized **before** other imports
- Check that auto-instrumentation is enabled
- Verify instrumentation packages are installed

### High Latency / Performance Issues

1. **Reduce sampling rate** in production
2. **Disable filesystem instrumentation** (already disabled by default)
3. **Use batch span processor** for high-throughput services

### Jaeger UI Not Loading

1. Check Jaeger health:
   ```bash
   curl http://localhost:14269/
   ```

2. Verify ports are not conflicting:
   ```bash
   netstat -an | grep 16686
   ```

3. Check Docker logs:
   ```bash
   docker logs jaeger
   ```

## Advanced Topics

### Trace Context Propagation

OpenTelemetry automatically propagates trace context through:
- HTTP headers (`traceparent`, `tracestate`)
- Kafka message headers
- gRPC metadata

### Correlating Logs with Traces

Extract trace ID in logs:

```typescript
import { trace } from '@notification-system/utils';

const span = trace.getActiveSpan();
if (span) {
  const traceId = span.spanContext().traceId;
  logger.info('Processing request', { traceId });
}
```

### Exporting to Multiple Backends

Configure multiple exporters:

```typescript
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';

const sdk = new NodeSDK({
  traceExporter: new MultiSpanExporter([
    jaegerExporter,
    new ConsoleSpanExporter() // Also log to console
  ])
});
```

## Metrics Dashboard

Access related monitoring dashboards:

- **Jaeger UI**: http://localhost:16686
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001

## Further Reading

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
- [Distributed Tracing Best Practices](https://opentelemetry.io/docs/concepts/instrumentation/)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
