import type { ToolCallDelTurno } from "../services/agentOrchestration.service";

// ---------------------------------------------------------------------------
// EL AGENTE DE UNA CLÍNICA NO AFIRMA LO QUE NO HIZO (hallazgo de la prueba de
// la Clínica Demo, 2026-10-11).
//
// El agente contestó "He reservado para vos un turno con la Dra. …" sin haber
// llamado a create_booking en ese turno: no existía ningún turno. La
// instrucción del prompt (INSTRUCCION_NO_AFIRMAR_LO_NO_HECHO) ya lo prohibía;
// un modelo chico la saltea. Esto es la guarda determinística, en el punto de
// extensión de salida (ReglasDelRubro.correccionesDeSalida, docs/rubros.md
// §5.3): si la respuesta afirma un turno agendado, reprogramado o cancelado y
// la tool que lo hace no devolvió ok EN ESTE TURNO, la respuesta no sale.
//
// QUÉ SALE EN SU LUGAR: un mensaje fijo (MENSAJE_AFIRMACION_SIN_ACCION), sin
// derivar. Se eligió eso y no volver a pedirle la respuesta al modelo porque
// es lo único que garantiza que la afirmación falsa no salga: una segunda
// redacción puede volver a afirmar lo mismo, cuesta otra llamada y alarga el
// turno. El mensaje es honesto en los dos casos posibles (no se hizo nada, o
// el turno es de un mensaje anterior y el modelo lo repitió de memoria) y
// deja la conversación andando. Un falso positivo cuesta una vuelta más; un
// falso negativo, un paciente que va a un turno que no existe.
//
// QUÉ CUENTA COMO AFIRMACIÓN: un verbo de acción en primera persona y en
// pasado ("reservé", "he reservado", "cancelé", "reprogramé"), o "quedó"
// con el participio ("quedó agendado", "quedó cancelado"). NO cuentan: una
// pregunta ("¿querés que lo reserve?"), una negación ("todavía no quedó
// reservado") ni describir un turno que ya existe ("tenés un turno el
// lunes"). Se compara con tildes: "reservé" (pasado) no es "reserve"
// (subjuntivo).
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

// "cambié", "moví" y "pasé" solos son demasiado generales ("te pasé los
// precios"): cuentan con el turno al lado.
const REPROGRAMAR_CON_EL_TURNO =
  "(cambié|moví|pasé)\\s+(tu|el|su)\\s+turno|(he|hemos)\\s+(cambiado|movido|pasado)\\s+(tu|el|su)\\s+turno|(lo|te\\s+lo|se\\s+lo)\\s+(cambié|moví|pasé)\\s+(para|al|a\\s+las?)";

function patrones(accion: AccionSobreTurnos): RegExp[] {
  const participio = PARTICIPIOS[accion];
  const lista = [
    // "reservé", "te reservé", "ya cancelé"
    new RegExp(`(^|[^\\p{L}])${PRETERITOS[accion]}(?![\\p{L}])`, "u"),
    // "he reservado", "hemos cancelado", "ha sido cancelado"
    new RegExp(`(^|[^\\p{L}])(he|hemos|ha)\\s+(\\p{L}+\\s+)?${participio}(?![\\p{L}])`, "u"),
    // "quedó agendado", "quedaron cancelados", "ya quedó confirmado"
    new RegExp(`(^|[^\\p{L}])(quedó|quedaron)\\s+(\\p{L}+\\s+)?${participio}(?![\\p{L}])`, "u"),
    // "fue cancelado", "se canceló"
    ...(accion === "CANCELAR"
      ? [
          new RegExp(`(^|[^\\p{L}])fue\\s+${participio}(?![\\p{L}])`, "u"),
          /(^|[^\p{L}])se\s+(canceló|anuló)(?![\p{L}])/u,
        ]
      : []),
    ...(accion === "REPROGRAMAR"
      ? [new RegExp(`(^|[^\\p{L}])(${REPROGRAMAR_CON_EL_TURNO})`, "u")]
      : []),
  ];
  return lista;
}

const NEGACION_ANTES = /(^|[^\p{L}])(no|nunca|todavía\s+no|aún\s+no|aun\s+no)(\s+\p{L}+){0,3}\s*$/u;

/** Las oraciones de la respuesta que no son preguntas, en minúsculas y con
 *  tildes. Una oración termina en ".", "!", "?" o un salto de línea. */
function afirmaciones(respuesta: string): string[] {
  const oraciones = respuesta.toLowerCase().match(/[^.!?\n]+[.!?]*/g) ?? [];
  return oraciones
    .map((o) => o.trim())
    .filter((o) => o.length > 0 && !o.endsWith("?") && !o.startsWith("¿"));
}

/** Las acciones sobre turnos que la respuesta da por hechas. Pura. */
export function accionesAfirmadas(respuesta: string): Set<AccionSobreTurnos> {
  const afirmadas = new Set<AccionSobreTurnos>();
  for (const oracion of afirmaciones(respuesta)) {
    for (const accion of ["AGENDAR", "REPROGRAMAR", "CANCELAR"] as const) {
      for (const patron of patrones(accion)) {
        const m = patron.exec(oracion);
        if (m && !NEGACION_ANTES.test(oracion.slice(0, m.index + m[1].length))) {
          afirmadas.add(accion);
        }
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

/** Las acciones que la respuesta afirma sin que una tool las haya hecho en
 *  este turno. Vacío = la respuesta puede salir. */
export function afirmacionesSinRespaldo(
  respuesta: string,
  toolsDelTurno: readonly ToolCallDelTurno[],
): AccionSobreTurnos[] {
  const hechas = accionesHechas(toolsDelTurno);
  return [...accionesAfirmadas(respuesta)].filter((accion) => !hechas.has(accion));
}
