-- ---------------------------------------------------------------------------
-- Base de conocimiento por sucursal (ítem 59 de
-- docs/frontend-cambios-pendientes.md): la tabla knowledge_base_entries.
--
-- Cierra el pendiente "Contexto de negocio por cliente" de
-- docs/ai-agent-architecture.md §10, con dos decisiones que cambian la forma
-- que ese pendiente imaginaba: es una LISTA DE ENTRADAS CON TÍTULO y no un
-- campo de texto único en organizations o branches, y cuelga de la SUCURSAL
-- —igual que agents— porque horarios y políticas son de la sucursal. Ver el
-- comentario del modelo en schema.prisma.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). El CREATE TABLE, el índice y las FKs son exactamente lo que
-- `prisma migrate diff` deriva del schema, para que no aparezca drift. Quien
-- valida que aplica sobre una base vacía es el job `integration` del CI, que
-- reconstruye la base desde cero en cada corrida.
--
-- SIN backfill y sin enum nuevo: la tabla nace vacía y todas sus columnas son
-- propias.
--
-- LAS ACCIONES REFERENCIALES salen de la regla de 20260821140200 y la fila 14
-- del diagnóstico las deriva sola: organization_id y branch_id son NOT NULL
-- -> RESTRICT. Ninguna se dispara en la práctica (branches usa soft delete),
-- y si alguien introduce un borrado físico, que falle ruidosamente.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entran en este
-- mismo cambio: la política de aislamiento a la fila 5 (23 -> 24 políticas) y
-- la FK compuesta a la fila 16 (52 -> 53). No entra a la fila 8 (no agrega
-- ningún CHECK: los topes de largo de title/content los pone Zod en el borde,
-- y VarChar(200) ya es la restricción de la columna del título) ni a la 11
-- (esa lista es de las siete entidades listables del CRM, y agents —el
-- modelo más parecido, también con soft delete— tampoco está).
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "knowledge_base_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "knowledge_base_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Un solo índice para los dos accesos reales: el listado filtrado por sucursal
-- y la lectura ordenada del loop del agente (las entradas activas de su
-- sucursal por created_at, en cada turno). Cubre además el lado referenciante
-- de la FK compuesta a branches, que Postgres no indexa por su cuenta. Mismo
-- criterio que payments_organization_id_opportunity_id_paid_at_idx.
CREATE INDEX "knowledge_base_entries_organization_id_branch_id_created_at_idx" ON "knowledge_base_entries"("organization_id", "branch_id", "created_at");

-- ---------------------------------------------------------------------------
-- Foreign keys — la cruzada es COMPUESTA (organization_id, branch_id) ->
-- branches(organization_id, id), el estándar del proyecto desde C-3. Apoya en
-- el UNIQUE (organization_id, id) que branches ya tiene. Es la misma forma que
-- agents_organization_id_branch_id_fkey.
-- ---------------------------------------------------------------------------

-- AddForeignKey
ALTER TABLE "knowledge_base_entries" ADD CONSTRAINT "knowledge_base_entries_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_base_entries" ADD CONSTRAINT "knowledge_base_entries_organization_id_branch_id_fkey"
    FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS — el patrón de aislamiento uniforme de M-5 (20260901120000), el mismo
-- que quotes, deliveries o payments: `for all` con USING y WITH CHECK sobre
-- current_organization_id(), y `drop policy if exists` antes del create. La
-- tabla tiene organization_id propio y no guarda secretos, así que no hay
-- motivo para la excepción deny-all de api_keys.
--
-- VA EN LA MIGRACIÓN y no en prisma/sql/rls_policies.sql, que es donde la
-- convención actual del proyecto las pone desde 20260901120000 — agents no
-- tiene política en ninguno de los dos lados, y ese hueco no es un modelo a
-- seguir (ver el encabezado de 20260912130000, que lo justificaba por
-- paralelismo con bookings/resources, anterior a M-5).
--
-- HOY NO ES ALCANZABLE desde afuera de Express: 20260821140100 revocó todo
-- grant a anon/authenticated sobre public y fijó `alter default privileges
-- ... revoke`, así que la tabla nace sin grants (fila 18 del diagnóstico). La
-- política es la SEGUNDA capa, para el día que alguien habilite Realtime o
-- haga un grant para un dashboard.
-- ---------------------------------------------------------------------------
alter table public.knowledge_base_entries enable row level security;
drop policy if exists knowledge_base_entries_isolation on public.knowledge_base_entries;
create policy knowledge_base_entries_isolation on public.knowledge_base_entries
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
