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

## Getting Started

Coming soon...

## License

MIT
