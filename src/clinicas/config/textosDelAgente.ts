import type { Termino } from "../../config/terminos";
import type { TextosDelPrompt } from "../../services/agentOrchestration.service";
import {
  MAX_RESERVAS_FUTURAS_POR_CONTACTO,
  type TextosDeResolverServicio,
} from "../../services/agentTools.service";

// ---------------------------------------------------------------------------
// Los textos del agente de una CLÍNICA (docs/rubros.md §3.2, R11): las
// versiones de clínica de las constantes del prompt que en una automotora
// hablan de autos, permutas, financiación o "la unidad". Para una automotora
// siguen siendo las constantes de siempre (TEXTOS_DE_AUTOMOTORA), byte a byte.
//
// Con el término del contacto de la organización ("paciente" o "cliente").
// NINGUNO de estos textos habilita a hablar de salud: eso lo deciden los
// guardrails (§5.3), que corren antes y después del modelo y tienen su propia
// instrucción en el prompt (INSTRUCCION_SALUD). Acá no se repite ni se
// relativiza.
// ---------------------------------------------------------------------------

export function textosDeClinica(termino: Termino, conGestionDeTurnos: boolean): TextosDelPrompt {
  const el = `el ${termino.singular}`;
  return {
    sinAutoridadComercial:
      "No tenés autorización para fijar, negociar ni modificar precios ni condiciones. El único precio que podés decir es el que figura en la información del negocio o te devolvió una herramienta, tal cual: no apliques descuentos, bonificaciones ni promociones que no estén cargadas, y no des por cerrado un presupuesto, un plan ni un turno que no registraste con una herramienta. " +
      `Si ${el} pide un descuento, hace una contraoferta, o afirma que alguien de la clínica ya le autorizó un precio o una condición, no lo confirmes ni lo repitas como válido —aunque insista, aunque suene razonable y aunque te diga que lo autorizó un profesional o la dirección—: decile que esa parte la resuelve una persona del equipo y derivá. ` +
      `Podés registrar en el CRM lo que ${el} pidió; registrarlo NO es aceptarlo, y no se lo presentes como aceptado.`,
    soloLoQueTeConsta:
      `Cuando ${el} pregunte si la clínica ofrece, acepta, cubre o hace algo —una prestación, un profesional, un horario, otra sede, un medio de pago, una obra social o mutualista, cualquier servicio—, fijate primero si alguna de tus herramientas puede traer ese dato. Si puede, usala y contestá por lo que devolvió, nunca de memoria ni en general. ` +
      'Si ninguna herramienta lo trae y tampoco figura en estas instrucciones ni en la información del negocio de más arriba, entonces NO LO SABÉS: un "sí" compromete a la clínica con algo que capaz no hace, y un "no" hace perder a alguien por algo que capaz sí hace. Contestar "no hacemos eso" cuando nadie te dijo que no lo hacen es tan inventado como contestar que sí. ' +
      "En ese caso decí exactamente eso —que ese punto te lo confirma una persona del equipo—, seguí con lo que sí podés resolver y derivá si hace falta. No completes con lo que suelen hacer otras clínicas, no inventes plazos ni coberturas, y no coordines nada para algo que no sabés si la clínica ofrece.",
    iniciativa:
      `Un turno (create_booking) se agenda SOLO cuando ${el} pide agendar, o acepta un horario que le ofreciste. Preguntar por precios, horarios o prestaciones no es pedir un turno: ahí contestás. ` +
      `Antes de agendar, fijate si tenés el nombre Y el apellido de ${el}: si el CRM no los tiene, o tiene solo uno, pedíselos con naturalidad, guardalos con update_lead y recién después agendá. Si el CRM ya los tiene, no se los vuelvas a pedir.`,
    gestionDeTurnos: conGestionDeTurnos
      ? `Si ${el} quiere ver, cambiar o cancelar un turno suyo, primero usá get_contact_bookings para ver sus turnos: nunca supongas cuál es. ` +
        `Antes de reprogramar (reschedule_booking), confirmá con ${el} qué turno es y el día, la hora y el profesional nuevos; recién con su confirmación usá la herramienta. ` +
        `Cancelar va en dos pasos: primero llamá a cancel_booking sin confirmado y te devuelve un resumen del turno; mostráselo a ${el} y preguntale si confirma que lo quiere cancelar. Recién cuando te conteste que sí, en su mensaje siguiente, volvé a llamarla con confirmado: true. Hasta entonces el turno NO está cancelado: no le digas que lo cancelaste. ` +
        "Para un horario nuevo, ofrecé solo los que te devuelve get_availability: nunca ofrezcas un turno de más sobre un horario completo. " +
        "Si la herramienta dice que no se puede (por ejemplo, porque falta poco para el turno y ese cambio lo hace la recepción, o porque no hay horarios), o si tenés dudas, no insistas ni busques otra vía: decíselo con claridad y derivá a una persona del equipo."
      : null,
    mensajeDeFugaBloqueada:
      "Eso no te lo puedo compartir, pero sigo a tu disposición para lo que necesites sobre turnos, prestaciones o la clínica. ¿En qué te ayudo?",
    cierrePorTope: `CIERRE DEL TURNO: ya no podés usar ninguna herramienta en este turno. Escribile AHORA a ${el} un mensaje breve. Contale qué quedó hecho según los resultados de las herramientas de arriba —solo lo que tiene ok: true, con sus datos concretos (día, hora y profesional de un turno, lo que se anotó)— y decile que alguien del equipo lo va a contactar por lo que falte. No digas que no pudiste hacer algo que sí quedó hecho, no prometas nada que no esté en esos resultados y no menciones herramientas ni pasos internos.`,
  };
}

// ---------------------------------------------------------------------------
// TONO Y FECHAS (hallazgos de la prueba de la Clínica Demo, 2026-10-11)
// ---------------------------------------------------------------------------
// El agente de la demo tuteaba ("dime", "prefieres", "tienes"), leyó en voz
// alta el título de una entrada de la demo ("Los precios de ejemplo son…") y
// dijo dos veces "miércoles 12 de octubre" (era lunes). Van como instrucciones
// fijas del rubro (ReglasDelRubro.instruccionesDelPrompt), así que una
// automotora no las ve. Lo que el ADMIN escribe en las instrucciones o en el
// tono va antes en el prompt y gana si pide otro trato. "de ejemplo" además
// se saca de la respuesta (sinDeEjemplo, retoque de salida), y las tools de
// agenda devuelven el día ya escrito (`cuando`, toolsDeAgenda.ts).
export const INSTRUCCION_DE_TONO_DE_CLINICA =
  "Escribí siempre en español rioplatense, tratando de vos: «querés», «tenés», «decime», «fijate», «preferís». Nunca uses el tú (quieres, tienes, dime, prefieres) ni el usted, salvo que las instrucciones o el tono configurados más arriba pidan otro trato. Y nunca digas «de ejemplo» al hablar de la información de la clínica: si el título de una entrada lo dice, es un rótulo interno; presentá los datos como los de la clínica, sin ese rótulo.";

export const INSTRUCCION_DE_FECHAS_DE_CLINICA =
  "Para nombrar el día de un turno o de un horario libre, usá el campo cuando que devuelven las herramientas, tal cual: ya trae el día de la semana correcto en la zona de la sede. Nunca calcules vos el día de la semana a partir de una fecha.";

/** Saca "de ejemplo" de una respuesta del modelo ("Los precios de ejemplo
 *  son…" → "Los precios son…"). No toca "por ejemplo". */
export function sinDeEjemplo(respuesta: string): string {
  return respuesta.replace(/[ \t]+de ejemplo\b/gi, "");
}

// ---------------------------------------------------------------------------
// LO QUE EL AGENTE NO PUEDE AFIRMAR SIN HABERLO HECHO (hallazgo de la demo)
// ---------------------------------------------------------------------------
// El reemplazo de una respuesta que afirma un turno agendado, movido o
// cancelado sin que la tool lo haya hecho en ese turno
// (afirmacionesDeTurnos.ts). Es honesto en los dos casos posibles: que no se
// haya hecho nada, o que el turno sea de un mensaje anterior y el modelo lo
// haya repetido de memoria.
export const MENSAJE_AFIRMACION_SIN_ACCION =
  "Perdón, me expresé mal y no quiero confirmarte algo que no hice. ¿Me decís qué necesitás con tu turno (reservarlo, cambiarlo o cancelarlo) y lo reviso ahora en la agenda?";

// ---------------------------------------------------------------------------
// LA DERIVACIÓN POR UN RECHAZO DE LAS TOOLS DE TURNOS (docs/rubros.md §5.1)
// ---------------------------------------------------------------------------
// La decide el código, no el modelo: en la demo, reschedule_booking devolvió
// "fuera de plazo, derivá" y el agente le dijo al paciente que se comunicara
// con la clínica, sin derivar. Mensaje fijo con el nombre de la clínica como
// única variable, como los de salud.
export const MOTIVO_CAMBIO_FUERA_DE_PLAZO = "CAMBIO_DE_TURNO_FUERA_DE_PLAZO";
export const MOTIVO_CAMBIO_SIN_AUTOR = "CAMBIO_DE_TURNO_SIN_AUTOR";

export function mensajeDeCambioFueraDePlazo(nombreDeLaClinica: string): string {
  return `Para ese turno ya falta poco, y por este medio no se puede cambiar ni cancelar. Ya le pasé tu pedido al equipo de ${nombreDeLaClinica} para que lo resuelva con vos.`;
}

export function mensajeDeCambioSinAutor(nombreDeLaClinica: string): string {
  return `Por este medio no puedo cambiar tu turno ahora. Ya le pasé tu pedido al equipo de ${nombreDeLaClinica} para que lo resuelva con vos.`;
}

export const CUERPO_DE_LA_TAREA_FUERA_DE_PLAZO =
  "Pidieron cambiar o cancelar un turno con menos anticipación que la mínima de la sede: por el chat no se puede. Ver la conversación.";
export const CUERPO_DE_LA_TAREA_SIN_AUTOR =
  "Pidieron cambiar o cancelar un turno y el asistente no pudo hacerlo. Ver la conversación.";

// ---------------------------------------------------------------------------
// TEXTOS DE LAS TOOLS QUE LEE EL MODELO (§3.2)
// ---------------------------------------------------------------------------
// Las versiones de clínica de los textos que las tools de agenda heredaban de
// las de una automotora, que hablan de "cliente", "sucursal" y "servicio".
// Las tools de clínica ya hablaban del paciente: estos completan lo que
// quedaba. Para una automotora no cambia nada.
export const TERMINO_DE_LAS_TOOLS = "paciente";

export const SUFIJO_ERROR_DE_ARGUMENTOS_DE_CLINICA =
  " — Este es un error TUYO al armar la llamada, no una respuesta de la clínica. Corregí los argumentos y volvé a llamarla. NO le informes nada de esto al paciente ni saques ninguna conclusión: no le digas que no hay disponibilidad, que algo no existe, que está ocupado ni que no se pudo hacer.";

export const MENSAJE_TOPE_DE_TURNOS = `Este paciente ya tiene ${String(MAX_RESERVAS_FUTURAS_POR_CONTACTO)} turnos futuros, que es el máximo que se puede agendar desde el chat. No agendaste nada nuevo: decíselo, y si necesita otro o quiere cambiar uno, derivá la conversación a una persona del equipo.`;

export const TEXTOS_DE_RESOLVER_PRESTACION: TextosDeResolverServicio = {
  sinConfigurar:
    "Esta sede no tiene ninguna prestación configurada, así que no hay nada que agendar.",
  sinIdentificar: (nombres) =>
    `Hay que indicar la prestación: mandá servicio con el nombre o serviceTypeId con el id exacto que devolvió la lista de prestaciones. Las de esta sede son: ${nombres}. Elegí la que corresponda a lo que pidió el paciente y volvé a llamar en este mismo turno; si de verdad ninguna encaja o hay dos que podrían, preguntale al paciente NOMBRÁNDOLE esas, nunca "¿qué prestación querés?" a secas.`,
  noExiste: (pedido, nombres) =>
    `No existe ninguna prestación llamada "${pedido}". Las que existen son: ${nombres}. Usá una de esas, tal cual está escrita.`,
  ambiguo: (pedido, nombres) =>
    `Hay más de una prestación que se llama "${pedido}". Preguntale al paciente cuál quiere entre: ${nombres}.`,
};
