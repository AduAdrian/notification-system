# In-App Notification Service

Real-time in-app notification delivery service using Server-Sent Events (SSE).

## Features

- Server-Sent Events (SSE) for real-time delivery
- Multiple concurrent connections per user
- Automatic reconnection support
- Message buffering for offline users
- Health check endpoints
- Prometheus metrics

## API Documentation

### Interactive Documentation

**Swagger UI** is available when the service is running:

- Local: http://localhost:3005/api-docs
- Production: https://inapp.notification-system.com/api-docs

### OpenAPI Specification

- YAML: [openapi.yaml](./openapi.yaml)
- JSON: http://localhost:3005/api-docs.json (when running)

## Quick Start

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env` file:

```env
PORT=3005
NODE_ENV=development

# Kafka
KAFKA_BROKERS=localhost:9092
```

### Running the Service

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## API Endpoints

### SSE Connection

Establish a Server-Sent Events connection for real-time notifications:

```javascript
const eventSource = new EventSource('http://localhost:3005/events/user123');

eventSource.addEventListener('open', () => {
  console.log('Connected');
});

eventSource.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  console.log('Notification:', data);
});

eventSource.addEventListener('error', (error) => {
  console.error('Connection error:', error);
});
```

### Get User Notifications

```bash
GET /notifications/:userId?limit=50&offset=0&unreadOnly=false
```

### Health Check

```bash
GET /health
```

### Metrics

```bash
GET /metrics
```

## SSE Event Format

### Connected Event

Sent immediately after connection is established:

```
data: {"type":"connected"}
```

### Notification Event

Sent when a new notification arrives:

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

## Client Examples

### JavaScript/TypeScript

```typescript
class NotificationClient {
  private eventSource: EventSource | null = null;

  connect(userId: string) {
    this.eventSource = new EventSource(
      `http://localhost:3005/events/${userId}`
    );

    this.eventSource.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'connected') {
        console.log('Connected to notification stream');
      } else if (data.type === 'notification') {
        this.handleNotification(data);
      }
    });

    this.eventSource.addEventListener('error', () => {
      console.error('Connection lost, will auto-reconnect');
      // EventSource automatically reconnects
    });
  }

  private handleNotification(notification: any) {
    // Show in-app notification
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(notification.title, {
        body: notification.message,
        icon: notification.iconUrl,
      });
    }
  }

  disconnect() {
    this.eventSource?.close();
  }
}

// Usage
const client = new NotificationClient();
client.connect('user123');
```

### React Hook

```typescript
import { useState, useEffect } from 'react';

interface InAppNotification {
  id: string;
  title: string;
  message: string;
  actionUrl?: string;
  iconUrl?: string;
  timestamp: string;
}

export function useInAppNotifications(userId: string) {
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
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
      }
    });

    eventSource.addEventListener('error', () => {
      setIsConnected(false);
    });

    return () => {
      eventSource.close();
    };
  }, [userId]);

  const clearNotifications = () => {
    setNotifications([]);
  };

  return {
    notifications,
    isConnected,
    clearNotifications,
  };
}

// Component usage
function NotificationBell() {
  const { notifications, isConnected } = useInAppNotifications('user123');

  return (
    <div>
      <span className={isConnected ? 'online' : 'offline'}>
        {notifications.length} notifications
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

### Python Client

```python
import sseclient
import requests
import json

def listen_to_notifications(user_id: str):
    """Listen to SSE notifications for a user"""
    url = f'http://localhost:3005/events/{user_id}'

    response = requests.get(url, stream=True)
    client = sseclient.SSEClient(response)

    for event in client.events():
        data = json.loads(event.data)

        if data['type'] == 'connected':
            print('Connected to notification stream')
        elif data['type'] == 'notification':
            print(f"New notification: {data['title']}")
            print(f"Message: {data['message']}")
            print(f"Action: {data.get('actionUrl', 'N/A')}")

# Usage
listen_to_notifications('user123')
```

## Connection Management

### Reconnection

EventSource automatically reconnects on connection loss:

- Default retry delay: 3 seconds
- Can be customized with `retry` field in SSE

### Multiple Tabs

The service supports multiple concurrent connections per user:

- Each tab/window can have its own SSE connection
- Notifications are delivered to all active connections

### Connection Limits

- Maximum 10 concurrent connections per user
- Oldest connections are closed when limit is exceeded

## Testing

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# Manual SSE testing
curl -N http://localhost:3005/events/user123
```

## Monitoring

### Prometheus Metrics

Available at `/metrics`:

- `inapp_connections_active` - Currently active SSE connections
- `inapp_connections_total` - Total connections established
- `inapp_notifications_sent` - Total notifications sent
- `inapp_notifications_failed` - Failed delivery attempts

### Health Checks

```bash
# Health status
curl http://localhost:3005/health

# Response
{
  "status": "healthy",
  "service": "inapp-service",
  "timestamp": "2025-11-13T10:30:00Z",
  "connections": {
    "active": 1234,
    "total": 5678
  },
  "uptime": 86400
}
```

## Architecture

```
┌──────────┐
│  Client  │
└────┬─────┘
     │ SSE
     ▼
┌─────────────────┐
│  In-App Service │
│   (Port 3005)   │
│                 │
│ • SSE Manager   │
│ • Connection    │
│   Pool          │
└────┬────────────┘
     │
     ▼
┌─────────┐
│ Kafka   │
│ (Events)│
└─────────┘
```

## Troubleshooting

### Connection Not Establishing

1. Check CORS settings
2. Verify firewall rules
3. Check nginx/proxy buffering settings

```nginx
# Disable buffering for SSE
location /events {
    proxy_pass http://inapp-service:3005;
    proxy_buffering off;
    proxy_cache off;
    proxy_set_header Connection '';
    proxy_http_version 1.1;
    chunked_transfer_encoding off;
}
```

### Events Not Received

1. Check Kafka connectivity
2. Verify user ID matches
3. Check service logs

```bash
docker logs inapp-service
```

## Dependencies

- express - Web framework
- kafkajs - Kafka client
- swagger-ui-express - API documentation
- swagger-jsdoc - OpenAPI generation

## Related Services

- [Notification Service](../notification-service/) - Main API gateway
- [Channel Orchestrator](../channel-orchestrator/) - Routing logic

## Documentation

- [Complete API Reference](../../docs/API_REFERENCE.md)
- [Architecture Overview](../../notification_system_architecture.md)

## Support

For issues or questions:
- GitHub Issues: [repository-url]
- Email: support@notification-system.com
- Slack: #notification-system

## License

MIT
