-- ---------------------------------------------------------------------------
-- El texto del aviso "nadie disponible" pasa a ser configurable por agente, y
-- el aviso se reconoce por un DATO, no por su texto.
--
-- Hasta acá el aviso era un texto fijo, y la marca "Pidió hablar con una
-- persona · sin responder" lo encontraba en el hilo por su primera frase
-- (PREFIJO_DEL_AVISO). Con texto libre esa frase puede no estar.
--
-- TRES COSAS:
--
-- 1. agents.unanswered_handoff_notice_text — el texto propio del agente.
--    NULL = el de siempre. Tope de 500 caracteres: es un WhatsApp de una o
--    dos oraciones, y fuera de horario se le agrega la frase del horario.
--
-- 2. messages.notice_type (enum MessageNoticeType) — qué aviso automático es
--    un mensaje. Se BACKFILLEA con el criterio de antes (AUTOMATION que empieza
--    con la primera frase fija), así los avisos ya guardados mantienen su
--    marca. Es la última vez que se usa el texto para reconocerlo.
--
-- 3. CHECK messages_notice_type_automation_check — solo un mensaje de
--    AUTOMATION puede ser un aviso.
--
-- Escrita a mano, como las demás desde 20260821. Las sentencias de 1 y 2 son
-- exactamente lo que `prisma migrate diff` deriva del schema.
--
-- ORDEN: aditiva. La imagen vieja no lee ni escribe las columnas nuevas, y
-- sigue reconociendo los avisos por el texto (que es el fijo mientras nadie
-- cargue uno propio). Migración primero, imagen después, como siempre.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "MessageNoticeType" AS ENUM ('UNANSWERED_HANDOFF');

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "unanswered_handoff_notice_text" VARCHAR(500);

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "notice_type" "MessageNoticeType";

-- Backfill (punto 2). El LIKE con la frase literal: es la constante
-- PREFIJO_DEL_AVISO de avisoSinRespuesta.service.ts.
UPDATE "messages"
SET "notice_type" = 'UNANSWERED_HANDOFF'
WHERE "sender_type" = 'AUTOMATION'
  AND "content" LIKE 'Por el momento no hay nadie del equipo disponible.%';

-- El punto 3.
ALTER TABLE "messages" ADD CONSTRAINT "messages_notice_type_automation_check"
    CHECK ("notice_type" IS NULL OR "sender_type" = 'AUTOMATION');
