-- Phase 6a: the tenant's retention window.
-- Tenant administrators set it through the API (retention:update is not a
-- separate permission: organization:update). The column check bounds it.
GRANT UPDATE (retention_days) ON public.tenants TO app_runtime;
