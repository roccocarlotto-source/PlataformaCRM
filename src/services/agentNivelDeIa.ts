import type { AgentParticipation, OrganizationEdition } from "@prisma/client";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Nivel de participación de la IA de un agente: las reglas de la API
// (docs/ediciones.md §1.2 "Nivel sin elegir" y D3; paso C de §10). Puras, sin
// base: el service les pasa el estado actual y lo pedido, y escribe lo que
// devuelven.
//
//   - COMPLETA, sin nivel en el cuerpo: no se escribe nada. El trigger
//     agents_nivel_por_defecto pone AUTONOMA al crear, como siempre.
//   - ESENCIAL, sin nivel: el agente nace INACTIVO; pedirlo activo sin nivel
//     es 400 NIVEL_DE_IA_SIN_ELEGIR (en vez del 500 del CHECK de la base).
//   - Activar (o dejar activo) un agente sin nivel: 400 NIVEL_DE_IA_SIN_ELEGIR.
//   - Un nivel elegido no vuelve a null: lo rechaza el schema del borde.
//   - participation_chosen_at lo escribe SOLO esto, al elegir o cambiar el
//     nivel; el cliente no puede mandarlo (el schema no lo conoce).
//   - "Solo fuera de horario" va solo con PRIMER_CONTACTO, y exige que la
//     sucursal tenga horario cargado (lo verifica el service).
//
// QUÉ NO HACE: que el agente respete el nivel al atender. Eso es D.
// ---------------------------------------------------------------------------

export const NIVEL_DE_IA_SIN_ELEGIR = "NIVEL_DE_IA_SIN_ELEGIR";

export interface NivelActual {
  participation: AgentParticipation | null;
  participationChosenAt: Date | null;
  onlyOutsideBusinessHours: boolean;
  isActive: boolean;
}

export interface NivelPedido {
  participation?: AgentParticipation;
  onlyOutsideBusinessHours?: boolean;
  isActive?: boolean;
}

export interface NivelAEscribir {
  participation?: AgentParticipation;
  participationChosenAt?: Date;
  onlyOutsideBusinessHours?: boolean;
  isActive?: boolean;
}

export interface DecisionDeNivel {
  data: NivelAEscribir;
  /** true si queda "solo fuera de horario": el service verifica el horario. */
  exigeHorarioDeLaSucursal: boolean;
}

function sinElegir(): never {
  throw new AppError("Elegí cuánto hace la IA antes de activar el agente.", 400, true, {
    code: NIVEL_DE_IA_SIN_ELEGIR,
  });
}

export function decidirNivelDeIa(args: {
  edition: OrganizationEdition;
  /** null al crear. */
  actual: NivelActual | null;
  pedido: NivelPedido;
  ahora: Date;
}): DecisionDeNivel {
  const { edition, actual, pedido, ahora } = args;
  const data: NivelAEscribir = {};

  // El nivel: se escribe (con su fecha) si se elige por primera vez o cambia.
  // Reenviar el mismo nivel ya elegido (el formulario manda todo) no lo toca.
  if (pedido.participation !== undefined) {
    const cambia =
      actual === null ||
      actual.participation !== pedido.participation ||
      actual.participationChosenAt === null;
    if (cambia) {
      data.participation = pedido.participation;
      data.participationChosenAt = ahora;
    }
  }

  // El nivel con el que queda el agente. Al crear en COMPLETA sin nivel, el
  // trigger pone AUTONOMA: para estas reglas, ya tiene nivel.
  const nivelEfectivo: AgentParticipation | null =
    pedido.participation ??
    (actual !== null ? actual.participation : edition === "COMPLETA" ? "AUTONOMA" : null);

  // Activo sin nivel.
  if (actual === null && nivelEfectivo === null) {
    // ESENCIAL al crear: inactivo salvo que lo pidan activo, que es un 400.
    if (pedido.isActive === true) sinElegir();
    data.isActive = false;
  } else {
    const activoEfectivo = pedido.isActive ?? actual?.isActive ?? true;
    if (activoEfectivo && nivelEfectivo === null) sinElegir();
  }

  // "Solo fuera de horario": solo con PRIMER_CONTACTO.
  const fueraDeHorario =
    pedido.onlyOutsideBusinessHours ?? actual?.onlyOutsideBusinessHours ?? false;
  if (fueraDeHorario && nivelEfectivo !== "PRIMER_CONTACTO") {
    throw new AppError(
      "«Solo fuera del horario de la sucursal» va solo con el nivel Primer contacto.",
      400,
    );
  }
  if (pedido.onlyOutsideBusinessHours !== undefined) {
    data.onlyOutsideBusinessHours = pedido.onlyOutsideBusinessHours;
  }

  return { data, exigeHorarioDeLaSucursal: fueraDeHorario };
}
