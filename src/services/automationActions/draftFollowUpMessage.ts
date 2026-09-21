import { ActivityType, OpportunityStatus } from "@prisma/client";
import { z } from "zod";
import { logger } from "../../lib/logger";
import {
  findOpportunityById,
  markStaleFollowUpDrafted,
} from "../../repositories/opportunity.repository";
import { createActivity } from "../activity.service";
import type { AccionRegistrada } from "../automationActions";
import { TRIGGER_OPPORTUNITY_STALE } from "../automationTriggers";
import { generarBorradorDeSeguimiento } from "../opportunityFollowUpDraft.service";
import { fechaDeVencimiento, payloadDeOportunidadSchema } from "./createFollowUpActivity";

// ---------------------------------------------------------------------------
// Acción `agent.draft_follow_up` (ítem 76 de docs/frontend-cambios-pendientes
// .md): cuando una oportunidad lleva demasiado tiempo quieta, la IA redacta un
// mensaje de seguimiento y queda como una Activity para su dueño, que lo revisa
// y lo manda él a mano. El agente nunca le escribe al cliente.
//
// MISMO MECANISMO DE ENTREGA que activity.create_follow_up: una Activity TASK
// asignada al dueño, que aparece en su bandeja de tareas de siempre, sin
// ninguna pantalla nueva. Lo único distinto es que el cuerpo lo escribe el
// modelo y no una plantilla fija.
//
// Y ES LA DUEÑA DE LA MARCA ANTI-REDRAFT: después de crear la Activity deja
// Opportunity.lastStaleFollowUpDraftedAt al día, que es lo que impide que el
// worker de oportunidades estancadas vuelva a emitir el evento mañana. Solo si
// la Activity se creó: si algo falla antes, la oportunidad queda sin marcar y
// la pasada del día siguiente la vuelve a intentar.
// ---------------------------------------------------------------------------

export const ACTION_DRAFT_FOLLOW_UP = "agent.draft_follow_up";

// Sin campos propios: el único parámetro de esta regla —cuántos días sin
// movimiento— es del TRIGGER (Automation.triggerConfig), no de la acción.
// z.object({}) descarta cualquier clave de más en vez de guardarla.
export const configDeBorradorSchema = z.object({});

// El título de Activity.subject es VarChar(255) y el de una oportunidad
// también: el prefijo más un título largo se pasaría. Se recorta el total.
export const PREFIJO_DEL_ASUNTO = "Seguimiento sugerido: ";
const MAX_SUBJECT = 255;

export function asuntoDelBorrador(tituloDeLaOportunidad: string): string {
  return `${PREFIJO_DEL_ASUNTO}${tituloDeLaOportunidad}`.slice(0, MAX_SUBJECT);
}

// Las dependencias del handler, inyectables para el test unitario (sin base y
// sin red): el orden "borrador -> Activity -> marca" y lo que pasa cuando algo
// falla en el medio es exactamente lo que hay que poder probar en aislamiento.
// Producción usa las reales (abajo).
export interface DependenciasDelBorrador {
  leerOportunidad: typeof findOpportunityById;
  generarBorrador: (organizationId: string, opportunityId: string) => Promise<string>;
  crearActividad: typeof createActivity;
  marcarBorrador: (id: string, organizationId: string, cuando: Date) => Promise<unknown>;
  ahora: () => Date;
}

const dependenciasReales: DependenciasDelBorrador = {
  leerOportunidad: findOpportunityById,
  generarBorrador: (organizationId, opportunityId) =>
    generarBorradorDeSeguimiento(organizationId, opportunityId),
  crearActividad: createActivity,
  marcarBorrador: markStaleFollowUpDrafted,
  ahora: () => new Date(),
};

export function crearAccionBorradorDeSeguimiento(
  deps: DependenciasDelBorrador = dependenciasReales,
): AccionRegistrada {
  return {
    actionType: ACTION_DRAFT_FOLLOW_UP,
    schema: configDeBorradorSchema,
    // Solo opportunity.stale. Es el único trigger que la marca anti-redraft
    // tiene sentido cerrar, y el prompt está escrito para "retomar el contacto
    // con una oportunidad quieta" — colgado de opportunity.won redactaría un
    // seguimiento de venta para una venta ya cerrada.
    triggers: [TRIGGER_OPPORTUNITY_STALE],
    async handler({ organizationId, payload }) {
      // Mismo criterio que activity.create_follow_up: el payload se valida en
      // el consumidor, no se confía ciegamente en el productor.
      const { opportunityId, ownerId } = payloadDeOportunidadSchema.parse(payload);

      // Se RELEE la oportunidad: entre la pasada del worker y este despacho
      // pueden haber pasado cosas (normalmente segundos, pero un evento que se
      // reintenta puede llegar horas después). Tres casos terminan acá sin
      // efecto y sin error —no hay nada que reintentar—:
      const oportunidad = await deps.leerOportunidad(opportunityId, organizationId);
      if (!oportunidad) {
        logger.info(
          { organizationId, opportunityId },
          "Borrador de seguimiento: la oportunidad ya no existe o está borrada; no se redacta nada",
        );
        return;
      }
      if (oportunidad.status !== OpportunityStatus.OPEN) {
        logger.info(
          { organizationId, opportunityId, status: oportunidad.status },
          "Borrador de seguimiento: la oportunidad ya no está abierta; no se redacta nada",
        );
        return;
      }
      // Ya hay un borrador posterior a su último movimiento. Pasa si dos
      // pasadas del worker emitieron el evento antes de que el primero se
      // despachara (un reinicio del servidor, que dispara una pasada
      // inmediata), o si un evento que falló se reintenta después de que el de
      // otra pasada ya tuvo éxito. Es la misma condición que usa el worker,
      // releída acá: la que convierte un evento duplicado en inofensivo.
      if (
        oportunidad.lastStaleFollowUpDraftedAt !== null &&
        oportunidad.lastStaleFollowUpDraftedAt >= oportunidad.updatedAt
      ) {
        logger.info(
          { organizationId, opportunityId },
          "Borrador de seguimiento: ya hay uno posterior al último movimiento; no se redacta otro",
        );
        return;
      }

      // BEST-EFFORT EN EL TEXTO, PERO SIN ACTIVITY VACÍA. Si el modelo falla
      // (proveedor caído, respuesta en blanco, sin OPENROUTER_API_KEY) no se
      // crea una tarea sin cuerpo ni una con un texto de relleno: una tarea
      // "Seguimiento sugerido" sin sugerencia es ruido en la bandeja del
      // vendedor. Se loguea con contexto y SE RELANZA — a diferencia de
      // ejecutarHandoff, que se traga el fallo porque no puede tumbar el turno
      // de una conversación; acá no hay turno que proteger, y relanzar es lo
      // que deja la regla en FAILED con el motivo en AutomationExecution.error
      // y hace que el outbox la reintente con backoff. Nada quedó escrito, así
      // que la oportunidad sigue sin marcar y la pasada de mañana la vuelve a
      // tomar si los reintentos se agotan.
      let borrador: string;
      try {
        borrador = await deps.generarBorrador(organizationId, opportunityId);
      } catch (err) {
        logger.error(
          { err, organizationId, opportunityId },
          "No se pudo generar el borrador de seguimiento: no se crea la Activity ni se marca la oportunidad",
        );
        throw err;
      }

      const ahora = deps.ahora();

      // Mismo criterio que activity.create_follow_up en todo lo que comparten
      // (por createActivity y no por el repositorio, TASK, el dueño como autor
      // de su propia tarea — ver los comentarios de esa acción).
      //
      // VENCE HOY (daysUntilDue 0, no mañana): la oportunidad ya lleva los días
      // que la regla considera demasiados, y el borrador está listo para
      // mandar ahora. Ponerle un día más de margen sería sumarle un día al
      // estancamiento que la regla existe para cortar.
      await deps.crearActividad(organizationId, ownerId, {
        type: ActivityType.TASK,
        subject: asuntoDelBorrador(oportunidad.title),
        body: borrador,
        dueDate: fechaDeVencimiento(ahora, 0),
        assigneeId: ownerId,
        opportunityId,
      });

      // DESPUÉS de la Activity y solo si se creó: si createActivity lanza, la
      // excepción sale de acá sin pasar por esta línea. Ventana conocida: si
      // esto falla con la Activity ya creada, el próximo evento redactaría
      // otra — la misma ventana "efecto hecho, marca no escrita" que el
      // dispatcher documenta para AutomationExecution.
      await deps.marcarBorrador(opportunityId, organizationId, ahora);
    },
  };
}

export const accionRedactarSeguimiento = crearAccionBorradorDeSeguimiento();
