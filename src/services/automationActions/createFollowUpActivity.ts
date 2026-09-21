import { ActivityType } from "@prisma/client";
import { z } from "zod";
import { createActivity } from "../activity.service";
import type { AccionRegistrada } from "../automationActions";
import { TRIGGER_OPPORTUNITY_WON } from "../automationTriggers";

// ---------------------------------------------------------------------------
// Acción `activity.create_follow_up` — la primera del catálogo
// (docs/automations-architecture.md §7). Crea una Activity de seguimiento
// asignada al dueño de la oportunidad que disparó el evento.
//
// NO SE REGISTRA SOLA AL IMPORTARSE: exporta su AccionRegistrada y es
// automationRegistrations.ts quien la mete en el registro al arrancar el
// servidor (o el test, en el suyo). Un archivo que se registrara a sí mismo
// como efecto de lado del import dependería del orden de imports para
// existir, que es justo lo que el registro está diseñado para no permitir.
// ---------------------------------------------------------------------------

export const ACTION_CREATE_FOLLOW_UP = "activity.create_follow_up";

// SIN DEFAULTS OCULTOS: si a la regla le falta daysUntilDue, falla la
// validación al crearla (400 del CRUD), no en tiempo de ejecución. max(200)
// en subject deja margen bajo el VarChar(255) de Activity.subject.
//
// EL TOPE DE `notes` ES NUESTRO, NO DE LA BASE: Activity.body es `Text`, sin
// largo máximo, y el endpoint manual de actividades tampoco le pone uno. 5.000
// es un límite de cordura elegido acá —holgado para lo que es (el detalle de
// una tarea, no un documento) y lejos de cualquier uso legítimo—, explícito y
// con su motivo en el mensaje de error: un campo sin tope del que cuelga una
// fila por cada oportunidad ganada es una forma silenciosa de llenar la tabla.
export const MAX_NOTES = 5000;

export const configDeSeguimientoSchema = z.object({
  subject: z
    .string({ required_error: "subject es requerido" })
    .trim()
    .min(1, "subject es requerido")
    .max(200, "subject no puede superar los 200 caracteres"),
  daysUntilDue: z
    .number({
      required_error: "daysUntilDue es requerido",
      invalid_type_error: "daysUntilDue debe ser un número entero",
    })
    .int("daysUntilDue debe ser un número entero")
    .min(0, "daysUntilDue no puede ser negativo")
    .max(365, "daysUntilDue no puede superar los 365 días"),
  // OPCIONAL, y "vacío" no es un valor: el string vacío se rechaza en vez de
  // aceptarse como "sin notas". Quien no quiere notas omite la clave; mandar
  // "" sería guardar en la regla una intención que no existe, y terminaría en
  // un Activity.body vacío indistinguible de uno nunca escrito.
  notes: z
    .string()
    .trim()
    .min(1, "notes no puede ser un string vacío")
    .max(MAX_NOTES, "notes no puede superar los 5000 caracteres")
    .optional(),
});

export type ConfigDeSeguimiento = z.infer<typeof configDeSeguimientoSchema>;

// Lo que los triggers de oportunidad ponen en el payload: opportunity.won
// (opportunity.service.ts) y opportunity.stale (opportunityStaleWorker.ts)
// emiten la MISMA forma, y agent.draft_follow_up lo reusa. Se valida acá, en el consumidor, y no solo se confía en el productor: un
// payload viejo o de otra forma tiene que fallar con un mensaje legible en
// AutomationExecution.error, no con un TypeError dentro de createActivity.
export const payloadDeOportunidadSchema = z.object({
  opportunityId: z.string().uuid("payload.opportunityId debe ser un UUID"),
  ownerId: z.string().uuid("payload.ownerId debe ser un UUID"),
});

// Aritmética de calendario en UTC: `0` = vence hoy. Exportada para probarla
// sin base.
export function fechaDeVencimiento(ahora: Date, diasHastaVencer: number): Date {
  const fecha = new Date(ahora);
  fecha.setUTCDate(fecha.getUTCDate() + diasHastaVencer);
  return fecha;
}

export const accionCrearActividadDeSeguimiento: AccionRegistrada = {
  actionType: ACTION_CREATE_FOLLOW_UP,
  schema: configDeSeguimientoSchema,
  // Solo opportunity.won (ítem 76). Colgada de opportunity.stale crearía la
  // misma tarea todos los días: esta acción no deja la marca anti-redraft
  // (Opportunity.lastStaleFollowUpDraftedAt), así que el worker de
  // oportunidades estancadas volvería a emitir el evento en cada pasada.
  triggers: [TRIGGER_OPPORTUNITY_WON],
  async handler({ organizationId, config, payload }) {
    // El dispatcher ya validó `config` contra el schema de arriba; se vuelve a
    // parsear acá solo para recuperar el TIPO (config llega como
    // Record<string, unknown>), no porque se desconfíe. Es un objeto de dos
    // campos: el costo es nulo y el handler queda autocontenido.
    const { subject, daysUntilDue, notes } = configDeSeguimientoSchema.parse(config);
    const { opportunityId, ownerId } = payloadDeOportunidadSchema.parse(payload);

    // Por createActivity() de activity.service.ts y no por el repositorio: sus
    // validaciones (el assignee existe, está activo y es de la organización;
    // la oportunidad existe y no está borrada) valen igual para una actividad
    // generada por una regla que para una creada a mano.
    //
    // TASK y no CALL/MEETING/EMAIL/NOTE: de los cinco tipos de Activity es el
    // único que describe "algo pendiente que alguien tiene que hacer, con una
    // fecha límite" — que es lo que "Mis tareas" lista. CALL/MEETING/EMAIL
    // presuponen el medio, que la regla no conoce; NOTE es el registro de algo
    // que ya pasó.
    //
    // actorUserId = ownerId (el dueño figura como autor de su propia tarea):
    // no existe un "usuario sistema" en el codebase y Activity.authorId es NOT
    // NULL con FK a users. Es el default reversible más simple; queda anotado
    // como decisión abierta en §10 del documento de arquitectura.
    //
    // `notes` -> Activity.body: el mismo campo de texto libre que el formulario
    // manual de actividades muestra bajo el rótulo "Notas". Sin notas la clave
    // NO se manda —y no un ""—, igual que hace ese formulario con
    // `body: input.body || undefined`: la actividad queda con body null, que es
    // lo que significa "sin notas".
    await createActivity(organizationId, ownerId, {
      type: ActivityType.TASK,
      subject,
      dueDate: fechaDeVencimiento(new Date(), daysUntilDue),
      assigneeId: ownerId,
      opportunityId,
      ...(notes === undefined ? {} : { body: notes }),
    });
  },
};
