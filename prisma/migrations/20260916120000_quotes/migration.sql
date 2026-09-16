-- ---------------------------------------------------------------------------
-- Cotización (§39 de docs/frontend-cambios-pendientes.md): la tabla quotes y
-- el enum QuoteStatus. Una Quote es la oferta de precio que se le hace al
-- cliente dentro de una oportunidad; cada contraoferta es una fila nueva y la
-- anterior queda en el historial (SUPERSEDED). Ver el comentario del modelo
-- en schema.prisma.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). El CREATE TABLE, el índice y las FKs son exactamente lo que
-- `prisma migrate diff` deriva del schema, para que no aparezca drift. Quien
-- valida que aplica sobre una base vacía es el job `integration` del CI, que
-- reconstruye la base desde cero en cada corrida.
--
-- El enum nace en esta migración y SE USA como tipo de columna en la misma
-- transacción. Es legal: la prohibición de Postgres ("unsafe use of new
-- value") aplica a ALTER TYPE ... ADD VALUE, no a CREATE TYPE. Mismo molde
-- que 20260913120000 (AutomationExecutionStatus).
--
-- LAS ACCIONES REFERENCIALES salen de la regla de 20260821140200 y la fila 14
-- del diagnóstico las deriva sola: opportunity_id y created_by_id son NOT NULL
-- -> RESTRICT; vehicle_id es nullable -> NO ACTION. Ninguna se dispara en la
-- práctica: opportunities y vehicles usan soft delete, y un User referenciado
-- no se borra físicamente (ver el comentario de User en schema.prisma).
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entran en este
-- mismo cambio: la política de aislamiento a la fila 5, el CHECK a la fila 8
-- y las tres FKs compuestas a la fila 16 (44 -> 47).
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED');

-- ---------------------------------------------------------------------------
-- 1. quotes
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "created_by_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "valid_until" DATE,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- El historial de una oportunidad ordenado y "la activa" (la más reciente que
-- no está SUPERSEDED), con un solo índice que además cubre el lado
-- referenciante de la FK compuesta a opportunities — que Postgres no indexa
-- por su cuenta. Mismo criterio que
-- agent_embed_tokens_organization_id_agent_id_created_at_idx.
CREATE INDEX "quotes_organization_id_opportunity_id_created_at_idx" ON "quotes"("organization_id", "opportunity_id", "created_at");

-- ---------------------------------------------------------------------------
-- 2. CHECK — el mismo que opportunities_amount_non_negative_check: el precio
-- ofertado no es negativo. Zod ya lo frena en el borde de la API; esto es el
-- respaldo para cualquier camino de escritura que no pase por ahí. Las líneas
-- (JSONB) sí pueden ser negativas —un descuento— y no llevan CHECK: su forma
-- la valida zod, como automations.action_config.
-- ---------------------------------------------------------------------------
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_amount_non_negative_check" CHECK (amount >= 0);

-- ---------------------------------------------------------------------------
-- 3. Foreign keys — las tres cruzadas son COMPUESTAS
-- (organization_id, x_id) -> padre(organization_id, id), el estándar del
-- proyecto desde C-3. Apoyan en los UNIQUE (organization_id, id) que
-- opportunities, vehicles y users ya tienen.
-- ---------------------------------------------------------------------------

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_opportunity_id_fkey"
    FOREIGN KEY ("organization_id", "opportunity_id") REFERENCES "opportunities"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_vehicle_id_fkey"
    FOREIGN KEY ("organization_id", "vehicle_id") REFERENCES "vehicles"("organization_id", "id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_created_by_id_fkey"
    FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "users"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. RLS — el patrón de aislamiento uniforme de M-5 (20260901120000), el
-- mismo que bookings, vehicles o automations: `for all` con USING y WITH
-- CHECK sobre current_organization_id(), y `drop policy if exists` antes del
-- create. La tabla tiene organization_id propio y no guarda secretos, así que
-- no hay motivo para la excepción deny-all de api_keys.
--
-- HOY NO ES ALCANZABLE desde afuera de Express: 20260821140100 revocó todo
-- grant a anon/authenticated sobre public y fijó `alter default privileges
-- ... revoke`, así que la tabla nace sin grants (fila 18 del diagnóstico). La
-- política es la SEGUNDA capa, para el día que alguien habilite Realtime o
-- haga un grant para un dashboard.
-- ---------------------------------------------------------------------------
alter table public.quotes enable row level security;
drop policy if exists quotes_isolation on public.quotes;
create policy quotes_isolation on public.quotes
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
