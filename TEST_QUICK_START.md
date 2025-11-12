# Testing Quick Start Guide

## Run Tests NOW

### Full Test Suite with Coverage
```bash
npm test
```

### Watch Mode (Auto-rerun on changes)
```bash
npm run test:watch
```

### Only Unit Tests (Fast)
```bash
npm run test:unit
```

### Only Integration Tests
```bash
npm run test:integration
```

### Only E2E Tests
```bash
npm run test:e2e
```

### Contract Tests (Pact)
```bash
npm run test:contract
```

### CI Mode (For GitHub Actions)
```bash
npm run test:ci
```

## View Coverage

```bash
npm run test:coverage
```

Open coverage report:
- **Windows**: `start coverage/lcov-report/index.html`
- **Mac/Linux**: `open coverage/lcov-report/index.html`

## Test Files Location

```
services/
├── notification-service/src/__tests__/
│   ├── controllers/          # API controller tests
│   ├── services/             # Business logic tests
│   ├── middleware/           # Middleware tests
│   └── integration/          # API integration tests
├── channel-orchestrator/src/__tests__/
│   └── orchestrator.test.ts  # Routing logic tests
├── email-service/src/__tests__/
│   └── email.service.test.ts # Email delivery tests
├── sms-service/src/__tests__/
│   └── sms.service.test.ts   # SMS delivery tests
├── push-service/src/__tests__/
│   └── push.service.test.ts  # Push notification tests
└── inapp-service/src/__tests__/
    └── inapp.service.test.ts # In-app delivery tests

tests/
├── e2e/                       # End-to-end tests
├── contract/                  # Pact contract tests
├── fixtures/                  # Reusable test data
├── mocks/                     # Mock implementations
└── helpers/                   # Test utilities
```

## Current Test Stats

- **Total Tests**: 82
- **Test Suites**: 12
- **Execution Time**: ~8 seconds
- **Coverage Target**: 70%
- **Coverage Status**: Infrastructure complete, needs additional unit tests

## Well-Tested Components

- Channel Orchestrator: 97% coverage
- Notification Controller: 87% coverage
- Email/SMS/Push/InApp Services: Comprehensive tests
- Validation Middleware: 100% coverage
- Error Middleware: 100% coverage

## Quick Test Examples

### Run Single Test File
```bash
npm test -- orchestrator.test.ts
```

### Run Tests Matching Pattern
```bash
npm test -- --testNamePattern="should create notification"
```

### Run with Verbose Output
```bash
npm run test:verbose
```

### Debug a Failing Test
```bash
npm run test:debug
```
Then attach debugger on port 9229

## Test Fixtures Usage

```typescript
import {
  testNotification,
  urgentNotification,
  createTestNotification,
} from '../../../tests/fixtures/notifications';

// Use predefined fixture
const notif = testNotification;

// Create custom test data
const customNotif = createTestNotification({
  priority: 'urgent',
  channels: ['sms', 'push'],
});
```

## Mock External Services

```typescript
import { createMockSendGridClient } from '../../../tests/mocks/sendgrid.mock';

const mockSendGrid = createMockSendGridClient();

// Test success
await emailService.send(payload);
expect(mockSendGrid.getSentEmails()).toHaveLength(1);

// Test failure
mockSendGrid.setShouldFail(true);
await expect(emailService.send(payload)).rejects.toThrow();
```

## Coverage Thresholds

All services must maintain:
- **Branches**: 70%
- **Functions**: 70%
- **Lines**: 70%
- **Statements**: 70%

Build fails if coverage drops below threshold.

## Common Issues

### Tests timing out?
Increase timeout:
```typescript
it('slow test', async () => {
  // test code
}, 15000); // 15 second timeout
```

### Mock not working?
Mock must be defined before import:
```typescript
jest.mock('./service');
import { Service } from './service'; // After mock
```

### Need to skip a test?
```typescript
it.skip('test to skip', () => {});
```

### Run only one test?
```typescript
it.only('only this test', () => {});
```

## Documentation

Full documentation: `docs/TESTING.md`

## Help

Questions? Check:
1. `docs/TESTING.md` - Comprehensive guide
2. `TESTING_IMPLEMENTATION_SUMMARY.md` - What's implemented
3. Test files themselves - Examples of patterns

---

**Ready to test?** Run `npm test` now!
