import { findUserByIdInOrganization } from "../repositories/user.repository";
import { AppError } from "../utils/AppError";

// Compartido entre cualquier entidad con ownerId (Company, Contact, y las
// que sigan). Si no se especifica, el registro queda asignado a quien lo
// crea. Si se especifica, tiene que existir, ser de la misma organización y
// estar activo — nunca se confía en un ownerId del cliente sin validarlo.
export async function resolveOwnerId(
  organizationId: string,
  actorUserId: string,
  requestedOwnerId: string | undefined,
): Promise<string> {
  if (!requestedOwnerId) {
    return actorUserId;
  }

  const owner = await findUserByIdInOrganization(
    requestedOwnerId,
    organizationId,
  );

  if (!owner) {
    throw new AppError(
      "El usuario indicado en ownerId no existe, no pertenece a tu organización, o está desactivado",
      400,
    );
  }

  return owner.id;
}
