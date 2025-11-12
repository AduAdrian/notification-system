/**
 * Performance Configuration for Notification System
 * Centralized configuration for connection pools, caching, and optimization settings
 */

export const PerformanceConfig = {
  // Redis Configuration
  redis: {
    primary: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        connectTimeout: 10000,
        keepAlive: 30000,
      },
      isolationPoolOptions: {
        min: 2,
        max: 10,
      },
    },
    replica: {
      url: process.env.REDIS_REPLICA_URL,
      enabled: !!process.env.REDIS_REPLICA_URL,
    },
    caching: {
      defaultTTL: 3600, // 1 hour
      notificationTTL: 7200, // 2 hours
      userPreferencesTTL: 86400, // 24 hours
      rateLimitWindow: 60, // 1 minute
      rateLimitMaxRequests: 100,
    },
  },

  // Database Configuration
  database: {
    postgres: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'notifications',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',

      // Connection Pool Settings
      max: 25, // Maximum pool size
      min: 5, // Minimum pool size
      idleTimeoutMillis: 30000, // Close idle connections after 30s
      connectionTimeoutMillis: 3000, // Connection timeout
      maxUses: 7500, // Recycle connections after 7500 uses

      // Performance Settings
      statement_timeout: 30000, // 30 seconds
      application_name: 'notification-system',
    },

    // Query Optimization
    queryOptimization: {
      enablePreparedStatements: true,
      batchSize: 500,
      slowQueryThreshold: 1000, // Log queries taking more than 1s
    },
  },

  // MongoDB Configuration (for channel orchestrator)
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://admin:admin@localhost:27017',
    options: {
      maxPoolSize: 20,
      minPoolSize: 5,
      maxIdleTimeMS: 30000,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,

      // Write Concern
      w: 'majority',
      journal: true,

      // Read Preference
      readPreference: 'secondaryPreferred',

      // Compression
      compressors: ['zlib', 'snappy'],
    },
  },

  // Kafka Configuration
  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),

    // Connection Settings
    connectionTimeout: 10000,
    requestTimeout: 30000,

    // Producer Settings
    producer: {
      idempotent: true,
      maxInFlightRequests: 5,
      batchSize: 16384, // 16KB
      maxBatchBytes: 1048576, // 1MB
      lingerMs: 10, // Wait 10ms to batch messages
      compression: 'gzip', // gzip, snappy, lz4, or zstd

      // Buffering
      enableBuffering: true,
      bufferFlushInterval: 1000, // 1 second
      maxBufferSize: 100, // messages
    },

    // Consumer Settings
    consumer: {
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxBytesPerPartition: 1048576, // 1MB
      maxWaitTime: 5000,
      autoCommit: true,
      autoCommitInterval: 5000,
      autoCommitThreshold: 100,
      partitionsConsumedConcurrently: 3,
    },

    // Topics Configuration
    topics: {
      notifications: {
        name: 'notifications',
        numPartitions: 6,
        replicationFactor: 2,
      },
      emailNotifications: {
        name: 'email-notifications',
        numPartitions: 4,
        replicationFactor: 2,
      },
      smsNotifications: {
        name: 'sms-notifications',
        numPartitions: 4,
        replicationFactor: 2,
      },
      pushNotifications: {
        name: 'push-notifications',
        numPartitions: 4,
        replicationFactor: 2,
      },
      inappNotifications: {
        name: 'inapp-notifications',
        numPartitions: 4,
        replicationFactor: 2,
      },
    },
  },

  // Express Server Configuration
  server: {
    // Compression
    compression: {
      enabled: true,
      level: 6, // 0-9, higher = better compression but slower
      threshold: 1024, // Only compress responses larger than 1KB
      filter: (req: any, res: any) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return true;
      },
    },

    // Body Parser Limits
    bodyParser: {
      json: {
        limit: '1mb',
      },
      urlencoded: {
        limit: '1mb',
        extended: true,
      },
    },

    // Keep-Alive
    keepAliveTimeout: 65000, // 65 seconds
    headersTimeout: 66000, // 66 seconds (slightly higher than keepAlive)

    // Request Timeout
    requestTimeout: 30000, // 30 seconds
  },

  // CDN Configuration
  cdn: {
    enabled: process.env.CDN_ENABLED === 'true',
    provider: process.env.CDN_PROVIDER || 'cloudflare', // cloudflare, cloudfront, fastly
    baseUrl: process.env.CDN_BASE_URL || '',

    // Cloudflare specific
    cloudflare: {
      zoneId: process.env.CLOUDFLARE_ZONE_ID,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,

      // Caching rules
      caching: {
        staticAssets: {
          pattern: '\\.(jpg|jpeg|png|gif|svg|css|js|woff|woff2|ttf|eot)$',
          ttl: 2592000, // 30 days
        },
        api: {
          pattern: '/api/v1/(.*)',
          ttl: 0, // Don't cache API responses by default
        },
      },
    },

    // CloudFront specific
    cloudfront: {
      distributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
      region: process.env.AWS_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  },

  // Load Testing Configuration
  loadTesting: {
    k6: {
      vus: 100, // Virtual users
      duration: '5m', // Test duration
      thresholds: {
        http_req_duration: ['p(95)<500'], // 95% of requests should be below 500ms
        http_req_failed: ['rate<0.01'], // Error rate should be less than 1%
      },
    },
    artillery: {
      phases: [
        { duration: 60, arrivalRate: 10, name: 'Warm up' },
        { duration: 120, arrivalRate: 50, name: 'Ramp up' },
        { duration: 300, arrivalRate: 100, name: 'Sustained load' },
      ],
    },
  },

  // Performance Monitoring
  monitoring: {
    prometheus: {
      enabled: process.env.PROMETHEUS_ENABLED !== 'false',
      port: Number(process.env.PROMETHEUS_PORT) || 9090,
      path: '/metrics',

      // Metrics collection interval
      interval: 15000, // 15 seconds

      // Custom metrics
      collectDefaultMetrics: true,
      prefix: 'notification_system_',
    },

    grafana: {
      enabled: process.env.GRAFANA_ENABLED !== 'false',
      port: Number(process.env.GRAFANA_PORT) || 3001,
      adminUser: process.env.GRAFANA_ADMIN_USER || 'admin',
      adminPassword: process.env.GRAFANA_ADMIN_PASSWORD || 'admin',
    },

    // APM (Application Performance Monitoring)
    apm: {
      enabled: process.env.APM_ENABLED === 'true',
      provider: process.env.APM_PROVIDER || 'newrelic', // newrelic, datadog, elastic

      // New Relic
      newrelic: {
        licenseKey: process.env.NEW_RELIC_LICENSE_KEY,
        appName: process.env.NEW_RELIC_APP_NAME || 'notification-system',
      },

      // Datadog
      datadog: {
        apiKey: process.env.DATADOG_API_KEY,
        service: process.env.DATADOG_SERVICE || 'notification-system',
        env: process.env.NODE_ENV || 'development',
      },
    },

    // Logging
    logging: {
      level: process.env.LOG_LEVEL || 'info',
      format: process.env.LOG_FORMAT || 'json',

      // Performance logging
      logSlowQueries: true,
      slowQueryThreshold: 1000, // ms
      logSlowRequests: true,
      slowRequestThreshold: 5000, // ms
    },
  },

  // Health Checks
  healthCheck: {
    enabled: true,
    path: '/health',
    interval: 30000, // Check every 30 seconds

    checks: {
      database: true,
      redis: true,
      kafka: true,
      mongodb: true,
    },
  },

  // Rate Limiting
  rateLimit: {
    enabled: true,
    windowMs: 60000, // 1 minute
    max: 100, // Max requests per window

    // Skip rate limiting for certain IPs
    skip: (req: any) => {
      const whitelist = (process.env.RATE_LIMIT_WHITELIST || '').split(',');
      return whitelist.includes(req.ip);
    },
  },

  // Circuit Breaker
  circuitBreaker: {
    enabled: true,
    threshold: 50, // Failure percentage threshold
    timeout: 30000, // Reset timeout (ms)
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
  },
};

export default PerformanceConfig;
