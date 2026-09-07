-- ---------------------------------------------------------------------------
-- Fase 1 del módulo de stock de vehículos: SOLO ESQUEMA. Cuatro tablas nuevas
-- (vehicles, vehicle_photos, vehicle_change_logs, exchange_rates), doce enums,
-- tres columnas en organizations (preferred_currency, alternate_currency,
-- next_vehicle_stock_number) y tres en opportunities (vehicle_id,
-- financing_type, lead_source). Sin endpoints, sin service, sin frontend — eso
-- es la Fase 2; la página pública, la Fase 3. Cada decisión de modelado está
-- explicada en prisma/schema.prisma, en la sección "Módulo de stock de
-- vehículos" al final del archivo; acá solo se explica lo que es propio del
-- DDL.
--
-- CÓMO SE GENERÓ: igual que 20260903120000 (qr_integration) y por la misma
-- razón — `prisma migrate dev` no funciona en este repo (la shadow database no
-- tiene el schema auth y 20260821140000 falla ahí). El DDL de la primera
-- sección salió de `prisma migrate diff --from-url <DIRECT_URL>
-- --to-schema-datamodel prisma/schema.prisma --script` contra la base ya al
-- día con 20260904120000, sin ningún retoque salvo uno: se QUITARON los nueve
-- `DROP INDEX *_trgm_idx` que el diff propone siempre, porque los GIN de
-- 20260828120100 no existen en el DSL de Prisma. No son drift: son los
-- objetos manuales de siempre, y la fila 12 del diagnóstico los afirma.
--
-- LAS ACCIONES REFERENCIALES salen de la regla de 20260821140200 y la fila 14
-- del diagnóstico las deriva sola: columna referenciante NOT NULL -> RESTRICT
-- (vehicles.branch_id, vehicle_photos.vehicle_id, vehicle_change_logs.
-- vehicle_id y changed_by_id), nullable -> NO ACTION (vehicles.
-- assigned_salesperson_id, opportunities.vehicle_id). Ninguna es CASCADE:
-- vehicles usa soft delete, así que ninguna se dispara en la práctica, y si
-- alguien introduce un borrado físico, que falle ruidosamente.
--
-- El bloque final (RLS + índice único parcial + CHECK constraints) es manual,
-- mismo criterio que 20260821140000 (C-2), 20260901120000 (M-5) y
-- 20260903120000: lo que el DSL no expresa se escribe en la migración
-- versionada. Las filas 5, 7, 8, 11 y 16 del diagnóstico
-- (docs/auditoria-2026-08-21-diagnostico.sql) afirman en CI, respectivamente,
-- las cuatro políticas, el único parcial, los ocho CHECK, el índice de
-- listado de vehicles y las seis FKs compuestas nuevas. Las expectativas de
-- las filas 7 y 8 se transcribieron de lo que pg_get_indexdef /
-- pg_get_constraintdef devolvieron de verdad después de aplicar esta
-- migración, como pide la regla del encabezado del diagnóstico.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "VehicleCondition" AS ENUM ('NEW', 'USED');

-- CreateEnum
CREATE TYPE "VehicleBodyType" AS ENUM ('SEDAN', 'HATCHBACK', 'SUV', 'PICKUP', 'COUPE', 'WAGON', 'VAN', 'UTILITY', 'MINIVAN');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'IN_PREPARATION', 'IN_TRANSIT', 'SOLD');

-- CreateEnum
CREATE TYPE "VehicleOrigin" AS ENUM ('DIRECT_PURCHASE', 'TRADE_IN', 'CONSIGNMENT', 'IMPORT', 'BRANCH_TRANSFER');

-- CreateEnum
CREATE TYPE "VehiclePublicationCurrency" AS ENUM ('BOTH', 'USD_ONLY', 'LOCAL_ONLY');

-- CreateEnum
CREATE TYPE "VehicleTransmission" AS ENUM ('MANUAL', 'AUTOMATIC', 'AUTOMATIC_SEQUENTIAL', 'CVT');

-- CreateEnum
CREATE TYPE "VehicleFuelType" AS ENUM ('GASOLINE', 'DIESEL', 'HYBRID', 'ELECTRIC', 'CNG', 'GASOLINE_CNG');

-- CreateEnum
CREATE TYPE "VehicleColorFinish" AS ENUM ('SOLID', 'METALLIC', 'PEARL', 'MATTE');

-- CreateEnum
CREATE TYPE "VehicleDrivetrain" AS ENUM ('FRONT', 'REAR', 'FOUR_BY_FOUR', 'AWD');

-- CreateEnum
CREATE TYPE "VehicleWarranty" AS ENUM ('NONE', 'FACTORY', 'DEALER_6M', 'DEALER_12M');

-- CreateEnum
CREATE TYPE "OpportunityFinancingType" AS ENUM ('NONE', 'INSTALLMENT_24M', 'INSTALLMENT_36M', 'OWN_FINANCING');

-- CreateEnum
CREATE TYPE "OpportunityLeadSource" AS ENUM ('PORTAL_MERCADOLIBRE', 'WEBSITE', 'SHOWROOM', 'REFERRAL', 'WHATSAPP');

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "financing_type" "OpportunityFinancingType",
ADD COLUMN     "lead_source" "OpportunityLeadSource",
ADD COLUMN     "vehicle_id" UUID;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "alternate_currency" VARCHAR(3),
ADD COLUMN     "next_vehicle_stock_number" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "preferred_currency" VARCHAR(3);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "internal_code" VARCHAR(30) NOT NULL,
    "condition" "VehicleCondition" NOT NULL,
    "license_plate" VARCHAR(20),
    "vin" VARCHAR(30),
    "engine_number" VARCHAR(50),
    "body_type" "VehicleBodyType",
    "make" VARCHAR(100) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "trim" VARCHAR(100),
    "year" INTEGER NOT NULL,
    "price_list_usd" DECIMAL(14,2),
    "price_list_local" DECIMAL(14,2),
    "min_acceptable_price_usd" DECIMAL(14,2),
    "acquisition_cost_usd" DECIMAL(14,2),
    "status" "VehicleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "visible_in_listing" BOOLEAN NOT NULL DEFAULT true,
    "origin" "VehicleOrigin",
    "stock_entered_at" DATE,
    "publication_currency" "VehiclePublicationCurrency" NOT NULL DEFAULT 'BOTH',
    "accepts_trade_in" BOOLEAN NOT NULL DEFAULT false,
    "financing_available" BOOLEAN NOT NULL DEFAULT false,
    "price_on_request" BOOLEAN NOT NULL DEFAULT false,
    "consignor_name" VARCHAR(255),
    "consignor_document" VARCHAR(50),
    "consignor_phone" VARCHAR(30),
    "consignor_email" VARCHAR(255),
    "consignment_agreed_price_usd" DECIMAL(14,2),
    "consignment_commission_percent" DECIMAL(5,2),
    "consignment_agreement_expires_at" DATE,
    "consignment_contract_number" VARCHAR(50),
    "mileage" INTEGER,
    "transmission" "VehicleTransmission",
    "fuel_type" "VehicleFuelType",
    "exterior_color" VARCHAR(50),
    "color_finish" "VehicleColorFinish",
    "cylinder_capacity_liters" DECIMAL(4,2),
    "drivetrain" "VehicleDrivetrain",
    "doors" INTEGER,
    "upholstery" VARCHAR(100),
    "power_hp" INTEGER,
    "seats" INTEGER,
    "declared_consumption_km_l" DECIMAL(5,2),
    "equipment" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warranty" "VehicleWarranty",
    "license_plate_debt_local" DECIMAL(14,2),
    "last_technical_inspection_at" DATE,
    "title_holder" VARCHAR(255),
    "single_owner" BOOLEAN NOT NULL DEFAULT false,
    "official_service_up_to_date" BOOLEAN NOT NULL DEFAULT false,
    "has_manual_and_spare_key" BOOLEAN NOT NULL DEFAULT false,
    "title_report_requested" BOOLEAN NOT NULL DEFAULT false,
    "branch_id" UUID NOT NULL,
    "assigned_salesperson_id" UUID,
    "physical_location" VARCHAR(255),
    "available_since" DATE,
    "video_url" VARCHAR(2048),
    "tour_360_url" VARCHAR(2048),
    "publish_on_website" BOOLEAN NOT NULL DEFAULT false,
    "publish_on_portals" BOOLEAN NOT NULL DEFAULT false,
    "featured_on_homepage" BOOLEAN NOT NULL DEFAULT false,
    "public_description" TEXT,
    "internal_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "storage_path" VARCHAR(1024) NOT NULL,
    "slot" VARCHAR(30),
    "position" INTEGER NOT NULL,
    "is_cover" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_change_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "field_name" VARCHAR(100) NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "base_currency" VARCHAR(3) NOT NULL,
    "target_currency" VARCHAR(3) NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "rate_date" DATE NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicles_organization_id_deleted_at_created_at_idx" ON "vehicles"("organization_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "vehicles_organization_id_branch_id_idx" ON "vehicles"("organization_id", "branch_id");

-- CreateIndex
CREATE INDEX "vehicles_organization_id_status_idx" ON "vehicles"("organization_id", "status");

-- CreateIndex
CREATE INDEX "vehicles_organization_id_make_idx" ON "vehicles"("organization_id", "make");

-- CreateIndex
CREATE INDEX "vehicles_organization_id_condition_idx" ON "vehicles"("organization_id", "condition");

-- CreateIndex
CREATE INDEX "vehicles_organization_id_price_list_usd_idx" ON "vehicles"("organization_id", "price_list_usd");

-- CreateIndex
CREATE INDEX "vehicles_organization_id_assigned_salesperson_id_idx" ON "vehicles"("organization_id", "assigned_salesperson_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_organization_id_id_key" ON "vehicles"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_organization_id_internal_code_key" ON "vehicles"("organization_id", "internal_code");

-- CreateIndex
CREATE INDEX "vehicle_photos_organization_id_vehicle_id_position_idx" ON "vehicle_photos"("organization_id", "vehicle_id", "position");

-- CreateIndex
CREATE INDEX "vehicle_change_logs_organization_id_vehicle_id_changed_at_idx" ON "vehicle_change_logs"("organization_id", "vehicle_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_base_currency_target_currency_rate_date_key" ON "exchange_rates"("base_currency", "target_currency", "rate_date");

-- CreateIndex
CREATE INDEX "opportunities_organization_id_vehicle_id_idx" ON "opportunities"("organization_id", "vehicle_id");

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organization_id_vehicle_id_fkey" FOREIGN KEY ("organization_id", "vehicle_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organization_id_branch_id_fkey" FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organization_id_assigned_salesperson_id_fkey" FOREIGN KEY ("organization_id", "assigned_salesperson_id") REFERENCES "users"("organization_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_organization_id_vehicle_id_fkey" FOREIGN KEY ("organization_id", "vehicle_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_change_logs" ADD CONSTRAINT "vehicle_change_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_change_logs" ADD CONSTRAINT "vehicle_change_logs_organization_id_vehicle_id_fkey" FOREIGN KEY ("organization_id", "vehicle_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_change_logs" ADD CONSTRAINT "vehicle_change_logs_organization_id_changed_by_id_fkey" FOREIGN KEY ("organization_id", "changed_by_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------
-- RLS — mismo patrón uniforme que el resto (ver
-- prisma/sql/rls_policies.sql, 20260901120000 y 20260903120000) para las
-- tres tablas con organization_id. Defensa en profundidad: el backend se
-- conecta con un rol BYPASSRLS y estas políticas no se evalúan para él;
-- protegen cualquier otro camino a public (Realtime, PostgREST con un
-- grant futuro, el SQL Editor con `authenticated`).
-- ---------------------------------------------------------------------
alter table public.vehicles enable row level security;
drop policy if exists vehicles_isolation on public.vehicles;
create policy vehicles_isolation on public.vehicles
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.vehicle_photos enable row level security;
drop policy if exists vehicle_photos_isolation on public.vehicle_photos;
create policy vehicle_photos_isolation on public.vehicle_photos
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

alter table public.vehicle_change_logs enable row level security;
drop policy if exists vehicle_change_logs_isolation on public.vehicle_change_logs;
create policy vehicle_change_logs_isolation on public.vehicle_change_logs
  for all
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

-- exchange_rates NO tiene organization_id (dato público, igual para todas
-- las cuentas — ver schema.prisma): la política es la de roles, lectura
-- para cualquier usuario autenticado y ninguna de escritura. Entra a la
-- fila 5 del diagnóstico como firma especial, al lado de roles_read_all.
alter table public.exchange_rates enable row level security;
drop policy if exists exchange_rates_read_all on public.exchange_rates;
create policy exchange_rates_read_all on public.exchange_rates
  for select
  using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------
-- Índice único parcial: a lo sumo UNA portada por unidad. El DSL de
-- Prisma no expresa el predicado; fila 7 del diagnóstico.
--
-- (organization_id, vehicle_id) y no (vehicle_id) solo, por lo mismo que
-- google_calendar_connections eligió (organization_id, branch_id): la FK
-- compuesta ya fuerza que organization_id sea el de la unidad, así que
-- garantiza exactamente lo mismo y además el índice sirve para buscar la
-- portada dentro del tenant sin un segundo índice.
-- ---------------------------------------------------------------------
create unique index vehicle_photos_vehicle_cover_unique
  on public.vehicle_photos (organization_id, vehicle_id)
  where is_cover = true;

-- ---------------------------------------------------------------------
-- CHECK constraints — la defensa que sobrevive a un camino de escritura
-- que no pase por el controller (un seed, un script de importación de
-- stock, un worker). Zod los repetirá en el borde HTTP de la Fase 2. Mismo
-- criterio que service_types_duration_positive_check (20260828160000). No
-- van en manual_constraints.sql (B-15).
--
-- Sobre las columnas NULLABLES: un CHECK cuya expresión da NULL PASA, así
-- que `price_list_usd >= 0` no rechaza una fila sin precio — es exactamente
-- lo que el modo borrador necesita, sin escribir `x is null or` en cada
-- término. En una conjunción, `NULL and false` es false, así que un solo
-- valor negativo alcanza para rechazar la fila aunque el resto esté vacío.
--
-- AGRUPADOS POR TEMA y no uno por columna: ocho constraints en vez de
-- veinte. El costo es que el error de Postgres nombra el grupo y no la
-- columna, y se acepta porque el mensaje que ve el usuario lo da Zod en el
-- borde; el CHECK es el respaldo.
-- ---------------------------------------------------------------------

-- Año de fabricación en un rango sensato. 1900 y no 1886 (el primer auto):
-- ninguna automotora de este SaaS va a cargar un Benz Patent-Motorwagen, y
-- 2100 deja margen sin admitir un dedazo de cinco cifras.
alter table public.vehicles
  add constraint vehicles_year_range_check
  check (year >= 1900 and year <= 2100);

-- Los seis montos de dinero: nunca negativos. Cero SÍ es válido (una unidad
-- que entró por permuta puede tener costo cero).
alter table public.vehicles
  add constraint vehicles_amounts_non_negative_check
  check (
    price_list_usd >= 0
    and price_list_local >= 0
    and min_acceptable_price_usd >= 0
    and acquisition_cost_usd >= 0
    and consignment_agreed_price_usd >= 0
    and license_plate_debt_local >= 0
  );

-- Porcentaje, no fracción: 0..100.
alter table public.vehicles
  add constraint vehicles_consignment_commission_range_check
  check (consignment_commission_percent >= 0 and consignment_commission_percent <= 100);

-- Magnitudes técnicas. mileage admite 0 (un 0 km tiene cero kilómetros); las
-- otras cinco son estrictamente positivas porque un auto con cero puertas o
-- cero caballos no es un dato faltante sino un dato mal cargado — para
-- "no se cargó" está el NULL.
alter table public.vehicles
  add constraint vehicles_specs_positive_check
  check (
    mileage >= 0
    and doors > 0
    and seats > 0
    and power_hp > 0
    and cylinder_capacity_liters > 0
    and declared_consumption_km_l > 0
  );

-- Los ocho campos de consignación solo pueden estar cargados si origin =
-- CONSIGNMENT. `is not distinct from` y no `=`: con origin NULL, `origin =
-- 'CONSIGNMENT'` da NULL y el OR entero pasaría con datos de consignante
-- cargados; con IS NOT DISTINCT FROM, origin NULL da false y los ocho tienen
-- que ser NULL. Un borrador sin origen no puede llevar datos de un
-- consignante que todavía no se sabe si existe.
--
-- Tiene la forma A OR (B AND C AND ...), que es el límite conocido del
-- normalizador del diagnóstico (mismo caso que
-- google_calendar_connections_channel_all_or_none_check): la fila 8 no
-- distingue esta parentización de otra que reparta los mismos operandos.
-- Se acepta a sabiendas, igual que allá.
alter table public.vehicles
  add constraint vehicles_consignment_fields_require_origin_check
  check (
    origin is not distinct from 'CONSIGNMENT'
    or (
      consignor_name is null
      and consignor_document is null
      and consignor_phone is null
      and consignor_email is null
      and consignment_agreed_price_usd is null
      and consignment_commission_percent is null
      and consignment_agreement_expires_at is null
      and consignment_contract_number is null
    )
  );

-- Orden de galería: 0 es la primera. "position" entre comillas porque es
-- palabra clave de Postgres (la función POSITION), igual que "order" en
-- stages_pipeline_order_unique.
alter table public.vehicle_photos
  add constraint vehicle_photos_position_non_negative_check
  check ("position" >= 0);

-- Una cotización es un número positivo, y USD -> USD no es una cotización.
alter table public.exchange_rates
  add constraint exchange_rates_rate_positive_check
  check (rate > 0);

alter table public.exchange_rates
  add constraint exchange_rates_currencies_differ_check
  check (base_currency <> target_currency);
