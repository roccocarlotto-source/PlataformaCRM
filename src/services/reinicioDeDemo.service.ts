import { reiniciarDatosDelTallerDemo } from "../automotora/demo/reinicioDelTallerDemo.service";
import { reiniciarDatosDeLaDemo } from "../clinicas/demo/reinicioDeLaDemo.service";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { NO_ES_UNA_DEMO } from "./modoDemo.service";

// ---------------------------------------------------------------------------
// Reiniciar los datos de una demo: POST
// /api/admin/organizations/:organizationId/demo/reiniciar (platform admin).
// Un solo endpoint y un solo botón para las dos demos, despachado por rubro:
//
//   - CLINICA → la Clínica Demo (src/clinicas/demo/reinicioDeLaDemo.service.ts,
//     docs/rubros.md §12.3), sin cambios: sigue exigiendo su slug, la regla del
//     recordatorio inactiva y Google desconectado;
//   - AUTOMOTORA → el Taller Demo
//     (src/automotora/demo/reinicioDelTallerDemo.service.ts, docs/taller-demo.md).
//
// Antes que nada exige el MODO DEMO (organizations.is_demo): una organización
// sin la bandera da 400 sin tocar nada, se llame como se llame.
// ---------------------------------------------------------------------------

export async function reiniciarDemo(organizationId: string, opciones: { ahora?: Date } = {}) {
  const org = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { industry: true, isDemo: true },
  });
  if (!org) throw new AppError("Organización no encontrada", 404);
  if (!org.isDemo) throw new AppError(NO_ES_UNA_DEMO, 400);
  return org.industry === "CLINICA"
    ? reiniciarDatosDeLaDemo(organizationId, opciones)
    : reiniciarDatosDelTallerDemo(organizationId, opciones);
}
