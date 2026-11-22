import { DateTime } from "luxon";
import type { ToolCallDelTurno } from "./agentOrchestration.service";

// ---------------------------------------------------------------------------
// EL AGENTE NO AFIRMA NI PROMETE UN TURNO QUE NO HIZO (los dos rubros).
//
// Nació en la prueba de la Clínica Demo (2026-10-11): el agente contestó "He
// reservado para vos un turno con la Dra. …" sin haber llamado a
// create_booking en ese turno, y no existía ningún turno. La instrucción del
// prompt (INSTRUCCION_NO_AFIRMAR_LO_NO_HECHO) ya lo prohibía; un modelo chico
// la saltea. Esto es la guarda determinística, en el punto de extensión de
// salida (ReglasDelRubro.correccionesDeSalida, docs/rubros.md §5.3): si la
// respuesta afirma o promete un turno agendado, reprogramado o cancelado y la
// tool que lo hace no devolvió ok EN ESTE TURNO, la respuesta no sale.
//
// DESDE LA QA DE LA PRIMERA CLÍNICA (2026-11-21) también mira el presente y
// la promesa: el agente contestó "Te reservo el turno … En un momento te
// confirmo la reserva" sin reservar nada. Después de esa respuesta el agente no
// vuelve a escribir hasta que la persona conteste, así que "en un momento" no
// llega nunca. Y vive en el núcleo porque la automotora usa la misma
// create_booking y no tenía ninguna guarda (los dos rubros la aplican, cada
// uno con su mensaje fijo).
//
// QUÉ SALE EN SU LUGAR: un mensaje fijo del rubro, sin derivar. Se eligió eso
// y no volver a pedirle la respuesta al modelo porque es lo único que
// garantiza que la afirmación falsa no salga: una segunda redacción puede
// volver a afirmar lo mismo, cuesta otra llamada y alarga el turno. El mensaje
// es honesto en los dos casos posibles (no se hizo nada, o el turno es de un
// mensaje anterior y el modelo lo repitió de memoria) y deja la conversación
// andando. Un falso positivo cuesta una vuelta más; un falso negativo, alguien
// que va a un turno que no existe.
//
// QUÉ CUENTA:
//   - un verbo de acción en primera persona y en pasado ("reservé", "he
//     reservado", "cancelé", "reprogramé"), o "quedó" con el participio
//     ("quedó agendado", "quedó cancelado");
//   - el presente afirmativo ("te reservo el turno", "te lo agendo", "te
//     cancelo el turno") y el futuro ("voy a reservarte");
//   - la promesa de confirmar después, con un turno o una reserva en la misma
//     oración ("en un momento te confirmo la reserva", "te confirmo el turno
//     enseguida").
// NO cuentan: una pregunta ("¿te lo reservo?"), una condicional ("si querés,
// te lo reservo", "cuando tengamos la unidad, te reservo el turno"), una
// negación ("todavía no quedó reservado") ni describir un turno que ya existe
// ("tenés un turno el lunes"). Se compara con tildes: "reservé" (pasado) no es
// "reserve" (subjuntivo).
//
// SOLO SI LA ORACIÓN NOMBRA UN TURNO (turno, cita, prueba de manejo, test
// drive, consulta, sesión). Decisión de Rocco (2026-11-22), después de dos
// falsos positivos con el modelo real en una automotora: "el Kwid quedó
// reservado a tu nombre" (el auto, con reserve_vehicle hecho) y "cuando
// tengamos la unidad, te reservo el turno". Es preferible dejar pasar un caso
// dudoso que mandarle a un cliente una disculpa sin sentido. Y un
// reserve_vehicle exitoso de este turno respalda "quedó reservado" en una
// oración que nombra ese vehículo, aunque nombre también un turno.
//
// UN TURNO QUE YA EXISTE TAMBIÉN RESPALDA "AGENDAR" (tercer falso positivo,
// eval del 2026-11-22): el turno se creó en un mensaje anterior y el modelo lo
// vuelve a confirmar, con la verdad ("ya quedó reservada: la prueba de manejo
// es el lunes 23 de 10:00 a 10:30"). Si la persona tiene algún turno futuro
// confirmado, la afirmación de agendar pasa; pero si la oración trae una hora
// (HH:MM) o un día ("lunes 23", "23 de noviembre") que no coincide con
// NINGUNO de sus turnos, la guarda actúa igual (decisión de Rocco). Los
// turnos son los que ya se leen para el prompt (los de la sede de la
// conversación), sin consultas de más.
//
// QUÉ TOOL LA RESPALDA: agendar, create_booking o reschedule_booking con ok
// (un turno movido también "quedó agendado"); reprogramar, reschedule_booking;
// cancelar, cancel_booking con `cancelado: true` (su primer paso devuelve ok
// con el resumen, y eso no cancela nada).
// ---------------------------------------------------------------------------

export type AccionSobreTurnos = "AGENDAR" | "REPROGRAMAR" | "CANCELAR";

// Sin "registrado" ni "cambiado" sueltos: "quedó registrado tu email" o "he
// cambiado tus datos" son de update_lead, no de un turno. Y sin la primera
// del plural ("reservamos"): también es presente ("si querés, lo reservamos").
const PARTICIPIOS: Record<AccionSobreTurnos, string> = {
  AGENDAR: "(reservad|agendad|confirmad)[oa]s?",
  REPROGRAMAR: "(reprogramad|movid)[oa]s?",
  CANCELAR: "(cancelad|anulad)[oa]s?",
};

const PRETERITOS: Record<AccionSobreTurnos, string> = {
  AGENDAR: "(reservé|agendé)",
  REPROGRAMAR: "(reprogramé)",
  CANCELAR: "(cancelé|anulé)",
};

// El presente de la primera persona. Va con un pronombre delante ("te
// reservo", "se lo agendo", "lo cancelo") para no agarrar "el horario que
// reservo para vos" ni un sustantivo ("la reserva"). Sin "anoto" suelto: "te
// anoto el teléfono" es de update_lead.
const PRESENTES: Record<AccionSobreTurnos, string> = {
  AGENDAR: "(reservo|agendo)",
  REPROGRAMAR: "(reprogramo)",
  CANCELAR: "(cancelo|anulo)",
};

// El futuro perifrástico: "voy a reservarte", "te lo voy a agendar".
const INFINITIVOS: Record<AccionSobreTurnos, string> = {
  AGENDAR: "(reserv|agend)ar",
  REPROGRAMAR: "reprogramar",
  CANCELAR: "(cancel|anul)ar",
};

// "cambié", "moví" y "pasé" solos son demasiado generales ("te pasé los
// precios"): cuentan con el turno al lado.
const REPROGRAMAR_CON_EL_TURNO =
  "(cambié|moví|pasé)\\s+(tu|el|su)\\s+turno|(he|hemos)\\s+(cambiado|movido|pasado)\\s+(tu|el|su)\\s+turno|(lo|te\\s+lo|se\\s+lo)\\s+(cambié|moví|pasé)\\s+(para|al|a\\s+las?)";

const PRONOMBRE = "(te|le|se|lo|la|te\\s+lo|te\\s+la|se\\s+lo|se\\s+la)";

// Las palabras que hacen que una oración hable de un turno. Sin ninguna, la
// guarda no actúa (ver arriba). Sin "reserva" suelta: en una automotora también
// es la del auto.
const DE_UN_TURNO =
  /(^|[^\p{L}])(turnos?|citas?|pruebas?\s+de\s+manejo|test\s*drives?|consultas?|sesi[oó]n(es)?)(?![\p{L}])/u;

// "en un momento", "enseguida", "ahora", "a la brevedad"…: lo que convierte un
// "te confirmo" en una promesa para después.
const DESPUES =
  "(en\\s+un\\s+(momento|momentito|rato|ratito|minuto|segundo)|enseguida|en\\s+breve|a\\s+la\\s+brevedad|ahora|ya)";
const CONFIRMAR = `(te|le)\\s+(lo\\s+|la\\s+)?(confirmo|aviso)`;
interface Patron {
  re: RegExp;
  // Presente, futuro y promesa: "si querés, te lo reservo" es una oferta.
  condicional: boolean;
}

function patrones(accion: AccionSobreTurnos): Patron[] {
  const participio = PARTICIPIOS[accion];
  const deAntes = (re: RegExp): Patron => ({ re, condicional: false });
  const lista: Patron[] = [
    // "reservé", "te reservé", "ya cancelé"
    deAntes(new RegExp(`(^|[^\\p{L}])${PRETERITOS[accion]}(?![\\p{L}])`, "u")),
    // "he reservado", "hemos cancelado", "ha sido cancelado"
    deAntes(
      new RegExp(`(^|[^\\p{L}])(he|hemos|ha)\\s+(\\p{L}+\\s+)?${participio}(?![\\p{L}])`, "u"),
    ),
    // "quedó agendado", "quedaron cancelados", "ya quedó confirmado"
    deAntes(
      new RegExp(`(^|[^\\p{L}])(quedó|quedaron)\\s+(\\p{L}+\\s+)?${participio}(?![\\p{L}])`, "u"),
    ),
    // "te reservo", "se lo agendo", "lo cancelo"
    {
      re: new RegExp(`(^|[^\\p{L}])${PRONOMBRE}\\s+${PRESENTES[accion]}(?![\\p{L}])`, "u"),
      condicional: true,
    },
    // "voy a reservarte", "te lo voy a agendar", "vamos a cancelarlo"
    {
      re: new RegExp(
        `(^|[^\\p{L}])(voy|vamos)\\s+a\\s+${INFINITIVOS[accion]}(\\p{L}*)(?![\\p{L}])`,
        "u",
      ),
      condicional: true,
    },
    // "fue cancelado", "se canceló"
    ...(accion === "CANCELAR"
      ? [
          deAntes(new RegExp(`(^|[^\\p{L}])fue\\s+${participio}(?![\\p{L}])`, "u")),
          deAntes(/(^|[^\p{L}])se\s+(canceló|anuló)(?![\p{L}])/u),
        ]
      : []),
    ...(accion === "REPROGRAMAR"
      ? [deAntes(new RegExp(`(^|[^\\p{L}])(${REPROGRAMAR_CON_EL_TURNO})`, "u"))]
      : []),
    // "en un momento te confirmo la reserva", "te confirmo el turno enseguida"
    ...(accion === "AGENDAR"
      ? [
          {
            re: new RegExp(`(^|[^\\p{L}])${DESPUES}\\s+${CONFIRMAR}(?![\\p{L}])`, "u"),
            condicional: true,
          },
          {
            re: new RegExp(
              `(^|[^\\p{L}])${CONFIRMAR}(\\s+\\p{L}+){0,4}\\s+${DESPUES}(?![\\p{L}])`,
              "u",
            ),
            condicional: true,
          },
        ]
      : []),
  ];
  return lista;
}

const NEGACION_ANTES = /(^|[^\p{L}])(no|nunca|todavía\s+no|aún\s+no|aun\s+no)(\s+\p{L}+){0,3}\s*$/u;
// "si querés, te lo reservo", "cuando tengamos la unidad, te reservo el
// turno": una oferta o algo que depende de otra cosa, no un hecho. "si" sin
// tilde: "sí, te lo reservo" es una respuesta afirmativa.
const CONDICIONAL_ANTES = /(^|[^\p{L}])(si|cuando)\s/u;

/** Las oraciones de la respuesta que no son preguntas, en minúsculas y con
 *  tildes. Una oración termina en ".", "!", "?" o un salto de línea. */
function afirmaciones(respuesta: string): string[] {
  const oraciones = respuesta.toLowerCase().match(/[^.!?\n]+[.!?]*/g) ?? [];
  return oraciones
    .map((o) => o.trim())
    .filter((o) => o.length > 0 && !o.endsWith("?") && !o.startsWith("¿"));
}

/** Lo que afirma o promete UNA oración, solo si nombra un turno. */
function accionesDeLaOracion(oracion: string): Set<AccionSobreTurnos> {
  const afirmadas = new Set<AccionSobreTurnos>();
  if (!DE_UN_TURNO.test(oracion)) return afirmadas;
  for (const accion of ["AGENDAR", "REPROGRAMAR", "CANCELAR"] as const) {
    for (const { re, condicional } of patrones(accion)) {
      const m = re.exec(oracion);
      if (!m) continue;
      const antes = oracion.slice(0, m.index + m[1].length);
      if (NEGACION_ANTES.test(antes)) continue;
      if (condicional && CONDICIONAL_ANTES.test(antes)) continue;
      afirmadas.add(accion);
    }
  }
  return afirmadas;
}

/** Las acciones sobre turnos que la respuesta da por hechas o promete. Pura. */
export function accionesAfirmadas(respuesta: string): Set<AccionSobreTurnos> {
  const afirmadas = new Set<AccionSobreTurnos>();
  for (const oracion of afirmaciones(respuesta)) {
    for (const accion of accionesDeLaOracion(oracion)) afirmadas.add(accion);
  }
  return afirmadas;
}

function exitosa(entrada: ToolCallDelTurno, nombre: string): boolean {
  return entrada.allowed && entrada.name === nombre && entrada.result?.ok === true;
}

function cancelo(entrada: ToolCallDelTurno): boolean {
  if (!exitosa(entrada, "cancel_booking") || entrada.result?.ok !== true) return false;
  const data = entrada.result.data as { cancelado?: unknown } | null;
  return data !== null && typeof data === "object" && data.cancelado === true;
}

/** Las acciones sobre turnos que las tools de ESTE turno hicieron de verdad. */
export function accionesHechas(toolsDelTurno: readonly ToolCallDelTurno[]): Set<AccionSobreTurnos> {
  const hechas = new Set<AccionSobreTurnos>();
  for (const entrada of toolsDelTurno) {
    if (exitosa(entrada, "create_booking")) hechas.add("AGENDAR");
    if (exitosa(entrada, "reschedule_booking")) {
      hechas.add("REPROGRAMAR");
      hechas.add("AGENDAR");
    }
    if (cancelo(entrada)) hechas.add("CANCELAR");
  }
  return hechas;
}

/** Las palabras de los vehículos que reserve_vehicle reservó en ESTE turno
 *  ("Renault Kwid Zen 2021" → renault, kwid, zen): una oración que nombra uno
 *  de esos vehículos y dice "quedó reservado" habla del auto, no de un turno. */
function palabrasDeVehiculosReservados(toolsDelTurno: readonly ToolCallDelTurno[]): string[] {
  const palabras: string[] = [];
  for (const entrada of toolsDelTurno) {
    if (!exitosa(entrada, "reserve_vehicle") || entrada.result?.ok !== true) continue;
    const data = entrada.result.data as { vehiculo?: unknown } | null;
    const nombre = data !== null && typeof data === "object" ? data.vehiculo : undefined;
    if (typeof nombre !== "string") continue;
    for (const palabra of nombre.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (palabra.length >= 3 && /\p{L}/u.test(palabra)) palabras.push(palabra);
    }
  }
  return palabras;
}

function nombraAlguna(oracion: string, palabras: readonly string[]): boolean {
  return palabras.some((palabra) => oracion.split(/[^\p{L}\p{N}]+/u).includes(palabra));
}

/** Las acciones que la respuesta afirma o promete sin que una tool las haya
 *  hecho en este turno. Vacío = la respuesta puede salir. */
export function afirmacionesSinRespaldo(
  respuesta: string,
  toolsDelTurno: readonly ToolCallDelTurno[],
  turnosDelContacto?: TurnosDelContacto,
): AccionSobreTurnos[] {
  const hechas = accionesHechas(toolsDelTurno);
  const vehiculos = palabrasDeVehiculosReservados(toolsDelTurno);
  const sinRespaldo = new Set<AccionSobreTurnos>();
  for (const oracion of afirmaciones(respuesta)) {
    // "el Kwid quedó reservado": lo respalda el reserve_vehicle de este turno.
    const delVehiculo = vehiculos.length > 0 && nombraAlguna(oracion, vehiculos);
    for (const accion of accionesDeLaOracion(oracion)) {
      if (hechas.has(accion)) continue;
      if (accion === "AGENDAR" && delVehiculo) continue;
      // "ya quedó reservada: … el lunes 23 a las 10:00": repite un turno que existe.
      if (
        accion === "AGENDAR" &&
        turnosDelContacto !== undefined &&
        coincideConUnTurnoExistente(oracion, turnosDelContacto)
      )
        continue;
      sinRespaldo.add(accion);
    }
  }
  return [...sinRespaldo];
}

/** Los turnos futuros confirmados de la persona, para respaldar una
 *  afirmación de agendar que repite uno que ya existe. */
export interface TurnosDelContacto {
  inicios: readonly Date[];
  // La zona de la sede: las horas y los días se comparan como los dice el
  // agente.
  zona: string;
}

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const HORAS = /(?<![\p{L}\p{N}])([01]?\d|2[0-3]):([0-5]\d)(?!\p{N})/gu;
const DIA_CON_MES =
  /(?<!\p{N})(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?!\p{L})/u;
const DIA_CON_SEMANA =
  /(?<!\p{L})(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\s+(\d{1,2})(?!\p{N})/u;

/** Si la oración puede estar hablando de uno de los turnos que ya existen:
 *  hay alguno, y la hora y el día que nombra (si nombra) coinciden con el
 *  mismo turno. Pura. */
export function coincideConUnTurnoExistente(oracion: string, turnos: TurnosDelContacto): boolean {
  if (turnos.inicios.length === 0) return false;
  const horas = [...oracion.matchAll(HORAS)].map((m) => `${m[1].padStart(2, "0")}:${m[2]}`);
  const conMes = DIA_CON_MES.exec(oracion);
  const conSemana = DIA_CON_SEMANA.exec(oracion);
  const dia = conMes ? Number(conMes[1]) : conSemana ? Number(conSemana[2]) : undefined;
  const mes = conMes ? (conMes[2] === "setiembre" ? 9 : MESES.indexOf(conMes[2]) + 1) : undefined;
  return turnos.inicios.some((inicio) => {
    const local = DateTime.fromJSDate(inicio, { zone: turnos.zona });
    const horaOk = horas.length === 0 || horas.includes(local.toFormat("HH:mm"));
    const diaOk =
      dia === undefined || (local.day === dia && (mes === undefined || local.month === mes));
    return horaOk && diaOk;
  });
}

/** El nombre con el que la corrección queda en Message.toolCalls (los dos
 *  rubros). */
export const REGLA_AFIRMACION_SIN_ACCION = "afirmacion_de_turno_sin_accion";
