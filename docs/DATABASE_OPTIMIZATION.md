# Database Optimization Guide

This document explains the database optimization strategies implemented in the notification system, focusing on PostgreSQL indexing and connection pool management.

## Table of Contents
- [Overview](#overview)
- [Index Strategy](#index-strategy)
- [Connection Pool Optimization](#connection-pool-optimization)
- [Performance Impact](#performance-impact)
- [Monitoring](#monitoring)
- [Maintenance](#maintenance)

## Overview

The notification system handles high-volume queries across three main tables:
- `notifications` - Core notification records
- `delivery_logs` - Channel delivery tracking
- `user_preferences` - User notification settings

Optimization focuses on two key areas:
1. **Strategic indexing** for query performance
2. **Connection pool tuning** for concurrency

## Index Strategy

### Single-Column Indexes

These indexes optimize common single-condition queries:

#### Notifications Table
```sql
-- User-based queries: "Get all notifications for user X"
CREATE INDEX idx_notifications_user_id ON notifications(user_id);

-- Status filtering: "Get all pending notifications"
CREATE INDEX idx_notifications_status ON notifications(status);

-- Temporal queries: "Get recent notifications"
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
```

**Use Cases:**
- User notification lists
- Status-based dashboards
- Recent activity feeds

#### Delivery Logs Table
```sql
-- Join operations: "Get logs for notification X"
CREATE INDEX idx_delivery_logs_notification_id ON delivery_logs(notification_id);

-- Channel filtering: "Get all email deliveries"
CREATE INDEX idx_delivery_logs_channel ON delivery_logs(channel);

-- Status filtering: "Get all failed deliveries"
CREATE INDEX idx_delivery_logs_status ON delivery_logs(status);
```

**Use Cases:**
- Notification detail pages (with delivery status)
- Channel-specific analytics
- Failure investigation

#### User Preferences Table
```sql
-- Primary user lookups (already covered by PRIMARY KEY)
CREATE INDEX idx_user_preferences_user_id ON user_preferences(user_id);
```

### Composite Indexes

Multi-column indexes for complex queries:

```sql
-- Optimized user notification queries with filtering
CREATE INDEX idx_notifications_user_status
ON notifications(user_id, status, created_at DESC);
```

**Query Pattern:**
```sql
-- This query uses the composite index efficiently
SELECT * FROM notifications
WHERE user_id = 'user123'
  AND status = 'sent'
ORDER BY created_at DESC
LIMIT 20;
```

**Why This Works:**
1. First column (`user_id`) filters to specific user
2. Second column (`status`) further filters
3. Third column (`created_at DESC`) provides sorted results without separate sort operation

**Performance Gain:** 60-80% faster than using separate indexes

### Index Selection Guidelines

PostgreSQL query planner will use the composite index for:
- ✅ `WHERE user_id = X AND status = Y ORDER BY created_at DESC`
- ✅ `WHERE user_id = X ORDER BY created_at DESC`
- ✅ `WHERE user_id = X AND status = Y`
- ❌ `WHERE status = Y ORDER BY created_at DESC` (uses single-column indexes instead)

## Connection Pool Optimization

### Configuration (2025 Best Practices)

```typescript
new Pool({
  // Pool size settings
  min: 5,              // Minimum connections always available
  max: 25,             // Maximum concurrent connections

  // Timeouts
  idleTimeoutMillis: 30000,        // Close idle connections after 30s
  connectionTimeoutMillis: 3000,   // 3s to establish connection
  statement_timeout: 10000,        // 10s max for any statement
  query_timeout: 10000,            // 10s max for query execution

  // Reliability
  allowExitOnIdle: false,          // Keep pool alive
});
```

### Why These Settings?

#### Min: 5 Connections
- **Rationale:** Maintain warm connections for instant response
- **Trade-off:** 5 idle connections vs cold-start latency
- **Memory cost:** ~10MB (2MB per connection)

#### Max: 25 Connections
- **Rationale:** Handle burst traffic without overwhelming database
- **Calculation:** Based on expected concurrent requests
  - 3 replicas × 8 concurrent requests = 24 peak connections
  - +1 for headroom = 25
- **Database limit:** Should be < `max_connections` in PostgreSQL (default 100)

#### Connection Timeout: 3000ms
- **Increased from 2000ms** for better reliability in network hiccups
- **Fast enough** to fail quickly on real issues
- **Prevents** request pileup during connection storms

#### Statement/Query Timeout: 10000ms
- **Prevents** long-running queries from blocking connections
- **Forces** query optimization (anything >10s needs indexes)
- **Protects** against accidental full table scans

### Pool Event Monitoring

The service monitors pool health through events:

```typescript
pool.on('connect', (client) => {
  // Track new connections
  // Log: totalCount, idleCount, waitingCount
});

pool.on('acquire', (client) => {
  // Track connection checkouts
});

pool.on('error', (err, client) => {
  // Track pool errors
  // Alert on high error rates
});
```

### Getting Pool Statistics

```typescript
const stats = dbService.getPoolStats();
// Returns:
{
  totalCount: 12,      // Total connections in pool
  idleCount: 7,        // Available connections
  waitingCount: 0,     // Clients waiting for connection
  maxSize: 25,
  minSize: 5,
  utilization: 20,     // % of pool in use
  lifetime: {
    totalConnects: 156,
    totalErrors: 2,
    totalAcquires: 8432
  }
}
```

## Performance Impact

### Expected Improvements

#### Index Performance
- **User queries with status filter:** 60-80% faster
  - Before: 150-200ms (table scan)
  - After: 30-50ms (index scan)

- **Delivery log queries:** 50-70% faster
  - Before: 100-150ms
  - After: 20-40ms

- **User preference lookups:** 40-60% faster
  - Before: 50-80ms
  - After: 10-20ms

#### Connection Pool Performance
- **Reduced connection acquisition time:** 80%
  - Before: 50-100ms (cold connections)
  - After: 5-10ms (warm pool)

- **Better concurrency handling:**
  - Before: 20 max concurrent (limited by old pool size)
  - After: 25 max concurrent (25% increase)

### Measuring Impact

```sql
-- Check query execution plans
EXPLAIN ANALYZE
SELECT * FROM notifications
WHERE user_id = 'test' AND status = 'sent'
ORDER BY created_at DESC
LIMIT 20;

-- Expected: "Index Scan using idx_notifications_user_status"
-- Before optimization: "Seq Scan on notifications"
```

## Monitoring

### Index Usage Statistics

```sql
-- Check if indexes are being used
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan AS scans,
  idx_tup_read AS tuples_read,
  idx_tup_fetch AS tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;
```

**What to look for:**
- `idx_notifications_user_status` should have high `idx_scan` count
- Low scan counts might indicate unused indexes (candidates for removal)

### Index Size Monitoring

```sql
-- Check index sizes
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;
```

**Size expectations:**
- Single-column indexes: 1-10 MB
- Composite indexes: 2-20 MB
- Total overhead: <5% of table size

### Connection Pool Metrics

Export to Prometheus:
```typescript
// Pool utilization gauge
db_pool_utilization{service="notification"} 35.2

// Active connections
db_pool_active_connections{service="notification"} 8

// Waiting clients (should be near 0)
db_pool_waiting_clients{service="notification"} 0

// Pool errors counter
db_pool_errors_total{service="notification"} 2
```

**Alerts to configure:**
- Pool utilization > 80% (scale up or optimize queries)
- Waiting clients > 5 (increase pool size)
- Error rate > 5/min (investigate connection issues)

## Maintenance

### Regular Tasks

#### Weekly
```sql
-- Analyze tables to update statistics
ANALYZE notifications;
ANALYZE delivery_logs;
ANALYZE user_preferences;
```

#### Monthly
```sql
-- Reindex if fragmentation detected
REINDEX TABLE notifications;
REINDEX TABLE delivery_logs;

-- Check for bloat
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

#### Quarterly
- Review slow query logs
- Identify missing indexes using `pg_stat_statements`
- Remove unused indexes

### Troubleshooting

#### High Pool Utilization
```sql
-- Find long-running queries
SELECT
  pid,
  now() - query_start AS duration,
  state,
  query
FROM pg_stat_activity
WHERE state != 'idle'
  AND query_start < now() - interval '5 seconds'
ORDER BY duration DESC;
```

**Solutions:**
- Kill long-running queries: `SELECT pg_terminate_backend(pid);`
- Add missing indexes
- Optimize query logic

#### Connection Pool Exhaustion
```typescript
// Check pool stats in service
const stats = dbService.getPoolStats();
if (stats.waitingCount > 0) {
  // Clients are waiting - pool is saturated
  // Options:
  // 1. Increase max pool size
  // 2. Optimize query performance
  // 3. Scale horizontally (more service replicas)
}
```

### Performance Regression Detection

Set up automated monitoring:
```sql
-- Track average query times
SELECT
  query,
  calls,
  mean_time,
  max_time,
  stddev_time
FROM pg_stat_statements
WHERE mean_time > 100  -- Queries taking > 100ms
ORDER BY mean_time DESC
LIMIT 20;
```

**Regression indicators:**
- Mean query time increases >50%
- Index scans decrease (switching to seq scans)
- Pool waiting clients trend upward

## Best Practices

1. **Always use prepared statements** - Prevents SQL injection and enables query plan caching
2. **Monitor index usage** - Remove unused indexes (they slow down writes)
3. **Keep pool size reasonable** - More connections ≠ better performance
4. **Set query timeouts** - Prevent runaway queries from blocking connections
5. **Use connection pooling** - Never create one-off connections
6. **Regular ANALYZE** - Keep query planner statistics up to date
7. **Index maintenance** - Rebuild fragmented indexes periodically

## Additional Resources

- [PostgreSQL Index Documentation](https://www.postgresql.org/docs/current/indexes.html)
- [node-postgres Pool Guide](https://node-postgres.com/features/pooling)
- [PostgreSQL Query Performance](https://www.postgresql.org/docs/current/performance-tips.html)
- [pg_stat_statements Extension](https://www.postgresql.org/docs/current/pgstatstatements.html)
