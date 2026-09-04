import type { Stage } from "../stage/types";
import type { Opportunity, UpdateOpportunityInput } from "./types";

// ---------------------------------------------------------------------------
// Qué PATCH manda el embudo al soltar una tarjeta en otra columna.
//
// Mover una oportunidad de etapa NO sincroniza su status del lado del
// backend: opportunity.service.ts no relaciona stageId con isWon/isLost de
// la etapa destino. Si el tablero mandara solo stageId, una tarjeta podría
// quedar en la columna "Ganada" con status OPEN adentro — un tablero que
// miente. Por eso el front arma el PATCH completo acá, a partir de los
// flags REALES de la etapa destino (nunca de su nombre):
//
//   - destino isWon  → status WON,  actualCloseDate hoy (si no tenía una)
//   - destino isLost → status LOST, actualCloseDate hoy (si no tenía una)
//   - destino normal y la oportunidad estaba cerrada → se REABRE: status
//     OPEN y actualCloseDate null. El null explícito está soportado por
//     UpdateOpportunityInput justamente para esto (ver el comentario en
//     types.ts).
//   - destino normal y ya estaba OPEN (mover entre etapas del medio) → solo
//     stageId, nada más cambia.
//
// actualCloseDate existente NUNCA se pisa: si la oportunidad ya tenía una
// fecha real de cierre, se conserva (no se manda el campo). lostReason no
// se toca en ningún caso: sigue siendo independiente del status y se edita
// solo desde el formulario, como hasta ahora.
//
// Es una función pura a propósito: la interacción de arrastre se prueba
// aparte, y estas reglas se prueban una por una sin simular ningún drag.
// ---------------------------------------------------------------------------

export type StageOutcome = Pick<Stage, "id" | "isWon" | "isLost">;

// Devuelve null cuando no hay nada que mandar: soltar en la misma columna.
export function buildMovePatch(
  opportunity: Pick<Opportunity, "stageId" | "status" | "actualCloseDate">,
  target: StageOutcome,
  today: string,
): UpdateOpportunityInput | null {
  if (target.id === opportunity.stageId) return null;

  // Una etapa no puede ser ganada y perdida a la vez (refine del backend,
  // stage.controller.ts); el orden de los dos `if` solo importa si esa
  // regla se rompiera, y en ese caso "ganada" gana.
  if (target.isWon) {
    return closeAs("WON", target.id, opportunity.actualCloseDate, today);
  }
  if (target.isLost) {
    return closeAs("LOST", target.id, opportunity.actualCloseDate, today);
  }
  if (opportunity.status !== "OPEN") {
    return { stageId: target.id, status: "OPEN", actualCloseDate: null };
  }
  return { stageId: target.id };
}

function closeAs(
  status: "WON" | "LOST",
  stageId: string,
  existingCloseDate: string | null,
  today: string,
): UpdateOpportunityInput {
  return existingCloseDate ? { stageId, status } : { stageId, status, actualCloseDate: today };
}

// "Hoy" en formato YYYY-MM-DD según el reloj LOCAL de quien arrastra — es
// la misma forma en que el formulario manda las fechas (input type="date"),
// y el backend la convierte con z.coerce.date(). No se usa toISOString():
// eso daría la fecha UTC, que de noche en Argentina ya es "mañana".
export function todayIsoDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
