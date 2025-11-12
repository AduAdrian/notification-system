/**
 * Artillery Load Test Processor
 * Custom functions for Artillery load testing scenarios
 */

module.exports = {
  // Initialize processor
  beforeScenario,
  afterScenario,
  beforeRequest,
  afterResponse,

  // Custom functions
  generateNotificationId,
  logNotificationCreated,
  logNotificationsRetrieved,
  logNotificationFetch,
  logStatusUpdate,
};

// Store created notification IDs for later use
const notificationIds = [];
let requestCount = 0;
let errorCount = 0;
let totalResponseTime = 0;

/**
 * Called before each scenario
 */
function beforeScenario(userContext, events, done) {
  userContext.vars.timestamp = Date.now();
  userContext.vars.sessionId = `session-${Math.random().toString(36).substring(7)}`;
  return done();
}

/**
 * Called after each scenario
 */
function afterScenario(userContext, events, done) {
  // Cleanup or logging if needed
  return done();
}

/**
 * Called before each request
 */
function beforeRequest(requestParams, context, ee, next) {
  requestCount++;

  // Add custom headers
  requestParams.headers = requestParams.headers || {};
  requestParams.headers['X-Test-Session'] = context.vars.sessionId;
  requestParams.headers['X-Request-ID'] = `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  return next();
}

/**
 * Called after each response
 */
function afterResponse(requestParams, response, context, ee, next) {
  totalResponseTime += response.timings?.phases?.firstByte || 0;

  // Track errors
  if (response.statusCode >= 400) {
    errorCount++;
    console.error(`Error ${response.statusCode}: ${requestParams.url}`);
  }

  // Log slow requests
  const duration = response.timings?.phases?.firstByte || 0;
  if (duration > 1000) {
    console.warn(`Slow request detected: ${requestParams.url} took ${duration}ms`);
  }

  return next();
}

/**
 * Generate a random notification ID from stored IDs or create a new one
 */
function generateNotificationId(requestParams, context, ee, next) {
  if (notificationIds.length > 0) {
    const randomId = notificationIds[Math.floor(Math.random() * notificationIds.length)];
    context.vars.notificationId = randomId;
  } else {
    // Generate a mock UUID if no IDs are stored yet
    context.vars.notificationId = generateUUID();
  }
  return next();
}

/**
 * Log notification creation and store the ID
 */
function logNotificationCreated(requestParams, response, context, ee, next) {
  if (response.statusCode === 200 || response.statusCode === 201) {
    try {
      const body = JSON.parse(response.body);
      if (body.id) {
        notificationIds.push(body.id);
        console.log(`Notification created: ${body.id}`);

        // Keep only the last 1000 IDs to avoid memory issues
        if (notificationIds.length > 1000) {
          notificationIds.shift();
        }
      }
    } catch (e) {
      console.error('Failed to parse notification creation response', e);
    }
  }
  return next();
}

/**
 * Log notifications retrieval
 */
function logNotificationsRetrieved(requestParams, response, context, ee, next) {
  if (response.statusCode === 200) {
    try {
      const body = JSON.parse(response.body);
      const count = body.notifications?.length || 0;
      console.log(`Retrieved ${count} notifications for user`);
    } catch (e) {
      console.error('Failed to parse notifications list response', e);
    }
  }
  return next();
}

/**
 * Log notification fetch
 */
function logNotificationFetch(requestParams, response, context, ee, next) {
  if (response.statusCode === 200) {
    console.log(`Notification fetched successfully: ${context.vars.notificationId}`);
  } else if (response.statusCode === 404) {
    console.log(`Notification not found: ${context.vars.notificationId}`);
  }
  return next();
}

/**
 * Log status update
 */
function logStatusUpdate(requestParams, response, context, ee, next) {
  if (response.statusCode === 200) {
    console.log(`Notification status updated: ${context.vars.notificationId}`);
  }
  return next();
}

/**
 * Generate a UUID v4
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Print summary statistics periodically
 */
setInterval(() => {
  if (requestCount > 0) {
    const avgResponseTime = totalResponseTime / requestCount;
    const errorRate = (errorCount / requestCount) * 100;

    console.log('\n=== Performance Summary ===');
    console.log(`Total Requests: ${requestCount}`);
    console.log(`Total Errors: ${errorCount}`);
    console.log(`Error Rate: ${errorRate.toFixed(2)}%`);
    console.log(`Avg Response Time: ${avgResponseTime.toFixed(2)}ms`);
    console.log(`Stored Notification IDs: ${notificationIds.length}`);
    console.log('==========================\n');
  }
}, 30000); // Print every 30 seconds
