# Testing Guide for Notification System

This document provides comprehensive information about the testing suite for the notification system microservices.

## Table of Contents

- [Overview](#overview)
- [Test Structure](#test-structure)
- [Running Tests](#running-tests)
- [Test Coverage](#test-coverage)
- [Test Types](#test-types)
- [Writing Tests](#writing-tests)
- [Best Practices](#best-practices)
- [CI/CD Integration](#cicd-integration)

## Overview

The notification system uses **Jest** as the primary testing framework with **ts-jest** for TypeScript support. The testing suite includes:

- **Unit Tests**: Test individual functions, classes, and modules in isolation
- **Integration Tests**: Test API endpoints and service interactions
- **E2E Tests**: Test complete notification flows across the entire system
- **Mocking**: Comprehensive mocks for Kafka, PostgreSQL, and Redis

## Test Structure

```
notification-system/
├── tests/
│   ├── setup.ts                          # Global test setup
│   ├── helpers/
│   │   ├── kafka.mock.ts                 # Mock Kafka client
│   │   ├── database.mock.ts              # Mock database service
│   │   └── redis.mock.ts                 # Mock Redis service
│   └── e2e/
│       └── notification-flow.e2e.test.ts # End-to-end tests
├── services/
│   ├── notification-service/
│   │   ├── jest.config.js                # Service-specific Jest config
│   │   └── src/__tests__/
│   │       ├── controllers/              # Controller unit tests
│   │       ├── services/                 # Service unit tests
│   │       └── integration/              # Integration tests
│   ├── channel-orchestrator/
│   │   ├── jest.config.js
│   │   └── src/__tests__/
│   ├── email-service/
│   │   ├── jest.config.js
│   │   └── src/__tests__/
│   ├── sms-service/
│   │   ├── jest.config.js
│   │   └── src/__tests__/
│   ├── push-service/
│   │   ├── jest.config.js
│   │   └── src/__tests__/
│   └── inapp-service/
│       ├── jest.config.js
│       └── src/__tests__/
└── jest.config.js                        # Root Jest configuration
```

## Running Tests

### Root Level (All Tests)

```bash
# Run all tests across all services
npm test

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Run only E2E tests
npm run test:e2e

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage

# Run tests in all workspaces
npm run test:workspaces
```

### Service Level

Run tests for a specific service:

```bash
# Notification Service
cd services/notification-service
npm test
npm run test:unit
npm run test:integration
npm run test:watch
npm run test:coverage

# Channel Orchestrator
cd services/channel-orchestrator
npm test

# Email Service
cd services/email-service
npm test

# SMS Service
cd services/sms-service
npm test

# Push Service
cd services/push-service
npm test

# In-App Service
cd services/inapp-service
npm test
```

## Test Coverage

Coverage thresholds are configured in `jest.config.js`:

```javascript
coverageThreshold: {
  global: {
    branches: 70,
    functions: 70,
    lines: 70,
    statements: 70,
  },
}
```

View coverage reports:
- HTML: `coverage/lcov-report/index.html`
- Terminal: Shown after running `npm run test:coverage`

## Test Types

### 1. Unit Tests

Located in: `services/*/src/__tests__/`

Test individual components in isolation with mocked dependencies.

**Example**: Controller test
```typescript
describe('NotificationController', () => {
  it('should create a notification successfully', async () => {
    const notificationRequest = {
      userId: 'user-123',
      channels: [NotificationChannel.EMAIL],
      message: 'Test message',
    };

    await controller.createNotification(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(201);
    expect(mockDbService.count()).toBe(1);
  });
});
```

### 2. Integration Tests

Located in: `services/*/src/__tests__/integration/`

Test API endpoints and service interactions using Supertest.

**Example**: API integration test
```typescript
describe('POST /api/v1/notifications', () => {
  it('should create a notification with all fields', async () => {
    const response = await request(app)
      .post('/api/v1/notifications')
      .send(notificationRequest)
      .expect(201);

    expect(response.body.success).toBe(true);
  });
});
```

### 3. E2E Tests

Located in: `tests/e2e/`

Test complete notification flows from creation to delivery.

**Example**: E2E test
```typescript
describe('Complete Notification Flow', () => {
  it('should process notification from creation to delivery', async () => {
    // Create notification
    await mockDbService.createNotification(notification);

    // Publish event
    await mockKafkaClient.publishEvent('notification.created', event);

    // Verify all channels processed
    expect(mockKafkaClient.getEventsByTopic('email.sent')).toHaveLength(1);
  });
});
```

## Writing Tests

### Test Structure (AAA Pattern)

Follow the Arrange-Act-Assert pattern:

```typescript
it('should do something', async () => {
  // Arrange: Set up test data and mocks
  const testData = { ... };
  mockService.method.mockResolvedValue(result);

  // Act: Execute the code under test
  const result = await functionUnderTest(testData);

  // Assert: Verify the results
  expect(result).toEqual(expectedValue);
  expect(mockService.method).toHaveBeenCalledWith(testData);
});
```

### Using Mocks

#### Kafka Mock
```typescript
import { MockKafkaClient } from '../../../../../tests/helpers/kafka.mock';

const mockKafkaClient = new MockKafkaClient();

// Verify events published
expect(mockKafkaClient.getEventsByTopic('notification.created')).toHaveLength(1);

// Simulate receiving an event
await mockKafkaClient.simulateEvent('notification.created', event);

// Reset mock state
mockKafkaClient.reset();
```

#### Database Mock
```typescript
import { MockDatabaseService } from '../../../../../tests/helpers/database.mock';

const mockDbService = new MockDatabaseService();

// Create test data
await mockDbService.createNotification(notification);

// Verify data
expect(mockDbService.count()).toBe(1);

// Query data
const result = await mockDbService.getNotification('id');
```

#### Redis Mock
```typescript
import { MockRedisService } from '../../../../../tests/helpers/redis.mock';

const mockRedisService = new MockRedisService();

// Cache data
await mockRedisService.cacheNotification('id', notification);

// Verify cache
expect(mockRedisService.getCacheSize()).toBe(1);

// Test rate limiting
const allowed = await mockRedisService.checkRateLimit('user-id', 10, 60);
```

## Best Practices

### 1. Test Isolation
- Each test should be independent and not rely on other tests
- Use `beforeEach` and `afterEach` to set up and tear down test state
- Reset mocks between tests

```typescript
beforeEach(() => {
  mockKafkaClient.reset();
  mockDbService.reset();
  mockRedisService.reset();
});
```

### 2. Clear Test Names
Use descriptive test names that explain what is being tested:

```typescript
// Good
it('should return 404 when notification does not exist', async () => { ... });

// Bad
it('test notification', async () => { ... });
```

### 3. Test Edge Cases
Test not just the happy path, but also:
- Error scenarios
- Boundary conditions
- Invalid inputs
- Race conditions
- Timeout scenarios

### 4. Minimize Test Setup
- Use factory functions for creating test data
- Share common setup in `beforeEach` hooks
- Use helper functions for repetitive tasks

### 5. Mock External Dependencies
Always mock:
- Database connections
- External APIs (SendGrid, Twilio, Firebase)
- Kafka producers/consumers
- Redis clients
- File system operations

### 6. Async/Await Best Practices
```typescript
// Good
it('should handle async operations', async () => {
  const result = await asyncFunction();
  expect(result).toBe(expected);
});

// Bad - missing await
it('should handle async operations', async () => {
  asyncFunction(); // Missing await
  expect(result).toBe(expected); // May not work
});
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Test Suite

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm run test:coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
```

### Pre-commit Hooks

Add to `.husky/pre-commit`:

```bash
#!/bin/sh
npm run test:unit
npm run lint
```

## Common Issues and Solutions

### Issue: Tests timing out
**Solution**: Increase timeout in `jest.config.js` or individual tests:
```typescript
jest.setTimeout(30000); // 30 seconds
```

### Issue: Mock not working
**Solution**: Ensure mock is defined before importing the module:
```typescript
jest.mock('module-name', () => ({ ... }));
const module = require('module-name');
```

### Issue: TypeScript path mapping not working
**Solution**: Configure `moduleNameMapper` in `jest.config.js`:
```javascript
moduleNameMapper: {
  '^@notification-system/types$': '<rootDir>/shared/types',
  '^@notification-system/utils$': '<rootDir>/shared/utils',
}
```

## Additional Resources

- [Jest Documentation](https://jestjs.io/)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [TypeScript Jest Guide](https://kulshekhar.github.io/ts-jest/)

## Contributing

When adding new features:
1. Write tests first (TDD approach recommended)
2. Ensure all tests pass before submitting PR
3. Maintain or improve code coverage
4. Follow the existing test structure and naming conventions
5. Document any new testing utilities or mocks

---

For questions or issues with tests, please open an issue or contact the development team.
