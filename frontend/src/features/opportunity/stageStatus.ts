import type { OpportunityStatus } from "./types";

// ---------------------------------------------------------------------------
// "La etapa manda sobre el estado": LA regla, en un solo lugar.
//
// Etapa (stageId) y Estado (status) son dos campos independientes del modelo
// — el backend no los relaciona (opportunity.service.ts no mira isWon/isLost
// de la etapa destino). Sincronizarlos es decisión del frontend, y hasta §50
// vivía SOLO adentro de boardMove.ts, es decir solo al arrastrar una tarjeta
// en el embudo: elegir una etapa "Perdida" en el formulario no mostraba
// Motivo de pérdida ni marcaba la oportunidad como perdida.
//
// Este módulo es el denominador común de los dos consumidores, que necesitan
// la misma regla pero producen cosas distintas:
//
//   - boardMove.ts arma un PATCH (UpdateOpportunityInput) que sale a la red;
//     ahí "limpiar la fecha" es `actualCloseDate: null` y "no tocarla" es no
//     mandar el campo.
//   - OpportunityFormPage.tsx actualiza el ESTADO LOCAL del formulario; ahí
//     "limpiar la fecha" es `""` (lo que espera un <input type="date">) y no
//     hay nada que enviar hasta que se apriete Guardar.
//
// Por eso la función devuelve una INTENCIÓN (`CloseDateAction`) y no un valor
// ya formateado: la regla no sabe — ni tiene por qué — en qué lenguaje la va
// a escribir cada consumidor. Es pura y sin dependencias de React.
//
// Lo que NO decide este módulo:
//   - lostReason. El embudo nunca lo toca (el PATCH del drag no lo incluye) y
//     el formulario lo limpia en toda transición cuyo estado resultante no
//     sea LOST, mismo criterio que handleStatusChange (§48). Son dos
//     políticas distintas sobre el mismo campo, así que cada consumidor la
//     aplica por su cuenta.
//   - "hoy". todayIsoDate() vive en boardMove.ts y lo llama quien necesite el
//     valor concreto.
// ---------------------------------------------------------------------------

// Los dos únicos flags de Stage que participan de la regla. Se leen SIEMPRE
// de los flags reales de la etapa, nunca de su nombre.
export interface StageOutcomeFlags {
  isWon: boolean;
  isLost: boolean;
}

// Qué hacer con la Fecha real de cierre:
//   - "keep":  dejarla como está. Una fecha ya cargada NUNCA se pisa.
//   - "today": completarla con hoy, porque estaba vacía y la oportunidad
//     acaba de cerrarse.
//   - "clear": vaciarla, porque la oportunidad se reabrió.
export type CloseDateAction = "keep" | "today" | "clear";

export interface StageStatusChange {
  status: OpportunityStatus;
  actualCloseDate: CloseDateAction;
}

// Devuelve null cuando la etapa destino no cambia nada del estado: etapa
// normal sobre una oportunidad que ya estaba abierta (moverse entre etapas
// del medio). No compara stageId contra el actual — "si vale la pena mover"
// es pregunta de cada consumidor, no de la regla.
export function stageStatusChange(
  current: { status: OpportunityStatus; actualCloseDate: string | null },
  target: StageOutcomeFlags,
): StageStatusChange | null {
  // Una etapa no puede ser ganada y perdida a la vez (refine del backend,
  // stage.controller.ts); el orden de los dos `if` solo importa si esa regla
  // se rompiera, y en ese caso "ganada" gana.
  if (target.isWon) return closeAs("WON", current.actualCloseDate);
  if (target.isLost) return closeAs("LOST", current.actualCloseDate);
  if (current.status !== "OPEN") return { status: "OPEN", actualCloseDate: "clear" };
  return null;
}

function closeAs(status: "WON" | "LOST", existingCloseDate: string | null): StageStatusChange {
  return { status, actualCloseDate: existingCloseDate ? "keep" : "today" };
}
