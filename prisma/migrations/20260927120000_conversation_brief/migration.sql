-- ---------------------------------------------------------------------------
-- Brief de cada conversación (ítem 73 de docs/frontend-cambios-pendientes.md):
-- las columnas conversations.brief y conversations.brief_edited_by_user_id.
--
-- QUÉ RESUELVE. Hasta acá, lo único parecido a un resumen de una conversación
-- era la Activity que ejecutarHandoff crea al derivar, con el motivo que dio
-- el propio agente. Eso es una tarea en la bandeja de otro módulo, no algo que
-- se vea en la conversación misma, y una conversación que nunca se derivó no
-- tenía nada equivalente. El brief vive en la fila de la conversación, se
-- redacta solo al derivar y se puede pedir a mano en cualquier momento.
--
-- DOS COLUMNAS NULLABLES, SIN DEFAULT Y SIN BACKFILL: "todavía no se generó"
-- es un estado válido y es el estado en el que quedan TODAS las conversaciones
-- existentes al aplicar esta migración. No hay ningún valor que se pueda
-- inferir de los datos: un brief se redacta llamando a un LLM con el
-- transcript, y eso es trabajo de la aplicación a pedido, no de una migración
-- de datos. Mismo criterio que branches.default_owner_id (20260925120000).
--
-- POR QUÉ brief_edited_by_user_id Y NO UN BOOLEANO. La columna responde "quién
-- escribió el texto que hoy está guardado", no "quién apretó un botón":
-- generar y regenerar los dispara una persona desde la pantalla y aun así la
-- dejan en NULL, porque el texto lo escribió el modelo. Solo el PATCH del
-- endpoint la completa. Guardar el usuario en vez de un flag es lo que deja
-- que la pantalla diga de quién fue la corrección sin una tabla de auditoría
-- aparte, y no cuesta nada más: es la misma forma que assigned_user_id.
--
-- TEXT Y NO VARCHAR(N), a diferencia de external_thread_id: el largo lo decide
-- el prompt ("2 a 4 oraciones"), no el esquema, y una persona editándolo a
-- mano no debería chocar contra un tope arbitrario. Es el mismo tipo que
-- messages.content, que transporta el texto del que este resumen sale.
--
-- SIN ÍNDICE sobre ninguna de las dos, a propósito y con el mismo criterio
-- explícito que branches.default_owner_id y activities.confirmed_by_id: ningún
-- listado filtra ni ordena conversaciones por su brief ni por quién lo editó.
-- El brief se lee siempre junto con la fila que ya se trajo —el listado lo
-- muestra truncado y el detalle entero—, así que el único acceso real lo
-- resuelven los índices que ya existen.
--
-- LA ACCIÓN REFERENCIAL sale de la regla de 20260821140200 y la fila 14 del
-- diagnóstico la deriva sola: columna NULLABLE -> NO ACTION (igual que
-- conversations.assigned_user_id, que está en esta misma tabla), con
-- ON UPDATE CASCADE y MATCH SIMPLE como toda FK entre tablas con
-- organization_id.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entra solo por la
-- fila 16: es una FK nueva hacia users y una FK bien formada hacia el padre
-- equivocado —contacts, que también tiene su UNIQUE (organization_id, id), y
-- que en ESTA tabla es un padre real (contact_id)— pasaría la fila 14 sin que
-- nadie se entere (55 -> 56 FKs conocidas). No entra a la fila 5 (no hay tabla
-- nueva: conversations ya tiene su política) ni a la 8 (no agrega ningún
-- CHECK).
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). Los ALTER TABLE y la FK son exactamente lo que
-- `prisma migrate diff` deriva del schema, para que no aparezca drift. Quien
-- valida que aplica sobre una base vacía es el job `integration` del CI, que
-- reconstruye la base desde cero en cada corrida.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "brief" TEXT;

ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "brief_edited_by_user_id" UUID;

-- AddForeignKey
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_organization_id_brief_edited_by_user_id_fkey"
  FOREIGN KEY ("organization_id", "brief_edited_by_user_id")
  REFERENCES "users"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE NO ACTION
  ON UPDATE CASCADE;
