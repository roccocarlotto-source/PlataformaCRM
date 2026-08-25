-- ---------------------------------------------------------------------------
-- Diagnóstico de la auditoría del 2026-08-21
--
-- SOLO LECTURA. No crea, no modifica y no borra nada. Se puede correr en
-- producción sin riesgo.
--
-- Cómo usarlo:
--   Supabase → SQL Editor → New query → pegar todo → Run.
--   Devuelve una sola tabla con una fila por chequeo.
--
-- Responde las verificaciones pendientes de la sección 8 de
-- docs/auditoria-2026-08-21.md:
--   V-1 → ¿C-1 es explotable hoy?
--   V-2 → ¿cuáles de los 36 objetos de DDL existen en la base real?
--   V-3 → ¿el rol de la app realmente bypassea RLS?
-- ---------------------------------------------------------------------------

select n, chequeo, resultado, esperado
from (

  -- V-1 ─ ¿PostgREST puede escribir? Este es el chequeo que decide C-1.
  select 1 as n,
    'V-1 · Escritura de anon/authenticated sobre public' as chequeo,
    coalesce(string_agg(distinct grantee || ':' || privilege_type, ', '), 'ninguno') as resultado,
    'ninguno — si aparece INSERT/UPDATE/DELETE, C-1 es explotable hoy' as esperado
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee in ('anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE')

  union all

  -- V-1b ─ Lectura. Aunque la escritura esté cerrada, la lectura directa
  -- expone filas soft-deleted y emails de invitaciones a cualquier USER.
  select 2,
    'V-1b · Lectura de anon/authenticated sobre public',
    coalesce(string_agg(distinct grantee || ':' || table_name, ', '), 'ninguno'),
    'ninguno si se aplica la opción A de C-1'
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee in ('anon', 'authenticated')
    and privilege_type = 'SELECT'

  union all

  -- V-3 ─ Premisa de toda la sección 5 de authentication-architecture.md.
  select 3,
    'V-3 · Roles con BYPASSRLS',
    coalesce(string_agg(rolname, ', '), 'ninguno'),
    'el rol de DATABASE_URL debería estar acá'
  from pg_roles
  where rolbypassrls and rolname not like 'pg\_%'

  union all

  -- V-2 ─ RLS habilitada.
  select 4,
    'V-2 · Tablas de public SIN row level security',
    coalesce(string_agg(c.relname, ', '), 'ninguna'),
    'a lo sumo _prisma_migrations'
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity

  union all

  select 5,
    'V-2 · Políticas RLS presentes',
    count(*)::text,
    '12 (10 de rls_policies.sql + 2 de la capa de ingesta — api_keys es
     deny-all a propósito: RLS activa y sin políticas)'
  from pg_policies
  where schemaname = 'public'

  union all

  -- V-2 ─ Políticas que permiten escritura: la causa raíz de C-1.
  select 6,
    'C-1 · Políticas con permiso de escritura (cmd = ALL)',
    coalesce(string_agg(policyname, ', '), 'ninguna'),
    'ninguna si se aplica la opción B de C-1'
  from pg_policies
  where schemaname = 'public' and cmd = 'ALL'

  union all

  -- V-2 ─ Los 8 índices únicos parciales: los 7 de manual_constraints.sql
  -- más el de idempotencia de la ingesta, que vive en la migración
  -- 20260824120000 (C-2: no hay DDL fuera de las migraciones).
  select 7,
    'V-2 · Índices únicos parciales FALTANTES',
    coalesce(string_agg(e.nombre, ', '), 'ninguno'),
    'ninguno'
  from (values
    ('contacts_org_email_unique'),
    ('pipelines_org_default_unique'),
    ('stages_pipeline_order_unique'),
    ('stages_pipeline_name_unique'),
    ('stages_pipeline_won_unique'),
    ('stages_pipeline_lost_unique'),
    ('invitations_org_email_pending_unique'),
    ('ingestion_events_source_external_unique')
  ) as e(nombre)
  where not exists (
    select 1 from pg_indexes i
    where i.schemaname = 'public' and i.indexname = e.nombre
  )

  union all

  -- V-2 ─ Los 4 CHECK constraints.
  select 8,
    'V-2 · CHECK constraints FALTANTES',
    coalesce(string_agg(e.nombre, ', '), 'ninguno'),
    'ninguno'
  from (values
    ('opportunities_company_or_contact_check'),
    ('opportunities_amount_non_negative_check'),
    ('stages_won_lost_exclusive_check'),
    ('activities_related_entity_check')
  ) as e(nombre)
  where not exists (
    select 1 from pg_constraint c
    where c.conname = e.nombre and c.contype = 'c'
  )

  union all

  -- V-2 ─ Los 2 triggers de sincronización de email.
  select 9,
    'V-2 · Triggers de email FALTANTES',
    coalesce(string_agg(e.nombre, ', '), 'ninguno'),
    'ninguno'
  from (values
    ('trg_set_user_email_from_auth'),
    ('trg_propagate_auth_email_change')
  ) as e(nombre)
  where not exists (
    select 1 from pg_trigger t
    where not t.tgisinternal and t.tgname = e.nombre
  )

  union all

  select 10,
    'V-2 · Función current_organization_id()',
    case when exists (
      select 1 from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname = 'current_organization_id'
    ) then 'presente' else 'FALTA' end,
    'presente'

  union all

  -- A-6 ─ Índices que sirven al orden por defecto de los listados.
  select 11,
    'A-6 · Índices que empiezan por (organization_id, created_at)',
    coalesce(string_agg(indexname, ', '), 'ninguno'),
    '6, uno por entidad listable (A-6 sigue abierto para las 6 viejas) —
     sources ya lo tiene, parcial, desde la capa de ingesta'
  from pg_indexes
  where schemaname = 'public'
    and indexdef like '%(organization_id, created_at%'

  union all

  -- A-7 ─ Búsqueda de texto.
  select 12,
    'A-7 · Extensión pg_trgm',
    case when exists (select 1 from pg_extension where extname = 'pg_trgm')
      then 'instalada' else 'no instalada' end,
    'instalada solo si se implementa la opción A de A-7'

  union all

  -- B-9 ─ Filas cuyo UPDATE pondría email = NULL y violaría el NOT NULL.
  select 13,
    'B-9 · Filas de public.users sin fila en auth.users',
    count(*)::text,
    '0 — si es > 0, esos usuarios no se pueden actualizar ni remover'
  from public.users u
  where not exists (select 1 from auth.users a where a.id = u.id)

  union all

  -- C-3 ─ Las FKs compuestas por organización. Es la garantía de aislamiento
  -- central del proyecto —Postgres rechazando a nivel de motor cualquier fila
  -- cuya organización no coincida con la de la fila referenciada— y hasta la
  -- capa de ingesta nada en CI comprobaba que existieran. Cuenta solo las FKs
  -- de exactamente dos columnas cuya primera columna, de los dos lados, es
  -- organization_id.
  select 14,
    'C-3 · FKs compuestas (organization_id, x_id) -> padre(organization_id, id)',
    count(*)::text,
    '18 — 15 de la migración 20260821140200 + 3 de la capa de ingesta'
  from pg_constraint c
  join pg_namespace ns on ns.oid = c.connamespace
  where ns.nspname = 'public'
    and c.contype = 'f'
    and array_length(c.conkey, 1) = 2
    and (
      select a.attname from pg_attribute a
      where a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    ) = 'organization_id'
    and (
      select a.attname from pg_attribute a
      where a.attrelid = c.confrelid and a.attnum = c.confkey[1]
    ) = 'organization_id'

) as diagnostico
order by n;


-- ---------------------------------------------------------------------------
-- Prueba definitiva de C-1 (opcional, fuera de SQL — solo si el chequeo 1
-- devuelve algo distinto de "ninguno").
--
-- Con la sesión de un usuario de rol USER abierta en la app, en la consola
-- del navegador:
--
--   const { data, error } = await window.supabase
--     .from('roles').select('id,name');
--   console.log(data, error);
--
-- Si `data` trae los roles, PostgREST está abierto. NO ejecutar el PATCH de
-- escalada contra una base con datos reales: alcanza con confirmar la
-- lectura.
-- ---------------------------------------------------------------------------
