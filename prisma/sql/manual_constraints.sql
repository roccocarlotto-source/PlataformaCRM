-- Prisma no soporta nativamente: índices únicos parciales (WHERE), CHECK
-- constraints, ni triggers. Este archivo completa dos de esas tres piezas
-- (triggers e índices); los CHECK constraints ya NO viven acá — B-15 de
-- docs/auditoria-2026-08-29.md los sacó de la reaplicación por deploy, porque
-- un ADD CONSTRAINT ... CHECK revalida cada fila bajo ACCESS EXCLUSIVE y desde
-- C-2 los crean las migraciones versionadas (20260821140000 los cuatro
-- originales, 20260825120000 el de M-13).
--
-- Este contenido ya forma parte del historial de migraciones desde
-- prisma/migrations/20260821140000_incorporate_manual_ddl_into_migrations
-- (C-2, docs/auditoria-2026-08-21.md). Se conserva acá como referencia
-- legible y como red de seguridad idempotente para scripts/apply-manual-sql.ts
-- — barata para triggers e índices (puro catálogo, o if not exists), que es
-- justamente lo que los CHECK no eran.

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
--
-- M-13: la unicidad se evalúa sobre lower(email), no sobre la columna cruda.
-- Antes dependía de que normalizeEmail() bajara a minúsculas antes de escribir,
-- y la promoción desde staging (ítem 4 de docs/ingestion-architecture.md) no
-- pasa por contact.service. Ver la migración 20260825120000, que además explica
-- por qué el NOMBRE del índice no se puede cambiar (rethrowAsConflict decide
-- con target.includes("email")).
create unique index if not exists contacts_org_email_unique
  on public.contacts (organization_id, lower(email))
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
-- perdido, por pipeline (distinto de stages_won_lost_exclusive_check —creado
-- por las migraciones, ver la cabecera—, que impide que un mismo stage sea
-- ambas cosas a la vez).
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
