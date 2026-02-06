-- Migration check to verify all tables exist
-- This migration will fail if previous migrations haven't been applied

-- Check that user table exists (renamed from user_temp in migration 0120)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables 
                   WHERE table_schema = 'public' AND table_name = 'user') THEN
        RAISE EXCEPTION 'Table "user" does not exist. Migration 0120 may not have been applied.';
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables 
               WHERE table_schema = 'public' AND table_name = 'user_temp') THEN
        RAISE WARNING 'Table "user_temp" still exists. This should have been renamed to "user" in migration 0120.';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables 
                   WHERE table_schema = 'public' AND table_name = 'member') THEN
        RAISE EXCEPTION 'Table "member" does not exist. Migration 0066 may not have been applied.';
    END IF;
    
    RAISE NOTICE 'Migration check passed: All required tables exist';
END $$;
