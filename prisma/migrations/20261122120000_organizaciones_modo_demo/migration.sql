-- Modo demo por organización (docs-privados/taller-demo-diseno.md §2, local):
-- con is_demo = true, los envíos a WhatsApp, Messenger e Instagram se simulan
-- y nada real se puede conectar (src/services/modoDemo.service.ts). Solo lo
-- pone el alta de una organización de demostración.
--
-- Aditiva: columna con default. El backfill marca la Clínica Demo (rubro
-- clínica y slug clinica-demo o clinica-demo-…), que hoy se reconoce solo por
-- el slug y no tiene ningún canal real conectado (verificado el 2026-10-16).
ALTER TABLE "organizations"
  ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;

UPDATE "organizations"
SET "is_demo" = true
WHERE "industry" = 'CLINICA'
  AND ("slug" = 'clinica-demo' OR "slug" LIKE 'clinica-demo-%');
