import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";

/** R14 (docs/rubros.md §7.2): "Recordar control a los N días" de una
 *  prestación. null = sin control. 404 si no es de la organización. Cambiarlo
 *  no recalcula los controles ya agendados. */
export async function configurarControlDeLaPrestacion(
  organizationId: string,
  serviceTypeId: string,
  followUpAfterDays: number | null,
) {
  const { count } = await prisma.serviceType.updateMany({
    where: { id: serviceTypeId, organizationId, deletedAt: null },
    data: { followUpAfterDays },
  });
  if (count === 0) throw new AppError("Servicio no encontrado", 404);
  return { id: serviceTypeId, followUpAfterDays };
}
