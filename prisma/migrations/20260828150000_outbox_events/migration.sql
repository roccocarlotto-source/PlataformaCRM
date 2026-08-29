-- Motor de eventos salientes — primer prerrequisito de P1 en
-- docs/roadmap-implementacion.md.
--
-- La contracara de la capa de ingesta: `ingestion_events` es lo que el CRM
-- RECIBE, `outbox_events` es lo que EMITE. El patrón se calca a propósito —fila
-- de staging, worker con polling, reclamo con FOR UPDATE SKIP LOCKED— porque ya
-- está probado en este repositorio.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que la
-- migración de la capa de ingesta (el único DATABASE_URL disponible apunta al
-- proyecto real y `migrate dev` usa una shadow database y puede proponer un
-- reset). Quien valida que aplica sobre una base vacía es el job `integration`
-- del CI, que la reconstruye desde cero en cada corrida.

-- ---------------------------------------------------------------------------
-- 1. Enum nativo
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSED', 'DEAD_LETTER');

-- ---------------------------------------------------------------------------
-- 2. Tabla
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
--
-- Columna simple contra organizations("id"), como TODAS las FKs a la tabla de
-- organizaciones: `organizations` no tiene columna organization_id —tiene id—
-- así que no existe una versión compuesta de esta relación. Las FKs compuestas
-- que impuso C-3 son las CRUZADAS entre entidades tenant-scoped, y
-- outbox_events no tiene ninguna: no referencia Contact, ni Opportunity, ni
-- nada. A quién se refiere el evento viaja en el payload, sin FK, y es
-- deliberado — un evento es un hecho histórico y no debe impedir borrar la fila
-- que lo originó.
--
-- Consecuencia para el chequeo genérico de la fila 14 del diagnóstico: esta
-- tabla queda FUERA de su alcance, porque ese chequeo mira FKs cuyas DOS tablas
-- tengan organization_id. No es un agujero — es que no hay nada que chequear.
-- Si algún día se le agrega a esta tabla una FK a otra entidad tenant-scoped,
-- ESA sí entra en el alcance sin tocar el chequeo, que es el punto de haberlo
-- generalizado.
--
-- ON DELETE RESTRICT / ON UPDATE CASCADE: idéntico a sources e ingestion_events.
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Índices
-- ---------------------------------------------------------------------------

-- CreateIndex
--
-- El listado por organización, declarado en schema.prisma con @@index. Va desde
-- el arranque y no cuando alguien lo audite: es la lección de ALTO-6, donde las
-- 6 entidades de negocio nacieron sin el índice de su propio listado.
CREATE INDEX "outbox_events_organization_id_created_at_idx"
  ON "outbox_events" ("organization_id", "created_at");

-- ---------------------------------------------------------------------------
-- LA COLA DEL WORKER. Parcial y sobre una expresión, dos formas que el DSL de
-- Prisma no expresa, así que vive solo acá — mismo caso que
-- ingestion_events_pending_created_at_idx.
--
-- QUÉ CONSULTA SIRVE. claimNextClaimableEvent busca el evento pendiente que ya
-- puede intentarse:
--
--   WHERE status = 'PENDING' AND coalesce(next_attempt_at, created_at) <= now()
--   ORDER BY coalesce(next_attempt_at, created_at)
--
-- POR QUÉ coalesce Y NO `next_attempt_at IS NULL OR next_attempt_at <= now()`,
-- que es la forma obvia. Las dos son equivalentes —created_at de una fila que
-- existe siempre es <= now()— pero la del OR no la puede servir un índice de
-- rango: obliga a recorrer el parcial entero filtrando. Y ese es justamente el
-- caso que importa, porque es el que se da durante una caída del destino
-- externo: miles de eventos PENDING con next_attempt_at en el futuro y unos
-- pocos vencidos. Con el OR, encontrar esos pocos cuesta leer todos los otros.
--
-- La expresión tiene además un segundo efecto, y es el que la hace elegante en
-- vez de solo rápida: `coalesce(next_attempt_at, created_at)` ES la fecha desde
-- la que el evento está disponible. Para un evento recién emitido eso es su
-- created_at, así que el orden degrada exactamente a FIFO; para uno en
-- reintento es su próximo turno. Un solo criterio que ordena bien las dos
-- poblaciones, sin ramas.
--
-- PARCIAL POR status, mismo criterio que la cola de ingesta y por el mismo
-- motivo: un índice completo cargaría cada fila PROCESSED para siempre,
-- mientras que el parcial pesa lo que pesa el backlog — tiende a cero cuando el
-- worker va al día, sin importar cuántos millones de filas históricas haya.
--
-- El literal del predicado se castea explícito al enum: un índice parcial exige
-- un predicado IMMUTABLE, y el casteo deja la resolución de tipo resuelta en la
-- definición en vez de depender de la inferencia. coalesce sobre dos columnas
-- timestamp también es IMMUTABLE, que es lo que permite indexarla.
-- ---------------------------------------------------------------------------
CREATE INDEX "outbox_events_claimable_idx"
  ON "outbox_events" ((coalesce("next_attempt_at", "created_at")))
  WHERE "status" = 'PENDING'::"OutboxStatus";
