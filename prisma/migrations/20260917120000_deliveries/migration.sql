-- ---------------------------------------------------------------------------
-- Entrega (§40 de docs/frontend-cambios-pendientes.md): la tabla deliveries,
-- el enum DeliveryStatus y el valor DELIVERED en VehicleStatus. Una Delivery
-- es la entrega física de la unidad vendida al cliente, con su checklist; nace
-- sola cuando la oportunidad gana con unidad vinculada, y "Confirmar entrega"
-- pasa la unidad de SOLD a DELIVERED. Ver el comentario del modelo en
-- schema.prisma.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). El CREATE TABLE, el índice y las FKs son exactamente lo que
-- `prisma migrate diff` deriva del schema, para que no aparezca drift. Quien
-- valida que aplica sobre una base vacía es el job `integration` del CI, que
-- reconstruye la base desde cero en cada corrida.
--
-- DOS ENUMS, DOS REGLAS DISTINTAS de Postgres:
--   - DeliveryStatus nace acá (CREATE TYPE) y se usa como tipo y default de
--     columna en la misma transacción. Es legal: la prohibición ("unsafe use
--     of new value") aplica a ALTER TYPE ... ADD VALUE, no a CREATE TYPE.
--     Mismo molde que QuoteStatus en 20260916120000.
--   - VehicleStatus suma DELIVERED con ADD VALUE. Esta migración NO lo usa en
--     ningún lado —ni default, ni backfill, ni CHECK—, así que la prohibición
--     no la afecta. Mismo molde que OTHER en 20260911120000.
--
-- SIN CHECK de consistencia status/delivered_at/delivered_by_id: la sostiene
-- delivery.service.ts, la única puerta de escritura, igual que
-- confirmed_at/confirmed_by_id en 20260914120000. Un CHECK manual entra al
-- diagnóstico y a los contadores de verify:schema sin proteger ningún camino
-- de escritura real que el service no cubra ya.
--
-- LAS ACCIONES REFERENCIALES salen de la regla de 20260821140200 y la fila 14
-- del diagnóstico las deriva sola: opportunity_id es NOT NULL -> RESTRICT;
-- vehicle_id y delivered_by_id son nullable -> NO ACTION. Ninguna se dispara
-- en la práctica: opportunities y vehicles usan soft delete, y un User
-- referenciado no se borra físicamente (ver el comentario de User en
-- schema.prisma).
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entran en este
-- mismo cambio: la política de aislamiento a la fila 5 y las tres FKs
-- compuestas a la fila 16 (47 -> 50).
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'DELIVERED');

-- AlterEnum
ALTER TYPE "VehicleStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';

-- ---------------------------------------------------------------------------
-- 1. deliveries
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "scheduled_at" DATE,
    "delivered_at" TIMESTAMP(3),
    "delivered_by_id" UUID,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Una entrega por oportunidad: una entrega es UN evento real, no se supera ni
-- se recrea (a diferencia de quotes, que versiona). El mismo índice cubre la
-- lectura "la entrega de esta oportunidad" y el lado referenciante de la FK
-- compuesta a opportunities, que Postgres no indexa por su cuenta.
CREATE UNIQUE INDEX "deliveries_organization_id_opportunity_id_key" ON "deliveries"("organization_id", "opportunity_id");

-- ---------------------------------------------------------------------------
-- 2. Foreign keys — las tres cruzadas son COMPUESTAS
-- (organization_id, x_id) -> padre(organization_id, id), el estándar del
-- proyecto desde C-3. Apoyan en los UNIQUE (organization_id, id) que
-- opportunities, vehicles y users ya tienen.
-- ---------------------------------------------------------------------------

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organization_id_opportunity_id_fkey"
    FOREIGN KEY ("organization_id", "opportunity_id") REFERENCES "opportunities"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organization_id_vehicle_id_fkey"
    FOREIGN KEY ("organization_id", "vehicle_id") REFERENCES "vehicles"("organization_id", "id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organization_id_delivered_by_id_fkey"
    FOREIGN KEY ("organization_id", "delivered_by_id") REFERENCES "users"("organization_id", "id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. RLS — el patrón de aislamiento uniforme de M-5 (20260901120000), el
-- mismo que quotes, vehicles o automations: `for all` con USING y WITH CHECK
-- sobre current_organization_id(), y `drop policy if exists` antes del
-- create. La tabla tiene organization_id propio y no guarda secretos, así que
-- no hay motivo para la excepción deny-all de api_keys.
--
-- HOY NO ES ALCANZABLE desde afuera de Express: 20260821140100 revocó todo
-- grant a anon/authenticated sobre public y fijó `alter default privileges
-- ... revoke`, así que la tabla nace sin grants (fila 18 del diagnóstico). La
-- política es la SEGUNDA capa, para el día que alguien habilite Realtime o
-- haga un grant para un dashboard.
-- ---------------------------------------------------------------------------
alter table public.deliveries enable row level security;
drop policy if exists deliveries_isolation on public.deliveries;
create policy deliveries_isolation on public.deliveries
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
