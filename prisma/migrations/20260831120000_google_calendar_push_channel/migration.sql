-- P2.1 (Agenda/Booking), paso 4 de §9: sincronización inversa. El estado del
-- canal de notificaciones push de Google y del token de sincronización
-- incremental.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que todas
-- las anteriores del módulo (el único DATABASE_URL disponible apunta al proyecto
-- real y `migrate dev` usa una shadow database y puede proponer un reset). Quien
-- valida que aplica sobre una base vacía es el job `integration` del CI.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ SE EXTIENDE google_calendar_connections Y NO HAY TABLA NUEVA
-- ---------------------------------------------------------------------------
--
-- El canal y el syncToken son estado DE UNA CONEXIÓN: nacen con ella, mueren
-- con ella, y no tiene sentido que existan sin ella. Una tabla aparte sería una
-- relación 1-a-1 obligatoria con la de al lado, o sea las mismas columnas más un
-- JOIN en cada lectura y una fila huérfana posible.
--
-- ---------------------------------------------------------------------------
-- LO QUE SE VERIFICÓ CONTRA GOOGLE ANTES DE ESCRIBIR ESTO
-- ---------------------------------------------------------------------------
--
-- Se verificó, no se asumió — el documento de diseño ya se equivocó dos veces en
-- este módulo (calendar.events no habilitaba freebusy.query; "cifrar igual que
-- ApiKey" no existía como criterio):
--
--   1. TTL del canal: 604800 segundos = 7 días EXACTOS por defecto. El "~7 días"
--      del documento estaba bien esta vez. (referencia de events.watch)
--   2. `expiration` vuelve como timestamp Unix en MILISEGUNDOS, no en segundos.
--      Interpretarlo como segundos daría una fecha de 1970 y el worker
--      renovaría el canal en cada pasada, para siempre.
--   3. channels.stop pide `id` + `resourceId`. Por eso channel_resource_id NO es
--      opcional de guardar: sin él un canal no se puede detener nunca, solo
--      esperar a que venza.
--   4. events.list con syncToken devuelve 410 GONE cuando el token venció, y ahí
--      hay que resincronizar completo.
--   5. `nextSyncToken` viene SOLO en la última página de una respuesta paginada
--      (textual en la guía de sync). Guardar el token de una página intermedia
--      dejaría un hueco invisible en la próxima sincronización.
--
-- El address del canal exige además un dominio VERIFICADO en Search Console y
-- registrado en la API Console — es configuración externa, no de este esquema.

-- ---------------------------------------------------------------------------
-- 1. Columnas
--
-- TODAS NULLABLE, y no es laxitud: una conexión recién creada por el flujo OAuth
-- del paso 2 NO tiene canal. El worker de renovación lo crea después, y trata
-- "sin canal" y "canal por vencer" como el mismo caso. Un NOT NULL acá obligaría
-- a cablear la creación del canal dentro de completarConexion(), que es
-- exactamente lo que se decidió no hacer.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "google_calendar_connections"
    -- El id que NOSOTROS le damos al canal (UUID). Google lo devuelve en cada
    -- notificación como X-Goog-Channel-ID.
    ADD COLUMN "channel_id" UUID,
    -- El id OPACO que asigna Google al recurso observado. No es nuestro y no se
    -- puede derivar. Obligatorio para channels.stop.
    ADD COLUMN "channel_resource_id" VARCHAR(255),
    -- Cuándo vence el canal (Google lo manda en milisegundos, ver arriba).
    ADD COLUMN "channel_expiration" TIMESTAMP(3),
    -- Token de sincronización incremental. Sin límite de longitud: Google no
    -- especifica su tamaño. NULL = nunca se sincronizó.
    ADD COLUMN "sync_token" TEXT;

-- ---------------------------------------------------------------------------
-- 2. Índices
-- ---------------------------------------------------------------------------

-- CreateIndex
--
-- UNIQUE sobre channel_id: es la clave de búsqueda del webhook —llega
-- X-Goog-Channel-ID y hay que encontrar la conexión— y dos conexiones no pueden
-- compartir canal. El UNIQUE es lo que hace que esa búsqueda devuelva una fila o
-- ninguna, nunca varias.
--
-- Un índice PARCIAL (WHERE channel_id IS NOT NULL) sería más chico, y no se usa:
-- Postgres ya no indexa los NULL en un índice único de una sola columna a los
-- efectos de la unicidad (varios NULL conviven sin violarla), y la tabla tiene
-- una fila por sucursal. La complejidad no se paga.
CREATE UNIQUE INDEX "google_calendar_connections_channel_id_key"
    ON "google_calendar_connections"("channel_id");

-- CreateIndex
--
-- Sirve la pasada del worker: "conexiones ACTIVE cuyo canal falta o vence
-- pronto". Sin él, esa consulta es un scan en cada tick — barato hoy (una fila
-- por sucursal) y no dentro de un año.
--
-- (status, channel_expiration) y NO al revés: el filtro por status descarta más
-- filas de entrada, y channel_expiration se compara por RANGO, que es lo que un
-- btree resuelve en el último lugar. Invertido, el status quedaría sin poder
-- usarse para acotar.
CREATE INDEX "google_calendar_connections_status_channel_expiration_idx"
    ON "google_calendar_connections"("status", "channel_expiration");

-- ---------------------------------------------------------------------------
-- 3. CHECK constraint
--
-- LAS TRES COLUMNAS DEL CANAL VAN JUNTAS O NO VAN. Un canal a medias es
-- inutilizable de una forma silenciosa y específica: con channel_id pero sin
-- channel_resource_id, el webhook encuentra la conexión y procesa
-- notificaciones, pero el canal NO SE PUEDE DETENER NUNCA (channels.stop pide
-- los dos) ni el worker sabe cuándo renovarlo sin la expiración.
--
-- Mismo criterio que el CHECK de "ACTIVE exige refresh_token" que ya tiene esta
-- tabla: Zod y el service lo garantizan en el borde, esto es la defensa que
-- sobrevive a un camino de escritura que no pase por ahí.
--
-- sync_token queda FUERA del invariante a propósito: es legítimo tener un canal
-- recién creado y todavía ningún token (la primera notificación lo obtiene).
-- ---------------------------------------------------------------------------

ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_channel_all_or_none_check"
    CHECK (
        ("channel_id" IS NULL AND "channel_resource_id" IS NULL AND "channel_expiration" IS NULL)
        OR
        ("channel_id" IS NOT NULL AND "channel_resource_id" IS NOT NULL AND "channel_expiration" IS NOT NULL)
    );
