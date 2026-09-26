import { AutomationExecutionStatus, type Automation } from "@prisma/client";
import { logger } from "../lib/logger";
import {
  findActiveAutomationsByTrigger,
  findExecutionsForEvent,
  upsertAutomationExecution,
} from "../repositories/automation.repository";
import { describirError } from "../utils/backoff";
import {
  accionAdmiteTrigger,
  registroDeAcciones as registroPorDefecto,
  type RegistroDeAcciones,
} from "./automationActions";
import type { EventoAEntregar } from "./outboxHandlers";

// ---------------------------------------------------------------------------
// Despacho de automatizaciones (docs/automations-architecture.md §6): la
// función genérica que se registra como handler del outbox para CADA trigger
// conocido (automationRegistrations.ts). Un evento entregado -> todas las
// reglas activas de su organización para ese trigger.
//
// LO QUE ESTE ARCHIVO AGREGA sobre el outbox, y lo único que agrega, es la
// IDEMPOTENCIA POR REGLA. El outbox reintenta la entrega COMPLETA del evento
// si el handler lanza: con dos reglas para el mismo trigger, si la segunda
// falla y la primera ya corrió, el reintento volvería a ejecutar la primera —
// una Activity duplicada por reintento. La marca SUCCESS en
// AutomationExecution por (automationId, outboxEventId) es lo que lo impide:
// en el reintento, la primera se salta y solo corre la que falló.
//
// LO QUE NO HACE, a propósito: ningún reintento propio. Ya existe uno, con
// backoff, tope de intentos, DEAD_LETTER y diagnóstico en lastError, y está
// probado (outboxWorker.integration-test.ts). Un fallo de acción se registra
// en su AutomationExecution y SE PROPAGA al handler del outbox para que ese
// mecanismo actúe. Atraparlo acá lo dejaría sin efecto y convertiría cada
// fallo en un PROCESSED silencioso.
//
// LAS MARCAS SE ESCRIBEN CON EL CLIENTE GLOBAL, fuera de la transacción del
// evento — el handler no tiene acceso a ella (EventoAEntregar no la expone) y
// tampoco convendría: si la marca SUCCESS viviera dentro de esa transacción y
// ésta revirtiera después de que la acción ya corrió (el caso B-26 del
// outbox), la marca se perdería y el próximo intento repetiría la acción.
// Comiteada por su cuenta, la acción y su marca son atómicas respecto del
// reintento, que es lo único que importa.
//
// Ventana conocida y aceptada: si el proceso muere ENTRE el efecto de la
// acción y la escritura de la marca, el reintento repite la acción. Es la
// misma ventana que el propio outbox tiene entre el handler y
// markOutboxEventProcessed; cerrarla exigiría que cada acción fuera
// transaccional con su marca, imposible para las externas (un WhatsApp
// enviado no se revierte).
// ---------------------------------------------------------------------------

export interface OpcionesDeDespacho {
  // Permite que un test corra con SU PROPIO registro de acciones en vez del
  // singleton de producción — ver automationActions.ts.
  registro?: RegistroDeAcciones;
}

// El payload del outbox es `unknown` (Json en la base). Las acciones esperan
// un objeto; cualquier otra cosa es un evento mal emitido y falla con un
// mensaje que lo dice, no con un TypeError adentro de la acción. Exportada
// para probarla sin base.
export function payloadComoObjeto(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("el payload del evento no es un objeto JSON");
  }
  return payload as Record<string, unknown>;
}

// Corre UNA regla contra un evento. Lanza ante cualquier problema — acción no
// registrada, actionConfig que ya no pasa el schema de la acción, fallo del
// handler — y el que llama decide qué hacer con eso.
async function ejecutarAutomatizacion(
  automation: Automation,
  evento: EventoAEntregar,
  registro: RegistroDeAcciones,
): Promise<void> {
  // ACCIÓN AUSENTE: fallo de ESTA regla, no DEAD_LETTER del evento entero
  // (que es lo que el outbox hace con un handler ausente). A nivel de acción
  // el evento sí tiene handler y las otras reglas del mismo evento pueden ser
  // perfectamente válidas — no deberían pagar por una regla rota. Queda en
  // AutomationExecution.error, que es donde quien configuró la regla lo va a
  // buscar.
  const accion = registro.obtener(automation.actionType);
  if (!accion) {
    throw new Error(
      `no hay acción registrada para "${automation.actionType}" (acciones disponibles: ${registro.tiposRegistrados().join(", ") || "ninguna"})`,
    );
  }

  // Misma defensa en profundidad que el schema de abajo, para la
  // compatibilidad acción/trigger (ítem 76): el CRUD ya la exigió al guardar,
  // pero una acción puede restringir sus triggers después de que la regla
  // existe. Fallar acá es lo que evita, por ejemplo, un seguimiento diario
  // infinito de activity.create_follow_up colgada de opportunity.stale.
  if (!accionAdmiteTrigger(accion, automation.triggerType)) {
    throw new Error(
      `la acción "${automation.actionType}" no se puede usar con el trigger "${automation.triggerType}"`,
    );
  }

  // Defensa en profundidad: el CRUD ya validó este config al guardar la regla,
  // pero el schema de una acción puede cambiar después. Mejor un error legible
  // acá que un handler corriendo con un config que no entiende.
  const config = accion.schema.safeParse(automation.actionConfig);
  if (!config.success) {
    throw new Error(
      `actionConfig de la regla ya no pasa el schema de "${automation.actionType}": ${config.error.issues.map((issue) => issue.message).join(", ")}`,
    );
  }

  await accion.handler({
    organizationId: evento.organizationId,
    automationId: automation.id,
    config: config.data,
    payload: payloadComoObjeto(evento.payload),
  });
}

interface FalloDeRegla {
  automation: Automation;
  error: string;
}

export async function despacharAutomatizaciones(
  evento: EventoAEntregar,
  triggerType: string,
  opciones: OpcionesDeDespacho = {},
): Promise<void> {
  const registro = opciones.registro ?? registroPorDefecto;

  const automatizaciones = await findActiveAutomationsByTrigger(evento.organizationId, triggerType);
  if (automatizaciones.length === 0) {
    return;
  }

  // Las marcas previas en UNA consulta, no una por regla.
  const previas = await findExecutionsForEvent(
    evento.organizationId,
    evento.id,
    automatizaciones.map((automation) => automation.id),
  );
  const yaExitosas = new Set(
    previas
      .filter((previa) => previa.status === AutomationExecutionStatus.SUCCESS)
      .map((previa) => previa.automationId),
  );

  const fallos: FalloDeRegla[] = [];

  for (const automation of automatizaciones) {
    if (yaExitosas.has(automation.id)) {
      // Un reintento del evento después de que esta regla ya corrió bien: es
      // el caso que AutomationExecution existe para atrapar.
      logger.info(
        { automationId: automation.id, eventoId: evento.id, triggerType },
        "Automatización ya ejecutada con éxito para este evento: se salta",
      );
      continue;
    }

    // El try abarca SOLO la ejecución, no la escritura de la marca SUCCESS: si
    // esa escritura fallara (la base no responde), la acción YA corrió y
    // marcarla FAILED mentiría — el reintento la repetiría a sabiendas. Un
    // fallo ahí sube como error de sistema, que es lo que es.
    let fallo: string | undefined;
    try {
      await ejecutarAutomatizacion(automation, evento, registro);
    } catch (err) {
      fallo = describirError(err);
      logger.error(
        { err, automationId: automation.id, eventoId: evento.id, triggerType },
        "Una automatización falló: queda FAILED y el evento se reintenta por el outbox",
      );
    }

    if (fallo === undefined) {
      await upsertAutomationExecution({
        organizationId: evento.organizationId,
        automationId: automation.id,
        outboxEventId: evento.id,
        status: AutomationExecutionStatus.SUCCESS,
        error: null,
      });
      continue;
    }

    await upsertAutomationExecution({
      organizationId: evento.organizationId,
      automationId: automation.id,
      outboxEventId: evento.id,
      status: AutomationExecutionStatus.FAILED,
      error: fallo,
    });
    // Se sigue con las demás en vez de cortar acá: cortar dejaría a las reglas
    // posteriores sin su primer intento hasta el próximo turno del evento (30 s
    // de backoff como mínimo) por un fallo que no es suyo. La marca SUCCESS
    // garantiza que el reintento no las repita.
    fallos.push({ automation, error: fallo });
  }

  // Un solo error que las resume, para que el outbox reintente el evento. El
  // detalle por regla ya quedó en AutomationExecution.error; esto es lo que
  // termina en outbox_events.last_error.
  if (fallos.length > 0) {
    throw new Error(
      `${String(fallos.length)} de ${String(automatizaciones.length)} automatizaciones fallaron para el evento ${evento.id} (${triggerType}): ` +
        fallos
          .map((fallo) => `"${fallo.automation.name}" [${fallo.automation.id}]: ${fallo.error}`)
          .join(" ;; "),
    );
  }
}
