// ---------------------------------------------------------------------------
// Registro de handlers del motor de eventos salientes.
//
// No hay un patrón previo en el repositorio para calcar acá, así que se eligió
// el que ya usan los rate limiters (src/middlewares/rateLimit.ts): una FACTORY
// más un SINGLETON construido con ella. Producción usa el singleton; los tests
// crean el suyo con la factory y quedan aislados sin tener que resetear estado
// global entre casos, que es la parte que se rompe sola cuando el runner corre
// archivos en paralelo.
//
// QUÉ ES UN HANDLER: la función que hace la entrega real de un eventType. El
// motor se construyó antes que sus consumidores (aviso a Resea, recordatorio
// de WhatsApp, "Oportunidad → Ganada"), y los tests registran una de prueba.
// El primero real llegó el 13/09/2026: el motor de automatizaciones registra
// un handler de despacho por cada trigger conocido al arrancar el servidor
// (automationRegistrations.ts, llamado desde server.ts); los otros dos siguen
// bloqueados por dependencias externas (docs/automations-architecture.md §2).
//
// EL MOTOR NO INTERPRETA eventType. Quien emite decide el string; el registro
// decide quién lo atiende. Un eventType sin handler no es un fallo transitorio
// sino un bug de configuración, y el worker lo trata como tal: DEAD_LETTER
// directo, sin gastar reintentos (ver outbox.service.ts).
// ---------------------------------------------------------------------------

export interface EventoAEntregar {
  id: string;
  organizationId: string;
  eventType: string;
  payload: unknown;
  // M-14 de docs/auditoria-2026-08-29.md: se aborta cuando vence
  // OUTBOX_HANDLER_TIMEOUT_MS. Un handler que la pasa a su propia operación
  // cancelable (fetch, por ejemplo, que la acepta nativamente) deja de competir
  // con el reintento — sin esto, el handler seguía corriendo solo después de
  // que el evento ya se había reprogramado, y el destino podía recibir el aviso
  // dos veces. Un handler que la ignora sigue pudiendo completar tarde: la
  // señal es una invitación a pararse, no una cancelación forzada (ninguna
  // promesa de JS se puede cancelar desde afuera).
  signal: AbortSignal;
}

// Entrega o lanza. No devuelve nada: el motor no tiene qué hacer con un valor
// de retorno, y pedirle uno invitaría a que un handler "reporte" un fallo
// devolviendo algo en vez de lanzando, que es la forma de que un fallo pase
// inadvertido.
export type OutboxHandler = (evento: EventoAEntregar) => Promise<void>;

export interface RegistroDeHandlers {
  registrar(eventType: string, handler: OutboxHandler): void;
  obtener(eventType: string): OutboxHandler | undefined;
  tiposRegistrados(): string[];
}

export function crearRegistroDeHandlers(): RegistroDeHandlers {
  const handlers = new Map<string, OutboxHandler>();

  return {
    // Registrar dos veces el mismo eventType LANZA, no sobrescribe. Sobrescribir
    // en silencio dejaría al segundo módulo importado ganándole al primero según
    // el orden de imports, que es un origen de bugs imposible de leer desde el
    // código. Es un error de programación y se comporta como tal.
    registrar(eventType, handler) {
      if (handlers.has(eventType)) {
        throw new Error(
          `Ya hay un handler registrado para el eventType "${eventType}": registrar dos veces el mismo tipo es un error de configuración, no un reemplazo`,
        );
      }
      handlers.set(eventType, handler);
    },

    obtener(eventType) {
      return handlers.get(eventType);
    },

    // Para el log de arranque del worker: saber qué tipos sabe atender este
    // proceso es lo primero que uno quiere cuando un evento termina en
    // DEAD_LETTER por handler ausente.
    tiposRegistrados() {
      return [...handlers.keys()].sort();
    },
  };
}

// El que usa el servidor. Nace vacío a propósito: los consumidores se
// registran al arrancar (hoy, registrarAutomatizaciones() en server.ts), no
// como efecto de lado de un import.
export const registroDeHandlers = crearRegistroDeHandlers();
