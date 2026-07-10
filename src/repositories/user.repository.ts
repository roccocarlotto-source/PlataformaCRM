import { prisma } from "../lib/prisma";

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
