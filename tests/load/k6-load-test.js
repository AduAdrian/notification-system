import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

/**
 * K6 Load Testing Script for Notification System
 * Tests various endpoints under different load scenarios
 */

// Custom metrics
const errorRate = new Rate('errors');
const notificationCreationTrend = new Trend('notification_creation_duration');
const notificationRetrievalTrend = new Trend('notification_retrieval_duration');
const apiCallCounter = new Counter('api_calls_total');

// Test configuration
export const options = {
  // Scenarios for different load patterns
  scenarios: {
    // Smoke test - verify system works with minimal load
    smoke_test: {
      executor: 'constant-vus',
      vus: 5,
      duration: '1m',
      tags: { test_type: 'smoke' },
      exec: 'smokeTest',
    },

    // Load test - normal expected load
    load_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 50 },  // Ramp up to 50 users
        { duration: '5m', target: 50 },  // Stay at 50 users
        { duration: '2m', target: 100 }, // Ramp up to 100 users
        { duration: '5m', target: 100 }, // Stay at 100 users
        { duration: '2m', target: 0 },   // Ramp down to 0 users
      ],
      tags: { test_type: 'load' },
      exec: 'loadTest',
      startTime: '1m',
    },

    // Stress test - push system beyond normal load
    stress_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 100 },  // Ramp up to 100 users
        { duration: '5m', target: 100 },  // Stay at 100 users
        { duration: '2m', target: 200 },  // Ramp up to 200 users
        { duration: '5m', target: 200 },  // Stay at 200 users
        { duration: '2m', target: 300 },  // Ramp up to 300 users
        { duration: '5m', target: 300 },  // Stay at 300 users
        { duration: '5m', target: 0 },    // Ramp down to 0 users
      ],
      tags: { test_type: 'stress' },
      exec: 'stressTest',
      startTime: '17m',
    },

    // Spike test - sudden burst of traffic
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 500 }, // Spike to 500 users
        { duration: '1m', target: 500 },  // Stay at 500 users
        { duration: '10s', target: 0 },   // Drop to 0 users
      ],
      tags: { test_type: 'spike' },
      exec: 'spikeTest',
      startTime: '44m',
    },

    // Soak test - sustained load over time
    soak_test: {
      executor: 'constant-vus',
      vus: 50,
      duration: '30m',
      tags: { test_type: 'soak' },
      exec: 'soakTest',
      startTime: '46m',
    },
  },

  // Thresholds - define success criteria
  thresholds: {
    // 95% of requests should complete within 500ms
    http_req_duration: ['p(95)<500', 'p(99)<1000'],

    // Error rate should be less than 1%
    errors: ['rate<0.01'],

    // 95% of requests should receive first byte within 200ms
    http_req_waiting: ['p(95)<200'],

    // Connection time should be under 100ms
    http_req_connecting: ['p(95)<100'],

    // Custom metrics thresholds
    notification_creation_duration: ['p(95)<600'],
    notification_retrieval_duration: ['p(95)<300'],
  },

  // Summary configuration
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

// Configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_VERSION = '/api/v1';
const API_URL = `${BASE_URL}${API_VERSION}`;

// Test data
const testUsers = Array.from({ length: 1000 }, (_, i) => `user-${i}`);
const notificationTypes = ['email', 'sms', 'push', 'inapp'];
const priorities = ['low', 'medium', 'high', 'urgent'];

// Helper function to get random item from array
function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// Helper function to generate test notification
function generateNotification() {
  return {
    userId: randomItem(testUsers),
    channels: [randomItem(notificationTypes)],
    priority: randomItem(priorities),
    subject: `Test Notification ${Date.now()}`,
    message: 'This is a test notification for load testing',
    metadata: {
      testId: __VU,
      iteration: __ITER,
      timestamp: new Date().toISOString(),
    },
  };
}

// Smoke test - basic functionality check
export function smokeTest() {
  group('Health Check', () => {
    const res = http.get(`${BASE_URL}/health`);
    check(res, {
      'health check status is 200': (r) => r.status === 200,
      'health check is healthy': (r) => JSON.parse(r.body).status === 'healthy',
    });
    errorRate.add(res.status !== 200);
    apiCallCounter.add(1);
  });

  sleep(1);
}

// Load test - normal operations
export function loadTest() {
  const userId = randomItem(testUsers);

  group('Create Notification', () => {
    const notification = generateNotification();
    const res = http.post(
      `${API_URL}/notifications`,
      JSON.stringify(notification),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const success = check(res, {
      'notification created': (r) => r.status === 201 || r.status === 200,
      'response time < 600ms': (r) => r.timings.duration < 600,
    });

    errorRate.add(!success);
    notificationCreationTrend.add(res.timings.duration);
    apiCallCounter.add(1);
  });

  sleep(1);

  group('Get User Notifications', () => {
    const res = http.get(`${API_URL}/notifications/user/${userId}?limit=10&offset=0`);

    const success = check(res, {
      'notifications retrieved': (r) => r.status === 200,
      'response time < 300ms': (r) => r.timings.duration < 300,
      'has notifications array': (r) => {
        try {
          return Array.isArray(JSON.parse(r.body).notifications);
        } catch (e) {
          return false;
        }
      },
    });

    errorRate.add(!success);
    notificationRetrievalTrend.add(res.timings.duration);
    apiCallCounter.add(1);
  });

  sleep(2);
}

// Stress test - high load
export function stressTest() {
  const userId = randomItem(testUsers);

  group('Rapid Notification Creation', () => {
    const batch = Array.from({ length: 5 }, () => generateNotification());

    batch.forEach((notification) => {
      const res = http.post(
        `${API_URL}/notifications`,
        JSON.stringify(notification),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );

      check(res, {
        'notification created under stress': (r) => r.status === 201 || r.status === 200,
      });

      errorRate.add(res.status !== 201 && res.status !== 200);
      apiCallCounter.add(1);
    });
  });

  sleep(0.5);
}

// Spike test - sudden traffic burst
export function spikeTest() {
  const notification = generateNotification();

  const res = http.post(
    `${API_URL}/notifications`,
    JSON.stringify(notification),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );

  check(res, {
    'spike test notification created': (r) => r.status === 201 || r.status === 200,
    'spike response time < 1s': (r) => r.timings.duration < 1000,
  });

  errorRate.add(res.status !== 201 && res.status !== 200);
  apiCallCounter.add(1);
}

// Soak test - sustained load
export function soakTest() {
  const userId = randomItem(testUsers);

  // Mix of operations
  const operations = [
    () => {
      const notification = generateNotification();
      return http.post(
        `${API_URL}/notifications`,
        JSON.stringify(notification),
        { headers: { 'Content-Type': 'application/json' } }
      );
    },
    () => http.get(`${API_URL}/notifications/user/${userId}?limit=10&offset=0`),
    () => http.get(`${BASE_URL}/health`),
  ];

  const operation = randomItem(operations);
  const res = operation();

  check(res, {
    'soak test successful': (r) => r.status === 200 || r.status === 201,
  });

  errorRate.add(res.status !== 200 && res.status !== 201);
  apiCallCounter.add(1);

  sleep(1);
}

// Teardown function
export function teardown(data) {
  console.log('Load test completed');
}

// Custom summary output
export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'summary.json': JSON.stringify(data),
    'summary.html': htmlReport(data),
  };
}

function textSummary(data, options) {
  // Custom text summary formatting
  return `
==============================================
  K6 Load Test Summary
==============================================

Test Duration: ${data.state.testRunDurationMs / 1000}s

HTTP Metrics:
  Total Requests: ${data.metrics.http_reqs.values.count}
  Request Rate: ${data.metrics.http_reqs.values.rate.toFixed(2)}/s

  Request Duration:
    - Average: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms
    - Median: ${data.metrics.http_req_duration.values.med.toFixed(2)}ms
    - P95: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms
    - P99: ${data.metrics.http_req_duration.values['p(99)'].toFixed(2)}ms
    - Max: ${data.metrics.http_req_duration.values.max.toFixed(2)}ms

  Error Rate: ${(data.metrics.errors.values.rate * 100).toFixed(2)}%

Custom Metrics:
  Notification Creation (P95): ${data.metrics.notification_creation_duration?.values['p(95)']?.toFixed(2) || 'N/A'}ms
  Notification Retrieval (P95): ${data.metrics.notification_retrieval_duration?.values['p(95)']?.toFixed(2) || 'N/A'}ms

Threshold Results:
${Object.entries(data.metrics)
  .filter(([_, metric]) => metric.thresholds)
  .map(([name, metric]) => {
    const passed = Object.values(metric.thresholds).every(t => t.ok);
    return `  ${passed ? '✓' : '✗'} ${name}`;
  })
  .join('\n')}

==============================================
  `;
}

function htmlReport(data) {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>K6 Load Test Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
    th { background-color: #4CAF50; color: white; }
    .pass { color: green; }
    .fail { color: red; }
  </style>
</head>
<body>
  <h1>K6 Load Test Report</h1>
  <pre>${textSummary(data)}</pre>
</body>
</html>
  `;
}
