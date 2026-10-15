// ---------------------------------------------------------------------------
// H-1 (docs-privados/prueba-s7-2026-10-15.md, local): el alta de la plantilla
// de WhatsApp de una regla que falló. Antes, si Meta no contestaba, la regla
// quedaba guardada con la plantilla "Sin enviar" y nada la volvía a mandar: si
// nadie guardaba de nuevo, el mensaje nunca salía.
//
// Dos clases de error (whatsappTemplate.service.ts, traducirErrorDeMeta):
//   - TEMPORAL: Meta no respondió (429, 5xx, red, timeout), la conexión de la
//     plataforma no está configurada, o un guardado simultáneo ganó la reserva.
//     Se reintenta solo, con espera creciente: 5 min, 15, 45, 2 h 15 y 6 h, y
//     después cada 6 h, hasta ~21 h desde el primer fallo. Ahí para, y queda el
//     aviso con "Reintentar".
//   - DEFINITIVO: Meta rechazó el pedido (el texto no cumple sus reglas, un
//     idioma que no existe). Mandar lo mismo daría lo mismo: no se reintenta.
//
// El estado vive en la regla (automations.template_sync_*). Lo escribe
// sincronizarPlantillaDeLaRegla en cada intento, venga de donde venga: guardar
// la regla, "Reintentar", el worker o conectar un WABA. Un intento que lanza
// una persona reinicia la cuenta; el del worker la sigue.
// ---------------------------------------------------------------------------

export type TipoDeErrorDeSincronizacion = "TEMPORAL" | "DEFINITIVO";

/** Las esperas entre intentos automáticos. Después del último, para. */
export const ESPERAS_DEL_REINTENTO_EN_MINUTOS = [5, 15, 45, 135, 360, 360, 360] as const;

/** Las columnas de la regla. Todo en null/0 = sin error. */
export interface EstadoGuardadoDeSincronizacion {
  templateSyncAttempts: number;
  templateSyncNextAt: Date | null;
  templateSyncError: string | null;
  templateSyncErrorKind: string | null;
}

export const SIN_ERROR_DE_SINCRONIZACION: EstadoGuardadoDeSincronizacion = {
  templateSyncAttempts: 0,
  templateSyncNextAt: null,
  templateSyncError: null,
  templateSyncErrorKind: null,
};

/** Un AppError de la sincronización: ¿se puede reintentar? Un 5xx (Meta no
 *  respondió, la conexión no está configurada) o un 409 (un guardado
 *  simultáneo ganó la reserva) sí; un 4xx (Meta rechazó el pedido) no. */
export function tipoDeError(statusCode: number): TipoDeErrorDeSincronizacion {
  return statusCode >= 500 || statusCode === 409 ? "TEMPORAL" : "DEFINITIVO";
}

/** Lo que queda en la regla después de un intento. `reiniciar`: lo lanzó una
 *  persona (guardar, "Reintentar"), así que la cuenta de intentos vuelve a 0. */
export function siguienteEstadoDeSincronizacion(
  previo: Pick<EstadoGuardadoDeSincronizacion, "templateSyncAttempts">,
  error: { tipo: TipoDeErrorDeSincronizacion; mensaje: string } | null,
  ahora: Date,
  opciones: { reiniciar: boolean },
): EstadoGuardadoDeSincronizacion {
  if (error === null) return { ...SIN_ERROR_DE_SINCRONIZACION };
  const mensaje = error.mensaje.slice(0, 500);
  if (error.tipo === "DEFINITIVO") {
    return {
      templateSyncAttempts: 0,
      templateSyncNextAt: null,
      templateSyncError: mensaje,
      templateSyncErrorKind: "DEFINITIVO",
    };
  }
  const intentos = (opciones.reiniciar ? 0 : previo.templateSyncAttempts) + 1;
  const espera = ESPERAS_DEL_REINTENTO_EN_MINUTOS[intentos - 1];
  return {
    templateSyncAttempts: intentos,
    templateSyncNextAt:
      espera === undefined ? null : new Date(ahora.getTime() + espera * 60 * 1000),
    templateSyncError: mensaje,
    templateSyncErrorKind: "TEMPORAL",
  };
}

/** Lo que ve la pantalla de la regla. Null = sin error. */
export interface EstadoDeSincronizacion {
  // REINTENTANDO: temporal, con un próximo intento. DETENIDO: temporal, se
  // acabaron los intentos automáticos. RECHAZADO: definitivo.
  estado: "REINTENTANDO" | "DETENIDO" | "RECHAZADO";
  motivo: string;
  proximoIntento: string | null;
}

export function resumenDeSincronizacion(
  e: EstadoGuardadoDeSincronizacion,
): EstadoDeSincronizacion | null {
  if (e.templateSyncError === null) return null;
  if (e.templateSyncErrorKind === "DEFINITIVO") {
    return { estado: "RECHAZADO", motivo: e.templateSyncError, proximoIntento: null };
  }
  return {
    estado: e.templateSyncNextAt ? "REINTENTANDO" : "DETENIDO",
    motivo: e.templateSyncError,
    proximoIntento: e.templateSyncNextAt?.toISOString() ?? null,
  };
}
