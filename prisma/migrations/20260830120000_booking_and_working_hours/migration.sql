-- P2.1 (Agenda/Booking), paso 3 de §9: el horario de trabajo por recurso y las
-- reservas. Con esto queda destrabado GET /api/availability, que el paso 2 dejó
-- explícitamente afuera por depender de un "rango de trabajo" que no existía.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que las
-- migraciones de la capa de ingesta, del outbox y de los dos tramos anteriores
-- de Booking (el único DATABASE_URL disponible apunta al proyecto real y
-- `migrate dev` usa una shadow database y puede proponer un reset). Quien valida
-- que aplica sobre una base vacía es el job `integration` del CI.
--
-- ---------------------------------------------------------------------------
-- LA DECISIÓN QUE ESTA MIGRACIÓN MATERIALIZA
-- ---------------------------------------------------------------------------
--
-- El horario de trabajo se modela POR RESOURCE, no por Branch: dos barberos de
-- la misma sucursal pueden trabajar días distintos. Cada fila de working_hours
-- es UNA FRANJA de un día, así que "lunes de 9 a 13 y de 16 a 20" son DOS filas
-- con weekday = MONDAY — por eso NO hay un UNIQUE (resource_id, weekday).
--
-- ALCANCE MÍNIMO A PROPÓSITO, mismo criterio con el que nació Branch: sin
-- excepciones, sin feriados y sin bloqueos puntuales. Lo que hoy NO se puede
-- expresar, y conviene tener presente antes de que alguien lo descubra
-- reservando: "el 25 de diciembre no atiendo" y "este martes me tomo la tarde"
-- no tienen representación. El horario es puramente semanal y recurrente.

-- ---------------------------------------------------------------------------
-- 1. Enums nativos
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- ---------------------------------------------------------------------------
-- 2. El UNIQUE pendiente de PR #41 sobre service_types
--
-- Se dejó afuera entonces a propósito ("no se agregan objetos que nadie usa")
-- porque nada referenciaba a ServiceType. Ahora bookings lo referencia con una
-- FK compuesta, así que este índice pasó a ser el que la habilita. Es el tercero
-- de los tres pendientes que aquel PR anotó; los otros dos (el count real de
-- contarReservasActivas y el lock de deleteServiceType) son código y se cierran
-- en este mismo PR.
-- ---------------------------------------------------------------------------

-- CreateIndex
CREATE UNIQUE INDEX "service_types_organization_id_id_key" ON "service_types"("organization_id", "id");

-- ---------------------------------------------------------------------------
-- 3. working_hours
--
-- LA HORA ES LOCAL DE LA SUCURSAL, NO UTC, y esto es lo más importante de la
-- tabla: `weekday` + `start_minute` son hora de pared en la zona IANA de
-- branches.timezone. Guardar UTC acá sería directamente incorrecto — "los lunes
-- a las 9" no es un instante, y en una zona con horario de verano no corresponde
-- siempre al mismo UTC. La conversión a instantes concretos necesita una fecha y
-- la zona, y vive en src/utils/workingHours.ts.
--
-- MINUTOS DESDE LA MEDIANOCHE y no `time`: Prisma mapea `time` a DateTime, o sea
-- que del otro lado llega un Date parado en el 1/1/1970 del que hay que extraer
-- la hora igual — un tipo más rico que no aporta nada y que invita a operar con
-- él como si fuera un instante. Toda la lógica de este módulo es aritmética
-- (¿entra un turno de 30 minutos?, ¿se superponen dos franjas?) y un entero es
-- la representación honesta de eso. La API habla "HH:MM"; la conversión vive en
-- el borde.
--
-- SIN deleted_at: no es una entidad de negocio que se archive, es la
-- configuración vigente de un recurso, y el endpoint la REEMPLAZA entera.
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "working_hours" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "weekday" "Weekday" NOT NULL,
    -- 0..1440, minutos desde la medianoche LOCAL. El 1440 es medianoche del día
    -- siguiente, y existe para poder expresar una franja que cierra a las 24:00.
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
--
-- (organization_id, resource_id) sirve la ÚNICA consulta que existe sobre esta
-- tabla: "el horario de este recurso", que es lo que leen el cálculo de
-- disponibilidad y la validación de POST /api/bookings. No hay listado por
-- organización, así que no hay (organization_id, created_at) — misma decisión, y
-- por el mismo motivo, que en google_calendar_connections.
CREATE INDEX "working_hours_organization_id_resource_id_idx" ON "working_hours"("organization_id", "resource_id");

-- ---------------------------------------------------------------------------
-- 4. bookings
--
-- ES LA FUENTE DE VERDAD. google_event_id es NULLABLE y el NULL es un estado
-- NORMAL, no un error: §4 del documento de diseño es explícito en que el sistema
-- no debe bloquear una reserva por una falla del proveedor externo, y eso incluye
-- el caso de una sucursal que directamente no conectó Google Calendar.
--
-- SIN deleted_at: cancelar es un `status`, no un borrado. Una reserva cancelada
-- es historia que hay que conservar, y un soft delete agregaría un quinto estado
-- que no significa nada distinto de CANCELLED.
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    -- NOT NULL: una reserva sin contacto no es una reserva, alguien la pidió. Es
    -- la diferencia con opportunities/activities, donde contact_id es opcional
    -- porque aquellas pueden colgar de una company.
    "contact_id" UUID NOT NULL,
    "opportunity_id" UUID,
    -- Instantes reales (UTC), a diferencia de working_hours. Acá sí corresponde:
    -- una reserva ocurre en un momento concreto.
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "google_event_id" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 5. Índices de bookings
--
-- Cada uno responde a una consulta que existe de verdad, no a una simetría:
--
--   (organization_id, resource_id, starts_at) — LA CONSULTA CALIENTE DEL
--     MÓDULO: "¿qué reservas del recurso R se superponen con [inicio, fin)?".
--     La hacen la validación de capacidad de POST /api/bookings y el cálculo de
--     disponibilidad, o sea que corre en cada reserva y en cada pantalla de
--     turnos. Sin ella, cada una es un scan de la tabla de mayor crecimiento del
--     módulo.
--   (organization_id, service_type_id, starts_at) — el conteo del RESTRICT de
--     deleteServiceType (reservas CONFIRMED de un servicio).
--   (organization_id, contact_id) — "las reservas de este contacto", la ficha
--     del cliente.
--   (organization_id, starts_at) — la agenda: las reservas de la organización
--     entre dos fechas.
--
-- NINGUNO ES PARCIAL por status. Sería tentador (casi todas las consultas
-- filtran CONFIRMED) y sería un error: las reservas pasadas se vuelven COMPLETED
-- o NO_SHOW y quedarían fuera del índice justo cuando la agenda histórica las
-- necesita. Mismo criterio que la migración 20260828120000 aplicó a los índices
-- de listado.
-- ---------------------------------------------------------------------------

-- CreateIndex
CREATE INDEX "bookings_organization_id_resource_id_starts_at_idx" ON "bookings"("organization_id", "resource_id", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_organization_id_service_type_id_starts_at_idx" ON "bookings"("organization_id", "service_type_id", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_organization_id_contact_id_idx" ON "bookings"("organization_id", "contact_id");

-- CreateIndex
CREATE INDEX "bookings_organization_id_starts_at_idx" ON "bookings"("organization_id", "starts_at");

-- ---------------------------------------------------------------------------
-- 6. Foreign keys
--
-- Todas las cruzadas son COMPUESTAS (organization_id, x_id) -> padre
-- (organization_id, id), el estándar del proyecto desde C-3.
--
-- ON DELETE por la regla de 20260821140200, que NO se elige caso por caso:
-- columna referenciante NOT NULL -> RESTRICT, nullable -> NO ACTION. Por eso
-- opportunity_id es la única NO ACTION de bookings — es la única nullable. Es
-- exactamente el mismo criterio con el que opportunities y activities referencian
-- a contacts (nullable allá, NO ACTION allá; NOT NULL acá, RESTRICT acá).
--
-- La fila 14 del diagnóstico (C-3 generalizado) toma estas siete solas, sin
-- tocar el chequeo: todas sus tablas tienen organization_id.
-- ---------------------------------------------------------------------------

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_organization_id_resource_id_fkey"
    FOREIGN KEY ("organization_id", "resource_id") REFERENCES "resources"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organization_id_branch_id_fkey"
    FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organization_id_service_type_id_fkey"
    FOREIGN KEY ("organization_id", "service_type_id") REFERENCES "service_types"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organization_id_resource_id_fkey"
    FOREIGN KEY ("organization_id", "resource_id") REFERENCES "resources"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organization_id_contact_id_fkey"
    FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organization_id_opportunity_id_fkey"
    FOREIGN KEY ("organization_id", "opportunity_id") REFERENCES "opportunities"("organization_id", "id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 7. CHECK constraints
--
-- Zod ya valida todo esto en el borde HTTP. Estos son la defensa que sobrevive a
-- un camino de escritura que no pase por el controller — un script, un seed, el
-- worker de automatizaciones del paso 5. Mismo criterio que los dos CHECK de
-- service_types y el de google_calendar_connections.
-- ---------------------------------------------------------------------------

-- Una franja tiene que empezar antes de terminar, y caer dentro del día.
-- El `<= 1440` del final permite cerrar a las 24:00; el `<` entre los dos
-- prohíbe la franja vacía, que no significa nada y rompería el cálculo de
-- disponibilidad devolviendo huecos de duración cero.
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_minute_range_check"
    CHECK ("start_minute" >= 0 AND "end_minute" <= 1440 AND "start_minute" < "end_minute");

-- Una reserva tiene que empezar antes de terminar. Sin esto, un intervalo
-- invertido pasaría inadvertido por TODA la lógica de superposición —que compara
-- starts_at < fin AND ends_at > inicio— y nunca chocaría con nada: una reserva
-- fantasma que ocupa un cupo que nadie ve.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_time_range_check"
    CHECK ("starts_at" < "ends_at");
