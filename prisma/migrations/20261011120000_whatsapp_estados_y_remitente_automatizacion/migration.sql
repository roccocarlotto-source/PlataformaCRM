-- ---------------------------------------------------------------------------
-- WA-1 de los pendientes post F1–F5 (docs/prueba-en-vivo-2026-09-29.md, rama
-- feat/whatsapp-estados-de-entrega). Parte 1 de 2: los valores nuevos.
--
-- 1. MessageSenderType gana AUTOMATION: los WhatsApp que manda una regla de
--    automatización (seguimiento con QR y cupón, F1) quedaban como AGENT
--    porque el enum no tenía otro valor. Ver el comentario del enum en
--    schema.prisma para lo que significa para el agente (nada cambia).
--
-- 2. MessageDeliveryStatus gana DELIVERED y READ: los statuses que Meta manda
--    al webhook para un mensaje saliente. El orden de "no retroceder" vive en
--    el código (message.repository.ts), no en el enum.
--
-- EN DOS MIGRACIONES, Y NO EN UNA. migrate deploy corre cada migración en una
-- transacción, y Postgres prohíbe USAR un valor de enum en la misma
-- transacción que lo agrega ("unsafe use of new value"). El CHECK
-- messages_sender_user_id_consistency_check tiene que nombrar AUTOMATION, así
-- que se reescribe en la migración siguiente (20261011120100), cuando este
-- ADD VALUE ya está commiteado. Acá los valores no se usan en ningún lado —ni
-- default, ni backfill, ni índice—, mismo molde que 20260902130000.
--
-- Entre las dos migraciones (si una fallara en el medio) el CHECK viejo
-- rechaza AUTOMATION: nada lo escribe hasta que la imagen nueva esté arriba, y
-- la imagen nueva se deploya después de las dos.
--
-- SIN BACKFILL de los mensajes de F1 ya guardados como AGENT: no hay forma
-- confiable de distinguirlos de una respuesta del agente sin inventar un
-- criterio (el texto de la plantilla cambia por regla).
--
-- Escrita a mano: la shadow database de `prisma migrate dev` no tiene el
-- schema auth (mismo motivo que el resto desde 20260821). Los ALTER TYPE son
-- los que deriva `prisma migrate diff`.
-- ---------------------------------------------------------------------------

-- AlterEnum
ALTER TYPE "MessageSenderType" ADD VALUE 'AUTOMATION';

-- AlterEnum
ALTER TYPE "MessageDeliveryStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "MessageDeliveryStatus" ADD VALUE 'READ';
