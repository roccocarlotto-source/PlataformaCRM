-- ---------------------------------------------------------------------------
-- Detalle de financiación (§42 de docs/frontend-cambios-pendientes.md): hasta
-- acá opportunities.financing_type era solo una categoría (Sin financiación /
-- Cuotas 24 / Cuotas 36 / Financiación propia), sin dónde cargar el plan real
-- que el vendedor arma con el cliente.
--
-- Cuatro columnas nullables en opportunities, aditivas y sin reescritura de
-- tabla, y no una tabla aparte: es UN juego de valores por oportunidad que se
-- corrige in-place con el PATCH común, mismo criterio que vehicle_id /
-- financing_type / lead_source. Sin CREATE TYPE (no hay enum nuevo), sin
-- backfill (las oportunidades anteriores quedan sin detalle, que es válido) y
-- sin FK.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). Las columnas son exactamente lo que `prisma migrate diff`
-- deriva del schema, para que no aparezca drift.
--
-- SIN CHECK que ate estas columnas a financing_type, a propósito: el detalle
-- se puede cargar con cualquier valor del enum (NONE incluido) y cambiar la
-- categoría no obliga a vaciar nada. Tampoco hay regla equivalente en el
-- service.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entran en este
-- mismo cambio los tres CHECK a la fila 8 (24 -> 27). Sin cambios en la fila 5
-- (RLS: la tabla ya tiene su política) ni en la 16 (no hay FK nueva).
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "financing_down_payment" DECIMAL(14,2),
ADD COLUMN     "financing_installment_amount" DECIMAL(14,2),
ADD COLUMN     "financing_installment_count" INTEGER,
ADD COLUMN     "financing_lender" VARCHAR(255);

-- ---------------------------------------------------------------------------
-- CHECK — el mismo molde que opportunities_amount_non_negative_check. Zod ya
-- los frena en el borde de la API; esto es el respaldo para cualquier camino
-- de escritura que no pase por ahí.
--
-- Sin `OR ... IS NULL`: un CHECK cuya expresión da NULL no se viola en
-- Postgres, así que la columna vacía pasa sola — el mismo criterio que
-- vehicles_specs_positive_check (mileage/doors/...) y
-- contacts_lead_budget_amount_non_negative_check, nullables también.
--
-- La entrega inicial y la cuota admiten 0 (entrega cero es un plan real); la
-- cantidad de cuotas no: un plan con cero cuotas no es un dato faltante sino
-- uno mal cargado, y para "no se cargó" está el NULL.
-- ---------------------------------------------------------------------------
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_financing_down_payment_non_negative_check"
    CHECK (financing_down_payment >= 0);

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_financing_installment_amount_non_negative_check"
    CHECK (financing_installment_amount >= 0);

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_financing_installment_count_positive_check"
    CHECK (financing_installment_count > 0);
