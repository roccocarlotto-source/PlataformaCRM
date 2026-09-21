import type { z } from "zod";
import type { TriggerType } from "./automationTriggers";

// ---------------------------------------------------------------------------
// Catálogo de acciones del motor de automatizaciones
// (docs/automations-architecture.md §5).
//
// MISMO PATRÓN EXACTO que registroDeHandlers en outboxHandlers.ts, y por los
// mismos motivos: una FACTORY más un SINGLETON construido con ella. Producción
// usa el singleton; los tests crean el suyo con la factory y quedan aislados
// sin tener que resetear estado global entre casos.
//
// QUÉ ES UNA ACCIÓN: lo que una Automation ejecuta cuando su trigger pasa.
// Cada una registra tres cosas juntas —su actionType, el schema zod de su
// actionConfig, y el handler— porque las tres se usan en pares: el CRUD
// necesita el schema para rechazar una regla mal configurada ANTES de
// guardarla (400, no un fallo en tiempo de ejecución), y el dispatcher
// necesita schema + handler para correrla.
//
// EL MOTOR NO INTERPRETA actionType. Quien configura la regla elige el
// string; el registro decide qué código lo atiende. Una acción que no está
// registrada no es un fallo transitorio sino un bug de configuración, y el
// dispatcher la trata como tal (ver automationDispatch.service.ts).
// ---------------------------------------------------------------------------

export interface AccionAEjecutar {
  organizationId: string;
  // actionConfig de la regla, YA validado contra el schema de la acción. El
  // handler puede confiar en su forma sin volver a parsearlo.
  config: Record<string, unknown>;
  // El payload del OutboxEvent, tal como lo emitió el service de negocio.
  payload: Record<string, unknown>;
}

// Entrega o lanza. No devuelve nada, igual que OutboxHandler: pedirle un
// valor de retorno invitaría a "reportar" un fallo devolviendo algo en vez de
// lanzando, que es la forma de que pase inadvertido.
export type AutomationAction = (input: AccionAEjecutar) => Promise<void>;

// El schema es de zod y no una función genérica de validación a propósito:
// safeParse devuelve issues legibles que el CRUD traduce a un 400 con el
// motivo exacto ("daysUntilDue es requerido"), no un "config inválido" seco.
export type EsquemaDeAccion = z.ZodType<Record<string, unknown>, z.ZodTypeDef, unknown>;

export interface AccionRegistrada {
  actionType: string;
  schema: EsquemaDeAccion;
  handler: AutomationAction;
  // Los triggers con los que la acción tiene sentido (ítem 76). Sin la clave,
  // cualquiera; con ella, el CRUD rechaza con 400 una regla que combine la
  // acción con otro trigger, y el dispatcher lo vuelve a chequear.
  //
  // No es cosmético: activity.create_follow_up colgada de opportunity.stale
  // crearía una tarea NUEVA cada día para siempre, porque esa acción no marca
  // Opportunity.lastStaleFollowUpDraftedAt y el worker volvería a emitir el
  // evento en cada pasada. La compatibilidad la declara la ACCIÓN y no el
  // trigger porque es la acción la que sabe si cumple el contrato del trigger
  // (en este caso, dejar la marca anti-redraft).
  triggers?: readonly TriggerType[];
}

// Si la acción se puede colgar de ese trigger. Una sola definición para los
// dos lugares que lo preguntan: el CRUD (400 al guardar) y el dispatcher
// (defensa en profundidad, por si la compatibilidad cambia después).
export function accionAdmiteTrigger(accion: AccionRegistrada, triggerType: string): boolean {
  return (
    accion.triggers === undefined || (accion.triggers as readonly string[]).includes(triggerType)
  );
}

export interface RegistroDeAcciones {
  registrar(accion: AccionRegistrada): void;
  obtener(actionType: string): AccionRegistrada | undefined;
  tiposRegistrados(): string[];
}

export function crearRegistroDeAcciones(): RegistroDeAcciones {
  const acciones = new Map<string, AccionRegistrada>();

  return {
    // Registrar dos veces el mismo actionType LANZA, no sobrescribe — misma
    // regla que registroDeHandlers y por el mismo motivo: sobrescribir en
    // silencio dejaría al último módulo importado ganándole al primero según
    // el orden de imports, un origen de bugs imposible de leer desde el
    // código. Es un error de programación y se comporta como tal.
    registrar(accion) {
      if (acciones.has(accion.actionType)) {
        throw new Error(
          `Ya hay una acción registrada para el actionType "${accion.actionType}": registrar dos veces el mismo tipo es un error de configuración, no un reemplazo`,
        );
      }
      acciones.set(accion.actionType, accion);
    },

    obtener(actionType) {
      return acciones.get(actionType);
    },

    // Para los mensajes de error del CRUD ("actionType debe ser uno de: ...")
    // y para el log de arranque: qué acciones sabe ejecutar este proceso.
    tiposRegistrados() {
      return [...acciones.keys()].sort();
    },
  };
}

// El que usa el servidor. Las acciones se registran acá al arrancar
// (automationRegistrations.ts, llamado desde server.ts); nace vacío a
// propósito, igual que registroDeHandlers.
export const registroDeAcciones = crearRegistroDeAcciones();
