-- ALTO-7 (docs/auditoria-2026-08-21.md, sección 4): los `search` de los seis
-- repositorios generan ILIKE '%x%' y no existía pg_trgm en ninguna parte del
-- proyecto — seq scan garantizado, verificado sobre prisma/ completo.
--
-- Prisma traduce `{ contains: x, mode: "insensitive" }` a ILIKE '%x%'. Un
-- comodín INICIAL no puede usar un btree, ni siquiera uno sobre lower(col): el
-- btree ordena por prefijo y acá no hay prefijo conocido. La única estructura
-- que responde esa consulta es un índice invertido sobre trigramas.
--
-- Y se paga dos veces por request, porque findMany y count corren en paralelo
-- con el mismo `where`.
--
-- ---------------------------------------------------------------------------
-- LAS 9 COLUMNAS SALEN DEL CÓDIGO, no del hallazgo
-- ---------------------------------------------------------------------------
--
-- Leídas de los buildWhere de cada repositorio, una por una:
--
--   contact.repository.ts      search -> OR sobre first_name, last_name, email
--   company.repository.ts      search -> name
--   opportunity.repository.ts  search -> title
--   activity.repository.ts     search -> OR sobre subject y body
--   stage.repository.ts        search -> name
--   pipeline.repository.ts     search -> name
--
-- contact.repository.ts además expone filtros firstName/lastName/email que
-- usan `contains` sobre esas MISMAS tres columnas, así que los tres índices
-- sirven a los dos caminos.
--
-- activities.body ES EL ÍNDICE CARO y es esperado: es TEXT sin límite (init:149)
-- y su GIN va a ser sensiblemente más grande que los otros ocho. Se acepta a
-- propósito: es también el peor seq scan de los seis, porque leerlo entero
-- obliga a des-TOASTear cada fila en cada búsqueda. La alternativa para texto
-- largo —tsvector + GIN— cambia la semántica (deja de ser subcadena, pasa a ser
-- búsqueda por palabras) y exige $queryRaw; se descartó porque el contrato de
-- `search` hoy es subcadena y cambiarlo no es parte de este hallazgo.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ VIVE EN UNA MIGRACIÓN Y NO EN schema.prisma
-- ---------------------------------------------------------------------------
--
-- El DSL de Prisma no expresa ni CREATE EXTENSION ni una clase de operadores
-- (gin_trgm_ops). Mismo caso que los 8 índices únicos parciales, los 5 CHECK y
-- los 2 triggers: el mecanismo ya establecido por C-2 (20260821140000) es que
-- el objeto viva DENTRO del historial de migraciones —para que una base
-- reconstruida desde cero lo tenga— y que el diagnóstico lo afirme, para que su
-- ausencia no pase inadvertida. La fila 12 de
-- docs/auditoria-2026-08-21-diagnostico.sql hace eso, y verify-schema.ts la
-- afirma.
--
-- No se agregan a prisma/sql/manual_constraints.sql: ese archivo quedó como
-- referencia legible del DDL anterior a C-2, y la capa de ingesta
-- (20260824120000) ya sentó el precedente de que los objetos manuales NUEVOS
-- viven solo en su migración.
--
-- ---------------------------------------------------------------------------
-- DÓNDE SE INSTALA LA EXTENSIÓN, y por qué se fija el search_path
-- ---------------------------------------------------------------------------
--
-- Supabase instala las extensiones en el esquema `extensions`, no en `public`
-- (mismo detalle que la migración de M-13 ya anotó al descartar citext). Ese
-- esquema NO está en el search_path de la conexión de Prisma —el
-- extra_search_path de supabase/config.toml aplica a los requests de PostgREST,
-- no a esta conexión— así que `gin_trgm_ops` a secas no resolvería.
--
-- SET LOCAL con las dos: `CREATE EXTENSION IF NOT EXISTS` es un no-op si la
-- extensión YA existe, sin importar en qué esquema quedó. Un proyecto donde
-- alguien la haya instalado antes en `public` seguiría funcionando, y uno donde
-- esta migración la cree la deja en `extensions`. Con las dos en el
-- search_path, la clase de operadores resuelve en los dos casos.
--
-- Prisma corre cada archivo de migración dentro de una transacción, así que el
-- SET LOCAL vale hasta el final de ESTA migración y no se filtra a las
-- siguientes.

-- El esquema es la convención de Supabase y ya existe en un proyecto real y en
-- el stack local del CI. El IF NOT EXISTS es para que esta migración también
-- aplique sobre un Postgres pelado, donde no existiría.
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

-- contacts — el `search` es un OR sobre las tres, y además hay un filtro
-- específico por cada una que usa el mismo `contains`.
CREATE INDEX IF NOT EXISTS "contacts_first_name_trgm_idx" ON public.contacts USING gin ("first_name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "contacts_last_name_trgm_idx" ON public.contacts USING gin ("last_name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "contacts_email_trgm_idx" ON public.contacts USING gin ("email" gin_trgm_ops);

-- companies
CREATE INDEX IF NOT EXISTS "companies_name_trgm_idx" ON public.companies USING gin ("name" gin_trgm_ops);

-- opportunities
CREATE INDEX IF NOT EXISTS "opportunities_title_trgm_idx" ON public.opportunities USING gin ("title" gin_trgm_ops);

-- activities — subject es VarChar(255); body es el TEXT sin límite del que
-- habla el encabezado.
CREATE INDEX IF NOT EXISTS "activities_subject_trgm_idx" ON public.activities USING gin ("subject" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "activities_body_trgm_idx" ON public.activities USING gin ("body" gin_trgm_ops);

-- stages
CREATE INDEX IF NOT EXISTS "stages_name_trgm_idx" ON public.stages USING gin ("name" gin_trgm_ops);

-- pipelines
CREATE INDEX IF NOT EXISTS "pipelines_name_trgm_idx" ON public.pipelines USING gin ("name" gin_trgm_ops);
