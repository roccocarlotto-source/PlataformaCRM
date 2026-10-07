-- ---------------------------------------------------------------------------
-- Importación de datos para el alta de clientes (06/10/2026): TODO el esquema
-- de la Fase 1, en una sola migración (decisión 20 de
-- docs/importacion-de-datos.md, para autorizar una sola vez).
--
-- Tablas nuevas, las cuatro con organization_id, FKs compuestas (C-3) con la
-- regla de 20260821140200 (NOT NULL -> RESTRICT, nullable -> NO ACTION) y la
-- política RLS uniforme:
--   import_batches          el lote del asistente como entidad (§2.1)
--   external_record_links   la identidad del registro de origen (§2.2): el
--                           único (org, fuente, tipo, clave externa) es lo
--                           que hace que reimportar no duplique (§9.14 de
--                           ingestion-architecture.md)
--   vehicle_photo_imports   la cola de fotos a descargar (§6)
--   import_syncs            la sincronización del stock desde una planilla
--                           (§7), con el lock en la base (next_run_at +
--                           locked_until), no en memoria
--
-- Columnas nuevas, todas nullable y sin default: un ADD COLUMN así no
-- reescribe la tabla (ingestion_events es la de mayor volumen).
--   ingestion_events  row_number, plan, decision, outcome,
--                     promoted_entity_type, promoted_entity_id, changes (§2.4)
--   contacts          customer_since ("Cliente desde"), imported_at (§2.5)
--
-- Valores de enum nuevos:
--   IngestionStatus.STAGED     fila del asistente sin confirmar; el worker no
--                              la reclama (pide PENDING)
--   VehicleStatus.UNAVAILABLE  "No disponible" (§5.4)
-- Postgres no deja USAR un valor de enum en la transacción que lo agrega; esta
-- migración no los usa. IF NOT EXISTS como 20261025120000.
--
-- Sin FK a propósito (cada una explicada en su modelo de schema.prisma):
-- ingestion_events.batch_id (los lotes viejos de POST /api/imports no tienen
-- fila en import_batches), external_record_links.entity_id (apunta a cuatro
-- tablas según entity_type), vehicle_photo_imports.vehicle_photo_id (una foto
-- se borra a mano sin soft delete), y created_by_user_id / undone_by_user_id
-- (el platform admin no es miembro de la organización).
--
-- Sin CHECK ni índices parciales, como 20261024120000: cada uno entra en los
-- contadores de verify:schema; las reglas viven en los services.
--
-- Escrita a partir de `prisma migrate diff --from-schema-datasource` contra el
-- Supabase local, y completada a mano (RLS, IF NOT EXISTS, BEFORE 'PENDING'):
-- mismo motivo que el resto desde 20260821 (la shadow database no tiene el
-- schema auth). La valida el job `integration` del CI.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "ImportEntityType" AS ENUM ('COMPANY', 'CONTACT', 'ACTIVITY', 'VEHICLE');

-- CreateEnum
CREATE TYPE "ImportOriginKind" AS ENUM ('FILE', 'GOOGLE_SHEETS_LINK', 'SYNC');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('STAGED', 'ANALYZING', 'READY', 'RUNNING', 'DONE', 'CANCELLED', 'UNDOING', 'UNDONE');

-- CreateEnum
CREATE TYPE "ImportRowDecision" AS ENUM ('FILL_EMPTY', 'OVERWRITE', 'SKIP');

-- CreateEnum
CREATE TYPE "ImportRowOutcome" AS ENUM ('CREATED', 'UPDATED', 'UNCHANGED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "VehiclePhotoImportStatus" AS ENUM ('PENDING', 'DONE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ImportSyncRunStatus" AS ENUM ('OK', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportSyncPauseReason" AS ENUM ('MANUAL', 'AUTO_FAILURES');

-- AlterEnum
ALTER TYPE "IngestionStatus" ADD VALUE IF NOT EXISTS 'STAGED' BEFORE 'PENDING';

-- AlterEnum
ALTER TYPE "VehicleStatus" ADD VALUE IF NOT EXISTS 'UNAVAILABLE';

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "customer_since" DATE,
ADD COLUMN     "imported_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ingestion_events" ADD COLUMN     "changes" JSONB,
ADD COLUMN     "decision" "ImportRowDecision",
ADD COLUMN     "outcome" "ImportRowOutcome",
ADD COLUMN     "plan" JSONB,
ADD COLUMN     "promoted_entity_id" UUID,
ADD COLUMN     "promoted_entity_type" "ImportEntityType",
ADD COLUMN     "row_number" INTEGER;

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "sync_id" UUID,
    "entity_type" "ImportEntityType" NOT NULL,
    "origin_kind" "ImportOriginKind" NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'STAGED',
    "file_name" VARCHAR(255),
    "file_sha256" VARCHAR(64),
    "file_bytes" INTEGER,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL DEFAULT '{}',
    "counters" JSONB,
    "error_message" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "undone_at" TIMESTAMP(3),
    "undone_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_record_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "entity_type" "ImportEntityType" NOT NULL,
    "external_key" VARCHAR(255) NOT NULL,
    "entity_id" UUID NOT NULL,
    "created_by_batch_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_record_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_photo_imports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "url_sha256" VARCHAR(64) NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "VehiclePhotoImportStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "error" TEXT,
    "bytes" INTEGER,
    "vehicle_photo_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_photo_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_syncs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "sheet_id" VARCHAR(200) NOT NULL,
    "sheet_gid" VARCHAR(50) NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "interval_hours" INTEGER NOT NULL,
    "mark_missing_unavailable" BOOLEAN NOT NULL DEFAULT false,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "locked_until" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_status" "ImportSyncRunStatus",
    "last_error" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "paused_at" TIMESTAMP(3),
    "paused_reason" "ImportSyncPauseReason",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "import_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_organization_id_created_at_idx" ON "import_batches"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "import_batches_organization_id_status_idx" ON "import_batches"("organization_id", "status");

-- CreateIndex
CREATE INDEX "import_batches_organization_id_sync_id_idx" ON "import_batches"("organization_id", "sync_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_batches_organization_id_id_key" ON "import_batches"("organization_id", "id");

-- CreateIndex
CREATE INDEX "external_record_links_organization_id_entity_type_entity_id_idx" ON "external_record_links"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "external_record_links_organization_id_created_by_batch_id_idx" ON "external_record_links"("organization_id", "created_by_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_record_links_organization_id_source_id_entity_type_key" ON "external_record_links"("organization_id", "source_id", "entity_type", "external_key");

-- CreateIndex
CREATE INDEX "vehicle_photo_imports_organization_id_batch_id_idx" ON "vehicle_photo_imports"("organization_id", "batch_id");

-- CreateIndex
CREATE INDEX "vehicle_photo_imports_status_next_attempt_at_idx" ON "vehicle_photo_imports"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_photo_imports_organization_id_vehicle_id_url_sha256_key" ON "vehicle_photo_imports"("organization_id", "vehicle_id", "url_sha256");

-- CreateIndex
CREATE INDEX "import_syncs_organization_id_created_at_idx" ON "import_syncs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "import_syncs_next_run_at_idx" ON "import_syncs"("next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "import_syncs_organization_id_id_key" ON "import_syncs"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_organization_id_source_id_fkey" FOREIGN KEY ("organization_id", "source_id") REFERENCES "sources"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_organization_id_sync_id_fkey" FOREIGN KEY ("organization_id", "sync_id") REFERENCES "import_syncs"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_record_links" ADD CONSTRAINT "external_record_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_record_links" ADD CONSTRAINT "external_record_links_organization_id_source_id_fkey" FOREIGN KEY ("organization_id", "source_id") REFERENCES "sources"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_record_links" ADD CONSTRAINT "external_record_links_organization_id_created_by_batch_id_fkey" FOREIGN KEY ("organization_id", "created_by_batch_id") REFERENCES "import_batches"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_photo_imports" ADD CONSTRAINT "vehicle_photo_imports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_photo_imports" ADD CONSTRAINT "vehicle_photo_imports_organization_id_batch_id_fkey" FOREIGN KEY ("organization_id", "batch_id") REFERENCES "import_batches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_photo_imports" ADD CONSTRAINT "vehicle_photo_imports_organization_id_vehicle_id_fkey" FOREIGN KEY ("organization_id", "vehicle_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_syncs" ADD CONSTRAINT "import_syncs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_syncs" ADD CONSTRAINT "import_syncs_organization_id_source_id_fkey" FOREIGN KEY ("organization_id", "source_id") REFERENCES "sources"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row Level Security: la política uniforme por organización, en las cuatro.
alter table public.import_batches enable row level security;

drop policy if exists import_batches_isolation on public.import_batches;
create policy import_batches_isolation on public.import_batches
  for all
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());

alter table public.external_record_links enable row level security;

drop policy if exists external_record_links_isolation on public.external_record_links;
create policy external_record_links_isolation on public.external_record_links
  for all
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());

alter table public.vehicle_photo_imports enable row level security;

drop policy if exists vehicle_photo_imports_isolation on public.vehicle_photo_imports;
create policy vehicle_photo_imports_isolation on public.vehicle_photo_imports
  for all
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());

alter table public.import_syncs enable row level security;

drop policy if exists import_syncs_isolation on public.import_syncs;
create policy import_syncs_isolation on public.import_syncs
  for all
  using (organization_id = current_organization_id())
  with check (organization_id = current_organization_id());
