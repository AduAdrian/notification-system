# Security Implementation Guide

## Overview

This guide explains how to implement and use the enhanced security features in the Notification System. All implementations follow OWASP 2025 best practices and industry standards.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Environment Setup](#environment-setup)
3. [Security Features Overview](#security-features-overview)
4. [Implementation Details](#implementation-details)
5. [Usage Examples](#usage-examples)
6. [Testing Security](#testing-security)
7. [Troubleshooting](#troubleshooting)

---

## Quick Start

### 1. Update Environment Variables

```bash
# Copy the example environment file
cp .env.example .env

# Generate secure secrets
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Add to your `.env`:
```env
# JWT Secrets (generate unique values)
JWT_SECRET=your-generated-secret-here
JWT_REFRESH_SECRET=your-generated-refresh-secret-here

# CORS Configuration
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com

# Session Secret
SESSION_SECRET=your-session-secret-here
```

### 2. Install Dependencies

```bash
cd services/notification-service
npm install
```

No new dependencies are required - all security features use existing packages.

### 3. Run Database Migrations

```sql
-- Create API keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  key_hash VARCHAR(64) NOT NULL UNIQUE,
  prefix VARCHAR(20) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'rotating', 'revoked')),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMP,
  rotation_scheduled_at TIMESTAMP
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_status ON api_keys(status);
CREATE INDEX idx_api_keys_rotation ON api_keys(rotation_scheduled_at);
```

### 4. Update Main Application File

Replace `src/index.ts` content with `src/index.enhanced.ts` or gradually integrate the security middleware.

---

## Environment Setup

### Required Environment Variables

```env
# Application
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# Database
DB_HOST=your-db-host
DB_PORT=5432
DB_NAME=notifications
DB_USER=notif_user
DB_PASSWORD=strong-password-here

# Redis
REDIS_URL=redis://your-redis-host:6379

# Kafka
KAFKA_BROKERS=kafka1:9092,kafka2:9092

# JWT Authentication
JWT_SECRET=your-jwt-secret-minimum-256-bits
JWT_REFRESH_SECRET=your-refresh-secret-minimum-256-bits

# CORS
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com

# Session
SESSION_SECRET=your-session-secret
COOKIE_DOMAIN=.yourdomain.com

# External Services
SENDGRID_API_KEY=SG.your-api-key
TWILIO_ACCOUNT_SID=your-twilio-sid
TWILIO_AUTH_TOKEN=your-twilio-token
GOOGLE_APPLICATION_CREDENTIALS=./firebase-credentials.json

# Rate Limiting
RATE_LIMIT_MAX=150
RATE_LIMIT_WINDOW=3600
```

### Generating Secure Secrets

```bash
# Generate 256-bit (32-byte) secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate 512-bit (64-byte) secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Generate base64 secret
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## Security Features Overview

### 1. Input Sanitization

**Location:** `src/middleware/sanitization.middleware.ts`

**Features:**
- XSS prevention (HTML entity encoding)
- SQL injection pattern detection
- NoSQL injection prevention
- Path traversal prevention
- Command injection prevention
- Deep object sanitization

**Usage:**
```typescript
import { sanitizeInput } from './middleware/sanitization.middleware';

// Apply to all routes
app.use(sanitizeInput({
  xss: true,
  sql: true,
  nosql: true,
  path: true,
  command: true,
}));

// Or specific routes
app.post('/api/v1/notifications',
  sanitizeInput({ xss: true, sql: true }),
  notificationController.create
);
```

### 2. SQL Injection Protection

**Location:** `src/middleware/sql-security.middleware.ts`

**Features:**
- Pattern-based SQL injection detection
- Query parameter validation
- Dangerous keyword blocking
- Comprehensive logging of attempts

**Usage:**
```typescript
import { sqlInjectionProtection } from './middleware/sql-security.middleware';

// Apply globally
app.use(sqlInjectionProtection);

// Or to specific routes
app.use('/api/v1', sqlInjectionProtection);
```

### 3. Enhanced CORS Configuration

**Location:** `src/config/security.config.ts`

**Features:**
- Environment-specific origin allowlisting
- Credential support with secure configuration
- Preflight caching
- Custom exposed headers for rate limiting

**Usage:**
```typescript
import { corsOptions } from './config/security.config';
import cors from 'cors';

app.use(cors(corsOptions));
```

### 4. Helmet.js Security Headers

**Location:** `src/config/security.config.ts`

**Features:**
- Content Security Policy (CSP)
- HTTP Strict Transport Security (HSTS)
- X-Frame-Options (clickjacking protection)
- X-Content-Type-Options (MIME sniffing prevention)
- Referrer Policy
- Cross-Origin policies

**Usage:**
```typescript
import { helmetOptions } from './config/security.config';
import helmet from 'helmet';

app.use(helmet(helmetOptions));
```

### 5. API Key Rotation System

**Location:** `src/services/apikey.service.ts`

**Features:**
- Cryptographically secure key generation
- Automatic expiration (90 days)
- Rotation with grace period
- Hashed storage (never plain text)
- Usage tracking

**Usage:**
```typescript
import { ApiKeyService } from './services/apikey.service';

const apiKeyService = new ApiKeyService(dbPool);

// Create API key
const { key, apiKey } = await apiKeyService.createApiKey(userId, 'My API Key');
console.log('Save this key:', key); // Show to user only once

// Rotate API key
const newKey = await apiKeyService.rotateApiKey(keyId);

// Revoke API key
await apiKeyService.revokeApiKey(keyId);

// Cleanup expired keys (scheduled task)
await apiKeyService.cleanupExpiredKeys();
```

### 6. JWT Token Refresh Mechanism

**Location:** `src/services/token.service.ts`

**Features:**
- Short-lived access tokens (15 minutes)
- Longer-lived refresh tokens (7 days)
- Automatic token rotation
- Token reuse detection
- Token family tracking
- Blacklisting for logout

**Usage:**
```typescript
import { TokenService } from './services/token.service';

const tokenService = new TokenService(redisService);

// Generate token pair on login
const tokens = await tokenService.generateTokenPair({
  userId: 'user-123',
  email: 'user@example.com',
  roles: ['user'],
});

// Refresh access token
const newTokens = await tokenService.refreshAccessToken(refreshToken);

// Logout (revoke tokens)
await tokenService.revokeRefreshToken(tokenId);
await tokenService.blacklistAccessToken(accessToken);

// Logout from all devices
await tokenService.revokeUserTokens(userId);
```

### 7. Enhanced Authentication Middleware

**Location:** `src/middleware/jwt.middleware.ts`

**Features:**
- JWT token validation
- Role-Based Access Control (RBAC)
- Permission-based authorization
- Token refresh endpoint
- Logout functionality

**Usage:**
```typescript
import { jwtAuth, requireRole, requirePermission } from './middleware/jwt.middleware';

// Protect route with authentication
app.get('/api/v1/notifications', jwtAuth(tokenService), getNotifications);

// Require specific role
app.delete('/api/v1/users/:id',
  jwtAuth(tokenService),
  requireRole(['admin', 'moderator']),
  deleteUser
);

// Require specific permission
app.post('/api/v1/notifications/broadcast',
  jwtAuth(tokenService),
  requirePermission('notifications:broadcast'),
  broadcastNotification
);
```

### 8. API Key Authentication

**Location:** `src/middleware/apikey.middleware.ts`

**Features:**
- Multiple key formats (Bearer, X-API-Key header)
- Key validation and tracking
- Dual authentication support (JWT or API Key)

**Usage:**
```typescript
import { apiKeyAuth, dualAuth } from './middleware/apikey.middleware';

// API key only
app.post('/api/v1/webhook',
  apiKeyAuth(apiKeyService),
  handleWebhook
);

// Accept both JWT and API key
app.get('/api/v1/notifications',
  dualAuth(apiKeyService, jwtAuth(tokenService)),
  getNotifications
);
```

---

## Implementation Details

### Step-by-Step Integration

#### Step 1: Update Package Dependencies

Verify these are in your `package.json`:

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "jsonwebtoken": "^9.0.2",
    "joi": "^17.11.0",
    "redis": "^4.6.11",
    "pg": "^8.11.3"
  }
}
```

#### Step 2: Create Configuration File

Create `src/config/security.config.ts` with the security configuration (already created in this implementation).

#### Step 3: Add Security Middleware

Create all middleware files:
- `src/middleware/sanitization.middleware.ts`
- `src/middleware/sql-security.middleware.ts`
- `src/middleware/jwt.middleware.ts`
- `src/middleware/apikey.middleware.ts`

#### Step 4: Add Security Services

Create service files:
- `src/services/token.service.ts`
- `src/services/apikey.service.ts`

#### Step 5: Update Main Application

Update `src/index.ts` to include all security middleware in the correct order:

```typescript
// 1. Helmet (security headers)
app.use(helmet(helmetOptions));

// 2. CORS
app.use(cors(corsOptions));

// 3. Body parser with limits
app.use(express.json({ limit: '10mb' }));

// 4. Input sanitization
app.use(sanitizeInput());

// 5. SQL injection protection
app.use(sqlInjectionProtection);

// 6. Request logging
// ... your logging middleware

// 7. Routes with authentication
app.use('/api/v1/notifications',
  jwtAuth(tokenService),
  notificationRoutes
);
```

#### Step 6: Update Routes

Add authentication to your routes:

```typescript
// routes/notification.routes.ts
import { Router } from 'express';
import { jwtAuth } from '../middleware/jwt.middleware';
import { rateLimiter } from '../middleware/ratelimit.middleware';
import { validateNotification } from '../middleware/validation.middleware';

const router = Router();

// All routes require authentication
router.use(jwtAuth(tokenService));

// Create notification (with rate limiting and validation)
router.post('/',
  rateLimiter,
  validateNotification,
  notificationController.create
);

// Get user notifications
router.get('/',
  notificationController.getAll
);

export { router as notificationRoutes };
```

---

## Usage Examples

### Example 1: Creating an API Key

```bash
# Login to get JWT token
curl -X POST https://api.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'

# Response:
# {
#   "accessToken": "eyJhbGc...",
#   "refreshToken": "eyJhbGc...",
#   "expiresIn": 900
# }

# Create API key
curl -X POST https://api.example.com/api/v1/apikeys \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production API Key"
  }'

# Response:
# {
#   "success": true,
#   "data": {
#     "key": "ns_AbCd1234EfGh5678IjKl...",  // SAVE THIS!
#     "id": "550e8400-e29b-41d4-a716-446655440000",
#     "name": "Production API Key",
#     "expiresAt": "2025-02-10T00:00:00Z",
#     "createdAt": "2024-11-12T00:00:00Z"
#   },
#   "message": "API key created. Save it securely - it will not be shown again."
# }
```

### Example 2: Using API Key

```bash
# Option 1: Bearer token
curl -X POST https://api.example.com/api/v1/notifications \
  -H "Authorization: Bearer ns_AbCd1234EfGh5678IjKl..." \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "channels": ["email"],
    "message": "Hello World"
  }'

# Option 2: X-API-Key header
curl -X POST https://api.example.com/api/v1/notifications \
  -H "X-API-Key: ns_AbCd1234EfGh5678IjKl..." \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "channels": ["email"],
    "message": "Hello World"
  }'
```

### Example 3: Refreshing JWT Token

```bash
# When access token expires, use refresh token
curl -X POST https://api.example.com/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
  }'

# Response:
# {
#   "success": true,
#   "data": {
#     "accessToken": "eyJhbGc...NEW_TOKEN",
#     "refreshToken": "eyJhbGc...NEW_REFRESH_TOKEN",
#     "expiresIn": 900,
#     "tokenType": "Bearer"
#   }
# }
```

### Example 4: Rotating API Key

```bash
# Rotate API key before it expires
curl -X POST https://api.example.com/api/v1/apikeys/KEY_ID/rotate \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json"

# Response:
# {
#   "success": true,
#   "data": {
#     "key": "ns_XyZ9876WvUt5432SrQp...",  // NEW KEY - SAVE THIS!
#     "id": "660e8400-e29b-41d4-a716-446655440001",
#     "name": "Production API Key",
#     "expiresAt": "2025-05-10T00:00:00Z"
#   },
#   "message": "API key rotated. Save the new key securely."
# }
```

### Example 5: Logout

```bash
# Logout from current device
curl -X POST https://api.example.com/api/v1/auth/logout \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
  }'

# Logout from all devices
curl -X POST https://api.example.com/api/v1/auth/logout \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "logoutAll": true
  }'
```

---

## Testing Security

### Unit Tests

```typescript
// test/security/sanitization.test.ts
import { sanitizeInput, escapeHtml } from '../../src/middleware/sanitization.middleware';

describe('Sanitization Middleware', () => {
  it('should escape HTML entities', () => {
    const input = '<script>alert("xss")</script>';
    const output = escapeHtml(input);
    expect(output).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('should remove SQL keywords', () => {
    // Add tests for SQL injection prevention
  });
});
```

### Integration Tests

```typescript
// test/integration/auth.test.ts
import request from 'supertest';
import app from '../../src/index';

describe('JWT Authentication', () => {
  let accessToken: string;
  let refreshToken: string;

  it('should login and receive tokens', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'password' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('accessToken');
    expect(response.body).toHaveProperty('refreshToken');

    accessToken = response.body.accessToken;
    refreshToken = response.body.refreshToken;
  });

  it('should access protected route with token', async () => {
    const response = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
  });

  it('should refresh token', async () => {
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveProperty('accessToken');
  });
});
```

### Security Testing

```bash
# Test SQL injection
curl -X GET "https://api.example.com/api/v1/notifications?userId=1' OR '1'='1"

# Test XSS
curl -X POST https://api.example.com/api/v1/notifications \
  -H "Authorization: Bearer TOKEN" \
  -d '{"message":"<script>alert(\"xss\")</script>"}'

# Test rate limiting
for i in {1..200}; do
  curl -X GET https://api.example.com/api/v1/notifications
done

# Test CORS
curl -X OPTIONS https://api.example.com/api/v1/notifications \
  -H "Origin: https://malicious.com" \
  -H "Access-Control-Request-Method: POST"
```

---

## Troubleshooting

### Issue: CORS Errors

**Problem:** Browser shows CORS policy errors

**Solution:**
1. Check `ALLOWED_ORIGINS` in environment variables
2. Ensure origin is included in the allowlist
3. Verify credentials setting matches your needs

```env
ALLOWED_ORIGINS=https://yourfrontend.com,https://app.yourfrontend.com
```

### Issue: Token Expired Errors

**Problem:** Frequent "Invalid or expired token" errors

**Solution:**
1. Implement token refresh on 401 responses in your client
2. Store refresh token securely
3. Use refresh token to get new access token

```javascript
// Client-side example
async function apiCall(url, options) {
  let response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (response.status === 401) {
    // Token expired, refresh it
    const refreshResponse = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken })
    });

    const { accessToken: newToken } = await refreshResponse.json();
    accessToken = newToken;

    // Retry original request
    response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${accessToken}`
      }
    });
  }

  return response;
}
```

### Issue: Rate Limit Exceeded

**Problem:** Getting 429 Too Many Requests errors

**Solution:**
1. Check rate limit headers in response
2. Implement exponential backoff
3. Request rate limit increase if legitimate

```javascript
// Check rate limit headers
const remaining = response.headers.get('X-RateLimit-Remaining');
const reset = response.headers.get('X-RateLimit-Reset');

if (remaining === '0') {
  const waitTime = new Date(reset) - new Date();
  await new Promise(resolve => setTimeout(resolve, waitTime));
}
```

### Issue: API Key Not Working

**Problem:** API key authentication fails

**Solution:**
1. Verify key hasn't expired
2. Check key format (should start with `ns_`)
3. Ensure using correct header format
4. Check key hasn't been revoked

```bash
# List your API keys
curl -X GET https://api.example.com/api/v1/apikeys \
  -H "Authorization: Bearer JWT_TOKEN"
```

---

## Additional Resources

- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
- [JWT Best Practices](https://auth0.com/blog/refresh-tokens-what-are-they-and-when-to-use-them/)
- [Helmet.js Documentation](https://helmetjs.github.io/)
- [Secrets Management Guide](./SECRETS_MANAGEMENT.md)
- [Security Audit Checklist](./SECURITY_AUDIT_CHECKLIST.md)

---

## Support

For security issues or questions:
- **Email:** security@yourcompany.com
- **Slack:** #security-team
- **Documentation:** https://docs.yourcompany.com/security

**Important:** Never share API keys, JWT secrets, or other sensitive credentials in support requests!
