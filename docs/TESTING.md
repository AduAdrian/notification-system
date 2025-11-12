# Testing Guide

Comprehensive testing documentation for the Notification System microservices.

## Table of Contents

- [Overview](#overview)
- [Test Structure](#test-structure)
- [Running Tests](#running-tests)
- [Writing Tests](#writing-tests)
- [Coverage Requirements](#coverage-requirements)
- [Contract Testing](#contract-testing)
- [CI/CD Integration](#cicd-integration)
- [Best Practices](#best-practices)

## Overview

Our testing strategy follows industry best practices for 2025:

- **Unit Tests**: Test individual components in isolation
- **Integration Tests**: Test API endpoints and service interactions
- **E2E Tests**: Test complete notification flows
- **Contract Tests**: Ensure service compatibility with Pact

**Coverage Requirement**: Minimum 70% across all metrics (branches, functions, lines, statements)

## Test Structure

```
notification-system/
├── tests/
│   ├── fixtures/          # Test data fixtures
│   │   ├── notifications.ts
│   │   └── payloads.ts
│   ├── mocks/             # Mock implementations
│   │   ├── sendgrid.mock.ts
│   │   ├── twilio.mock.ts
│   │   └── firebase.mock.ts
│   ├── helpers/           # Test utilities
│   │   ├── kafka.mock.ts
│   │   ├── database.mock.ts
│   │   └── redis.mock.ts
│   ├── contract/          # Pact contract tests
│   │   ├── notification-orchestrator.pact.test.ts
│   │   └── orchestrator-email.pact.test.ts
│   ├── e2e/               # End-to-end tests
│   │   └── notification-flow.e2e.test.ts
│   └── setup.ts           # Global test setup
└── services/
    └── [service-name]/
        └── src/
            └── __tests__/
                ├── controllers/  # Controller unit tests
                ├── services/     # Service unit tests
                └── integration/  # Integration tests
```

## Running Tests

### All Tests with Coverage

```bash
npm test
```

### Watch Mode (Development)

```bash
npm run test:watch
```

### Unit Tests Only

```bash
npm run test:unit
```

### Integration Tests

```bash
npm run test:integration
```

### E2E Tests

```bash
npm run test:e2e
```

### Contract Tests

```bash
npm run test:contract
```

### CI Mode

```bash
npm run test:ci
```

### Coverage Report

```bash
npm run test:coverage
```

View HTML coverage report: `open coverage/lcov-report/index.html`

### Debug Tests

```bash
npm run test:debug
```

Then attach your debugger to the Node process.

## Writing Tests

### Unit Test Example

```typescript
import { NotificationController } from '../controllers/notification.controller';
import { createTestNotification } from '../../../tests/fixtures/notifications';

describe('NotificationController', () => {
  let controller: NotificationController;
  let mockDbService: MockDatabaseService;

  beforeEach(() => {
    mockDbService = new MockDatabaseService();
    controller = new NotificationController();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should create a notification successfully', async () => {
    const notification = createTestNotification();

    const result = await controller.createNotification(notification);

    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('id');
  });
});
```

### Integration Test Example

```typescript
import request from 'supertest';
import { app } from '../app';

describe('POST /api/v1/notifications', () => {
  it('should create notification and return 201', async () => {
    const response = await request(app)
      .post('/api/v1/notifications')
      .send({
        userId: 'test-user',
        channels: ['email'],
        message: 'Test notification',
      })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty('id');
  });
});
```

### E2E Test Example

```typescript
describe('Complete notification flow', () => {
  it('should process notification from creation to delivery', async () => {
    // 1. Create notification
    const notification = await createNotification({
      userId: 'user-123',
      channels: ['email', 'sms'],
      message: 'Test message',
    });

    // 2. Verify orchestrator routes to channels
    await waitForEvent('channel.email.queued');
    await waitForEvent('channel.sms.queued');

    // 3. Verify channel services send
    await waitForEvent('channel.email.sent');
    await waitForEvent('channel.sms.sent');

    // 4. Verify delivery confirmation
    const finalStatus = await getNotificationStatus(notification.id);
    expect(finalStatus).toBe('delivered');
  });
});
```

### Using Test Fixtures

```typescript
import {
  testNotification,
  urgentNotification,
  createTestNotification,
} from '../../../tests/fixtures/notifications';

// Use predefined fixtures
const notif = testNotification;

// Create custom test data
const customNotif = createTestNotification({
  priority: 'urgent',
  channels: ['sms', 'push'],
});
```

### Using Mocks

```typescript
import { createMockSendGridClient } from '../../../tests/mocks/sendgrid.mock';

describe('EmailService', () => {
  let mockSendGrid: MockSendGridClient;

  beforeEach(() => {
    mockSendGrid = createMockSendGridClient();
  });

  it('should send email via SendGrid', async () => {
    await emailService.send(emailPayload);

    const sentEmails = mockSendGrid.getSentEmails();
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe('user@example.com');
  });

  it('should handle SendGrid errors', async () => {
    mockSendGrid.setShouldFail(true, new Error('API rate limit'));

    await expect(emailService.send(emailPayload)).rejects.toThrow();
  });
});
```

## Coverage Requirements

### Global Thresholds

All services must maintain:

- **Branches**: 70%
- **Functions**: 70%
- **Lines**: 70%
- **Statements**: 70%

### What to Test

**Controllers**:
- All HTTP endpoints
- Request validation
- Error handling
- Response formatting

**Services**:
- Business logic
- Data transformations
- External service calls
- Error scenarios

**Middleware**:
- Authentication
- Authorization
- Validation
- Rate limiting
- Error handling

**Utilities**:
- Helper functions
- Data formatters
- Validators

### What NOT to Test

- Third-party libraries
- Type definitions
- Configuration files
- Auto-generated code

## Contract Testing

### Overview

We use **Pact** for contract testing between microservices.

### Consumer-Driven Contracts

**Consumer**: Service that calls another service
**Provider**: Service that is called

### Writing Contract Tests

```typescript
import { Pact, Matchers } from '@pact-foundation/pact';

const { like, iso8601DateTime } = Matchers;

describe('Notification Service -> Orchestrator Contract', () => {
  const provider = new Pact({
    consumer: 'notification-service',
    provider: 'channel-orchestrator',
    port: 8990,
  });

  beforeAll(() => provider.setup());
  afterEach(() => provider.verify());
  afterAll(() => provider.finalize());

  it('should publish notification.created event', async () => {
    await provider.addInteraction({
      state: 'orchestrator is ready',
      uponReceiving: 'a notification.created event',
      withRequest: {
        method: 'POST',
        path: '/events/notification.created',
        body: {
          type: 'notification.created',
          data: {
            id: like('notif-123'),
            userId: like('user-123'),
            channels: like(['email']),
            message: like('Test message'),
            createdAt: iso8601DateTime(),
          },
        },
      },
      willRespondWith: {
        status: 200,
        body: { success: true },
      },
    });

    // Your test implementation
  });
});
```

### Contract Test Workflow

1. **Consumer writes contract**: Defines expected interaction
2. **Generate pact file**: Contract saved to `pacts/` directory
3. **Provider verifies**: Ensures it satisfies the contract
4. **Share contracts**: Via Pact Broker or version control

### Service Contracts

- `notification-service` → `channel-orchestrator`
- `channel-orchestrator` → `email-service`
- `channel-orchestrator` → `sms-service`
- `channel-orchestrator` → `push-service`
- `channel-orchestrator` → `inapp-service`

## CI/CD Integration

### GitHub Actions Workflow

Tests run automatically on:
- Every push to `master` or `develop`
- Every pull request

### CI Test Process

```yaml
- name: Run tests with coverage
  run: npm run test:ci

- name: Check coverage threshold
  run: |
    if [ -f coverage/lcov.info ]; then
      echo "✅ Coverage report generated"
    else
      exit 1
    fi

- name: Upload coverage to Codecov
  uses: codecov/codecov-action@v3
```

### Coverage Upload

Coverage reports are uploaded to **Codecov** for tracking over time.

### Build Fails If

- Any test fails
- Coverage drops below 70%
- TypeScript compilation errors

## Best Practices

### 1. Test Naming

```typescript
// Good
it('should create notification with valid data', () => {});
it('should reject notification with invalid channel', () => {});

// Bad
it('test 1', () => {});
it('works', () => {});
```

### 2. AAA Pattern

**Arrange - Act - Assert**

```typescript
it('should format email payload correctly', () => {
  // Arrange
  const notification = createTestNotification();

  // Act
  const payload = formatEmailPayload(notification);

  // Assert
  expect(payload.to).toBe('user@example.com');
  expect(payload.subject).toBe(notification.subject);
});
```

### 3. Mock External Dependencies

```typescript
// Mock Kafka
jest.mock('@notification-system/utils', () => ({
  KafkaClient: jest.fn().mockImplementation(() => mockKafkaClient),
}));

// Mock SendGrid
jest.mock('@sendgrid/mail', () => mockSendGridClient);
```

### 4. Clean Up After Tests

```typescript
afterEach(() => {
  jest.clearAllMocks();
  mockKafkaClient.reset();
  mockDbService.reset();
});
```

### 5. Test Error Paths

```typescript
it('should handle database connection errors', async () => {
  mockDb.setShouldFail(true);

  await expect(service.getNotification('id')).rejects.toThrow();
  expect(logger.error).toHaveBeenCalled();
});
```

### 6. Use Fixtures for Complex Data

```typescript
import { multiChannelNotification } from '../../../tests/fixtures/notifications';

it('should route to all channels', async () => {
  await orchestrator.process(multiChannelNotification);

  expect(emailQueue).toHaveLength(1);
  expect(smsQueue).toHaveLength(1);
  expect(pushQueue).toHaveLength(1);
});
```

### 7. Keep Tests Fast

- Unit tests: < 100ms each
- Integration tests: < 1s each
- E2E tests: < 5s each
- Full test suite: < 30s

### 8. One Assertion Per Test (When Possible)

```typescript
// Good
it('should set correct status code', () => {
  expect(response.status).toBe(201);
});

it('should return notification ID', () => {
  expect(response.body.data).toHaveProperty('id');
});

// Acceptable for related assertions
it('should create notification successfully', () => {
  expect(response.status).toBe(201);
  expect(response.body.success).toBe(true);
  expect(response.body.data).toHaveProperty('id');
});
```

### 9. Test Edge Cases

- Empty strings
- Null/undefined values
- Large data sets
- Boundary conditions
- Rate limits
- Timeouts

### 10. Don't Test Implementation Details

```typescript
// Bad - testing internal implementation
it('should call private method', () => {
  expect(service['privateMethod']).toHaveBeenCalled();
});

// Good - testing public behavior
it('should format notification correctly', () => {
  const result = service.formatNotification(data);
  expect(result).toMatchObject(expectedFormat);
});
```

## Troubleshooting

### Tests Timing Out

Increase timeout:
```typescript
it('slow test', async () => {
  // test code
}, 15000); // 15 second timeout
```

### Mock Not Working

Ensure mock is defined before importing:
```typescript
jest.mock('./service');
import { Service } from './service'; // Import AFTER mock
```

### Coverage Not Generated

Check that files are in `collectCoverageFrom` pattern:
```javascript
collectCoverageFrom: [
  'services/**/src/**/*.ts',
  '!**/__tests__/**',
]
```

### Tests Passing Locally But Failing in CI

- Check for race conditions
- Ensure deterministic test data (avoid `Date.now()`)
- Clean up resources properly
- Check environment variables

## Resources

- [Jest Documentation](https://jestjs.io/)
- [Pact Documentation](https://docs.pact.io/)
- [Testing Best Practices](https://testingjavascript.com/)
- [Supertest Guide](https://github.com/visionmedia/supertest)

## Questions?

Contact the development team or create an issue in the repository.
