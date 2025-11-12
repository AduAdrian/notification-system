# API Documentation

## Authentication

All API requests require a JWT token in the Authorization header:

```
Authorization: Bearer <token>
```

## Base URL

```
http://localhost:3000/api/v1
```

## Endpoints

### Create Notification

**POST** `/notifications`

Create a new notification that will be sent through specified channels.

**Request Body:**

```json
{
  "userId": "user-123",
  "channels": ["email", "sms", "push", "in_app"],
  "priority": "high",
  "subject": "Welcome to our platform!",
  "message": "Thank you for signing up. We're excited to have you!",
  "metadata": {
    "templateId": "welcome-template",
    "tags": ["onboarding", "welcome"],
    "customData": {
      "userName": "John Doe"
    }
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "pending",
    "createdAt": "2025-01-15T10:30:00Z"
  },
  "metadata": {
    "requestId": "req-123",
    "timestamp": "2025-01-15T10:30:00Z"
  }
}
```

**Status Codes:**
- `201` - Notification created successfully
- `400` - Invalid request body
- `401` - Unauthorized
- `429` - Rate limit exceeded
- `500` - Internal server error

---

### Get Notification

**GET** `/notifications/:id`

Retrieve a specific notification by ID.

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "userId": "user-123",
    "channels": ["email", "sms"],
    "priority": "high",
    "status": "sent",
    "subject": "Welcome!",
    "message": "Thank you for signing up.",
    "metadata": {
      "templateId": "welcome-template"
    },
    "createdAt": "2025-01-15T10:30:00Z",
    "updatedAt": "2025-01-15T10:31:00Z"
  }
}
```

**Status Codes:**
- `200` - Success
- `404` - Notification not found
- `401` - Unauthorized

---

### Get User Notifications

**GET** `/notifications/user/:userId`

Retrieve all notifications for a specific user.

**Query Parameters:**
- `limit` (optional): Number of results (default: 50, max: 100)
- `offset` (optional): Pagination offset (default: 0)

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "userId": "user-123",
      "channels": ["email"],
      "priority": "medium",
      "status": "delivered",
      "subject": "Your order has shipped",
      "message": "Track your package here...",
      "createdAt": "2025-01-15T10:30:00Z"
    }
  ],
  "metadata": {
    "total": 1,
    "limit": 50,
    "offset": 0
  }
}
```

---

### Update Notification Status

**PATCH** `/notifications/:id/status`

Update the status of a notification.

**Request Body:**

```json
{
  "status": "delivered"
}
```

**Valid Statuses:**
- `pending`
- `queued`
- `sent`
- `delivered`
- `failed`
- `bounced`

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "delivered"
  }
}
```

---

## In-App Notifications (SSE)

### Connect to In-App Stream

**GET** `http://localhost:3004/events/:userId`

Establish a Server-Sent Events (SSE) connection to receive real-time in-app notifications.

**Example Client Code:**

```javascript
const eventSource = new EventSource('http://localhost:3004/events/user-123');

eventSource.onmessage = (event) => {
  const notification = JSON.parse(event.data);
  console.log('New notification:', notification);

  if (notification.type === 'notification') {
    showNotification(notification.title, notification.message);
  }
};

eventSource.onerror = (error) => {
  console.error('SSE connection error:', error);
};
```

**Event Format:**

```json
{
  "type": "notification",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "New Message",
  "message": "You have a new message from John",
  "actionUrl": "/messages/123",
  "iconUrl": "/icons/message.png",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

---

## Rate Limiting

- **Limit**: 150 requests per hour per user
- **Headers**:
  - `X-RateLimit-Limit`: Maximum requests allowed
  - `X-RateLimit-Remaining`: Requests remaining
  - `X-RateLimit-Reset`: Time when limit resets (Unix timestamp)

When rate limit is exceeded:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests, please try again later"
  }
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  }
}
```

**Common Error Codes:**
- `VALIDATION_ERROR` - Invalid request data
- `UNAUTHORIZED` - Missing or invalid authentication
- `NOT_FOUND` - Resource not found
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `INTERNAL_SERVER_ERROR` - Server error

---

## Notification Channels

| Channel | Type | Description |
|---------|------|-------------|
| `email` | Email | Send via SendGrid/AWS SES |
| `sms` | SMS | Send via Twilio/AWS SNS |
| `push` | Push | Send via Firebase/APNs |
| `in_app` | In-App | Send via SSE real-time |

---

## Notification Priorities

| Priority | Description | Use Case |
|----------|-------------|----------|
| `low` | Low priority | Marketing emails |
| `medium` | Medium priority | General updates |
| `high` | High priority | Important alerts |
| `urgent` | Urgent | Critical alerts |

---

## Examples

### Send Welcome Email

```bash
curl -X POST http://localhost:3000/api/v1/notifications \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "channels": ["email"],
    "subject": "Welcome!",
    "message": "Thank you for signing up!",
    "metadata": {
      "templateId": "welcome"
    }
  }'
```

### Send Multi-Channel Alert

```bash
curl -X POST http://localhost:3000/api/v1/notifications \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "channels": ["email", "sms", "push", "in_app"],
    "priority": "urgent",
    "subject": "Security Alert",
    "message": "Unusual activity detected on your account",
    "metadata": {
      "tags": ["security", "alert"]
    }
  }'
```
