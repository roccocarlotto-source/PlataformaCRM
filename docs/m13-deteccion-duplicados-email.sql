-- ---------------------------------------------------------------------------
-- M-13 — Detección previa: ¿esta base puede recibir la migración
--        20260825120000_m13_case_insensitive_contact_email?
--
-- SOLO LECTURA. No crea, no modifica y no borra nada. Se puede correr en
-- producción sin riesgo.
--
-- Cómo usarlo:
--   Supabase → SQL Editor → New query → pegar todo → Run.
--   Devuelve dos tablas: la primera son los duplicados de case, la segunda los
--   emails con espacios al borde. LAS DOS TIENEN QUE VOLVER VACÍAS.
--
-- ---------------------------------------------------------------------------
-- CUÁNDO CORRERLA
--
-- Antes de aplicar la migración de M-13 sobre CUALQUIER base que ya tenga
-- datos: la de desarrollo, la de producción, o la de cualquiera que clone el
-- proyecto sobre un Postgres con contactos cargados.
--
-- NO alcanza con que el CI esté en verde. El job de integración reconstruye la
-- base desde cero en cada corrida, así que confirma que la migración APLICA y
-- no dice absolutamente nada sobre si aplica sobre TUS datos. Este archivo
-- existe exactamente para cubrir ese hueco.
--
-- ---------------------------------------------------------------------------
-- QUÉ HACE LA MIGRACIÓN, Y POR QUÉ PUEDE FALLAR
--
-- Redefine contacts_org_email_unique sobre lower(email) en vez de sobre la
-- columna cruda, y agrega un CHECK que exige que el email no tenga espacios al
-- borde. Las dos cosas VALIDAN LAS FILAS EXISTENTES al aplicarse:
--
--   1. Si dos contactos vivos de la misma organización tienen emails que
--      difieren solo en mayúsculas (Juan@Acme.com y juan@acme.com), hoy
--      conviven y después no van a poder. CREATE UNIQUE INDEX falla.
--   2. Si algún contacto tiene el email con un espacio adelante o atrás, el
--      CHECK falla.
--
-- Prisma corre cada migración dentro de una transacción, así que un fallo
-- revierte todo y el índice viejo queda intacto — no hay estado intermedio
-- roto. Pero deja la migración marcada como fallida y bloquea las siguientes
-- hasta resolverlo a mano.
--
-- ---------------------------------------------------------------------------
-- QUÉ HACER SI DEVUELVE FILAS
--
-- No hay arreglo automático, y es a propósito: decidir qué pasa con dos
-- contactos que resultaron ser el mismo es una decisión de negocio, no de
-- migración. Una migración que "resuelve" esto sola destruye datos que alguien
-- cargó a mano.
--
-- Para la primera consulta (duplicados de case), por cada grupo hay que elegir:
--   - fusionar: quedarse con uno y mover a mano lo que cuelga del otro
--     (opportunities, activities: ver las FKs compuestas de contacts);
--   - borrar uno con soft delete (deleted_at) — el índice es parcial, así que
--     una fila borrada deja de ocupar el lugar;
--   - o corregir el email de uno, si resultaron ser personas distintas y
--     alguien se equivocó al cargar.
--
-- Para la segunda (espacios al borde), un UPDATE con btrim(email) alcanza:
-- nadie tipeó ese espacio a propósito. Conviene mirar las filas primero igual.
--
-- Después de resolverlas, volver a correr este archivo hasta que las dos
-- consultas devuelvan vacío, y recién ahí aplicar la migración.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Duplicados que hoy conviven y dejarían de poder hacerlo.
--
--    Mismo predicado que el índice (email not null, deleted_at is null): las
--    filas borradas no cuentan, igual que no van a contar después.
-- ---------------------------------------------------------------------------
select
  'DUPLICADO DE CASE' as problema,
  organization_id,
  lower(email) as email_normalizado,
  count(*) as filas,
  string_agg(distinct email, ' | ' order by email) as variantes,
  string_agg(id::text, ' | ') as ids
from public.contacts
where email is not null
  and deleted_at is null
group by organization_id, lower(email)
having count(*) > 1
order by organization_id, lower(email);


-- ---------------------------------------------------------------------------
-- 2. Emails con espacios al borde, que el CHECK nuevo va a rechazar.
--
--    Sin filtrar por deleted_at: el CHECK valida TODAS las filas de la tabla,
--    incluidas las borradas lógicamente. Es la diferencia con la consulta de
--    arriba y es fácil de pasar por alto.
-- ---------------------------------------------------------------------------
select
  'ESPACIOS AL BORDE' as problema,
  id,
  organization_id,
  deleted_at,
  '[' || email || ']' as email_entre_corchetes,
  '[' || btrim(email) || ']' as quedaria_como
from public.contacts
where email is not null
  and email <> btrim(email)
order by organization_id, id;
