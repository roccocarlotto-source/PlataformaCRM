-- ---------------------------------------------------------------------------
-- Calificación del lead: diez columnas nuevas en contacts, todas NULL
-- (docs/roadmap-implementacion.md, 2.2 Agentes de IA; docs/project-overview.md,
-- sección 4, Contact).
--
-- Resuelve el pendiente abierto el 28/08/2026 al formalizar Lead vs. Contact:
-- los atributos de calificación que el documento de visión asignaba a `Lead`
-- (score, intención, servicio de interés, urgencia, presupuesto, ubicación,
-- notas, datos recopilados por IA, campos personalizados) no tenían dónde
-- vivir. Decisión: columnas en Contact y no una tabla aparte — la relación
-- es 1:1 y no hace falta historial. Todas nullable a propósito: un negocio
-- que no usa calificación no pierde funcionalidad.
--
-- SOLO SCHEMA. Ningún endpoint, service ni formulario lee o escribe estas
-- columnas todavía; quien las va a completar es el futuro
-- create_lead()/update_lead() del agente de IA. Por eso no hay backfill (nace
-- todo NULL), no hay índices (ninguna consulta filtra por ellas) y no hay
-- cambio en los schemas de Zod de Contact.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). Quien valida que aplica sobre una base vacía es el job
-- `integration` del CI, que reconstruye la base desde cero en cada corrida.
--
-- El enum LeadUrgency nace en esta misma migración y ninguna sentencia lo USA
-- (ni default, ni backfill, ni CHECK), así que la prohibición de Postgres de
-- usar un valor de enum en la transacción que lo crea no aplica. Mismo molde
-- que 20260911120000 (VehicleWarranty.OTHER).
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "LeadUrgency" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "lead_score" INTEGER,
  ADD COLUMN IF NOT EXISTS "lead_intent" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "lead_service_of_interest" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "lead_urgency" "LeadUrgency",
  ADD COLUMN IF NOT EXISTS "lead_budget_amount" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "lead_budget_currency" VARCHAR(3),
  ADD COLUMN IF NOT EXISTS "lead_location" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "lead_notes" TEXT,
  ADD COLUMN IF NOT EXISTS "lead_ai_data" JSONB,
  ADD COLUMN IF NOT EXISTS "custom_fields" JSONB;

-- ---------------------------------------------------------------------------
-- CHECK constraints — la defensa que sobrevive a un camino de escritura que
-- no pase por un controller (un seed, un script, la tool del agente). Viven
-- acá y NO en prisma/sql/manual_constraints.sql: B-15 de
-- docs/auditoria-2026-08-29.md sacó los CHECK de la reaplicación por deploy,
-- porque un ADD CONSTRAINT ... CHECK revalida cada fila bajo ACCESS EXCLUSIVE
-- y reaplicarlo en cada deploy era exactamente lo que los CHECK no eran.
-- Mismo criterio que vehicles_* (20260907120000).
--
-- Sobre columnas NULLABLES: un CHECK cuya expresión da NULL PASA, así que
-- `lead_score >= 0 and lead_score <= 100` admite la fila sin score sin
-- escribir `is null or`. Es exactamente lo pedido: NULL o dentro del rango.
--
-- Los dos entran a la fila 8 de docs/auditoria-2026-08-21-diagnostico.sql y
-- al contador de scripts/verify-schema.ts en este mismo cambio.
-- ---------------------------------------------------------------------------

-- 0..100: información auxiliar, nunca gating, pero un 250 es un dato mal
-- cargado y no un score.
alter table public.contacts
  add constraint contacts_lead_score_range_check
  check (lead_score >= 0 and lead_score <= 100);

-- Cero SÍ es válido ("presupuesto cero" es un dato); negativo no. Para "sin
-- presupuesto" está el NULL, por eso la columna no tiene default.
alter table public.contacts
  add constraint contacts_lead_budget_amount_non_negative_check
  check (lead_budget_amount >= 0);
