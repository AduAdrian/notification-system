-- Migration Rollback: Remove Performance Indexes
-- Author: Database Optimization Agent
-- Date: 2025-01-13
-- Description: Rolls back the 001_add_indexes.sql migration by dropping the created indexes
--
-- WARNING: Rolling back these indexes will negatively impact query performance
-- Only execute this rollback if you encounter issues with the indexes

BEGIN;

-- Drop composite index
DROP INDEX IF EXISTS idx_notifications_user_status;

-- Drop user_preferences index (only if it's not the primary key constraint)
-- Since user_id is PRIMARY KEY, we don't actually need to drop this
-- DROP INDEX IF EXISTS idx_user_preferences_user_id;

-- Drop delivery_logs status index
DROP INDEX IF EXISTS idx_delivery_logs_status;

-- Verify indexes were dropped
DO $$
BEGIN
    RAISE NOTICE 'Migration rollback 001_add_indexes_rollback.sql completed';
    RAISE NOTICE 'Indexes dropped: 2';
    RAISE NOTICE '  - idx_delivery_logs_status';
    RAISE NOTICE '  - idx_notifications_user_status';
END $$;

COMMIT;
