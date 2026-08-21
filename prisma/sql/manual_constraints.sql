-- Prisma no soporta nativamente: índices únicos parciales (WHERE), CHECK
-- constraints, ni triggers. Este archivo se aplica manualmente después de
-- cada `prisma migrate dev` (o se copia su contenido dentro de la migración
-- SQL generada) para completar las restricciones que sí forman parte del
-- diseño pero no del lenguaje de schema.prisma.
--
-- Este contenido ya forma parte del historial de migraciones desde
-- prisma/migrations/20260821140000_incorporate_manual_ddl_into_migrations
-- (C-2, docs/auditoria-2026-08-21.md). Se conserva acá como referencia
-- legible y como red de seguridad idempotente para scripts/apply-manual-sql.ts.

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
