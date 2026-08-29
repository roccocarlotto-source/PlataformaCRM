-- P2.1 (Agenda/Booking), primer tramo: las entidades de configuración.
-- Branch, Resource y ServiceType. SIN Google Calendar y SIN Booking.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que las
-- migraciones de la capa de ingesta y del outbox (el único DATABASE_URL
-- disponible apunta al proyecto real y `migrate dev` usa una shadow database y
-- puede proponer un reset). Quien valida que aplica sobre una base vacía es el
-- job `integration` del CI.
--
-- ---------------------------------------------------------------------------
-- BRANCH ES UN PRERREQUISITO QUE EL DISEÑO DABA POR EXISTENTE
-- ---------------------------------------------------------------------------
--
-- docs/booking-architecture.md §3 modela las tres entidades de Booking con
-- `organizationId + sucursalId`, pero no había NINGUNA entidad de sucursal en
-- este schema — verificado con grep sobre el archivo completo, cero
-- coincidencias. Se agrega acá, en inglés (`Branch`/`branch_id`) porque el
-- resto del schema lo es; el `sucursalId` del documento era un desliz de
-- redacción y quedó corregido ahí.
--
-- Alcance acotado a propósito: SOLO las entidades de Booking llevan branch_id.
-- contacts, companies, opportunities, activities, pipelines y stages NO se
-- tocan. Sucursalizar el resto del CRM es una decisión mucho más grande.

-- ---------------------------------------------------------------------------
-- 1. Enum nativo
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('PERSON', 'ROOM', 'CLASS');

-- ---------------------------------------------------------------------------
-- 2. Tablas
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    -- Zona horaria IANA. Default 'UTC' y VarChar(50) replicando
    -- organizations.timezone, para que las dos tablas describan el mismo dato
    -- de la misma forma. El API igual la exige al crear.
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'UTC',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "ResourceType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "service_types_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 3. UNIQUE (organization_id, id) en las tablas PADRE
--
-- Es lo que habilita las FKs compuestas de C-3. Se agrega en branches y
-- resources porque algo las referencia; NO en service_types, que todavía no es
-- padre de nada — llega cuando exista Booking. Mismo criterio con el que se
-- dejó afuera google_calendar_id: no se agregan objetos que nadie usa.
-- ---------------------------------------------------------------------------

-- CreateIndex
CREATE UNIQUE INDEX "branches_organization_id_id_key" ON "branches"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "resources_organization_id_id_key" ON "resources"("organization_id", "id");

-- ---------------------------------------------------------------------------
-- 4. Índices
--
-- (organization_id, created_at) en las tres desde el arranque: la lección de
-- ALTO-6, donde las 6 entidades de negocio nacieron sin el índice de su propio
-- listado y hubo que agregarlo después.
--
-- Los (organization_id, branch_id) / (organization_id, resource_id) NO están
-- por ser el lado referenciante de una FK — Postgres solo lo necesitaría para
-- abaratar un DELETE del padre, y estas tablas usan soft delete, así que su
-- (organization_id, id) no cambia ni se borra nunca (mismo criterio que
-- ingestion_events). Están porque sirven consultas que sí existen: el filtro
-- "los recursos/servicios de esta sucursal", y los conteos de los RESTRICT de
-- deleteBranch y deleteResource.
-- ---------------------------------------------------------------------------

-- CreateIndex
CREATE INDEX "branches_organization_id_created_at_idx" ON "branches"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "resources_organization_id_created_at_idx" ON "resources"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "resources_organization_id_branch_id_idx" ON "resources"("organization_id", "branch_id");

-- CreateIndex
CREATE INDEX "service_types_organization_id_created_at_idx" ON "service_types"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "service_types_organization_id_branch_id_idx" ON "service_types"("organization_id", "branch_id");

-- CreateIndex
CREATE INDEX "service_types_organization_id_resource_id_idx" ON "service_types"("organization_id", "resource_id");

-- ---------------------------------------------------------------------------
-- 5. Foreign keys
--
-- Las tres CRUZADAS son COMPUESTAS (organization_id, x_id) -> padre
-- (organization_id, id), el estándar del proyecto desde C-3: Postgres rechaza a
-- nivel de motor cualquier fila cuya organización no coincida con la de la fila
-- referenciada.
--
-- ON DELETE RESTRICT en las tres, y no es una elección caso por caso: la regla
-- de 20260821140200 es columna referenciante nullable -> NO ACTION, NOT NULL ->
-- RESTRICT. branch_id y resource_id son NOT NULL. ON UPDATE CASCADE y MATCH
-- SIMPLE, como todas.
--
-- La fila 14 del diagnóstico toma estas tres SOLA, sin tocar el chequeo: sus
-- dos tablas tienen organization_id, que es exactamente su criterio de alcance.
-- Es el primer caso que ejercita esa generalización desde que se hizo.
--
-- Las FKs a organizations son de columna simple, como las 11 que ya existen:
-- organizations tiene id, no organization_id, así que no hay versión compuesta
-- posible de esa relación.
-- ---------------------------------------------------------------------------

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_organization_id_branch_id_fkey"
    FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_organization_id_branch_id_fkey"
    FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_organization_id_resource_id_fkey"
    FOREIGN KEY ("organization_id", "resource_id") REFERENCES "resources"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 6. CHECK constraints
--
-- Zod ya valida los dos en el borde HTTP. Estos son la defensa que sobrevive a
-- un camino de escritura que no pase por el controller — un script, un seed, un
-- worker futuro. Mismo criterio que opportunities_amount_non_negative_check.
--
-- No van en manual_constraints.sql: ese archivo quedó como referencia legible
-- del DDL anterior a C-2, y desde la capa de ingesta los objetos manuales
-- NUEVOS viven solo en su migración.
-- ---------------------------------------------------------------------------

ALTER TABLE "service_types" ADD CONSTRAINT "service_types_duration_positive_check"
    CHECK ("duration_min" > 0);

ALTER TABLE "service_types" ADD CONSTRAINT "service_types_capacity_positive_check"
    CHECK ("capacity" >= 1);
