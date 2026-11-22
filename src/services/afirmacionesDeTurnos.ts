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
// te lo reservo"), una negación ("todavía no quedó reservado") ni describir un
// turno que ya existe ("tenés un turno el lunes"). Se compara con tildes:
// "reservé" (pasado) no es "reserve" (subjuntivo).
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

// "en un momento", "enseguida", "ahora", "a la brevedad"…: lo que convierte un
// "te confirmo" en una promesa para después.
const DESPUES =
  "(en\\s+un\\s+(momento|momentito|rato|ratito|minuto|segundo)|enseguida|en\\s+breve|a\\s+la\\s+brevedad|ahora|ya)";
const CONFIRMAR = `(te|le)\\s+(lo\\s+|la\\s+)?(confirmo|aviso)`;
// La promesa cuenta solo si habla de un turno: "te confirmo el precio en un
// momento" no es de la agenda.
const DE_LA_AGENDA =
  /(^|[^\p{L}])(turnos?|reservas?|citas?|horarios?|agenda|prueba|visita|test\s+drive)(?![\p{L}])/u;

interface Patron {
  re: RegExp;
  // Presente, futuro y promesa: "si querés, te lo reservo" es una oferta.
  condicional: boolean;
  // La promesa necesita un turno en la oración.
  deLaAgenda: boolean;
}

function patrones(accion: AccionSobreTurnos): Patron[] {
  const participio = PARTICIPIOS[accion];
  const deAntes = (re: RegExp): Patron => ({ re, condicional: false, deLaAgenda: false });
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
      deLaAgenda: false,
    },
    // "voy a reservarte", "te lo voy a agendar", "vamos a cancelarlo"
    {
      re: new RegExp(
        `(^|[^\\p{L}])(voy|vamos)\\s+a\\s+${INFINITIVOS[accion]}(\\p{L}*)(?![\\p{L}])`,
        "u",
      ),
      condicional: true,
      deLaAgenda: false,
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
            deLaAgenda: true,
          },
          {
            re: new RegExp(
              `(^|[^\\p{L}])${CONFIRMAR}(\\s+\\p{L}+){0,4}\\s+${DESPUES}(?![\\p{L}])`,
              "u",
            ),
            condicional: true,
            deLaAgenda: true,
          },
        ]
      : []),
  ];
  return lista;
}

const NEGACION_ANTES = /(^|[^\p{L}])(no|nunca|todavía\s+no|aún\s+no|aun\s+no)(\s+\p{L}+){0,3}\s*$/u;
// "si querés, te lo reservo", "si te sirve, lo agendo": una oferta, no un
// hecho. "si" sin tilde: "sí, te lo reservo" es una respuesta afirmativa.
const CONDICIONAL_ANTES = /(^|[^\p{L}])si\s/u;

/** Las oraciones de la respuesta que no son preguntas, en minúsculas y con
 *  tildes. Una oración termina en ".", "!", "?" o un salto de línea. */
function afirmaciones(respuesta: string): string[] {
  const oraciones = respuesta.toLowerCase().match(/[^.!?\n]+[.!?]*/g) ?? [];
  return oraciones
    .map((o) => o.trim())
    .filter((o) => o.length > 0 && !o.endsWith("?") && !o.startsWith("¿"));
}

/** Las acciones sobre turnos que la respuesta da por hechas o promete. Pura. */
export function accionesAfirmadas(respuesta: string): Set<AccionSobreTurnos> {
  const afirmadas = new Set<AccionSobreTurnos>();
  for (const oracion of afirmaciones(respuesta)) {
    for (const accion of ["AGENDAR", "REPROGRAMAR", "CANCELAR"] as const) {
      for (const { re, condicional, deLaAgenda } of patrones(accion)) {
        const m = re.exec(oracion);
        if (!m) continue;
        const antes = oracion.slice(0, m.index + m[1].length);
        if (NEGACION_ANTES.test(antes)) continue;
        if (condicional && CONDICIONAL_ANTES.test(antes)) continue;
        if (deLaAgenda && !DE_LA_AGENDA.test(oracion)) continue;
        afirmadas.add(accion);
      }
    }
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

/** Las acciones que la respuesta afirma o promete sin que una tool las haya
 *  hecho en este turno. Vacío = la respuesta puede salir. */
export function afirmacionesSinRespaldo(
  respuesta: string,
  toolsDelTurno: readonly ToolCallDelTurno[],
): AccionSobreTurnos[] {
  const hechas = accionesHechas(toolsDelTurno);
  return [...accionesAfirmadas(respuesta)].filter((accion) => !hechas.has(accion));
}

/** El nombre con el que la corrección queda en Message.toolCalls (los dos
 *  rubros). */
export const REGLA_AFIRMACION_SIN_ACCION = "afirmacion_de_turno_sin_accion";
