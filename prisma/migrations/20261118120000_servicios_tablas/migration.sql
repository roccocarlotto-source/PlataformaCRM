-- ---------------------------------------------------------------------------
-- S1 de docs/servicios.md (§11): las tablas del módulo Servicios (el taller de
-- postventa de una concesionaria).
--
-- TODO ADITIVO E INERTE. Diez tablas nuevas, vacías, y seis enums. No toca
-- ninguna tabla ni fila existente. Nadie las lee ni las escribe hasta S2
-- (activación y gate) y S3/S4 (vehículos y órdenes): aplicada antes que el
-- código, no cambia nada para ninguna organización.
--
--   organization_modules            los módulos activables de una organización (§1.2)
--   workshop_settings               la configuración del taller, 1:1 (§2.6)
--   customer_vehicles               el vehículo de un cliente (§2.2)
--   customer_vehicle_owner_changes  cambios de dueño y fin de propiedad (§2.2.1)
--   service_job_types               los tipos de service del taller (§2.6)
--   service_orders                  la orden de servicio (§2.3)
--   service_order_status_changes    el historial de estados (§2.4)
--   service_order_approvals         las aprobaciones registradas a mano (§2.5)
--   service_order_job_types         los tipos de una orden (§2.6)
--   service_order_photos            las fotos de antes y después (§2.7, §4.9)
--
-- FKs: compuestas (organization_id, x_id) -> padre(organization_id, id) entre
-- tablas con organización (C-3), con la regla de 20260821140200: columna NOT
-- NULL -> RESTRICT, nullable -> NO ACTION, ON UPDATE CASCADE. Sin excepciones
-- declaradas. Ninguna se dispara en el uso normal: contactos, usuarios,
-- sucursales, unidades del stock y oportunidades usan soft delete, y las
-- órdenes no se borran. Las FKs que pasaban de 63 caracteres llevan un nombre
-- corto (Postgres trunca sin aviso).
--
-- organization_modules.enabled_by_id / disabled_by_id: el platform admin es
-- un usuario de OTRA organización, así que no hay FK (ver schema.prisma).
--
-- customer_vehicles <-> service_orders es circular (la orden apunta al
-- vehículo, y el vehículo a la orden de la que salió su próximo service): la
-- FK de vuelta se agrega después de crear las dos tablas.
--
-- Escrita a mano (la shadow database no tiene el schema auth). Las sentencias
-- de tabla, FKs e índices no parciales son las que deriva `prisma migrate
-- diff` del schema; los índices parciales y de expresión, los CHECK y la RLS
-- son lo que el DSL de Prisma no expresa. Al diagnóstico
-- (docs/auditoria-2026-08-21-diagnostico.sql) entran: las políticas a la fila
-- 5, los únicos parciales a la fila 7, los CHECK a la fila 8, las FKs a la
-- fila 16 y los índices parciales no únicos a la suya.
--
-- ROLLBACK: docs del PR (DROP de las diez tablas en orden inverso y de los
-- seis enums). Las tablas están vacías hasta S2, así que no se pierde nada.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "ServiceOrderStatus" AS ENUM ('AGENDADO', 'RECIBIDO', 'EN_TRABAJO', 'ESPERANDO_APROBACION', 'LISTO_PARA_RETIRAR', 'ENTREGADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "CustomerVehicleEndReason" AS ENUM ('VENDIDO_A_TERCERO', 'PERMUTA', 'OTRO');

-- CreateEnum
CREATE TYPE "CustomerVehicleOwnerChangeKind" AS ENUM ('CAMBIO_DE_DUENO', 'FIN');

-- CreateEnum
CREATE TYPE "ServiceOrderApprovalChannel" AS ENUM ('TELEFONO', 'WHATSAPP', 'PRESENCIAL', 'OTRO');

-- CreateEnum
CREATE TYPE "ServiceOrderApprovalDecision" AS ENUM ('APROBADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "ServiceOrderPhotoPhase" AS ENUM ('ANTES', 'DESPUES');

-- CreateTable
CREATE TABLE "organization_modules" (
    "organization_id" UUID NOT NULL,
    "module" VARCHAR(50) NOT NULL,
    "enabled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enabled_by_id" UUID NOT NULL,
    "disabled_at" TIMESTAMP(3),
    "disabled_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_modules_pkey" PRIMARY KEY ("organization_id","module")
);

-- CreateTable
CREATE TABLE "workshop_settings" (
    "organization_id" UUID NOT NULL,
    "next_order_number" INTEGER NOT NULL DEFAULT 1,
    "default_next_service_months" INTEGER DEFAULT 12,
    "first_service_after_months" INTEGER DEFAULT 12,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshop_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "customer_vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "branch_id" UUID,
    "make" VARCHAR(60) NOT NULL,
    "model" VARCHAR(80) NOT NULL,
    "year" INTEGER,
    "license_plate" VARCHAR(20),
    "license_plate_norm" VARCHAR(20),
    "vin" VARCHAR(30),
    "mileage" INTEGER,
    "purchased_on" DATE,
    "next_service_due_on" DATE,
    "next_service_set_from_order_id" UUID,
    "reminders_opt_out" BOOLEAN NOT NULL DEFAULT false,
    "source_vehicle_id" UUID,
    "source_opportunity_id" UUID,
    "ownership_ended_at" TIMESTAMP(3),
    "ownership_end_reason" "CustomerVehicleEndReason",
    "notes" VARCHAR(2000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "customer_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_vehicle_owner_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "customer_vehicle_id" UUID NOT NULL,
    "kind" "CustomerVehicleOwnerChangeKind" NOT NULL,
    "from_contact_id" UUID NOT NULL,
    "to_contact_id" UUID,
    "end_reason" "CustomerVehicleEndReason",
    "previous_purchased_on" DATE,
    "stock_vehicle_id" UUID,
    "note" VARCHAR(1000),
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_id" UUID,

    CONSTRAINT "customer_vehicle_owner_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_job_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "next_service_after_months" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "service_job_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "customer_vehicle_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "booking_id" UUID,
    "assignee_id" UUID,
    "status" "ServiceOrderStatus" NOT NULL DEFAULT 'AGENDADO',
    "scheduled_for" TIMESTAMP(3),
    "mileage_in" INTEGER,
    "damage_notes" VARCHAR(4000),
    "notes" VARCHAR(8000),
    "amount" DECIMAL(14,2),
    "currency" VARCHAR(3),
    "received_at" TIMESTAMP(3),
    "work_started_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(500),
    "next_service_due_on" DATE,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order_status_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "service_order_id" UUID NOT NULL,
    "from_status" "ServiceOrderStatus",
    "to_status" "ServiceOrderStatus" NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_id" UUID NOT NULL,
    "note" VARCHAR(1000),

    CONSTRAINT "service_order_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order_approvals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "service_order_id" UUID NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "decision" "ServiceOrderApprovalDecision" NOT NULL,
    "approver_name" VARCHAR(200) NOT NULL,
    "channel" "ServiceOrderApprovalChannel" NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2),
    "currency" VARCHAR(3),
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_order_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order_job_types" (
    "organization_id" UUID NOT NULL,
    "service_order_id" UUID NOT NULL,
    "service_job_type_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_order_job_types_pkey" PRIMARY KEY ("service_order_id","service_job_type_id")
);

-- CreateTable
CREATE TABLE "service_order_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "service_order_id" UUID NOT NULL,
    "phase" "ServiceOrderPhotoPhase" NOT NULL,
    "storage_path" VARCHAR(500) NOT NULL,
    "position" INTEGER NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_order_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_vehicles_organization_id_contact_id_idx" ON "customer_vehicles"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX "customer_vehicles_organization_id_branch_id_idx" ON "customer_vehicles"("organization_id", "branch_id");

-- CreateIndex
CREATE INDEX "customer_vehicles_organization_id_source_opportunity_id_idx" ON "customer_vehicles"("organization_id", "source_opportunity_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_vehicles_organization_id_id_key" ON "customer_vehicles"("organization_id", "id");

-- CreateIndex
CREATE INDEX "cv_owner_changes_vehicle_idx" ON "customer_vehicle_owner_changes"("organization_id", "customer_vehicle_id", "changed_at");

-- CreateIndex
CREATE INDEX "cv_owner_changes_from_contact_idx" ON "customer_vehicle_owner_changes"("organization_id", "from_contact_id");

-- CreateIndex
CREATE INDEX "cv_owner_changes_to_contact_idx" ON "customer_vehicle_owner_changes"("organization_id", "to_contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_job_types_organization_id_id_key" ON "service_job_types"("organization_id", "id");

-- CreateIndex
CREATE INDEX "service_orders_organization_id_status_branch_id_idx" ON "service_orders"("organization_id", "status", "branch_id");

-- CreateIndex
CREATE INDEX "service_orders_vehicle_created_idx" ON "service_orders"("organization_id", "customer_vehicle_id", "created_at");

-- CreateIndex
CREATE INDEX "service_orders_organization_id_contact_id_idx" ON "service_orders"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX "service_orders_organization_id_booking_id_idx" ON "service_orders"("organization_id", "booking_id");

-- CreateIndex
CREATE INDEX "service_orders_organization_id_assignee_id_idx" ON "service_orders"("organization_id", "assignee_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_orders_organization_id_id_key" ON "service_orders"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "service_orders_organization_id_number_key" ON "service_orders"("organization_id", "number");

-- CreateIndex
CREATE INDEX "so_status_changes_order_idx" ON "service_order_status_changes"("organization_id", "service_order_id", "changed_at");

-- CreateIndex
CREATE INDEX "so_approvals_order_idx" ON "service_order_approvals"("organization_id", "service_order_id");

-- CreateIndex
CREATE INDEX "so_job_types_order_idx" ON "service_order_job_types"("organization_id", "service_order_id");

-- CreateIndex
CREATE INDEX "so_job_types_job_type_idx" ON "service_order_job_types"("organization_id", "service_job_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_order_photos_storage_path_key" ON "service_order_photos"("storage_path");

-- CreateIndex
CREATE INDEX "so_photos_order_idx" ON "service_order_photos"("organization_id", "service_order_id", "phase", "position");

-- AddForeignKey
ALTER TABLE "organization_modules" ADD CONSTRAINT "organization_modules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_settings" ADD CONSTRAINT "workshop_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_contact_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_branch_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_source_vehicle_fkey" FOREIGN KEY ("organization_id", "source_vehicle_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_source_opportunity_fkey" FOREIGN KEY ("organization_id", "source_opportunity_id") REFERENCES "opportunities"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_vehicle_owner_changes" ADD CONSTRAINT "customer_vehicle_owner_changes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_vehicle_owner_changes" ADD CONSTRAINT "cv_owner_changes_vehicle_fkey" FOREIGN KEY ("organization_id", "customer_vehicle_id") REFERENCES "customer_vehicles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_vehicle_owner_changes" ADD CONSTRAINT "cv_owner_changes_from_contact_fkey" FOREIGN KEY ("organization_id", "from_contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_vehicle_owner_changes" ADD CONSTRAINT "cv_owner_changes_to_contact_fkey" FOREIGN KEY ("organization_id", "to_contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_vehicle_owner_changes" ADD CONSTRAINT "cv_owner_changes_stock_vehicle_fkey" FOREIGN KEY ("organization_id", "stock_vehicle_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_vehicle_owner_changes" ADD CONSTRAINT "cv_owner_changes_changed_by_fkey" FOREIGN KEY ("organization_id", "changed_by_id") REFERENCES "users"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_job_types" ADD CONSTRAINT "service_job_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_customer_vehicle_fkey" FOREIGN KEY ("organization_id", "customer_vehicle_id") REFERENCES "customer_vehicles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_contact_fkey" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_branch_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_booking_fkey" FOREIGN KEY ("organization_id", "booking_id") REFERENCES "bookings"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_assignee_fkey" FOREIGN KEY ("organization_id", "assignee_id") REFERENCES "users"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_created_by_fkey" FOREIGN KEY ("organization_id", "created_by_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (la vuelta del ciclo customer_vehicles <-> service_orders)
ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_next_service_order_fkey" FOREIGN KEY ("organization_id", "next_service_set_from_order_id") REFERENCES "service_orders"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_status_changes" ADD CONSTRAINT "service_order_status_changes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_status_changes" ADD CONSTRAINT "so_status_changes_order_fkey" FOREIGN KEY ("organization_id", "service_order_id") REFERENCES "service_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_status_changes" ADD CONSTRAINT "so_status_changes_changed_by_fkey" FOREIGN KEY ("organization_id", "changed_by_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_approvals" ADD CONSTRAINT "service_order_approvals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_approvals" ADD CONSTRAINT "so_approvals_order_fkey" FOREIGN KEY ("organization_id", "service_order_id") REFERENCES "service_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_approvals" ADD CONSTRAINT "so_approvals_recorded_by_fkey" FOREIGN KEY ("organization_id", "recorded_by_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_job_types" ADD CONSTRAINT "service_order_job_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_job_types" ADD CONSTRAINT "so_job_types_order_fkey" FOREIGN KEY ("organization_id", "service_order_id") REFERENCES "service_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_job_types" ADD CONSTRAINT "so_job_types_job_type_fkey" FOREIGN KEY ("organization_id", "service_job_type_id") REFERENCES "service_job_types"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_photos" ADD CONSTRAINT "service_order_photos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_photos" ADD CONSTRAINT "so_photos_order_fkey" FOREIGN KEY ("organization_id", "service_order_id") REFERENCES "service_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_order_photos" ADD CONSTRAINT "so_photos_uploaded_by_fkey" FOREIGN KEY ("organization_id", "uploaded_by_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Lo que el DSL de Prisma no expresa.
-- ---------------------------------------------------------------------------

-- organization_modules: solo los módulos activables (MODULOS_ACTIVABLES en
-- src/config/ediciones.ts, desde S2). Un valor que el backend no sabe gatear
-- no puede quedar escrito. Sumar uno es una migración que cambia este CHECK.
ALTER TABLE "organization_modules" ADD CONSTRAINT "organization_modules_module_check" CHECK (
  "module" IN ('servicios')
);

-- Desactivado = cuándo y quién, juntos.
ALTER TABLE "organization_modules" ADD CONSTRAINT "organization_modules_disabled_check" CHECK (
  ("disabled_at" IS NULL) = ("disabled_by_id" IS NULL)
);

ALTER TABLE "workshop_settings" ADD CONSTRAINT "workshop_settings_next_order_number_check" CHECK (
  "next_order_number" >= 1
);

ALTER TABLE "workshop_settings" ADD CONSTRAINT "workshop_settings_months_check" CHECK (
  ("default_next_service_months" IS NULL OR "default_next_service_months" BETWEEN 1 AND 60)
  AND ("first_service_after_months" IS NULL OR "first_service_after_months" BETWEEN 1 AND 60)
);

-- La matrícula normalizada va con la escrita, y es solo mayúsculas y dígitos;
-- el chasis, igual. Es lo que hace confiable la unicidad.
ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_plate_check" CHECK (
  ("license_plate" IS NULL) = ("license_plate_norm" IS NULL)
  AND ("license_plate_norm" IS NULL OR "license_plate_norm" ~ '^[A-Z0-9]+$')
  AND ("vin" IS NULL OR "vin" ~ '^[A-Z0-9]+$')
);

ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_numbers_check" CHECK (
  ("year" IS NULL OR "year" BETWEEN 1900 AND 2100)
  AND ("mileage" IS NULL OR "mileage" >= 0)
);

-- "Ya no es del cliente": cuándo y por qué, juntos.
ALTER TABLE "customer_vehicles" ADD CONSTRAINT "customer_vehicles_ownership_end_check" CHECK (
  ("ownership_ended_at" IS NULL) = ("ownership_end_reason" IS NULL)
);

-- Un cambio de dueño tiene destino y no motivo de fin; un fin, al revés. La
-- unidad del stock solo con PERMUTA, y sin persona solo con PERMUTA (lo
-- escribe el barrido de S10).
ALTER TABLE "customer_vehicle_owner_changes" ADD CONSTRAINT "cv_owner_changes_kind_check" CHECK (
  ("kind" = 'CAMBIO_DE_DUENO' AND "to_contact_id" IS NOT NULL AND "end_reason" IS NULL)
  OR ("kind" = 'FIN' AND "to_contact_id" IS NULL AND "end_reason" IS NOT NULL)
);

ALTER TABLE "customer_vehicle_owner_changes" ADD CONSTRAINT "cv_owner_changes_permuta_check" CHECK (
  ("stock_vehicle_id" IS NULL OR "end_reason" = 'PERMUTA')
  AND ("changed_by_id" IS NOT NULL OR "end_reason" = 'PERMUTA')
);

ALTER TABLE "service_job_types" ADD CONSTRAINT "service_job_types_months_check" CHECK (
  "next_service_after_months" IS NULL OR "next_service_after_months" BETWEEN 1 AND 60
);

ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_numbers_check" CHECK (
  "number" >= 1
  AND ("mileage_in" IS NULL OR "mileage_in" >= 0)
);

-- El Valor: monto y moneda juntos, monto no negativo, moneda ISO 4217.
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_amount_check" CHECK (
  ("amount" IS NULL) = ("currency" IS NULL)
  AND ("amount" IS NULL OR "amount" >= 0)
  AND ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$')
);

-- Los estados que dejan una marca: ENTREGADO con su fecha, CANCELADO con la
-- suya y el motivo.
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_status_dates_check" CHECK (
  ("status" <> 'ENTREGADO' OR "delivered_at" IS NOT NULL)
  AND ("status" <> 'CANCELADO' OR ("cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL))
);

ALTER TABLE "service_order_status_changes" ADD CONSTRAINT "so_status_changes_distinct_check" CHECK (
  "from_status" IS NULL OR "from_status" <> "to_status"
);

ALTER TABLE "service_order_approvals" ADD CONSTRAINT "so_approvals_amount_check" CHECK (
  ("amount" IS NULL) = ("currency" IS NULL)
  AND ("amount" IS NULL OR "amount" >= 0)
  AND ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$')
);

ALTER TABLE "service_order_photos" ADD CONSTRAINT "so_photos_position_check" CHECK (
  "position" >= 0
);

-- Unicidad entre vehículos VIGENTES (§2.2, D16): un vehículo que ya no es del
-- cliente, o borrado, no ocupa su matrícula, su chasis ni su unidad de origen.
CREATE UNIQUE INDEX "customer_vehicles_plate_vigente_key" ON "customer_vehicles"("organization_id", "license_plate_norm")
  WHERE "deleted_at" IS NULL AND "ownership_ended_at" IS NULL AND "license_plate_norm" IS NOT NULL;

CREATE UNIQUE INDEX "customer_vehicles_vin_vigente_key" ON "customer_vehicles"("organization_id", "vin")
  WHERE "deleted_at" IS NULL AND "ownership_ended_at" IS NULL AND "vin" IS NOT NULL;

CREATE UNIQUE INDEX "customer_vehicles_source_vehicle_vigente_key" ON "customer_vehicles"("organization_id", "source_vehicle_id")
  WHERE "deleted_at" IS NULL AND "ownership_ended_at" IS NULL AND "source_vehicle_id" IS NOT NULL;

-- El barrido diario del próximo service (§6.2) y el de recambio (§7.2).
CREATE INDEX "customer_vehicles_next_service_idx" ON "customer_vehicles"("organization_id", "next_service_due_on")
  WHERE "deleted_at" IS NULL AND "ownership_ended_at" IS NULL AND NOT "reminders_opt_out" AND "next_service_due_on" IS NOT NULL;

CREATE INDEX "customer_vehicles_purchased_on_idx" ON "customer_vehicles"("organization_id", "purchased_on")
  WHERE "deleted_at" IS NULL AND "ownership_ended_at" IS NULL AND "purchased_on" IS NOT NULL;

-- El nombre de un tipo de service, único entre los no borrados y sin
-- distinguir mayúsculas.
CREATE UNIQUE INDEX "service_job_types_name_vigente_key" ON "service_job_types"("organization_id", lower("name"))
  WHERE "deleted_at" IS NULL;

-- Un mismo auto no está dos veces en el taller (§2.3). AGENDADO queda afuera:
-- se puede tener un turno futuro mientras el auto está adentro por otra cosa.
CREATE UNIQUE INDEX "service_orders_vehiculo_en_taller_key" ON "service_orders"("organization_id", "customer_vehicle_id")
  WHERE "status" IN ('RECIBIDO', 'EN_TRABAJO', 'ESPERANDO_APROBACION', 'LISTO_PARA_RETIRAR');

-- RLS: la política uniforme de aislamiento (fila 5 del diagnóstico).
alter table public.organization_modules enable row level security;
drop policy if exists organization_modules_isolation on public.organization_modules;
create policy organization_modules_isolation on public.organization_modules
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.workshop_settings enable row level security;
drop policy if exists workshop_settings_isolation on public.workshop_settings;
create policy workshop_settings_isolation on public.workshop_settings
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.customer_vehicles enable row level security;
drop policy if exists customer_vehicles_isolation on public.customer_vehicles;
create policy customer_vehicles_isolation on public.customer_vehicles
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.customer_vehicle_owner_changes enable row level security;
drop policy if exists customer_vehicle_owner_changes_isolation on public.customer_vehicle_owner_changes;
create policy customer_vehicle_owner_changes_isolation on public.customer_vehicle_owner_changes
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.service_job_types enable row level security;
drop policy if exists service_job_types_isolation on public.service_job_types;
create policy service_job_types_isolation on public.service_job_types
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.service_orders enable row level security;
drop policy if exists service_orders_isolation on public.service_orders;
create policy service_orders_isolation on public.service_orders
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.service_order_status_changes enable row level security;
drop policy if exists service_order_status_changes_isolation on public.service_order_status_changes;
create policy service_order_status_changes_isolation on public.service_order_status_changes
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.service_order_approvals enable row level security;
drop policy if exists service_order_approvals_isolation on public.service_order_approvals;
create policy service_order_approvals_isolation on public.service_order_approvals
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.service_order_job_types enable row level security;
drop policy if exists service_order_job_types_isolation on public.service_order_job_types;
create policy service_order_job_types_isolation on public.service_order_job_types
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.service_order_photos enable row level security;
drop policy if exists service_order_photos_isolation on public.service_order_photos;
create policy service_order_photos_isolation on public.service_order_photos
  for all using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());
