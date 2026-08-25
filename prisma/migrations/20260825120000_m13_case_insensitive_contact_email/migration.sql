-- M-13 (docs/auditoria-2026-08-21.md, sección 4): la unicidad de email de
-- contacto era case-sensitive. contacts_org_email_unique estaba definido sobre
-- la columna cruda, y lo único que hacía que dedupliquara de verdad era
-- normalizeEmail() en contact.service.ts, que bajaba a minúsculas antes de
-- escribir.
--
-- La sección 4 de docs/ingestion-architecture.md apoya TODA la deduplicación de
-- la ingesta en un "upsert por email" contra este índice, y la promoción desde
-- staging no pasa por contact.service. Sin este arreglo, Juan@Acme.com y
-- juan@acme.com entrarían como dos contactos distintos justo en el escenario
-- para el que el índice existe.
--
-- ---------------------------------------------------------------------------
-- Por qué un índice sobre expresión y no citext
-- ---------------------------------------------------------------------------
--
-- citext es expresable en Prisma (5.22.0 acepta @db.Citext — verificado, no
-- supuesto), así que el descarte no es por ahí. El argumento a favor de citext
-- era que las LECTURAS quedaran insensibles solas, sin que nadie tenga que
-- acordarse. Eso importaría si olvidarse produjera un duplicado silencioso, y
-- no lo produce: con el índice sobre lower(email), un camino de lectura que se
-- olvide del lower() no encuentra el contacto existente, intenta insertar, y
-- CHOCA CONTRA LA CONSTRAINT. Falla ruidoso, no duplica. La garantía es
-- idéntica; lo de citext era comodidad, no seguridad.
--
-- Y se paga caro: extensión nueva (en Supabase vive en el esquema `extensions`,
-- con la calificación que eso arrastra), reescritura completa de la tabla
-- (citext no es binariamente coercible desde varchar) y pérdida del VarChar(255)
-- de la columna, que quedaría validado solo en Zod — el patrón de M-12 que la
-- auditoría ya marca.
--
-- ---------------------------------------------------------------------------
-- EL NOMBRE DEL ÍNDICE NO CAMBIA. Restricción dura, no preferencia.
-- ---------------------------------------------------------------------------
--
-- rethrowAsConflict (contact.service.ts) decide con target.includes("email").
-- Postgres reporta el NOMBRE DEL ÍNDICE en el error 23505, y Prisma solo lo
-- mapea a nombres de campo si el índice está declarado en el DSL — éste no lo
-- está (es parcial, y ahora además sobre expresión, dos formas que el DSL de
-- Prisma no expresa). Mientras el nombre siga conteniendo "email", la
-- traducción al 409 específico sigue funcionando con cualquiera de las dos
-- formas que Prisma pueda devolver.
--
-- Si se renombrara, el 409 "Ya existe un contacto con ese email en esta
-- organización" degradaría en silencio al genérico "El registro ya existe", y
-- NINGÚN TEST UNITARIO LO VERÍA: los unitarios le pasan el target a mano. Por
-- eso hay un test de integración que captura el error real de Postgres y lo
-- pasa por rethrowAsConflict.
--
-- ---------------------------------------------------------------------------
-- Datos existentes
-- ---------------------------------------------------------------------------
--
-- Esta migración PUEDE FALLAR sobre una base con datos: si dos contactos vivos
-- de la misma organización tienen emails que difieren solo en mayúsculas, el
-- CREATE UNIQUE INDEX los rechaza; si alguno tiene espacios al borde, el CHECK
-- los rechaza. Prisma corre cada migración dentro de una transacción, así que
-- un fallo revierte todo y el índice viejo queda intacto — pero deja la
-- migración marcada como fallida y bloquea las siguientes.
--
-- ANTES DE APLICARLA SOBRE UNA BASE CON DATOS: correr
-- docs/m13-deteccion-duplicados-email.sql, que detecta los dos casos.
--
-- En CI no hay riesgo y por eso el verde del CI NO ALCANZA: la base se
-- reconstruye vacía en cada corrida, así que el job confirma que la migración
-- aplica y no dice absolutamente nada sobre si aplica sobre datos reales.

-- ---------------------------------------------------------------------------
-- 1. El índice, ahora sobre lower(email)
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS public.contacts_org_email_unique;

-- Mismo nombre y mismo predicado parcial que antes; lo único que cambia es que
-- la unicidad se evalúa sobre lower(email). El índice sigue siendo parcial: se
-- permiten múltiples contactos sin email, y un contacto borrado (soft delete)
-- libera su email para reuso.
CREATE UNIQUE INDEX contacts_org_email_unique
  ON public.contacts (organization_id, lower(email))
  WHERE email IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. El CHECK de espacios — RESPALDO, NO MECANISMO
-- ---------------------------------------------------------------------------
--
-- lower(' juan@acme.com ') no es igual a lower('juan@acme.com'), así que un
-- espacio al borde sí crearía un duplicado falso: el case lo resuelve la base,
-- los espacios no.
--
-- Este CHECK es el RESPALDO, no el mecanismo. La aplicación tiene que seguir
-- normalizando los espacios —contact.service.ts lo hace con .trim(), y la
-- promoción del ítem 4 tiene que hacer lo mismo—; el CHECK existe para que sea
-- IMPOSIBLE saltearlo, no para reemplazarlo. Una fila de ingesta que llegue con
-- espacios se marca FAILED con su mensaje y el lote sigue (sección 5 del
-- documento de ingesta), que es el comportamiento correcto para datos externos.
--
-- Se prefirió un CHECK sobre lower(btrim(email)) en el índice: esa variante
-- también evitaría el duplicado, pero dejaría guardado el valor con espacios —
-- dato sucio con constraint limpia. El CHECK rechaza el dato sucio de entrada.
--
-- drop + add en vez de "add if not exists" (que Postgres no soporta para
-- constraints), igual que los 4 CHECK de manual_constraints.sql.

ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_email_trimmed_check;
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_email_trimmed_check
  CHECK (email IS NULL OR email = btrim(email));
