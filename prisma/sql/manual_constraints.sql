-- Prisma no soporta nativamente: índices únicos parciales (WHERE), CHECK
-- constraints, ni triggers. Este archivo se aplica manualmente después de
-- cada `prisma migrate dev` (o se copia su contenido dentro de la migración
-- SQL generada) para completar las restricciones que sí forman parte del
-- diseño pero no del lenguaje de schema.prisma.

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

-- A lo sumo un pipeline marcado como default por organización.
create unique index if not exists pipelines_org_default_unique
  on public.pipelines (organization_id)
  where is_default = true;

-- ---------------------------------------------------------------------------
-- 3. CHECK constraints
-- ---------------------------------------------------------------------------

-- Una oportunidad debe estar asociada a una Company, a un Contact, o a ambos.
alter table public.opportunities
  add constraint opportunities_company_or_contact_check
  check (company_id is not null or contact_id is not null);

alter table public.opportunities
  add constraint opportunities_amount_non_negative_check
  check (amount >= 0);

-- Un stage no puede ser simultáneamente ganado y perdido.
alter table public.stages
  add constraint stages_won_lost_exclusive_check
  check (not (is_won and is_lost));

-- Una actividad debe estar asociada al menos a Company, Contact u Opportunity.
alter table public.activities
  add constraint activities_related_entity_check
  check (
    company_id is not null
    or contact_id is not null
    or opportunity_id is not null
  );
