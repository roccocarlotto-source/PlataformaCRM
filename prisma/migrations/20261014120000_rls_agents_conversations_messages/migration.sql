-- ---------------------------------------------------------------------------
-- A-02 de la auditoría del 24/09 (docs-privados/auditoria-2026-09-24-punta-a-punta.md,
-- local, no está en GitHub): RLS en agents, conversations y messages.
--
-- Eran las ÚNICAS tablas del schema sin row level security, ni siquiera
-- habilitada. El encabezado de 20260912130000_agent_conversation_message_schema
-- lo justificaba con que bookings, working_hours, resources, service_types y
-- google_calendar_connections "tampoco las tienen" — pero 20260901120000
-- (M-5) ya se las había dado. Ese comentario quedó desactualizado; las
-- migraciones aplicadas son inmutables, así que la corrección vive acá.
--
-- HOY NO ES EXPLOTABLE: 20260821140100 revocó todo grant a anon/authenticated
-- sobre public (y los default privileges), así que PostgREST no llega a estas
-- tablas. Lo que faltaba es la SEGUNDA capa, y justo en las tablas que guardan
-- la transcripción de cada cliente con el agente (datos personales, y
-- tool_calls con sus argumentos): el día que alguien habilite Realtime o haga
-- un `grant select on conversations to authenticated` para un dashboard, sin
-- política el grant expone todos los tenants.
--
-- MISMO PATRÓN EXACTO que las demás tablas uniformes (M-5, 20260901120000):
-- `for all` con USING y WITH CHECK sobre current_organization_id(), y `drop
-- policy if exists` antes de cada create. La fila 5 del diagnóstico
-- (docs/auditoria-2026-08-21-diagnostico.sql) compara las políticas por
-- DEFINICIÓN: las tres tablas entran a su `values(...)` en el mismo PR.
--
-- Express no se entera: el backend se conecta con el rol dueño de las tablas
-- (postgres), que no está sujeto a RLS sin FORCE ROW LEVEL SECURITY — igual
-- que en las otras 35 tablas.
-- ---------------------------------------------------------------------------

alter table public.agents enable row level security;
drop policy if exists agents_isolation on public.agents;
create policy agents_isolation on public.agents
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.conversations enable row level security;
drop policy if exists conversations_isolation on public.conversations;
create policy conversations_isolation on public.conversations
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.messages enable row level security;
drop policy if exists messages_isolation on public.messages;
create policy messages_isolation on public.messages
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
