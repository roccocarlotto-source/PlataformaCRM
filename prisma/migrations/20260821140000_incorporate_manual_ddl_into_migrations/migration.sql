-- C-2 (docs/auditoria-2026-08-21.md, sección 2): hasta esta migración, 36
-- objetos (funciones, triggers, índices únicos parciales, CHECK constraints,
-- RLS) vivían únicamente en prisma/sql/manual_constraints.sql y
-- prisma/sql/rls_policies.sql, aplicados por separado con
-- `npm run migrate:deploy` (scripts/apply-manual-sql.ts). `prisma migrate
-- deploy` por sí solo producía una base sin ninguna de estas defensas, de
-- las que el código depende como defensa primaria (ver
-- invitation.service.ts, activity.service.ts, stage.service.ts).
--
-- El contenido de acá abajo es equivalente al de ambos archivos: mismos
-- nombres de objetos, mismos predicados WHERE, mismas expresiones CHECK,
-- mismos comentarios explicativos. manual_constraints.sql y rls_policies.sql
-- se conservan como referencia legible y como red de seguridad idempotente
-- (scripts/apply-manual-sql.ts los sigue reaplicando en cada deploy; sobre
-- una base que ya tiene estos objetos es un no-op).

-- =============================================================================
-- Origen: prisma/sql/manual_constraints.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Sincronización de email: auth.users -> public.users
--
--    public.users.email nunca se escribe desde la aplicación. Dos triggers
--    garantizan que siempre refleje auth.users.email:
--
--    a) Antes de cualquier INSERT/UPDATE en public.users, se sobreescribe
--       el campo email leyéndolo de auth.users (cubre también la creación
--       inicial del perfil, sin depender de que la app lo pase correcto).
--    b) Cuando auth.users.email cambia (el usuario actualiza su email en
--       Supabase Auth), se propaga automáticamente a public.users.
-- ---------------------------------------------------------------------------

create or replace function public.set_user_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select email into new.email
  from auth.users
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists trg_set_user_email_from_auth on public.users;

create trigger trg_set_user_email_from_auth
before insert or update on public.users
for each row
execute function public.set_user_email_from_auth();

create or replace function public.propagate_auth_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
  set email = new.email
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists trg_propagate_auth_email_change on auth.users;

create trigger trg_propagate_auth_email_change
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function public.propagate_auth_email_change();

-- ---------------------------------------------------------------------------
-- 2. Índices únicos parciales
-- ---------------------------------------------------------------------------

-- Un contacto no puede repetir email dentro de la misma organización,
-- pero se permiten múltiples contactos sin email.
create unique index if not exists contacts_org_email_unique
  on public.contacts (organization_id, email)
  where email is not null and deleted_at is null;

-- A lo sumo un pipeline marcado como default por organización. Incluye
-- "and deleted_at is null" — sin esto, borrar (soft delete) el pipeline
-- default deja a la organización sin poder tener nunca más un default,
-- porque el índice seguiría contando la fila borrada como ocupando el lugar.
create unique index if not exists pipelines_org_default_unique
  on public.pipelines (organization_id)
  where is_default = true and deleted_at is null;

-- Un stage no puede repetir order ni name dentro del mismo pipeline, pero
-- un stage borrado (soft delete) libera ambos para reuso — mismo criterio
-- que contacts_org_email_unique.
create unique index if not exists stages_pipeline_order_unique
  on public.stages (pipeline_id, "order")
  where deleted_at is null;

create unique index if not exists stages_pipeline_name_unique
  on public.stages (pipeline_id, name)
  where deleted_at is null;

-- A lo sumo un stage marcado como ganado, y a lo sumo uno marcado como
-- perdido, por pipeline (distinto de stages_won_lost_exclusive_check más
-- abajo, que impide que un mismo stage sea ambas cosas a la vez).
create unique index if not exists stages_pipeline_won_unique
  on public.stages (pipeline_id)
  where is_won = true and deleted_at is null;

create unique index if not exists stages_pipeline_lost_unique
  on public.stages (pipeline_id)
  where is_lost = true and deleted_at is null;

-- A lo sumo una invitación PENDING por (organization_id, email). Un email
-- puede tener múltiples invitaciones a lo largo del tiempo (reinvitado tras
-- vencer, revocada y reinvitado, etc.) mientras a lo sumo una esté PENDING a
-- la vez. No se filtra por una fecha de expiración acá porque un índice
-- parcial exige un predicado IMMUTABLE — now() no lo es — por eso el estado
-- vencido se resuelve en la aplicación (expireDueInvitations, perezoso)
-- ANTES de las operaciones que dependen de esta constraint, no en el índice.
create unique index if not exists invitations_org_email_pending_unique
  on public.invitations (organization_id, email)
  where status = 'PENDING';

-- ---------------------------------------------------------------------------
-- 3. CHECK constraints
-- ---------------------------------------------------------------------------

-- Postgres no soporta "ADD CONSTRAINT IF NOT EXISTS" (a diferencia de los
-- índices de la sección anterior) — cada constraint se dropea primero para
-- que este archivo completo sea seguro de reaplicar (idempotente), igual
-- que ya lo son los triggers de la sección 1.

-- Una oportunidad debe estar asociada a una Company, a un Contact, o a ambos.
alter table public.opportunities
  drop constraint if exists opportunities_company_or_contact_check;
alter table public.opportunities
  add constraint opportunities_company_or_contact_check
  check (company_id is not null or contact_id is not null);

alter table public.opportunities
  drop constraint if exists opportunities_amount_non_negative_check;
alter table public.opportunities
  add constraint opportunities_amount_non_negative_check
  check (amount >= 0);

-- Un stage no puede ser simultáneamente ganado y perdido.
alter table public.stages
  drop constraint if exists stages_won_lost_exclusive_check;
alter table public.stages
  add constraint stages_won_lost_exclusive_check
  check (not (is_won and is_lost));

-- Una actividad debe estar asociada al menos a Company, Contact u Opportunity.
alter table public.activities
  drop constraint if exists activities_related_entity_check;
alter table public.activities
  add constraint activities_related_entity_check
  check (
    company_id is not null
    or contact_id is not null
    or opportunity_id is not null
  );

-- =============================================================================
-- Origen: prisma/sql/rls_policies.sql
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
-- =============================================================================

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
