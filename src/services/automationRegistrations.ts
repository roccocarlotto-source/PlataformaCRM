import {
  registroDeAcciones as accionesPorDefecto,
  type AccionRegistrada,
  type RegistroDeAcciones,
} from "./automationActions";
import { accionCrearActividadDeSeguimiento } from "./automationActions/createFollowUpActivity";
import { accionRedactarSeguimiento } from "./automationActions/draftFollowUpMessage";
import { accionSeguimientoQr } from "./automationActions/sendQrFollowup";
import { despacharAutomatizaciones } from "./automationDispatch.service";
import { TRIGGERS_CONOCIDOS } from "./automationTriggers";
import {
  registroDeHandlers as handlersPorDefecto,
  type RegistroDeHandlers,
} from "./outboxHandlers";

// ---------------------------------------------------------------------------
// Bootstrap de registros del motor de automatizaciones. Es EL lugar donde el
// outbox, que nació sin ningún handler ("los consumidores futuros se registran
// acá al arrancar", outboxHandlers.ts), recibe su primer consumidor real.
//
// Lo llama server.ts ANTES de iniciarWorkerDeOutbox(), para que el log de
// arranque del worker ya liste los eventTypes que este proceso sabe atender.
// NO se llama desde app.ts: los tests de integración importan app.ts y
// montan sus propios registros con las factories — un registro global
// poblado como efecto de lado del import volvería a los tests dependientes
// del orden, que es lo que las factories existen para evitar.
//
// Los dos registros son inyectables por el mismo motivo: un test crea los
// suyos con crearRegistroDeAcciones()/crearRegistroDeHandlers(), los pasa acá
// y drena el outbox con ese registro de handlers. El handler que se registra
// cierra sobre el registro de acciones que recibió, así que todo el camino
// evento -> despacho -> acción corre contra los registros del test.
//
// Llamarlo dos veces sobre los mismos registros LANZA (registrar dos veces el
// mismo tipo es un error, no un reemplazo): cada proceso lo llama una vez.
// ---------------------------------------------------------------------------

// El catálogo de acciones incorporadas. Agregar una acción = un archivo que
// exporta su AccionRegistrada + una línea acá.
export const ACCIONES_INCORPORADAS: readonly AccionRegistrada[] = [
  accionCrearActividadDeSeguimiento,
  accionRedactarSeguimiento,
  accionSeguimientoQr,
];

export interface RegistrosDeAutomatizacion {
  acciones?: RegistroDeAcciones;
  handlers?: RegistroDeHandlers;
}

export function registrarAutomatizaciones(registros: RegistrosDeAutomatizacion = {}): void {
  const acciones = registros.acciones ?? accionesPorDefecto;
  const handlers = registros.handlers ?? handlersPorDefecto;

  for (const accion of ACCIONES_INCORPORADAS) {
    acciones.registrar(accion);
  }

  // UN handler de despacho por cada trigger conocido, derivado de la lista y
  // no escrito a mano por trigger: agregar un trigger a TRIGGERS_CONOCIDOS lo
  // deja atendido acá sin que nadie tenga que acordarse de una segunda línea.
  // Lo que sí sigue siendo responsabilidad del service de negocio es EMITIR el
  // evento (docs/automations-architecture.md §4).
  for (const trigger of TRIGGERS_CONOCIDOS) {
    handlers.registrar(trigger, (evento) =>
      despacharAutomatizaciones(evento, trigger, { registro: acciones }),
    );
  }
}
