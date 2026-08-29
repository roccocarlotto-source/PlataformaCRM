-- ---------------------------------------------------------------------------
-- M-5 de docs/auditoria-2026-08-29.md — RLS en las siete tablas que nacieron
-- sin ella.
--
-- Las migraciones del 28, 29, 30 y 31 de agosto (outbox_events, branches,
-- resources, service_types, google_calendar_connections, working_hours,
-- bookings) crearon tablas con organization_id propio y FKs compuestas, pero
-- ninguna habilitó row level security ni creó política. Contradecía la
-- política de C-2 (20260821140000: RLS como defensa en profundidad para
-- cualquier camino de acceso que no sea Express) y lo que 20260824120000 dejó
-- escrito al agregar la ingesta: "RLS se habilita igual, para que la fila 4
-- del diagnóstico siga diciendo 'a lo sumo _prisma_migrations'".
--
-- HOY NO ES EXPLOTABLE: 20260821140100 revocó todo grant a anon/authenticated
-- sobre public y fijó `alter default privileges ... revoke`, así que estas
-- tablas nacieron sin grants y PostgREST no llega a ellas. Lo que falta es la
-- SEGUNDA capa: el día que alguien habilite Realtime o haga un `grant select
-- on bookings to authenticated` para un dashboard, en las 12 tablas con RLS la
-- política filtra por organización; en éstas, sin política, el grant expone
-- todos los tenants — y en google_calendar_connections, los refresh tokens
-- cifrados de todas las sucursales.
--
-- MISMO PATRÓN EXACTO que las diez tablas uniformes (users, companies,
-- contacts, opportunities, pipelines, activities, stages, invitations,
-- sources, ingestion_events): `for all` con USING y WITH CHECK sobre
-- current_organization_id(), y `drop policy if exists` antes de cada create.
-- La fila 5 del diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql)
-- compara estas políticas por DEFINICIÓN, no por conteo: las seis tablas
-- entran a su `values(...)` en el mismo PR.
--
-- NADA DE LO ANTERIOR SE TOCA: las migraciones ya aplicadas son inmutables.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Tablas con organization_id propio — patrón de aislamiento uniforme.
-- ---------------------------------------------------------------------------
alter table public.outbox_events enable row level security;
drop policy if exists outbox_events_isolation on public.outbox_events;
create policy outbox_events_isolation on public.outbox_events
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.branches enable row level security;
drop policy if exists branches_isolation on public.branches;
create policy branches_isolation on public.branches
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.resources enable row level security;
drop policy if exists resources_isolation on public.resources;
create policy resources_isolation on public.resources
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.service_types enable row level security;
drop policy if exists service_types_isolation on public.service_types;
create policy service_types_isolation on public.service_types
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.working_hours enable row level security;
drop policy if exists working_hours_isolation on public.working_hours;
create policy working_hours_isolation on public.working_hours
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.bookings enable row level security;
drop policy if exists bookings_isolation on public.bookings;
create policy bookings_isolation on public.bookings
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

-- ---------------------------------------------------------------------------
-- google_calendar_connections: RLS habilitada y DELIBERADAMENTE SIN NINGUNA
-- POLÍTICA — deny-all, mismo criterio y misma razón que api_keys
-- (20260824120000). Con RLS activa y cero políticas, Postgres deniega todo a
-- cualquier rol que no tenga BYPASSRLS.
--
-- Es la segunda tabla del schema que guarda material criptográfico: el refresh
-- token de Google de cada sucursal, cifrado con AES-256-GCM
-- (src/utils/encryption.ts). Cifrado o no, no debe ser legible por ningún
-- camino que no sea el backend — ni siquiera por el ADMIN de su propia
-- organización a través de PostgREST. Todo lo que el frontend necesita de esta
-- tabla (estado de la conexión, motivo del último error) sale por
-- GET /api/branches/:branchId/google-calendar, que Express sirve con un
-- `select` que excluye el token y con la conexión de la app, que tiene
-- BYPASSRLS.
--
-- Por eso esta tabla NO entra al `values(...)` de la fila 5 del diagnóstico:
-- ahí se listan las que tienen política de aislamiento, y ésta no tiene que
-- tener ninguna. La fila 4 (tablas sin RLS) sí la deja de listar.
-- ---------------------------------------------------------------------------
alter table public.google_calendar_connections enable row level security;
