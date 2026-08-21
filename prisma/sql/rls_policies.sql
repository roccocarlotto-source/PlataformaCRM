-- -----------------------------------------------------------------------------
-- Row Level Security — ver docs/authentication-architecture.md sección 5.
--
-- Este contenido ya forma parte del historial de migraciones desde
-- prisma/migrations/20260821140000_incorporate_manual_ddl_into_migrations
-- (C-2, docs/auditoria-2026-08-21.md). Se conserva acá como referencia
-- legible y como red de seguridad idempotente para scripts/apply-manual-sql.ts.
--
-- IMPORTANTE: estas políticas son una defensa SECUNDARIA, no la principal.
-- El backend (Express + Prisma) se conecta con DATABASE_URL, cuyo rol
-- (postgres.<project-ref>, vía el pooler) es equivalente al `service_role`
-- de Supabase y tiene BYPASSRLS — estas políticas NO se evalúan para
-- ninguna query que haga este backend. Protegen cualquier otro camino de
-- acceso a la base: Supabase Realtime, un cliente de Supabase usado directo
-- desde el frontend, el SQL editor con el rol `authenticated`, o un futuro
-- script que use la clave `anon`/`authenticated` en vez de `service_role`.
-- La disciplina de filtrar por organizationId en cada query de Prisma sigue
-- siendo, y va a seguir siendo, la defensa principal contra fuga de datos
-- entre tenants (ver la tabla de responsabilidades por capa en la sección 5
-- del doc de arquitectura). Prisma no soporta RLS nativamente en su DSL, por
-- eso este archivo se aplica a mano, igual que manual_constraints.sql.
--
-- Idempotente: cada política se dropea antes de recrearse (Postgres no
-- soporta "CREATE POLICY IF NOT EXISTS"), así que este archivo es seguro de
-- reaplicar en cada deploy — ver scripts/apply-manual-sql.ts.
-- -----------------------------------------------------------------------------

-- Resuelve la organización del usuario autenticado (auth.uid()) sin volver a
-- evaluar RLS sobre public.users en el proceso (security definer) — evita la
-- recursión de "para saber tu organización hace falta leer users, pero leer
-- users ya requiere saber tu organización".
create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.users where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- organizations — cada usuario ve únicamente su propia organización.
-- Sin política de escritura: alta/baja de organizaciones no es algo que un
-- cliente autenticado deba poder hacer directo contra la base.
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;

drop policy if exists organizations_isolation on public.organizations;
create policy organizations_isolation on public.organizations
  for select
  using (id = public.current_organization_id());

-- ---------------------------------------------------------------------------
-- roles — catálogo global, sin scope por organización (ver schema.prisma).
-- Cualquier usuario autenticado puede leerlo; no hay política de escritura.
-- ---------------------------------------------------------------------------
alter table public.roles enable row level security;

drop policy if exists roles_read_all on public.roles;
create policy roles_read_all on public.roles
  for select
  using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- Tablas con organization_id propio — mismo patrón de aislamiento en las
-- cuatro operaciones (select/insert/update/delete).
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
drop policy if exists users_isolation on public.users;
create policy users_isolation on public.users
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.companies enable row level security;
drop policy if exists companies_isolation on public.companies;
create policy companies_isolation on public.companies
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.contacts enable row level security;
drop policy if exists contacts_isolation on public.contacts;
create policy contacts_isolation on public.contacts
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.opportunities enable row level security;
drop policy if exists opportunities_isolation on public.opportunities;
create policy opportunities_isolation on public.opportunities
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.pipelines enable row level security;
drop policy if exists pipelines_isolation on public.pipelines;
create policy pipelines_isolation on public.pipelines
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.activities enable row level security;
drop policy if exists activities_isolation on public.activities;
create policy activities_isolation on public.activities
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

-- stages ahora tiene organization_id propio (denormalizado desde
-- pipeline.organizationId, ver schema.prisma) — mismo patrón uniforme que
-- el resto de las tablas, ya no hace falta el join a pipelines que tenía
-- esta política antes.
alter table public.stages enable row level security;
drop policy if exists stages_isolation on public.stages;
create policy stages_isolation on public.stages
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

-- invitations — mismo patrón uniforme. Nota: un usuario invitado que todavía
-- no aceptó (existe en auth.users, no en public.users) resuelve
-- current_organization_id() como NULL, así que esta política no le deja ver
-- ninguna fila — correcto: la aceptación pasa por el backend con
-- service_role (BYPASSRLS), no por un cliente autenticado con RLS.
alter table public.invitations enable row level security;
drop policy if exists invitations_isolation on public.invitations;
create policy invitations_isolation on public.invitations
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
