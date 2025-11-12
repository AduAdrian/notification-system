# Error Handling & Dead Letter Queue (DLQ) Guide

This guide explains the error handling strategies, Dead Letter Queue (DLQ) pattern, and retry mechanisms implemented in the notification system.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Dead Letter Queue Pattern](#dead-letter-queue-pattern)
- [Retry Strategy](#retry-strategy)
- [Circuit Breaker Pattern](#circuit-breaker-pattern)
- [Error Classification](#error-classification)
- [Monitoring DLQ](#monitoring-dlq)
- [Reprocessing DLQ Messages](#reprocessing-dlq-messages)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

The notification system implements a robust error handling strategy with:

1. **Automatic Retry** with exponential backoff for transient failures
2. **Dead Letter Queue (DLQ)** for messages that fail after retries
3. **Circuit Breaker** to prevent cascading failures
4. **Error Classification** to distinguish retryable vs non-retryable errors

## Architecture

### Error Handling Flow

```
┌─────────────────┐
│  Message Arrives │
└────────┬─────────┘
         │
         ▼
┌─────────────────┐
│  Process Message │
└────────┬─────────┘
         │
         ▼
    ┌────────┐
    │Success?│
    └───┬────┘
        │
   ┌────┴────┐
   │Yes      │No
   │         │
   ▼         ▼
┌──────┐  ┌────────────┐
│ Done │  │ Retryable? │
└──────┘  └─────┬──────┘
                │
           ┌────┴────┐
           │Yes      │No
           │         │
           ▼         ▼
      ┌─────────┐  ┌─────────┐
      │ Retry   │  │Send to  │
      │ (max 3) │  │   DLQ   │
      └────┬────┘  └─────────┘
           │
           ▼
      ┌─────────┐
      │Max      │
      │Retries? │
      └────┬────┘
           │
      ┌────┴────┐
      │Yes      │No
      │         │
      ▼         ▼
   ┌─────┐   ┌──────┐
   │ DLQ │   │Retry │
   └─────┘   └──────┘
```

## Dead Letter Queue Pattern

### What is DLQ?

A Dead Letter Queue is a separate Kafka topic where messages that fail processing are sent after all retry attempts are exhausted. This prevents:
- Message loss
- Blocking of message queue
- Infinite retry loops
- Service degradation

### DLQ Topics

Each service has its own DLQ topic:

| Service | Primary Topic | DLQ Topic |
|---------|--------------|-----------|
| Email Service | `channel.email.queued` | `channel.email.queued.dlq` |
| SMS Service | `channel.sms.queued` | `channel.sms.queued.dlq` |
| Push Service | `channel.push.queued` | `channel.push.queued.dlq` |
| In-App Service | `channel.inapp.queued` | `channel.inapp.queued.dlq` |
| Notification Service | `notification.created` | `notification.created.dlq` |

### DLQ Message Metadata

Messages in DLQ contain additional headers:

```typescript
{
  'x-original-topic': 'channel.email.queued',
  'x-retry-count': '3',
  'x-first-attempt': '1704067200000',
  'x-last-attempt': '1704067260000',
  'x-error-message': 'SendGrid API timeout',
  'x-error-type': 'TimeoutError',
  'x-dlq-timestamp': '1704067261000'
}
```

## Retry Strategy

### Configuration

```env
# .env
DLQ_ENABLED=true
DLQ_MAX_RETRIES=3
DLQ_RETRY_DELAY_MS=1000
```

### Exponential Backoff

Retry delays increase exponentially with jitter to prevent thundering herd:

| Attempt | Base Delay | With Jitter (0-30%) | Example |
|---------|------------|---------------------|---------|
| 1 | 1s | 1.0s - 1.3s | 1.1s |
| 2 | 2s | 2.0s - 2.6s | 2.2s |
| 3 | 4s | 4.0s - 5.2s | 4.5s |
| Max | 60s | Capped at 60s | 60s |

Formula:
```
delay = min(baseDelay * 2^retryCount + random(0, 0.3 * delay), 60000ms)
```

### Implementation Example

```typescript
const kafkaClient = new KafkaClientWithDLQ(
  brokers,
  'email-service',
  {
    enabled: true,
    maxRetries: 3,
    retryDelayMs: 1000,
    dlqTopicSuffix: '.dlq',
    metrics,
  }
);
```

## Circuit Breaker Pattern

### Purpose

Circuit breakers protect external services (SendGrid, Twilio, Firebase) from cascading failures by:
1. Detecting high failure rates
2. Temporarily blocking requests to failing services
3. Allowing services time to recover
4. Testing recovery with half-open state

### Configuration

```env
CIRCUIT_BREAKER_ENABLED=true
CIRCUIT_BREAKER_THRESHOLD=0.5          # Open at 50% failure rate
CIRCUIT_BREAKER_TIMEOUT=30000          # 30s request timeout
CIRCUIT_BREAKER_RESET_TIMEOUT=60000    # 60s before retry
```

### Circuit States

#### Closed (Normal)
- Requests pass through normally
- Failures are counted
- Opens if failure rate exceeds threshold

#### Open (Failing)
- All requests immediately rejected
- Fallback executed (queue for retry)
- After reset timeout, transitions to half-open

#### Half-Open (Testing)
- Limited requests allowed through
- If successful: transitions to closed
- If failed: returns to open

### Example

```typescript
// Circuit breaker wraps SendGrid API
const sendEmailWithCircuitBreaker = createHttpCircuitBreaker(
  'sendgrid-api',
  async (emailData) => await sgMail.send(emailData),
  metrics
);

// Use the circuit breaker
try {
  await sendEmailWithCircuitBreaker({ to: 'user@example.com', ... });
} catch (error) {
  // Circuit open or request failed
  // Message will be retried via DLQ
}
```

## Error Classification

### Retryable Errors (Temporary)

These errors trigger retry logic:

- **Network Errors**: `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`
- **Timeout Errors**: Request timeouts
- **5xx Server Errors**: `500`, `502`, `503`, `504`
- **Rate Limit Errors**: `429 Too Many Requests`
- **Service Unavailable**: Circuit breaker open

**Action**: Retry with exponential backoff

### Non-Retryable Errors (Permanent)

These errors go directly to DLQ:

- **Validation Errors**: Invalid email format, phone number
- **Parse Errors**: Malformed JSON, corrupt data
- **Schema Errors**: Missing required fields
- **4xx Client Errors**: `400`, `401`, `403`, `404`, `422`
- **Invalid Credentials**: Wrong API keys

**Action**: Send to DLQ immediately

### Implementation

```typescript
private isRetryableError(error: Error): boolean {
  const errorMessage = error.message.toLowerCase();
  const errorName = error.name.toLowerCase();

  // Non-retryable patterns
  const nonRetryablePatterns = [
    'validation',
    'parse',
    'schema',
    'invalid',
    'malformed',
    'unauthorized',
    'forbidden',
    'not found',
    '400', '401', '403', '404', '422',
  ];

  for (const pattern of nonRetryablePatterns) {
    if (errorMessage.includes(pattern) || errorName.includes(pattern)) {
      return false;
    }
  }

  return true; // Everything else is retryable
}
```

## Monitoring DLQ

### Metrics

DLQ metrics are exposed via Prometheus:

```promql
# Total messages in DLQ
notification_dead_letter_queue_total{channel="email",reason="max_retries"}

# Circuit breaker state
circuit_breaker_state{name="sendgrid-api"}

# Retry attempts
notification_retry_total{channel="email",attempt="1"}
```

### Grafana Dashboard

Access the DLQ dashboard at: http://localhost:3001

Key panels:
- DLQ message rate by channel
- Retry distribution
- Circuit breaker state timeline
- Error rate by type

### Checking DLQ via CLI

```bash
# List DLQ topics
docker exec -it kafka kafka-topics --list --bootstrap-server localhost:9092 | grep dlq

# Consume DLQ messages
docker exec -it kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic channel.email.queued.dlq \
  --from-beginning \
  --property print.headers=true \
  --property print.key=true
```

### DLQ Alerts

Configure Prometheus alerts:

```yaml
# alerts/dlq_alerts.yml
groups:
  - name: dlq
    rules:
      - alert: HighDLQRate
        expr: rate(notification_dead_letter_queue_total[5m]) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High DLQ rate detected"
          description: "{{ $labels.channel }} channel DLQ rate is {{ $value }}/sec"

      - alert: CircuitBreakerOpen
        expr: circuit_breaker_state > 1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Circuit breaker open for {{ $labels.name }}"
```

## Reprocessing DLQ Messages

### Manual Reprocessing

#### Option 1: Via Code

```typescript
// Subscribe to DLQ topic
await kafkaClient.subscribeToDLQ(
  'channel.email.queued',
  async (event, metadata) => {
    console.log('Reprocessing DLQ message:', metadata);

    // Fix the issue (e.g., update API key, fix data)
    // Then reprocess
    await handleEmailQueue(event);
  }
);
```

#### Option 2: Via Kafka CLI

```bash
# Read messages from DLQ
docker exec -it kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic channel.email.queued.dlq \
  --from-beginning > dlq_messages.txt

# Fix issues in code/config

# Republish to original topic
cat dlq_messages.txt | docker exec -i kafka kafka-console-producer \
  --bootstrap-server localhost:9092 \
  --topic channel.email.queued
```

#### Option 3: Via Custom Script

```typescript
// scripts/reprocess-dlq.ts
import { KafkaClientWithDLQ } from '@notification-system/utils';

const client = new KafkaClientWithDLQ(brokers, 'dlq-reprocessor');

await client.subscribeToDLQ('channel.email.queued', async (event, metadata) => {
  console.log(`Reprocessing notification ${metadata.notificationId}`);

  try {
    // Validate data is now correct
    if (isValid(event)) {
      // Republish to original topic
      await client.publishEvent('channel.email.queued', event);
      console.log('Successfully reprocessed');
    } else {
      console.error('Still invalid, skipping');
    }
  } catch (error) {
    console.error('Failed to reprocess:', error);
  }
});
```

### Automated Reprocessing

For transient failures, set up automatic DLQ reprocessing:

```typescript
// Run as a separate service
const dlqReprocessor = new DLQReprocessor({
  reprocessAfter: 3600000, // 1 hour
  maxAge: 86400000, // 24 hours
  batchSize: 10,
});

await dlqReprocessor.start();
```

## Best Practices

### 1. Monitor DLQ Size

Set up alerts when DLQ grows unexpectedly:
- Spike in DLQ messages indicates systemic issues
- Gradual growth indicates configuration problems

### 2. Regular DLQ Analysis

Periodically analyze DLQ messages:
```bash
# Weekly DLQ report
docker exec kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --describe --all-groups | grep dlq
```

### 3. Set Appropriate Retry Limits

- **Too few retries**: Valid messages end up in DLQ
- **Too many retries**: Delays processing of other messages

Recommended:
- **Email**: 3 retries (SendGrid usually recovers quickly)
- **SMS**: 5 retries (Twilio can have longer outages)
- **Push**: 3 retries (Firebase is generally reliable)

### 4. Separate Validation Errors

Don't retry validation errors:
```typescript
if (error.name === 'ValidationError') {
  // Log and move to DLQ immediately
  logger.error('Validation failed:', error);
  await sendToDLQ(message, error);
  return; // Don't retry
}
```

### 5. Include Diagnostic Information

Add context to DLQ messages:
```typescript
const metadata = {
  originalTopic,
  retryCount,
  firstAttempt,
  lastAttempt,
  errorMessage: error.message,
  errorType: error.name,
  errorStack: error.stack, // For debugging
  serviceName: 'email-service',
  serviceVersion: process.env.SERVICE_VERSION,
};
```

### 6. Circuit Breaker Configuration

Tune circuit breaker for each service:

```typescript
// High-availability service (strict)
createCircuitBreaker(sendgridCall, {
  errorThresholdPercentage: 0.3, // Open at 30% failure
  volumeThreshold: 5,             // After just 5 requests
  resetTimeout: 30000,            // Try again after 30s
});

// Less critical service (lenient)
createCircuitBreaker(analyticsCall, {
  errorThresholdPercentage: 0.8, // Open at 80% failure
  volumeThreshold: 20,            // After 20 requests
  resetTimeout: 120000,           // Wait 2 minutes
});
```

## Troubleshooting

### Messages Stuck in Retry Loop

**Symptoms**: Same message retried repeatedly, never succeeds or goes to DLQ

**Causes**:
- Bug in retry logic
- Error not properly classified
- Infinite loop in error handler

**Solution**:
1. Check retry counter in message headers
2. Verify `isRetryableError` logic
3. Add max retry check in code
4. Manually move to DLQ

### DLQ Growing Rapidly

**Symptoms**: DLQ topic size increasing quickly

**Causes**:
- External service down (SendGrid, Twilio)
- Invalid API credentials
- Data validation issues
- Circuit breaker stuck open

**Solution**:
1. Check external service status
2. Verify API credentials
3. Review recent error logs
4. Check circuit breaker metrics
5. Analyze sample DLQ messages

### Circuit Breaker Stuck Open

**Symptoms**: All requests rejected, circuit never closes

**Causes**:
- Service genuinely down
- Reset timeout too long
- Health check failing
- Cascading failures

**Solution**:
1. Verify external service is actually up
2. Reduce reset timeout temporarily
3. Manually close circuit breaker:
   ```typescript
   closeCircuitBreaker(myBreaker);
   ```
4. Check for cascading failures in dependent services

### Messages Lost

**Symptoms**: Messages disappear, not in primary or DLQ topics

**Causes**:
- Kafka partition full
- Consumer offset committed before processing
- Exception swallowed in handler

**Solution**:
1. Disable auto-commit:
   ```typescript
   const consumer = kafka.consumer({
     groupId: 'my-group',
     sessionTimeout: 30000,
     allowAutoTopicCreation: false,
   });
   ```
2. Only commit after successful processing
3. Add comprehensive error logging
4. Enable Kafka transaction logs

## Further Reading

- [Dead Letter Queue Pattern](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
- [Circuit Breaker Pattern - Martin Fowler](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Kafka Consumer Best Practices](https://kafka.apache.org/documentation/#consumerapi)
- [Exponential Backoff and Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
