-- ---------------------------------------------------------------------------
-- Nombres de la página de Facebook y del Instagram conectados.
--
-- La tarjeta "Facebook e Instagram" mostraba los ids que manda Meta
-- ("Página: 1332…"), porque la base no guardaba los nombres. Desde esta
-- migración, completar la conexión guarda el nombre de la página y el
-- @usuario del Instagram vinculado (sin la arroba).
--
-- Las dos columnas aceptan NULL: las conexiones que ya existen no los tienen,
-- y GET de la conexión los completa una vez con el token guardado
-- (metaPageConnection.service.ts, obtenerConexion). No hace falta reconectar.
--
-- Solo agrega columnas nullable sin DEFAULT: no reescribe filas y la imagen
-- vieja las ignora, así que va en el orden de siempre (migración primero,
-- imagen después; docs/deployment.md §2.2).
--
-- Generada con `prisma migrate diff` contra el Supabase local; se sacaron los
-- DROP INDEX de los índices de trigramas, que son manuales y Prisma no ve.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "meta_page_connections" ADD COLUMN     "instagram_username" VARCHAR(64),
ADD COLUMN     "page_name" VARCHAR(255);
