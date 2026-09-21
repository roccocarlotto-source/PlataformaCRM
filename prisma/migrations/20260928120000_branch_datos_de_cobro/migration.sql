-- ---------------------------------------------------------------------------
-- Datos de cobro por sucursal (ítem 74 de docs/frontend-cambios-pendientes.md):
-- las columnas branches.payment_link_url y branches.bank_transfer_details, que
-- el agente de IA comparte con la tool get_payment_info.
--
-- No hay pasarela de pago integrada y no es lo que esto construye: son un link
-- de pago FIJO que el negocio ya generó en su proveedor y datos de cuenta para
-- transferencia, cargados a mano como configuración. Ver el comentario del
-- modelo Branch en schema.prisma.
--
-- DOS COLUMNAS NULLABLE, SIN DEFAULT Y SIN BACKFILL, mismo patrón que
-- default_owner_id (20260925120000): "sin configurar" es un estado válido y es
-- en el que quedan TODAS las sucursales existentes. No hay ningún valor que se
-- pueda inferir.
--
-- SIN ÍNDICE: ningún listado filtra sucursales por estos campos; el único
-- acceso es "dada esta sucursal, sus datos de cobro", que ya resuelve la PK.
--
-- SIN CHECK: el formato (http(s)://, topes de largo) lo valida el API en
-- branch.controller.ts, igual que QrCode.destinationUrl. No entra al
-- diagnóstico (docs/auditoria-2026-08-21-diagnostico.sql): no hay tabla nueva
-- (fila 5), ni CHECK (fila 8), ni FK (filas 14/16).
--
-- Escrita a mano, no generada por `prisma migrate dev` (la shadow database no
-- tiene el schema auth). El ALTER TABLE es exactamente lo que
-- `prisma migrate diff` deriva del schema, para que no aparezca drift.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "payment_link_url" VARCHAR(2048),
  ADD COLUMN IF NOT EXISTS "bank_transfer_details" TEXT;
