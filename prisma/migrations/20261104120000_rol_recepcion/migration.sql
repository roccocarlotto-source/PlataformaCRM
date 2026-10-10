-- ---------------------------------------------------------------------------
-- PR R12 de docs/rubros.md (§15, §11.1, D15, D21): el rol RECEPCION de una
-- clínica.
--
-- Los roles no son un enum de Postgres: son filas de `roles`, que sembraba
-- solo prisma/seed.ts. Esta va además en la migración para que producción
-- tenga el rol sin depender de que alguien corra el seed (que también la suma,
-- con un upsert idempotente).
--
-- Solo agrega una fila. No toca ni borra nada existente, y no hay usuarios
-- ni invitaciones con este rol hasta que un ADMIN de una clínica lo asigne.
--
-- ORDEN DE DESPLIEGUE: es seguro aplicar esto ANTES de desplegar el código que
-- conoce el rol. resolveAuthContext solo rechaza ("Rol desconocido", 500) a un
-- usuario que TIENE un rol que el código no conoce; una fila en `roles` sin
-- usuarios no la lee nadie. Y el código viejo no puede asignarla: el zod de
-- invitaciones y de usuarios solo acepta ADMIN y USER. Ver la descripción del
-- PR.
--
-- ON CONFLICT (name) DO NOTHING: idempotente si el seed ya la creó en algún
-- entorno. updated_at no tiene DEFAULT en la tabla (es @updatedAt de Prisma):
-- se escribe a mano.
--
-- El nombre ordena después de 20261101120000_clinicas_configuracion, la
-- última de master.
-- ---------------------------------------------------------------------------

INSERT INTO "roles" ("name", "description", "updated_at")
VALUES (
  'RECEPCION',
  'Recepción de una clínica: agenda, pacientes, conversaciones y tareas. No configura nada.',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;
