-- ---------------------------------------------------------------------------
-- Permuta (§41 de docs/frontend-cambios-pendientes.md): el vínculo explícito
-- entre una unidad del stock y la oportunidad de venta en la que el cliente la
-- entregó como parte de pago. Hasta acá origin = TRADE_IN era un dato suelto:
-- nada decía EN QUÉ venta se había recibido la unidad.
--
-- Un solo cambio, aditivo y sin reescritura de tabla: la columna nullable
-- trade_in_opportunity_id en vehicles, con su índice y su FK compuesta. Sin
-- CREATE TYPE ni ALTER TYPE: no hay enum nuevo. Sin backfill: las unidades
-- TRADE_IN anteriores no tienen de dónde sacar la oportunidad, y quedan sin
-- vínculo, que sigue siendo un estado válido.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). La columna, el índice y la FK son exactamente lo que
-- `prisma migrate diff` deriva del schema, para que no aparezca drift. Quien
-- valida que aplica sobre una base vacía es el job `integration` del CI, que
-- reconstruye la base desde cero en cada corrida.
--
-- SIN CHECK "trade_in_opportunity_id IS NULL OR origin = 'TRADE_IN'", a
-- propósito y a diferencia de vehicles_consignment_fields_require_origin_check:
-- el vínculo no depende del origen (una unidad TRADE_IN sin vínculo es válida,
-- y cambiar el origen no obliga a vaciar nada). Tampoco hay regla equivalente
-- en el service.
--
-- SIN UNIQUE: una venta puede recibir más de una unidad en permuta. "Las
-- unidades de esta oportunidad" se resuelve por consulta, sobre el índice
-- (organization_id, trade_in_opportunity_id), que además es el lado
-- referenciante de la FK — Postgres no lo crea solo.
--
-- LA ACCIÓN REFERENCIAL sale de la regla de 20260821140200 y la fila 14 del
-- diagnóstico la deriva sola: columna nullable -> NO ACTION. No se dispara en
-- la práctica: opportunities usa soft delete. Validar que la oportunidad no
-- esté dada de baja es del service (validateTradeInOpportunityId).
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entra en este
-- mismo cambio la FK a la fila 16 (50 -> 51). Sin cambios en la fila 5 (RLS:
-- la tabla ya tiene su política) ni en la 8 (no hay CHECK nuevo).
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN "trade_in_opportunity_id" UUID;

-- CreateIndex
CREATE INDEX "vehicles_organization_id_trade_in_opportunity_id_idx" ON "vehicles"("organization_id", "trade_in_opportunity_id");

-- AddForeignKey
-- Compuesta (organization_id, trade_in_opportunity_id) -> opportunities
-- (organization_id, id), el estándar del proyecto desde C-3: una unidad de una
-- organización no puede apuntar a una venta de otra ni aunque el service se
-- equivoque. Apoya en el UNIQUE (organization_id, id) de opportunities.
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organization_id_trade_in_opportunity_id_fkey"
    FOREIGN KEY ("organization_id", "trade_in_opportunity_id") REFERENCES "opportunities"("organization_id", "id")
    ON DELETE NO ACTION ON UPDATE CASCADE;
