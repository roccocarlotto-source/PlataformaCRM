-- H-1 (docs-privados/prueba-s7-2026-10-15.md, local): el reintento automático
-- del alta de la plantilla de WhatsApp de una regla. Si Meta no responde (429,
-- 5xx, red, timeout), la regla guarda el error y cuándo reintentar; un worker
-- reintenta con espera creciente y tope. Si Meta rechaza el pedido, no se
-- reintenta: queda el motivo. Solo columnas nuevas, sin tocar datos.
ALTER TABLE automations
  ADD COLUMN template_sync_attempts   INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN template_sync_next_at    TIMESTAMP(3) NULL,
  ADD COLUMN template_sync_error      VARCHAR(500) NULL,
  ADD COLUMN template_sync_error_kind VARCHAR(20)  NULL;
ALTER TABLE automations
  ADD CONSTRAINT automations_template_sync_attempts_check CHECK (template_sync_attempts >= 0),
  ADD CONSTRAINT automations_template_sync_kind_check
    CHECK (template_sync_error_kind IS NULL OR template_sync_error_kind IN ('TEMPORAL', 'DEFINITIVO'));
CREATE INDEX automations_template_sync_next_at_idx
  ON automations (template_sync_next_at) WHERE template_sync_next_at IS NOT NULL;
