import { prisma, type Db } from "../lib/prisma";

// Única consulta que resuelve la identidad de negocio de un usuario
// autenticado, con lo que el middleware de autenticación necesita para
// construir el AuthContext: organización y rol en la misma query.
export function findUserForAuth(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      organization: true,
      role: true,
    },
  });
}

// Crea el perfil de negocio de un usuario ya existente en Supabase Auth.
// `id` debe ser el mismo UUID que auth.users.id (convención del proyecto,
// ver docs/project-overview.md sección 4). `email` se pasa por completitud,
// pero el trigger trg_set_user_email_from_auth lo va a sobreescribir siempre
// leyéndolo de auth.users — la app nunca controla ese campo.
export function createUser(
  data: {
    id: string;
    organizationId: string;
    roleId: string;
    email: string;
    fullName: string;
  },
  db: Db = prisma,
) {
  return db.user.create({ data });
}
