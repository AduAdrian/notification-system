# Notification System API Reference

Complete API documentation for the Notification System microservices.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Service Discovery](#service-discovery)
- [API Documentation Endpoints](#api-documentation-endpoints)
- [Notification Service API](#notification-service-api)
- [In-App Service API](#in-app-service-api)
- [Code Examples](#code-examples)
- [Error Handling](#error-handling)
- [Webhooks & Events](#webhooks--events)

---

## Overview

The Notification System is a microservices-based platform for multi-channel notification delivery supporting Email, SMS, Push, and In-App notifications.

### Architecture

- **notification-service** (port 3000) - Main API gateway for creating and managing notifications
- **inapp-service** (port 3005) - Real-time in-app notification delivery via Server-Sent Events
- **channel-orchestrator** - Internal service for routing notifications to appropriate channels
- **email-service** - Internal email delivery service
- **sms-service** - Internal SMS delivery service
- **push-service** - Internal push notification delivery service

### Base URLs

| Environment | Notification Service | In-App Service |
|-------------|---------------------|----------------|
| Development | http://localhost:3000 | http://localhost:3005 |
| Staging | https://staging.notification-system.com | https://staging-inapp.notification-system.com |
| Production | https://api.notification-system.com | https://inapp.notification-system.com |

---

## Authentication

The Notification System supports two authentication methods:

### 1. Bearer Token (JWT)

Used for user-initiated requests.

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Token Requirements:**
- Algorithm: HS256 or RS256
- Expiration: Maximum 24 hours
- Required claims: `sub` (user ID), `exp` (expiration)

### 2. API Key

Used for service-to-service authentication.

```http
X-API-Key: your-api-key-here
```

**Getting an API Key:**
1. Contact your system administrator
2. API keys are scoped to specific environments
3. Rotate keys every 90 days

### Example Authentication

```bash
# Using Bearer Token
curl -X POST https://api.notification-system.com/api/v1/notifications \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": "user123", "channels": ["email"], "message": "Hello"}'

# Using API Key
curl -X POST https://api.notification-system.com/api/v1/notifications \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"userId": "user123", "channels": ["email"], "message": "Hello"}'
```

---

## Rate Limiting

Rate limits protect the API from abuse and ensure fair usage.

### Limits by Endpoint

| Endpoint | Rate Limit | Window |
|----------|------------|--------|
| POST /api/v1/notifications | 100 requests | 1 minute |
| GET /api/v1/notifications/:id | 300 requests | 1 minute |
| GET /api/v1/notifications/user/:userId | 200 requests | 1 minute |
| SSE /events/:userId | 10 connections | per user |

### Rate Limit Headers

Every response includes rate limit information:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1699876543
```

### Handling Rate Limits

When rate limited, you'll receive a `429 Too Many Requests` response:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Please retry after 60 seconds"
  }
}
```

**Best Practices:**
- Implement exponential backoff
- Cache responses when possible
- Use webhooks instead of polling
- Monitor `X-RateLimit-Remaining` header

---

## Service Discovery

### Health Checks

All services expose health check endpoints for monitoring and orchestration.

```bash
# Notification Service
curl http://localhost:3000/health

# Response
{
  "status": "healthy",
  "service": "notification-service",
  "timestamp": "2025-11-13T10:30:00Z",
  "checks": {
    "database": "up",
    "redis": "up",
    "kafka": "up"
  },
  "uptime": 3600,
  "memory": {
    "rss": 52428800,
    "heapTotal": 20971520,
    "heapUsed": 15728640
  }
}
```

### Kubernetes Probes

```yaml
# Readiness Probe
readinessProbe:
  httpGet:
    path: /ready
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 5

# Liveness Probe
livenessProbe:
  httpGet:
    path: /live
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10
```

### Metrics

Prometheus-compatible metrics are exposed at `/metrics`:

```bash
curl http://localhost:3000/metrics
```

---

## API Documentation Endpoints

Interactive API documentation is available via Swagger UI:

### Notification Service
- **Swagger UI**: http://localhost:3000/api-docs
- **OpenAPI JSON**: http://localhost:3000/api-docs.json
- **OpenAPI YAML**: [services/notification-service/openapi.yaml](../services/notification-service/openapi.yaml)

### In-App Service
- **Swagger UI**: http://localhost:3005/api-docs
- **OpenAPI JSON**: http://localhost:3005/api-docs.json
- **OpenAPI YAML**: [services/inapp-service/openapi.yaml](../services/inapp-service/openapi.yaml)

---

## Notification Service API

Main API for creating and managing notifications.

### Create Notification

Creates a new notification for delivery across one or more channels.

**Endpoint:** `POST /api/v1/notifications`

**Request:**

```json
{
  "userId": "user123",
  "channels": ["email", "sms", "push", "in_app"],
  "priority": "high",
  "subject": "Welcome to our platform!",
  "message": "Thank you for signing up. Let's get started!",
  "metadata": {
    "templateId": "welcome-email",
    "tags": ["onboarding", "welcome"],
    "customData": {
      "userName": "John Doe"
    },
    "scheduledAt": "2025-11-14T15:00:00Z",
    "expiresAt": "2025-11-15T15:00:00Z"
  }
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": "notif_1234567890abcdef",
    "status": "pending",
    "createdAt": "2025-11-13T10:30:00Z"
  },
  "metadata": {
    "requestId": "req_abcdef123456",
    "timestamp": "2025-11-13T10:30:00Z"
  }
}
```

### Get Notification

Retrieves details of a specific notification.

**Endpoint:** `GET /api/v1/notifications/:id`

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": "notif_1234567890abcdef",
    "userId": "user123",
    "channels": ["email", "sms"],
    "priority": "high",
    "status": "delivered",
    "subject": "Welcome to our platform!",
    "message": "Thank you for signing up",
    "metadata": {
      "templateId": "welcome-email",
      "tags": ["onboarding"]
    },
    "createdAt": "2025-11-13T10:30:00Z",
    "updatedAt": "2025-11-13T10:30:15Z"
  }
}
```

### Get User Notifications

Retrieves all notifications for a specific user with pagination.

**Endpoint:** `GET /api/v1/notifications/user/:userId`

**Query Parameters:**
- `limit` (integer, optional): Maximum number of results (1-100, default: 50)
- `offset` (integer, optional): Number of results to skip (default: 0)
- `status` (string, optional): Filter by status
- `channel` (string, optional): Filter by channel

**Example:** `GET /api/v1/notifications/user/user123?limit=20&offset=0&status=delivered`

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": "notif_001",
      "userId": "user123",
      "channels": ["email"],
      "priority": "high",
      "status": "delivered",
      "subject": "Welcome!",
      "message": "Thanks for signing up",
      "createdAt": "2025-11-13T10:30:00Z",
      "updatedAt": "2025-11-13T10:30:15Z"
    }
  ],
  "metadata": {
    "total": 42,
    "limit": 20,
    "offset": 0
  }
}
```

### Update Notification Status

Updates the status of an existing notification.

**Endpoint:** `PATCH /api/v1/notifications/:id/status`

**Request:**

```json
{
  "status": "delivered"
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": "notif_1234567890abcdef",
    "status": "delivered"
  }
}
```

---

## In-App Service API

Real-time in-app notification delivery using Server-Sent Events (SSE).

### Establish SSE Connection

Opens a persistent connection for receiving real-time notifications.

**Endpoint:** `GET /events/:userId`

**Connection Headers:**

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

### JavaScript Client Example

```javascript
// Establish SSE connection
const eventSource = new EventSource('http://localhost:3005/events/user123');

// Handle connection established
eventSource.addEventListener('open', () => {
  console.log('Connected to notification stream');
});

// Handle incoming notifications
eventSource.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'connected') {
    console.log('Connection confirmed');
  } else if (data.type === 'notification') {
    console.log('New notification:', data);
    displayNotification(data.title, data.message, data.actionUrl);
  }
});

// Handle errors and reconnection
eventSource.addEventListener('error', (error) => {
  console.error('Connection error:', error);
  // EventSource automatically reconnects
});

// Close connection when needed
// eventSource.close();
```

### Event Types

#### Connected Event

Sent immediately after connection is established.

```
data: {"type":"connected"}
```

#### Notification Event

Sent when a new notification is delivered.

```
id: notif_123
data: {
  "type": "notification",
  "id": "notif_123",
  "title": "New Message",
  "message": "You have a new message from John",
  "actionUrl": "/messages/456",
  "iconUrl": "https://cdn.example.com/icons/message.png",
  "timestamp": "2025-11-13T10:30:00Z"
}
```

### Get User Notifications

Retrieves stored in-app notifications (for catching up after being offline).

**Endpoint:** `GET /notifications/:userId`

**Query Parameters:**
- `limit` (integer): Max results (default: 50)
- `offset` (integer): Pagination offset (default: 0)
- `unreadOnly` (boolean): Only unread notifications (default: false)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": "notif_001",
      "userId": "user123",
      "title": "New Message",
      "message": "You have a new message from John",
      "actionUrl": "/messages/456",
      "iconUrl": "https://cdn.example.com/icons/message.png",
      "read": false,
      "createdAt": "2025-11-13T10:30:00Z"
    }
  ],
  "metadata": {
    "total": 42,
    "unread": 5,
    "limit": 50,
    "offset": 0
  }
}
```

---

## Code Examples

### cURL Examples

#### Create Email Notification

```bash
curl -X POST http://localhost:3000/api/v1/notifications \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "channels": ["email"],
    "priority": "high",
    "subject": "Welcome!",
    "message": "Thanks for signing up",
    "metadata": {
      "templateId": "welcome-email"
    }
  }'
```

#### Get Notification Details

```bash
curl -X GET http://localhost:3000/api/v1/notifications/notif_123 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### JavaScript/TypeScript Examples

#### Using Fetch API

```typescript
interface NotificationRequest {
  userId: string;
  channels: ('email' | 'sms' | 'push' | 'in_app')[];
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  subject?: string;
  message: string;
  metadata?: {
    templateId?: string;
    tags?: string[];
    customData?: Record<string, any>;
  };
}

async function createNotification(request: NotificationRequest) {
  const response = await fetch('http://localhost:3000/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${JWT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error.message);
  }

  return await response.json();
}

// Usage
try {
  const result = await createNotification({
    userId: 'user123',
    channels: ['email', 'push'],
    priority: 'high',
    subject: 'Important Update',
    message: 'Your account has been verified!',
    metadata: {
      templateId: 'account-verified',
      tags: ['account', 'verification'],
    },
  });

  console.log('Notification created:', result.data.id);
} catch (error) {
  console.error('Failed to create notification:', error);
}
```

#### Using Axios

```typescript
import axios from 'axios';

const apiClient = axios.create({
  baseURL: 'http://localhost:3000',
  headers: {
    'Authorization': `Bearer ${JWT_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

// Create notification
const createNotification = async (data: NotificationRequest) => {
  try {
    const response = await apiClient.post('/api/v1/notifications', data);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('API Error:', error.response?.data);
    }
    throw error;
  }
};

// Get user notifications
const getUserNotifications = async (userId: string, limit = 50, offset = 0) => {
  const response = await apiClient.get(
    `/api/v1/notifications/user/${userId}`,
    { params: { limit, offset } }
  );
  return response.data;
};
```

### Python Examples

```python
import requests
from typing import Dict, List, Optional

class NotificationClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url
        self.headers = {
            'X-API-Key': api_key,
            'Content-Type': 'application/json'
        }

    def create_notification(
        self,
        user_id: str,
        channels: List[str],
        message: str,
        subject: Optional[str] = None,
        priority: str = 'medium',
        metadata: Optional[Dict] = None
    ) -> Dict:
        """Create a new notification"""
        payload = {
            'userId': user_id,
            'channels': channels,
            'message': message,
            'priority': priority
        }

        if subject:
            payload['subject'] = subject
        if metadata:
            payload['metadata'] = metadata

        response = requests.post(
            f'{self.base_url}/api/v1/notifications',
            headers=self.headers,
            json=payload
        )
        response.raise_for_status()
        return response.json()

    def get_notification(self, notification_id: str) -> Dict:
        """Get notification by ID"""
        response = requests.get(
            f'{self.base_url}/api/v1/notifications/{notification_id}',
            headers=self.headers
        )
        response.raise_for_status()
        return response.json()

    def get_user_notifications(
        self,
        user_id: str,
        limit: int = 50,
        offset: int = 0
    ) -> Dict:
        """Get notifications for a user"""
        params = {'limit': limit, 'offset': offset}
        response = requests.get(
            f'{self.base_url}/api/v1/notifications/user/{user_id}',
            headers=self.headers,
            params=params
        )
        response.raise_for_status()
        return response.json()

# Usage
client = NotificationClient(
    base_url='http://localhost:3000',
    api_key='your-api-key-here'
)

# Send multi-channel notification
result = client.create_notification(
    user_id='user123',
    channels=['email', 'sms', 'push'],
    subject='Security Alert',
    message='New login detected from unknown device',
    priority='urgent',
    metadata={
        'templateId': 'security-alert',
        'customData': {
            'device': 'iPhone 15',
            'location': 'New York, US'
        }
    }
)

print(f"Notification created: {result['data']['id']}")
```

### React Hook Example

```typescript
import { useState, useEffect } from 'react';

interface Notification {
  id: string;
  title: string;
  message: string;
  actionUrl?: string;
  iconUrl?: string;
  timestamp: string;
}

export function useNotifications(userId: string) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const eventSource = new EventSource(
      `http://localhost:3005/events/${userId}`
    );

    eventSource.addEventListener('open', () => {
      setIsConnected(true);
    });

    eventSource.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'notification') {
        setNotifications((prev) => [data, ...prev]);

        // Show browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(data.title, {
            body: data.message,
            icon: data.iconUrl,
          });
        }
      }
    });

    eventSource.addEventListener('error', () => {
      setIsConnected(false);
    });

    return () => {
      eventSource.close();
    };
  }, [userId]);

  return { notifications, isConnected };
}

// Usage in component
function NotificationBell() {
  const { notifications, isConnected } = useNotifications('user123');

  return (
    <div>
      <span className={isConnected ? 'connected' : 'disconnected'}>
        {notifications.length} new notifications
      </span>
      <ul>
        {notifications.map((notif) => (
          <li key={notif.id}>
            <a href={notif.actionUrl}>
              <strong>{notif.title}</strong>
              <p>{notif.message}</p>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

## Error Handling

All errors follow a consistent format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": [
      {
        "field": "channels",
        "message": "At least one channel is required"
      }
    ]
  }
}
```

### HTTP Status Codes

| Code | Description | When to Expect |
|------|-------------|----------------|
| 200 | OK | Successful GET/PATCH request |
| 201 | Created | Successful POST request |
| 400 | Bad Request | Invalid parameters or validation error |
| 401 | Unauthorized | Missing or invalid authentication |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server-side error |
| 503 | Service Unavailable | Service is down or unhealthy |

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| VALIDATION_ERROR | 400 | Request validation failed |
| INVALID_CHANNEL | 400 | Unsupported notification channel |
| UNAUTHORIZED | 401 | Authentication required |
| INVALID_TOKEN | 401 | JWT token is invalid or expired |
| FORBIDDEN | 403 | Insufficient permissions |
| NOT_FOUND | 404 | Resource not found |
| RATE_LIMIT_EXCEEDED | 429 | Too many requests |
| INTERNAL_ERROR | 500 | Unexpected server error |
| SERVICE_UNAVAILABLE | 503 | Service is temporarily down |

### Error Handling Best Practices

```typescript
async function sendNotification(data: NotificationRequest) {
  try {
    const response = await fetch('http://localhost:3000/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const result = await response.json();

    if (!response.ok) {
      // Handle specific error codes
      switch (result.error.code) {
        case 'RATE_LIMIT_EXCEEDED':
          const retryAfter = response.headers.get('Retry-After');
          console.log(`Rate limited. Retry after ${retryAfter} seconds`);
          // Implement exponential backoff
          break;

        case 'VALIDATION_ERROR':
          console.error('Validation errors:', result.error.details);
          // Show validation errors to user
          break;

        case 'UNAUTHORIZED':
          // Refresh token and retry
          await refreshAuthToken();
          return sendNotification(data);

        default:
          console.error('API error:', result.error.message);
      }

      throw new Error(result.error.message);
    }

    return result;
  } catch (error) {
    // Handle network errors
    if (error instanceof TypeError) {
      console.error('Network error:', error);
      // Retry with exponential backoff
    }
    throw error;
  }
}
```

---

## Webhooks & Events

The system can send webhook notifications for delivery events.

### Event Types

| Event | Description |
|-------|-------------|
| notification.created | New notification created |
| notification.queued | Notification queued for delivery |
| notification.sent | Notification sent to provider |
| notification.delivered | Notification successfully delivered |
| notification.failed | Notification delivery failed |
| notification.bounced | Email bounced |

### Webhook Payload

```json
{
  "event": "notification.delivered",
  "timestamp": "2025-11-13T10:30:15Z",
  "data": {
    "notificationId": "notif_123",
    "userId": "user123",
    "channel": "email",
    "status": "delivered"
  }
}
```

### Webhook Security

Webhooks include an HMAC signature for verification:

```http
X-Webhook-Signature: sha256=abc123...
X-Webhook-Timestamp: 1699876543
```

Verify signature:

```typescript
import crypto from 'crypto';

function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature.replace('sha256=', '')),
    Buffer.from(expectedSignature)
  );
}
```

---

## Support

For questions, issues, or feature requests:

- Email: support@notification-system.com
- GitHub: [repository-url]
- Slack: #notification-system

## Additional Resources

- [OpenAPI Specifications](../services/)
- [Architecture Documentation](../notification_system_architecture.md)
- [Performance Guide](../PERFORMANCE_OPTIMIZATIONS_SUMMARY.md)
- [Testing Guide](../TESTING.md)
