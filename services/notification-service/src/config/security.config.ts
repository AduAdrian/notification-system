import { CorsOptions } from 'cors';
import { HelmetOptions } from 'helmet';

/**
 * Security Configuration for Notification Service
 * Based on OWASP 2025 best practices and industry standards
 */

// Environment-specific configuration
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * CORS Configuration
 *
 * Implements secure Cross-Origin Resource Sharing policies
 * Following OWASP best practices for API security
 */
export const corsOptions: CorsOptions = {
  // Allowed origins - should be environment-specific
  origin: (origin, callback) => {
    // In production, use a strict allowlist
    const allowedOrigins = isProduction
      ? (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)
      : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8080'];

    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS policy'));
    }
  },

  // Allowed HTTP methods
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

  // Allowed headers
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-API-Key',
    'X-Request-ID',
    'X-Correlation-ID',
  ],

  // Exposed headers (available to client)
  exposedHeaders: [
    'X-Request-ID',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
  ],

  // Enable credentials (cookies, authorization headers)
  credentials: true,

  // Preflight cache duration (24 hours)
  maxAge: 86400,

  // Pass the CORS preflight response to the next handler
  preflightContinue: false,

  // Provide a status code to use for successful OPTIONS requests
  optionsSuccessStatus: 204,
};

/**
 * Helmet.js Security Headers Configuration
 *
 * Comprehensive security headers following OWASP recommendations
 * Protects against common web vulnerabilities
 */
export const helmetOptions: HelmetOptions = {
  // Content Security Policy - Prevents XSS and other code injection attacks
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Adjust based on needs
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null,
    },
  },

  // Cross-Origin-Embedder-Policy - Enables cross-origin isolation
  crossOriginEmbedderPolicy: true,

  // Cross-Origin-Opener-Policy - Prevents attacks from malicious cross-origin windows
  crossOriginOpenerPolicy: { policy: 'same-origin' },

  // Cross-Origin-Resource-Policy - Controls cross-origin resource loading
  crossOriginResourcePolicy: { policy: 'same-origin' },

  // DNS Prefetch Control - Controls browser DNS prefetching
  dnsPrefetchControl: { allow: false },

  // Expect-CT - Certificate Transparency enforcement (deprecated but still useful)
  expectCt: {
    maxAge: 86400,
    enforce: true,
  },

  // Frameguard - Prevents clickjacking attacks
  frameguard: { action: 'deny' },

  // Hide Powered-By header - Don't reveal technology stack
  hidePoweredBy: true,

  // HSTS - Forces HTTPS connections
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },

  // IE No Open - Prevents IE from executing downloads in site's context
  ieNoOpen: true,

  // No Sniff - Prevents MIME type sniffing
  noSniff: true,

  // Origin Agent Cluster - Improves site isolation
  originAgentCluster: true,

  // Permitted Cross-Domain Policies - Restricts Flash and PDF cross-domain requests
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },

  // Referrer Policy - Controls referrer information
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

  // XSS Filter - Enables browser's XSS protection
  xssFilter: true,
};

/**
 * Rate Limiting Configuration
 *
 * Implements tiered rate limiting based on endpoint sensitivity
 */
export const rateLimitConfig = {
  // Standard API endpoints
  standard: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later',
    standardHeaders: true, // Return rate limit info in headers
    legacyHeaders: false, // Disable X-RateLimit-* headers
  },

  // Authentication endpoints (more restrictive)
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 login attempts per windowMs
    skipSuccessfulRequests: true, // Don't count successful requests
    message: 'Too many authentication attempts, please try again later',
  },

  // Notification creation (per user)
  notification: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 150, // 150 notifications per hour per user
    keyGenerator: (req: any) => req.user?.userId || req.ip,
    message: 'Notification rate limit exceeded',
  },

  // Strict rate limit for sensitive operations
  strict: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 requests per hour
    message: 'Rate limit exceeded for this operation',
  },
};

/**
 * JWT Configuration
 *
 * Secure JWT token settings based on 2025 best practices
 */
export const jwtConfig = {
  // Access token settings
  accessToken: {
    expiresIn: '15m', // Short-lived access tokens
    algorithm: 'HS256' as const,
  },

  // Refresh token settings
  refreshToken: {
    expiresIn: '7d', // Longer-lived refresh tokens
    algorithm: 'HS256' as const,
  },

  // Token issuer and audience
  issuer: 'notification-service',
  audience: 'notification-api',

  // Require secure token transmission
  requireHttps: isProduction,
};

/**
 * API Key Configuration
 *
 * Settings for API key authentication and rotation
 */
export const apiKeyConfig = {
  // Key length in bytes (32 bytes = 256 bits)
  keyLength: 32,

  // Key rotation period (90 days recommended)
  rotationPeriodDays: 90,

  // Grace period for old keys (7 days)
  gracePeriodDays: 7,

  // Key prefix for easy identification
  keyPrefix: 'ns_', // notification-service

  // Hash algorithm for storing keys
  hashAlgorithm: 'sha256' as const,
};

/**
 * Session Configuration
 */
export const sessionConfig = {
  // Session secret (should be in environment variables)
  secret: process.env.SESSION_SECRET || 'change-this-in-production',

  // Cookie settings
  cookie: {
    secure: isProduction, // HTTPS only in production
    httpOnly: true, // Prevents JavaScript access
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'strict' as const, // CSRF protection
    domain: process.env.COOKIE_DOMAIN,
  },

  // Resave and save uninitialized
  resave: false,
  saveUninitialized: false,
};

/**
 * Input Validation Configuration
 */
export const validationConfig = {
  // Maximum request body size
  maxBodySize: '10mb',

  // Maximum URL parameter length
  maxParamLength: 200,

  // Maximum array items
  maxArrayItems: 100,

  // Maximum object depth
  maxObjectDepth: 10,

  // String patterns
  patterns: {
    uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    phone: /^\+?[1-9]\d{1,14}$/,
    alphanumeric: /^[a-zA-Z0-9]+$/,
  },
};

/**
 * Security Headers to Add to All Responses
 */
export const additionalSecurityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

/**
 * Allowed File Upload Configuration (if needed in future)
 */
export const fileUploadConfig = {
  maxFileSize: 5 * 1024 * 1024, // 5MB
  allowedMimeTypes: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf',
  ],
  uploadDirectory: './uploads',
  // Prevent path traversal in filenames
  sanitizeFilename: (filename: string) => {
    return filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  },
};

export default {
  cors: corsOptions,
  helmet: helmetOptions,
  rateLimit: rateLimitConfig,
  jwt: jwtConfig,
  apiKey: apiKeyConfig,
  session: sessionConfig,
  validation: validationConfig,
  securityHeaders: additionalSecurityHeaders,
  fileUpload: fileUploadConfig,
};
