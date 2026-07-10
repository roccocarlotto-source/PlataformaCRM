-- -----------------------------------------------------------------------------
-- Row Level Security — ver docs/authentication-architecture.md sección 5.
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
-- Se aplica una única vez con:
--   npx prisma db execute --file prisma/sql/rls_policies.sql --url "$DIRECT_URL"
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

create policy organizations_isolation on public.organizations
  for select
  using (id = public.current_organization_id());

-- ---------------------------------------------------------------------------
-- roles — catálogo global, sin scope por organización (ver schema.prisma).
-- Cualquier usuario autenticado puede leerlo; no hay política de escritura.
-- ---------------------------------------------------------------------------
alter table public.roles enable row level security;

create policy roles_read_all on public.roles
  for select
  using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- Tablas con organization_id propio — mismo patrón de aislamiento en las
-- cuatro operaciones (select/insert/update/delete).
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
create policy users_isolation on public.users
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.companies enable row level security;
create policy companies_isolation on public.companies
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.contacts enable row level security;
create policy contacts_isolation on public.contacts
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.opportunities enable row level security;
create policy opportunities_isolation on public.opportunities
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.pipelines enable row level security;
create policy pipelines_isolation on public.pipelines
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.activities enable row level security;
create policy activities_isolation on public.activities
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

-- stages ahora tiene organization_id propio (denormalizado desde
-- pipeline.organizationId, ver schema.prisma) — mismo patrón uniforme que
-- el resto de las tablas, ya no hace falta el join a pipelines que tenía
-- esta política antes.
alter table public.stages enable row level security;
create policy stages_isolation on public.stages
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
