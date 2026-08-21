-- C-1 (docs/auditoria-2026-08-21.md, sección 2): las políticas RLS creadas
-- en la migración anterior son "for all" (SELECT + INSERT + UPDATE +
-- DELETE). Sin un REVOKE explícito, los grants por defecto de Supabase a
-- `anon`/`authenticated` sobre tablas creadas por el rol `postgres`
-- (el rol con el que corren las migraciones) quedan vigentes, y RLS pasa de
-- ser una defensa en profundidad a ser la ÚNICA puerta — con políticas
-- `for all`, un usuario con rol USER puede escribir directo contra
-- PostgREST con la anon key pública y asignarse el rol ADMIN, salteando
-- `authorize("ADMIN")`, todo Zod, y toda regla de negocio del backend.
--
-- Esto cierra PostgREST de forma deliberada. Habilitar Supabase Realtime o
-- un cliente de Supabase directo desde el frontend en el futuro requiere
-- volver a otorgar permisos explícitamente, tabla por tabla — decisión
-- consciente en vez de default heredado.
--
-- No se revoca nada a `service_role`, a `postgres` ni al rol de la conexión
-- de la aplicación (DATABASE_URL/DIRECT_URL) — ambos son equivalentes a
-- `service_role` y tienen BYPASSRLS, así que ningún REVOKE sobre
-- `anon`/`authenticated` los afecta. No se tocan los esquemas `auth`,
-- `storage`, `realtime` ni `extensions`.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Para que las tablas que se creen en el futuro (nuevas migraciones) nazcan
-- cerradas por default, en vez de heredar el default permisivo de Supabase.
alter default privileges in schema public
  revoke all on tables from anon, authenticated;

-- _prisma_migrations es la única tabla de public sin RLS: el historial de
-- migraciones no debería ser legible ni escribible por anon/authenticated.
alter table public._prisma_migrations enable row level security;
