import type { ToolCallDelTurno } from "./agentOrchestration.service";
import type { ContextoDeLaRegla, DecisionDelRubro, DesenlaceDeLasTools } from "./reglasDelRubro";

// ---------------------------------------------------------------------------
// UN TURNO DEL MISMO SERVICIO QUE YA TIENE: NO SE CREA OTRO (los dos rubros).
//
// QA de la primera clínica (2026-11-21): una persona con manicura el viernes
// pidió "pasarlo al sábado" y el agente llamó a create_booking en vez de
// reschedule_booking. Quedaron los dos turnos. El prompt ya decía que antes de
// cambiar un turno se miran los turnos de la persona; el modelo no lo hizo.
// Por eso el control va en la tool, no en el prompt: create_booking (la del
// catálogo y la de clínica) no reserva si el contacto ya tiene un turno
// FUTURO y CONFIRMADO del mismo servicio.
//
// QUÉ RECIBE EL MODELO depende de las tools que se le ofrecieron en ese turno:
//   - con reschedule_booking: el turno que ya tiene, con su bookingId, y que
//     use esa tool si lo quiere mover. Si quiere uno MÁS del mismo servicio,
//     que derive.
//   - sin reschedule_booking (la automotora real hoy): CODIGO_TURNO_REPETIDO.
//     El turno no vuelve al modelo: lo cierra el código
//     (desenlacePorTurnoRepetido), con un mensaje fijo y una tarea "quiere
//     cambiar su turno". Así no depende de que el modelo derive.
//
// LOS CASOS LEGÍTIMOS (dos turnos del mismo servicio a propósito: sesiones
// semanales de masajes, dos pruebas de manejo de un mismo cliente en días
// distintos) se cargan desde el panel: este control vive solo en la tool del
// agente. La agenda del panel, las automatizaciones y la reserva por API no lo
// tienen.
// ---------------------------------------------------------------------------

export const CODIGO_TURNO_REPETIDO = "TURNO_DEL_MISMO_SERVICIO";
export const MOTIVO_CAMBIO_DE_TURNO_POR_EL_CHAT = "CAMBIO_DE_TURNO_POR_EL_CHAT";
export const REGLA_TURNO_REPETIDO = "turno_del_mismo_servicio";

export const CUERPO_DE_LA_TAREA_TURNO_REPETIDO =
  "Quiere cambiar su turno: pidió otro turno de un servicio que ya tiene reservado, y por el chat no se puede reprogramar. Ver la conversación.";

export interface TurnoFuturo {
  id: string;
  serviceTypeId: string;
  startsAt: Date;
}

/** El turno futuro del mismo servicio, si el contacto ya tiene uno. Pura. */
export function turnoDelMismoServicio<T extends TurnoFuturo>(
  futuros: readonly T[],
  serviceTypeId: string,
): T | undefined {
  return futuros.find((t) => t.serviceTypeId === serviceTypeId);
}

/** Lo que lee el modelo cuando puede reprogramar. */
export function mensajeUsaReprogramar(cuando: string, bookingId: string): string {
  return `Esta persona ya tiene un turno futuro de ese mismo servicio (${cuando}, bookingId ${bookingId}), y no se reserva otro igual: no reservaste nada. Si lo que quiere es cambiar ese turno de día u horario, usá reschedule_booking con ese bookingId (antes confirmá con la persona el horario nuevo). Si quiere un turno MÁS del mismo servicio además del que tiene, eso no se hace por el chat: decíselo y derivá a una persona del equipo.`;
}

/** Lo que lee el modelo cuando no puede reprogramar (el turno lo cierra el
 *  código, ver desenlacePorTurnoRepetido). */
export function mensajeSinReprogramar(cuando: string): string {
  return `Esta persona ya tiene un turno futuro de ese mismo servicio (${cuando}), y por el chat no se puede cambiar ni sumar otro del mismo servicio: no reservaste nada. La conversación pasa a una persona del equipo.`;
}

/** El mensaje fijo a la persona, con el nombre del negocio como única
 *  variable. No dice el horario: el mensaje lo arma el código sin leer el
 *  resultado de la tool. */
export function mensajeDeTurnoRepetido(nombreDelNegocio: string): string {
  return `Ya tenés un turno reservado para ese servicio, y por este medio no puedo cambiarlo ni sumarte otro igual. Ya le pasé tu pedido al equipo de ${nombreDelNegocio} para que lo resuelva con vos.`;
}

export function derivacionPorTurnoRepetido(contexto: ContextoDeLaRegla): DecisionDelRubro {
  return {
    regla: REGLA_TURNO_REPETIDO,
    motivo: MOTIVO_CAMBIO_DE_TURNO_POR_EL_CHAT,
    mensaje: mensajeDeTurnoRepetido(contexto.nombreDeLaOrganizacion),
    aviso: { cuerpo: CUERPO_DE_LA_TAREA_TURNO_REPETIDO, urgente: false },
  };
}

/** Después de una ronda de tools: si create_booking rechazó con
 *  CODIGO_TURNO_REPETIDO, se deriva desde el código. Pura. */
export function desenlacePorTurnoRepetido(
  entradas: readonly ToolCallDelTurno[],
  contexto: ContextoDeLaRegla,
): DesenlaceDeLasTools | null {
  const rechazo = entradas.some(
    (e) => e.result?.ok === false && e.result.codigo === CODIGO_TURNO_REPETIDO,
  );
  return rechazo ? { tipo: "derivar", decision: derivacionPorTurnoRepetido(contexto) } : null;
}
