-- ---------------------------------------------------------------------------
-- PR R1 de docs/rubros.md (§15): el rubro de la organización (§1.1). Ningún
-- código de la aplicación lee la columna todavía; el gate del rubro es el PR R2
-- y el selector en Nueva organización, el R3.
--
-- organizations.industry: AUTOMOTORA o CLINICA. Default AUTOMOTORA, sin
-- backfill: todas las organizaciones existentes son automotoras y el DEFAULT
-- les deja ese valor al agregar la columna. Solo agrega: no modifica ni borra
-- nada existente. Sin CHECK, trigger, índice ni FK, así que el diagnóstico
-- (docs/auditoria-2026-08-21-diagnostico.sql) no cambia.
--
-- Escrita a mano, no generada por `prisma migrate dev`: mismo motivo que el
-- resto desde 20260821 (la shadow database no tiene el schema auth). Es lo que
-- `prisma migrate diff --from-schema-datasource` deriva del schema.
--
-- El nombre ordena DESPUÉS de 20261030120000_ediciones_columnas, la última,
-- que ya tiene fecha futura: migrate deploy aplica en orden de nombre.
-- ---------------------------------------------------------------------------

CREATE TYPE "OrganizationIndustry" AS ENUM ('AUTOMOTORA', 'CLINICA');

ALTER TABLE "organizations" ADD COLUMN "industry" "OrganizationIndustry" NOT NULL DEFAULT 'AUTOMOTORA';
