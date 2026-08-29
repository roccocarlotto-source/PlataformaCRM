-- P2.1 (Agenda/Booking), paso 2 de §9: la conexión OAuth de una sucursal con
-- Google Calendar. SIN Booking y SIN GET /api/availability.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que las
-- migraciones de la capa de ingesta, del outbox y del primer tramo de Booking
-- (el único DATABASE_URL disponible apunta al proyecto real y `migrate dev` usa
-- una shadow database y puede proponer un reset). Quien valida que aplica sobre
-- una base vacía es el job `integration` del CI.
--
-- ---------------------------------------------------------------------------
-- LA PREMISA DEL DOCUMENTO DE DISEÑO SOBRE EL CIFRADO ERA FALSA
-- ---------------------------------------------------------------------------
--
-- docs/booking-architecture.md §3/§4 dice que el refresh token se guarda
-- "cifrado en reposo, igual criterio que ApiKey". Se verificó contra el repo
-- antes de escribir esto y NO HAY tal criterio que copiar:
--
--   - ApiKey no está cifrada, está HASHEADA — SHA-256 sin sal
--     (src/utils/apiKey.ts), irreversible a propósito.
--   - Un grep por createCipheriv/createDecipheriv/aes-256/encrypt/decrypt sobre
--     src/, prisma/ y scripts/ daba CERO coincidencias: no había ningún módulo
--     de cifrado en reposo en el proyecto.
--
-- Y la diferencia no es de implementación sino de problema: una API key solo hay
-- que RECONOCERLA (comparar por igualdad contra lo que llega en un header), así
-- que un hash irreversible es la primitiva correcta. Un refresh token hay que
-- RECUPERARLO para poder mandárselo a Google, así que hashearlo lo volvería
-- inútil. Cifrado y hasheo no son dos formas de "proteger un secreto": son
-- respuestas a dos preguntas distintas.
--
-- Se paró y se preguntó antes de elegir, por ser una decisión de seguridad.
-- Resultado: AES-256-GCM con node:crypto, clave de 32 bytes por variable de
-- entorno, en un módulo GENÉRICO (src/utils/encryption.ts) y no atado a Google
-- ni a "refresh token" — cualquier otro secreto recuperable que aparezca lo va a
-- necesitar igual. El documento de diseño quedó corregido.

-- ---------------------------------------------------------------------------
-- 1. Enum nativo
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'ERROR');

-- ---------------------------------------------------------------------------
-- 2. Tabla
--
-- SIN deleted_at, a diferencia de branches/resources/service_types: esta fila no
-- es una entidad de negocio que se archive, es el estado de una integración. Su
-- ciclo de vida completo lo describe `status`, y un soft delete agregaría un
-- cuarto estado ("borrada") que no significa nada distinto de REVOKED.
--
-- refresh_token NULLABLE, y es deliberado: una conexión REVOKED no tiene token,
-- no tiene un token vacío. Al desconectar se pone en NULL, así que un volcado de
-- la base no arrastra credenciales de sucursales que ya se fueron. El CHECK de
-- la sección 5 sostiene la otra mitad del invariante.
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "google_calendar_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    -- Cifrado con AES-256-GCM (src/utils/encryption.ts). NUNCA en claro.
    -- Sin límite de longitud: el ciphertext es base64url y su tamaño depende del
    -- token que emita Google, que no está especificado ni es estable.
    "refresh_token" TEXT,
    "calendar_id" VARCHAR(255) NOT NULL DEFAULT 'primary',
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    -- Por qué esta conexión dejó de funcionar. No hay mecanismo de aviso al
    -- admin todavía (§4 lo pide, no existe), así que el registro en la fila ES
    -- la notificación.
    "last_error_at" TIMESTAMP(3),
    "last_error_message" VARCHAR(500),
    -- Cuándo se autorizó POR ÚLTIMA VEZ, distinto de created_at: reconectar
    -- actualiza esta misma fila.
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_calendar_connections_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 3. UNIQUE (organization_id, branch_id) — "una conexión por sucursal"
--
-- Es EL invariante estructural de esta tabla: reconectar una sucursal actualiza
-- su fila, nunca crea una segunda. Sin este índice, dos callbacks concurrentes
-- dejarían dos filas ACTIVE y nada podría decidir cuál es la buena.
--
-- COMPUESTO Y NO UN UNIQUE SOBRE branch_id SOLO, por un requisito de Prisma —el
-- lado definidor de una relación 1-a-1 tiene que ser único sobre los mismos
-- campos que usa la relación— y garantiza exactamente lo mismo por
-- construcción: la FK compuesta de la sección 4 obliga a que el organization_id
-- de esta fila sea el de SU sucursal, y branches.id es la PK (un solo
-- organization_id posible por branch_id), así que dos filas con el mismo
-- branch_id colisionan acá sí o sí.
--
-- NO hay (organization_id, created_at), a diferencia de las tres tablas del
-- primer tramo, y es una decisión y no un olvido: la lección de ALTO-6 es sobre
-- el índice del LISTADO de una entidad, y acá no hay listado. Todo acceso es por
-- sucursal —una fila— y lo sirve este mismo índice, incluido el conteo del
-- RESTRICT de deleteBranch.
-- ---------------------------------------------------------------------------

-- CreateIndex
CREATE UNIQUE INDEX "google_calendar_connections_organization_id_branch_id_key"
    ON "google_calendar_connections"("organization_id", "branch_id");

-- ---------------------------------------------------------------------------
-- 4. Foreign keys
--
-- La cruzada es COMPUESTA (organization_id, branch_id) -> branches
-- (organization_id, id), el estándar del proyecto desde C-3. ON DELETE RESTRICT
-- por la regla de 20260821140200 (columna referenciante NOT NULL -> RESTRICT).
-- ON UPDATE CASCADE y MATCH SIMPLE, como todas.
--
-- La fila 14 del diagnóstico (C-3 generalizado) toma esta FK sola, sin tocar el
-- chequeo: sus dos tablas tienen organization_id, que es exactamente su criterio
-- de alcance.
-- ---------------------------------------------------------------------------

-- AddForeignKey
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_organization_id_branch_id_fkey"
    FOREIGN KEY ("organization_id", "branch_id") REFERENCES "branches"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. CHECK constraint
--
-- UNA CONEXIÓN ACTIVE SIN TOKEN ES IMPOSIBLE. Es el invariante que hace que
-- `status = 'ACTIVE'` signifique algo: sin esto, un bug en el callback podría
-- dejar una fila que dice estar conectada y no tiene con qué llamar a Google, y
-- el síntoma aparecería recién en la primera reserva.
--
-- Mismo criterio que los dos CHECK de service_types: Zod y el service ya lo
-- garantizan en el borde, esto es la defensa que sobrevive a un camino de
-- escritura que no pase por ahí — un script, un seed, un worker futuro.
--
-- REVOKED y ERROR quedan libres de tener token o no: al desconectar se pone en
-- NULL, pero una conexión que pasó a ERROR conserva el suyo a propósito (puede
-- ser un fallo transitorio de Google, y tirarlo obligaría a reautorizar por algo
-- que quizás se arregla solo).
-- ---------------------------------------------------------------------------

ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_active_requires_token_check"
    CHECK ("status" <> 'ACTIVE' OR "refresh_token" IS NOT NULL);
