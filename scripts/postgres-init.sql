-- PostgreSQL 16 init script for Bounce-CLN
-- Fixes schema ownership so Prisma can create/drop tables and types

-- Ensure the application user owns the public schema
GRANT ALL ON SCHEMA public TO bounce;
ALTER SCHEMA public OWNER TO bounce;

-- Default privileges for all future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO bounce;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO bounce;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO bounce;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TYPES TO bounce;

-- Grant on existing objects (in case db already has some)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE 'GRANT ALL ON TABLE public.' || quote_ident(r.tablename) || ' TO bounce';
    END LOOP;
    FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
        EXECUTE 'GRANT ALL ON SEQUENCE public.' || quote_ident(r.sequencename) || ' TO bounce';
    END LOOP;
END $$;
