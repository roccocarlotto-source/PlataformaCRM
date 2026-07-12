import { findUserForAuth } from "../repositories/user.repository";
import { AppError } from "../utils/AppError";
import { isRoleName, type AuthContext, type JwtPayload } from "../types/auth";

// Aplica las reglas de la sección 4 de docs/authentication-architecture.md:
// el JWT solo prueba identidad, todo lo demás (organización, rol, isActive)
// se resuelve siempre contra Postgres, nunca contra el propio token.
export async function resolveAuthContext(
  payload: JwtPayload,
): Promise<AuthContext> {
  const user = await findUserForAuth(payload.sub);

  if (!user) {
    throw new AppError(
      "Tu cuenta todavía no está activada. Contactá a tu administrador.",
      403,
    );
  }

  // deletedAt implica isActive = false por construcción (softDeleteUser
  // siempre setea los dos juntos, ver user.repository.ts) — se chequea
  // primero para dar el mensaje más específico ("removida" en vez del
  // genérico "desactivada") cuando ambos son ciertos.
  if (user.deletedAt !== null) {
    throw new AppError("Tu cuenta fue removida de la organización.", 403);
  }

  if (!user.isActive) {
    throw new AppError("Tu cuenta fue desactivada.", 403);
  }

  if (user.organization.deletedAt !== null) {
    throw new AppError(
      "La organización asociada a tu cuenta ya no está disponible.",
      403,
    );
  }

  if (!isRoleName(user.role.name)) {
    throw new AppError(`Rol desconocido: ${user.role.name}`, 500);
  }

  return {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role.name,
    email: user.email,
    fullName: user.fullName,
  };
}
