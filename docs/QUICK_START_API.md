# Quick Start API Guide

Get started with the Notification System API in 5 minutes.

## 1. Start the Services

```bash
# Clone repository
git clone <repository-url>
cd notification-system

# Install dependencies
npm install

# Start all services
npm run dev
```

Services will be available at:
- Notification Service: http://localhost:3000
- In-App Service: http://localhost:3005

## 2. View API Documentation

Open your browser:

- **Notification Service Docs**: http://localhost:3000/api-docs
- **In-App Service Docs**: http://localhost:3005/api-docs

## 3. Get Authentication Token

For testing, you can use:

```bash
# Generate a test JWT token (requires JWT_SECRET from .env)
export JWT_TOKEN="your-test-token"

# Or use API key (for development)
export API_KEY="dev-api-key"
```

## 4. Send Your First Notification

### Using cURL

```bash
curl -X POST http://localhost:3000/api/v1/notifications \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "channels": ["email"],
    "priority": "high",
    "subject": "Welcome!",
    "message": "Thanks for signing up with our platform!"
  }'
```

### Using JavaScript

```javascript
const response = await fetch('http://localhost:3000/api/v1/notifications', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${JWT_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    userId: 'user123',
    channels: ['email'],
    priority: 'high',
    subject: 'Welcome!',
    message: 'Thanks for signing up!',
  }),
});

const result = await response.json();
console.log('Notification ID:', result.data.id);
```

### Response

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

## 5. Check Notification Status

```bash
curl http://localhost:3000/api/v1/notifications/notif_1234567890abcdef \
  -H "Authorization: Bearer $JWT_TOKEN"
```

## 6. Get User Notifications

```bash
curl "http://localhost:3000/api/v1/notifications/user/user123?limit=10" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

## 7. Connect to Real-Time Notifications

### HTML + JavaScript

```html
<!DOCTYPE html>
<html>
<head>
  <title>Notification Demo</title>
</head>
<body>
  <h1>Real-Time Notifications</h1>
  <div id="notifications"></div>

  <script>
    const userId = 'user123';
    const eventSource = new EventSource(`http://localhost:3005/events/${userId}`);

    eventSource.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'notification') {
        const div = document.getElementById('notifications');
        div.innerHTML += `
          <div>
            <strong>${data.title}</strong>
            <p>${data.message}</p>
          </div>
        `;
      }
    });
  </script>
</body>
</html>
```

## Common Use Cases

### 1. Send Multi-Channel Notification

```bash
curl -X POST http://localhost:3000/api/v1/notifications \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "channels": ["email", "sms", "push", "in_app"],
    "priority": "urgent",
    "subject": "Security Alert",
    "message": "New login detected from unknown device"
  }'
```

### 2. Schedule a Notification

```bash
curl -X POST http://localhost:3000/api/v1/notifications \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "channels": ["email"],
    "subject": "Reminder",
    "message": "Your appointment is tomorrow at 3 PM",
    "metadata": {
      "scheduledAt": "2025-11-14T15:00:00Z"
    }
  }'
```

### 3. Use Template

```bash
curl -X POST http://localhost:3000/api/v1/notifications \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "channels": ["email"],
    "message": "Template will be used",
    "metadata": {
      "templateId": "welcome-email",
      "customData": {
        "userName": "John Doe",
        "activationLink": "https://example.com/activate/123"
      }
    }
  }'
```

## Health Checks

```bash
# Check service health
curl http://localhost:3000/health

# Check metrics
curl http://localhost:3000/metrics
```

## Error Handling

### Rate Limit Exceeded (429)

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Please retry after 60 seconds"
  }
}
```

**Solution**: Wait for the time specified in `Retry-After` header.

### Validation Error (400)

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": [
      {
        "field": "channels",
        "message": "At least one channel is required"
      }
    ]
  }
}
```

**Solution**: Fix the validation errors listed in `details`.

### Unauthorized (401)

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing authentication token"
  }
}
```

**Solution**: Provide a valid JWT token or API key.

## Testing in Swagger UI

1. Open http://localhost:3000/api-docs
2. Click "Authorize" button
3. Enter your Bearer token or API key
4. Click any endpoint
5. Click "Try it out"
6. Modify the example
7. Click "Execute"

## Next Steps

- Read the [Complete API Reference](./API_REFERENCE.md)
- Check out [Code Examples](./API_REFERENCE.md#code-examples)
- Learn about [Rate Limiting](./API_REFERENCE.md#rate-limiting)
- Explore [Authentication](./API_REFERENCE.md#authentication)
- Set up [Webhooks](./API_REFERENCE.md#webhooks--events)

## Support

- Documentation: http://localhost:3000/api-docs
- Email: support@notification-system.com
- GitHub Issues: [repository-url]

## Common Commands

```bash
# Start services
npm run dev

# Run tests
npm test

# View logs
docker logs notification-service

# Check health
curl http://localhost:3000/health

# View API docs
open http://localhost:3000/api-docs

# Get OpenAPI spec
curl http://localhost:3000/api-docs.json
```

Happy coding!
