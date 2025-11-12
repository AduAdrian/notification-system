# Client Notification System

A scalable, event-driven, microservices-based notification system for multi-channel client notifications.

## Overview

This system provides reliable notification delivery across multiple channels:
- Email notifications (SendGrid/AWS SES)
- SMS notifications (Twilio/AWS SNS)
- Push notifications (Firebase/APNs)
- In-app notifications (SSE/WebSocket)

## Architecture

See [notification_system_architecture.md](./notification_system_architecture.md) for detailed architecture documentation.

## Technology Stack

- **Runtime**: Node.js / Go / Python
- **Orchestration**: Kubernetes
- **Message Queue**: Apache Kafka
- **Databases**: PostgreSQL, MongoDB, Redis, InfluxDB
- **Communication**: REST API, gRPC, SSE

## Project Structure

```
notification-system/
├── services/              # Microservices
│   ├── notification-service/
│   ├── channel-orchestrator/
│   ├── email-service/
│   ├── sms-service/
│   ├── push-service/
│   └── inapp-service/
├── shared/               # Shared libraries
├── infrastructure/       # K8s configs, Terraform
├── docs/                # Documentation
└── tests/               # Integration tests
```

## Development Workflow

This project uses **git worktree** for parallel development:

```bash
# Main repository (production)
cd notification-system

# Development worktree
git worktree add ../notification-system-dev develop

# Service-specific worktrees
git worktree add ../notification-system-email feature/email-service
git worktree add ../notification-system-sms feature/sms-service
```

## 🚀 Quick Deploy (100% FREE)

### One-Click Deploy to Render:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/AduAdrian/notification-system)

**Or Manual:**

1. **Sign up**: https://render.com (FREE)
2. **Connect GitHub repo**: AduAdrian/notification-system
3. **Deploy Blueprint**: Render auto-detects `render.yaml`
4. **Setup Databases**: https://aiven.io (FREE PostgreSQL, Redis, Kafka)
5. **Configure ENV vars** in Render Dashboard
6. **Done!** Services live in 5-10 minutes

📖 **Full Guide**: [docs/CLOUD_DEPLOYMENT.md](./docs/CLOUD_DEPLOYMENT.md)

---

## 🏠 Local Development

**With Docker:**
```bash
docker-compose up -d
```

**Without Docker:**
```bash
npm install --workspaces
npm run dev
```

📖 **Full Guide**: [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)

---

## 📚 Documentation

- **[API Documentation](./docs/API.md)** - Complete API reference
- **[Cloud Deployment](./docs/CLOUD_DEPLOYMENT.md)** - Free cloud setup
- **[Local Deployment](./docs/DEPLOYMENT.md)** - Docker & local setup
- **[Architecture](./notification_system_architecture.md)** - System design
- **[Worktree Workflow](./WORKTREE_WORKFLOW.md)** - Git workflow

---

## 🌐 Live Demo

After deployment:
- **API**: `https://notification-api.onrender.com`
- **Health**: `https://notification-api.onrender.com/health`
- **SSE**: `https://inapp-service.onrender.com/events/:userId`

## License

MIT
