-- ---------------------------------------------------------------------------
-- Vendedor por defecto por sucursal (ítem 69 de
-- docs/frontend-cambios-pendientes.md): la columna branches.default_owner_id.
--
-- Cierra la limitación conocida que documentaba la nota del 12/09/2026 bajo §6
-- de docs/ai-agent-architecture.md ("la solución natural es un vendedor por
-- defecto por sucursal"). Sin ella, un Contact sin ownerId rompe dos cosas en
-- la capa de tools del agente de IA: create_opportunity falla de una, y la
-- derivación a humano transfiere la conversación pero no crea la Activity que
-- avisa a nadie. Ver el comentario del modelo Branch en schema.prisma.
--
-- UNA COLUMNA NULLABLE, SIN DEFAULT Y SIN BACKFILL: "sin vendedor por defecto"
-- es un estado válido y es el estado en el que quedan TODAS las sucursales
-- existentes al aplicar esta migración — o sea que el comportamiento no cambia
-- para nadie hasta que un ADMIN configure uno a mano. Es lo contrario de una
-- migración de datos: acá no hay ningún valor que se pueda inferir.
--
-- SIN ÍNDICE, a propósito y con el mismo criterio explícito que
-- activities.confirmed_by_id (20260914120000): ningún listado filtra sucursales
-- por su vendedor por defecto, y branches tiene un puñado de filas por
-- organización. El único acceso real es "dada esta sucursal, quién es su
-- vendedor por defecto", que ya resuelve la PK.
--
-- LA ACCIÓN REFERENCIAL sale de la regla de 20260821140200 y la fila 14 del
-- diagnóstico la deriva sola: columna NULLABLE -> NO ACTION (igual que
-- conversations.assigned_user_id y vehicles.assigned_salesperson_id), con
-- ON UPDATE CASCADE y MATCH SIMPLE como toda FK entre tablas con
-- organization_id.
--
-- Al diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql) entra solo por la
-- fila 16: es una FK nueva hacia users y una FK bien formada hacia el padre
-- equivocado —contacts, que también tiene su UNIQUE (organization_id, id)—
-- pasaría la fila 14 sin que nadie se entere (53 -> 54 FKs conocidas). No entra
-- a la fila 5 (no hay tabla nueva: branches ya tiene su política) ni a la 8 (no
-- agrega ningún CHECK).
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto de las migraciones desde 20260821 (la shadow database no tiene el
-- schema auth). El ALTER TABLE y la FK son exactamente lo que `prisma migrate
-- diff` deriva del schema, para que no aparezca drift. Quien valida que aplica
-- sobre una base vacía es el job `integration` del CI, que reconstruye la base
-- desde cero en cada corrida.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "default_owner_id" UUID;

-- AddForeignKey
ALTER TABLE "branches"
  ADD CONSTRAINT "branches_organization_id_default_owner_id_fkey"
  FOREIGN KEY ("organization_id", "default_owner_id")
  REFERENCES "users"("organization_id", "id")
  MATCH SIMPLE
  ON DELETE NO ACTION
  ON UPDATE CASCADE;
