import { logger } from "../../lib/logger";
import { OPCIONES_DE_TRANSACCION_LARGA, prisma } from "../../lib/prisma";
import { findActiveAutomationsByTriggerForSweep } from "../../repositories/automation.repository";
import { emitOutboxEvent } from "../../repositories/outboxEvent.repository";
import { configDelProximoServiceSchema } from "../../services/automationTriggers";
import { hoyEnLaZona } from "../../services/opportunityClosing";
import { TRIGGER_NEXT_SERVICE_DUE, ventanaDeFechas, yaEsHoraDelBarrido } from "./config";
import { avisosDeLaRegla, candidatosDelBarrido, crearAviso, tieneElModulo } from "./repository";

// ---------------------------------------------------------------------------
// El barrido del próximo service (docs/servicios.md §6.2, S7).
//
// Corre cada hora y, en cada organización con el módulo Servicios y una regla
// activa de service.next_service_due, recién desde las 10:00 de su zona. Por
// cada regla busca los vehículos cuya fecha de service, corrida offsetDays,
// cae en [hoy − 7, hoy], y por cada uno registra el aviso y emite el evento EN
// LA MISMA TRANSACCIÓN. El registro de avisos es lo que lo hace idempotente:
// la segunda pasada del día (o la de mañana, con el margen de 7 días) ve el
// aviso y no repite. Por eso no hace falta guardar "ya corrió hoy".
//
// El evento lleva la regla (payload.automationId): el trigger es DIRIGIDO
// (TRIGGERS_DIRIGIDOS_A_UNA_REGLA) y el dispatcher corre solo esa regla.
// ---------------------------------------------------------------------------

const POLL_MS = 60 * 60 * 1000;

export interface ResumenDelBarrido {
  organizaciones: number;
  avisos: number;
  fallidas: number;
}

export interface OpcionesDelBarrido {
  ahora?: Date;
  organizationId?: string;
}

export async function barrerProximosServices(
  opciones: OpcionesDelBarrido = {},
): Promise<ResumenDelBarrido> {
  const ahora = opciones.ahora ?? new Date();
  const resumen: ResumenDelBarrido = { organizaciones: 0, avisos: 0, fallidas: 0 };

  const reglas = await findActiveAutomationsByTriggerForSweep(TRIGGER_NEXT_SERVICE_DUE, {
    organizationId: opciones.organizationId,
  });
  const porOrganizacion = new Map<string, typeof reglas>();
  for (const regla of reglas) {
    porOrganizacion.set(regla.organizationId, [
      ...(porOrganizacion.get(regla.organizationId) ?? []),
      regla,
    ]);
  }

  for (const [organizationId, suyas] of porOrganizacion) {
    try {
      if (!(await tieneElModulo(organizationId))) continue;
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { timezone: true, deletedAt: true },
      });
      if (!org || org.deletedAt !== null) continue;
      if (!yaEsHoraDelBarrido(ahora, org.timezone)) continue;
      resumen.organizaciones++;
      const hoy = hoyEnLaZona(org.timezone, ahora);

      for (const regla of suyas) {
        const config = configDelProximoServiceSchema.safeParse(regla.triggerConfig);
        if (!config.success) {
          logger.warn(
            { organizationId, automationId: regla.id },
            "Regla de próximo service con una configuración que ya no pasa el schema: se saltea",
          );
          continue;
        }
        const { desde, hasta } = ventanaDeFechas(hoy, config.data.offsetDays);
        const candidatos = await candidatosDelBarrido(organizationId, desde, hasta);
        if (candidatos.length === 0) continue;

        const avisados = await prisma.$transaction(async (tx) => {
          // Dos pasadas a la vez (dos instancias, un tick lento) no duplican:
          // la segunda espera y ve los avisos de la primera.
          await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`next-service:${organizationId}`}::text))`;
          const previos = await avisosDeLaRegla(
            organizationId,
            regla.id,
            candidatos.map((c) => c.id),
            tx,
          );
          const yaAvisado = new Set(
            previos.map((p) => `${p.customerVehicleId}|${p.dueOn.toISOString()}`),
          );
          let n = 0;
          for (const v of candidatos) {
            if (!v.nextServiceDueOn) continue;
            if (yaAvisado.has(`${v.id}|${v.nextServiceDueOn.toISOString()}`)) continue;
            const aviso = await crearAviso(
              {
                organizationId,
                customerVehicleId: v.id,
                automationId: regla.id,
                dueOn: v.nextServiceDueOn,
              },
              tx,
            );
            await emitOutboxEvent(
              {
                organizationId,
                eventType: TRIGGER_NEXT_SERVICE_DUE,
                payload: {
                  automationId: regla.id,
                  noticeId: aviso.id,
                  customerVehicleId: v.id,
                  contactId: v.contactId,
                  branchId: v.branchId,
                  nextServiceDueOn: v.nextServiceDueOn.toISOString().slice(0, 10),
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
            "Próximo service: avisos registrados y eventos emitidos",
          );
        }
      }
    } catch (err) {
      // Una organización que falla no corta la pasada.
      resumen.fallidas++;
      logger.error(
        { err, organizationId },
        "No se pudo barrer el próximo service de esta organización; se sigue con las demás",
      );
    }
  }
  return resumen;
}

export function iniciarBarridoDelProximoService(
  opciones: { pollMs?: number; barrer?: () => Promise<ResumenDelBarrido> } = {},
): () => Promise<void> {
  const pollMs = opciones.pollMs ?? POLL_MS;
  const barrer = opciones.barrer ?? (() => barrerProximosServices());
  let detenido = false;
  let timer: NodeJS.Timeout | undefined;
  let tickEnCurso: Promise<void> | undefined;

  const tick = async () => {
    if (detenido) return;
    tickEnCurso = (async () => {
      try {
        const r = await barrer();
        if (r.avisos + r.fallidas > 0) logger.info(r, "Pasada del próximo service");
      } catch (err) {
        // Falló la consulta de reglas: el bucle no puede morir por eso.
        logger.error({ err }, "Fallo inesperado en la pasada del próximo service");
      }
    })();
    await tickEnCurso;
    if (!detenido) timer = setTimeout(() => void tick(), pollMs);
  };

  logger.info({ pollMs }, "Barrido del próximo service iniciado");
  // Primera pasada inmediata: un deploy no corre el reloj una hora.
  timer = setTimeout(() => void tick(), 0);
  return async () => {
    detenido = true;
    if (timer) clearTimeout(timer);
    await tickEnCurso;
  };
}
