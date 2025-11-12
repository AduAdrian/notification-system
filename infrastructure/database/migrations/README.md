# Database Migrations

This directory contains SQL migration scripts for the notification system database.

## Migration Naming Convention

Migrations follow the pattern: `NNN_description.sql` where:
- `NNN` is a zero-padded sequential number (001, 002, etc.)
- `description` is a brief, lowercase description with underscores

## Available Migrations

### 001_add_indexes.sql
**Purpose**: Adds critical performance indexes to notification tables

**Indexes Created**:
- `idx_delivery_logs_status` - Single column index on delivery_logs.status
- `idx_user_preferences_user_id` - Index on user_preferences.user_id (optimization)
- `idx_notifications_user_status` - Composite index on (user_id, status, created_at DESC)

**Expected Performance Improvements**:
- 60-80% faster user notification queries with status filtering
- 50-70% faster delivery log queries by channel and status
- 40-60% improvement in user preference lookups

**Rollback**: `001_add_indexes_rollback.sql`

## Running Migrations

### Manual Execution

```bash
# Apply migration
psql -h localhost -U postgres -d notifications -f migrations/001_add_indexes.sql

# Rollback migration (if needed)
psql -h localhost -U postgres -d notifications -f migrations/001_add_indexes_rollback.sql
```

### Using Docker

```bash
# Apply migration
docker exec -i notification-db psql -U postgres -d notifications < infrastructure/database/migrations/001_add_indexes.sql

# Rollback migration
docker exec -i notification-db psql -U postgres -d notifications < infrastructure/database/migrations/001_add_indexes_rollback.sql
```

### Kubernetes

```bash
# Copy migration to pod
kubectl cp infrastructure/database/migrations/001_add_indexes.sql postgres-pod:/tmp/

# Execute in pod
kubectl exec -it postgres-pod -- psql -U postgres -d notifications -f /tmp/001_add_indexes.sql
```

## Migration Best Practices

1. **Always test migrations** in a development/staging environment first
2. **Create rollback scripts** for every migration
3. **Use transactions** (BEGIN/COMMIT) to ensure atomicity
4. **Document expected impact** including performance improvements
5. **Use IF NOT EXISTS** to make migrations idempotent
6. **Add verification queries** to confirm migration success

## Index Strategy

The notification system uses a multi-tier indexing strategy:

### Single-Column Indexes
Used for simple WHERE clause filtering:
- `notifications.user_id` - User notification lookups
- `notifications.status` - Status-based filtering
- `notifications.created_at` - Temporal queries
- `delivery_logs.notification_id` - Join operations
- `delivery_logs.channel` - Channel-specific queries
- `delivery_logs.status` - Delivery status filtering

### Composite Indexes
Used for complex queries with multiple conditions:
- `(user_id, status, created_at DESC)` - User notifications with status filter, ordered by date

### Index Maintenance

```sql
-- Check index usage statistics
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- Check index sizes
SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;

-- Rebuild indexes if needed (during maintenance window)
REINDEX TABLE notifications;
REINDEX TABLE delivery_logs;
REINDEX TABLE user_preferences;
```

## Monitoring Index Performance

After applying migrations, monitor query performance:

```sql
-- Enable query logging (postgresql.conf)
-- log_statement = 'all'
-- log_min_duration_statement = 100  # Log queries > 100ms

-- Check slow queries
SELECT
    query,
    calls,
    total_time,
    mean_time,
    max_time
FROM pg_stat_statements
WHERE mean_time > 100
ORDER BY mean_time DESC
LIMIT 20;
```

## Future Migrations

When creating new migrations:
1. Increment the migration number (002, 003, etc.)
2. Document the purpose and expected impact
3. Create a corresponding rollback script
4. Test in development before production deployment
5. Update this README with migration details
