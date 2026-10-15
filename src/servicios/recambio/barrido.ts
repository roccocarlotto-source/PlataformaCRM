import { logger } from "../../lib/logger";
import { OPCIONES_DE_TRANSACCION_LARGA, prisma } from "../../lib/prisma";
import { findActiveAutomationsByTriggerForSweep } from "../../repositories/automation.repository";
import { emitOutboxEvent } from "../../repositories/outboxEvent.repository";
import { hoyEnLaZona } from "../../services/opportunityClosing";
import { yaEsHoraDelBarrido } from "../recordatorio/config";
import { tieneElModulo } from "../recordatorio/repository";
import type { ResumenDelBarrido } from "../recordatorio/barrido";
import {
  TRIGGER_RECAMBIO,
  comprasPosibles,
  configDelRecambioSchema,
  fechaDeRecambio,
  laFechaDeAvisoCae,
} from "./config";
import {
  avisosDeRecambio,
  claveDeAviso,
  crearAvisoDeRecambio,
  vehiculosParaElRecambio,
} from "./repository";

// ---------------------------------------------------------------------------
// El barrido del recambio (docs/servicios.md §7.2, S13). Corre en la misma
// pasada horaria del próximo service (recordatorio/barrido.ts), desde las 10:00
// de cada organización con el módulo y su regla (única) de
// service.replacement_due activa.
//
// Elige los vehículos cuya fecha de aviso (compra + meses − días) cae en
// [hoy − 7, hoy], con vehículo y cliente vigentes, cliente sin "sin interés" y
// sin una oportunidad abierta, y sin un aviso previo (automático O manual) para
// esa fecha de recambio. Por cada uno, el aviso y el evento EN LA MISMA
// TRANSACCIÓN, con el lock de la organización: idempotente como el de §6.2.
// ---------------------------------------------------------------------------

export async function barrerRecambios(
  opciones: { ahora?: Date; organizationId?: string } = {},
): Promise<ResumenDelBarrido> {
  const ahora = opciones.ahora ?? new Date();
  const resumen: ResumenDelBarrido = { organizaciones: 0, avisos: 0, fallidas: 0 };
  const reglas = await findActiveAutomationsByTriggerForSweep(TRIGGER_RECAMBIO, {
    organizationId: opciones.organizationId,
  });

  for (const regla of reglas) {
    const { organizationId } = regla;
    try {
      if (!(await tieneElModulo(organizationId))) continue;
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { timezone: true, deletedAt: true },
      });
      if (!org || org.deletedAt !== null) continue;
      if (!yaEsHoraDelBarrido(ahora, org.timezone)) continue;
      const config = configDelRecambioSchema.safeParse(regla.triggerConfig);
      if (!config.success) {
        logger.warn(
          { organizationId, automationId: regla.id },
          "Regla de recambio con una configuración que ya no pasa el schema: se saltea",
        );
        continue;
      }
      resumen.organizaciones++;
      const hoy = hoyEnLaZona(org.timezone, ahora);
      const { desde, hasta } = comprasPosibles(hoy, config.data);
      const candidatos = (
        await prisma.customerVehicle.findMany({
          where: vehiculosParaElRecambio(organizationId, {
            purchasedOn: { gte: desde, lte: hasta },
          }),
          select: { id: true, contactId: true, branchId: true, purchasedOn: true },
          orderBy: { id: "asc" },
        })
      ).filter((v) => laFechaDeAvisoCae(v.purchasedOn!, hoy, config.data));
      if (candidatos.length === 0) continue;

      const avisados = await prisma.$transaction(async (tx) => {
        // El mismo lock que el barrido del próximo service: dos pasadas a la
        // vez no duplican.
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`next-service:${organizationId}`}::text))`;
        const previos = new Set(
          (
            await avisosDeRecambio(
              organizationId,
              candidatos.map((c) => c.id),
              tx,
            )
          ).map((a) => claveDeAviso(a.customerVehicleId, a.dueOn)),
        );
        let n = 0;
        for (const v of candidatos) {
          const recambio = fechaDeRecambio(v.purchasedOn!, config.data);
          if (previos.has(claveDeAviso(v.id, recambio))) continue;
          const aviso = await crearAvisoDeRecambio(
            {
              organizationId,
              customerVehicleId: v.id,
              dueOn: recambio,
              source: "AUTOMATICO",
              automationId: regla.id,
            },
            tx,
          );
          await emitOutboxEvent(
            {
              organizationId,
              eventType: TRIGGER_RECAMBIO,
              payload: {
                automationId: regla.id,
                noticeId: aviso.id,
                customerVehicleId: v.id,
                contactId: v.contactId,
                branchId: v.branchId,
                purchasedOn: v.purchasedOn!.toISOString().slice(0, 10),
                replacementDueOn: recambio.toISOString().slice(0, 10),
              },
            },
            tx,
          );
          n++;
        }
        return n;
      }, OPCIONES_DE_TRANSACCION_LARGA);
      if (avisados > 0) {
        resumen.avisos += avisados;
        logger.info(
          { organizationId, automationId: regla.id, avisos: avisados },
          "Recambio: avisos registrados y eventos emitidos",
        );
      }
    } catch (err) {
      resumen.fallidas++;
      logger.error(
        { err, organizationId },
        "No se pudo barrer el recambio de esta organización; se sigue con las demás",
      );
    }
  }
  return resumen;
}
