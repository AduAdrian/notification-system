# Quick Test Reference

## Running Tests

```bash
# All tests
npm test

# Specific service
cd services/notification-service && npm test

# Watch mode (auto-rerun)
npm run test:watch

# Coverage report
npm run test:coverage

# Specific test file
npx jest path/to/test.test.ts

# Specific test case
npx jest -t "test name pattern"
```

## Test Commands Cheat Sheet

| Command | Description |
|---------|-------------|
| `npm test` | Run all tests |
| `npm run test:unit` | Run unit tests only |
| `npm run test:integration` | Run integration tests only |
| `npm run test:e2e` | Run E2E tests only |
| `npm run test:watch` | Run in watch mode |
| `npm run test:coverage` | Generate coverage report |
| `npm run test:workspaces` | Run tests in all services |

## Writing Tests - Quick Template

```typescript
import { MockKafkaClient } from '../../../../../tests/helpers/kafka.mock';
import { MockDatabaseService } from '../../../../../tests/helpers/database.mock';
import { MockRedisService } from '../../../../../tests/helpers/redis.mock';

describe('Feature Name', () => {
  let mockKafkaClient: MockKafkaClient;
  let mockDbService: MockDatabaseService;
  let mockRedisService: MockRedisService;

  beforeEach(() => {
    mockKafkaClient = new MockKafkaClient();
    mockDbService = new MockDatabaseService();
    mockRedisService = new MockRedisService();
  });

  afterEach(() => {
    mockKafkaClient.reset();
    mockDbService.reset();
    mockRedisService.reset();
  });

  it('should do something', async () => {
    // Arrange
    const testData = { ... };

    // Act
    const result = await functionUnderTest(testData);

    // Assert
    expect(result).toBe(expected);
  });
});
```

## Common Assertions

```typescript
// Basic assertions
expect(value).toBe(expected);
expect(value).toEqual(expected);
expect(value).toBeTruthy();
expect(value).toBeFalsy();
expect(value).toBeNull();
expect(value).toBeUndefined();
expect(value).toBeDefined();

// Arrays
expect(array).toHaveLength(3);
expect(array).toContain(item);
expect(array).toContainEqual({ id: '123' });

// Objects
expect(object).toHaveProperty('key');
expect(object).toMatchObject({ key: 'value' });

// Functions
expect(fn).toHaveBeenCalled();
expect(fn).toHaveBeenCalledWith(arg1, arg2);
expect(fn).toHaveBeenCalledTimes(2);

// Async
await expect(promise).resolves.toBe(value);
await expect(promise).rejects.toThrow('error');
```

## Mock Helpers

### Kafka Mock

```typescript
// Publish event
await mockKafkaClient.publishEvent('topic', event);

// Get events by topic
const events = mockKafkaClient.getEventsByTopic('topic');

// Get last event
const lastEvent = mockKafkaClient.getLastEvent('topic');

// Simulate incoming event
await mockKafkaClient.simulateEvent('topic', event);

// Reset
mockKafkaClient.reset();
```

### Database Mock

```typescript
// Create
await mockDbService.createNotification(notification);

// Read
const notification = await mockDbService.getNotification('id');
const notifications = await mockDbService.getUserNotifications('userId', 10, 0);

// Update
await mockDbService.updateNotificationStatus('id', NotificationStatus.SENT);

// Helpers
const count = mockDbService.count();
const all = mockDbService.getAll();
mockDbService.reset();
```

### Redis Mock

```typescript
// Cache
await mockRedisService.cacheNotification('id', notification);

// Retrieve
const cached = await mockRedisService.getNotification('id');

// Delete
await mockRedisService.deleteNotification('id');

// Rate limit
const allowed = await mockRedisService.checkRateLimit('userId', 10, 60);

// Helpers
const size = mockRedisService.getCacheSize();
const hasKey = mockRedisService.hasKey('notification:id');
mockRedisService.reset();
```

## Debugging Tests

```bash
# Run single test in debug mode
node --inspect-brk node_modules/.bin/jest path/to/test.test.ts

# Verbose output
npx jest --verbose

# Show test names only
npx jest --listTests

# Clear cache
npx jest --clearCache
```

## Coverage Reports

After running `npm run test:coverage`:

- **HTML Report:** `coverage/lcov-report/index.html`
- **Terminal:** Displayed after test run
- **CI/CD:** `coverage/lcov.info`

## File Locations

- Global mocks: `tests/helpers/`
- E2E tests: `tests/e2e/`
- Unit tests: `services/*/src/__tests__/`
- Integration tests: `services/*/src/__tests__/integration/`
- Jest config: `jest.config.js` (root and each service)

## Best Practices Checklist

- [ ] Test follows AAA pattern (Arrange, Act, Assert)
- [ ] Descriptive test name (should... when...)
- [ ] Mocks are reset in `afterEach`
- [ ] Async operations use `async/await`
- [ ] Edge cases and errors are tested
- [ ] No hardcoded sleeps or timeouts
- [ ] Tests are isolated (no dependencies between tests)
- [ ] Coverage maintains 70%+ threshold

## Need Help?

See full documentation in `TESTING.md`
