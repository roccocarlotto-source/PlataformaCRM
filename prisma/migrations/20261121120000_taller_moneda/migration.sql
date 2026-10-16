-- #12 (docs/servicios.md §2.6, D17): la moneda propia del taller. Es la que
-- toma el Valor de una orden (y el de una aprobación) cuando no se elige otra.
-- Antes se usaba la moneda de preferencia de la organización, que en una
-- automotora es la de las ventas (USD), no la del taller.
--
-- Solo una columna nueva con default: las filas que ya existen quedan en UYU.
-- No toca ninguna orden: cada orden guarda su propia moneda junto al monto.
ALTER TABLE "workshop_settings"
  ADD COLUMN "currency" VARCHAR(3) NOT NULL DEFAULT 'UYU';

ALTER TABLE "workshop_settings"
  ADD CONSTRAINT "workshop_settings_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
