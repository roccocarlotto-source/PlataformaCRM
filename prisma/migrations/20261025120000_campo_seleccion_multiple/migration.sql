-- ---------------------------------------------------------------------------
-- Tipo MULTI_SELECT ("Selección múltiple") en ContactCustomFieldType
-- (06/10/2026). El valor de un campo de este tipo en Contact.customFields es
-- un arreglo de opciones ["Contado", "Permuta"]; las reglas (cada una
-- vigente, sin repetidas) viven en utils/camposPersonalizados.ts.
--
-- Un valor aditivo, mismo molde que 20261022120000: sin reescritura de tabla,
-- sin backfill (ninguna definición puede tenerlo todavía) y sin usarlo en
-- esta misma transacción (Postgres prohíbe usar un valor de enum en la
-- transacción que lo agrega). Escrita a mano por el mismo motivo que las
-- demás desde 20260821 (la shadow database no tiene el schema auth); la
-- valida el job `integration` del CI, que reconstruye la base desde cero.
--
-- El pasaje SELECT ↔ MULTI_SELECT de una definición existente convierte los
-- valores de sus contactos en el service (contactCustomFieldDefinition), no
-- acá: es por campo y lo decide un ADMIN.
-- ---------------------------------------------------------------------------

-- AlterEnum
ALTER TYPE "ContactCustomFieldType" ADD VALUE IF NOT EXISTS 'MULTI_SELECT';
