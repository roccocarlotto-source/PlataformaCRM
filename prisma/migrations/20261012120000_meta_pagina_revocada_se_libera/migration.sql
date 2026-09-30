-- ---------------------------------------------------------------------------
-- D-10 de docs-privados/auditoria-2026-09-30-corta.md (local, no está en
-- GitHub): una página de Facebook desconectada quedaba bloqueada para siempre.
--
-- meta_page_connections_page_id_key era UNIQUE sobre page_id a secas, y
-- desconectar (markMetaConnectionRevoked) deja la fila en REVOKED con su
-- page_id, sin token. Así, la página que una organización desconectó no la
-- podía conectar NINGUNA otra: el upsert de la otra chocaba con la fila
-- revocada (P2002 → 409 "ya está conectada a otra cuenta") y no había ningún
-- camino en la aplicación para liberarla.
--
-- Ahora el UNIQUE es PARCIAL: una página no puede estar conectada (ACTIVE o
-- ERROR) a dos organizaciones a la vez, que es lo que el webhook necesita para
-- saber de quién es un mensaje; una REVOKED no ocupa el lugar. ERROR sigue
-- contando a propósito: es una conexión que puede volver a funcionar
-- reconectando, no una que el negocio soltó.
--
-- Nadie busca por page_id sin filtrar el status (findPageIdByInstagram-
-- BusinessAccountId y markMetaConnectionError ya excluyen REVOKED), así que
-- varias filas REVOKED con la misma página no cambian ninguna lectura.
--
-- Prisma no expresa índices parciales en su DSL: el schema deja pageId sin
-- @unique y la garantía vive acá, afirmada por la fila 7 del diagnóstico
-- (docs/auditoria-2026-08-21-diagnostico.sql), igual que
-- conversations_open_unique.
--
-- DROP + CREATE en la misma transacción: no hay ventana sin la garantía. El
-- CREATE no puede fallar: el índice viejo ya era más estricto.
-- ---------------------------------------------------------------------------

DROP INDEX "meta_page_connections_page_id_key";

CREATE UNIQUE INDEX "meta_page_connections_page_id_active_unique"
  ON "meta_page_connections" ("page_id")
  WHERE "status" <> 'REVOKED'::"ConnectionStatus";
