-- ---------------------------------------------------------------------------
-- Pago del cliente (§43 de docs/frontend-cambios-pendientes.md): la tabla
-- payments y el enum PaymentMethod. Un Payment es un cobro que la agencia
-- registra dentro de una oportunidad (la entrega inicial, una cuota); cero o
-- más por oportunidad. Puramente informativo: no bloquea la entrega ni el
-- cierre, y no dispara automatizaciones. Ver el comentario del modelo en
-- schema.prisma.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). El CREATE TYPE, el CREATE TABLE, el índice y las FKs son
-- exactamente lo que `prisma migrate diff` deriva del schema, para que no
-- aparezca drift. Quien valida que aplica sobre una base vacía es el job
-- `integration` del CI, que reconstruye la base desde cero en cada corrida.
--
-- El enum nace en esta migración y SE USA como tipo de columna en la misma
-- transacción: legal, mismo molde que 20260916120000 (QuoteStatus).
--
-- LA ACCIÓN REFERENCIAL sale de la regla de 20260821140200 y la fila 14 del
-- diagnóstico la deriva sola: opportunity_id es NOT NULL -> RESTRICT. No se
-- dispara en la práctica: opportunities usa soft delete. Borrar un PAGO (el
-- DELETE físico que este ítem sí permite) es el lado hijo y no la toca.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entran en este
-- mismo cambio: la política de aislamiento a la fila 5, el CHECK a la fila 8
-- (27 -> 28) y la FK compuesta a la fila 16 (51 -> 52). El índice no tiene
-- fila: el diagnóstico solo afirma los índices únicos parciales (fila 7), los
-- de listado con deleted_at (ALTO-6) y los GIN de búsqueda (ALTO-7), y este no
-- es ninguno de los tres — mismo caso que el índice de quotes.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'CARD', 'CHECK', 'OTHER');

-- ---------------------------------------------------------------------------
-- 1. payments
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "paid_at" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- El historial de una oportunidad ordenado por fecha de cobro, con un solo
-- índice que además cubre el lado referenciante de la FK compuesta a
-- opportunities — que Postgres no indexa por su cuenta. Mismo criterio que
-- quotes_organization_id_opportunity_id_created_at_idx.
CREATE INDEX "payments_organization_id_opportunity_id_paid_at_idx" ON "payments"("organization_id", "opportunity_id", "paid_at");

-- ---------------------------------------------------------------------------
-- 2. CHECK — el importe cobrado es ESTRICTAMENTE positivo. A diferencia de
-- quotes_amount_non_negative_check y de
-- opportunities_financing_down_payment_non_negative_check (>= 0, donde un 0 es
-- información real), un pago de $0 no es un pago. Zod ya lo frena en el borde
-- de la API; esto es el respaldo para cualquier camino de escritura que no
-- pase por ahí.
-- ---------------------------------------------------------------------------
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive_check" CHECK (amount > 0);

-- ---------------------------------------------------------------------------
-- 3. Foreign keys — la cruzada es COMPUESTA (organization_id, opportunity_id)
-- -> opportunities(organization_id, id), el estándar del proyecto desde C-3.
-- ---------------------------------------------------------------------------

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_opportunity_id_fkey"
    FOREIGN KEY ("organization_id", "opportunity_id") REFERENCES "opportunities"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. RLS — el patrón de aislamiento uniforme de M-5 (20260901120000), el
-- mismo que quotes y deliveries: `for all` con USING y WITH CHECK sobre
-- current_organization_id(), y `drop policy if exists` antes del create.
--
-- HOY NO ES ALCANZABLE desde afuera de Express: 20260821140100 revocó todo
-- grant a anon/authenticated sobre public, así que la tabla nace sin grants
-- (fila 18 del diagnóstico). La política es la SEGUNDA capa.
-- ---------------------------------------------------------------------------
alter table public.payments enable row level security;
drop policy if exists payments_isolation on public.payments;
create policy payments_isolation on public.payments
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
