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

// ---------------------------------------------------------------------------
// Paso D (docs/ediciones.md §4 y §10): que el agente RESPETE el nivel al
// atender. Solo para agentes activos y no borrados: un agente inactivo, sin
// el canal o borrado sigue el camino de siempre (no llega acá).
// ---------------------------------------------------------------------------

/** El nivel que rige, o null si cuenta como "sin elegir": sin nivel, o en
 *  ESENCIAL con un nivel que ningún ADMIN eligió (participation_chosen_at
 *  vacío: lo escribió un script, un seed o un UPDATE a mano). En COMPLETA no
 *  se mira participation_chosen_at: los agentes de siempre (AUTONOMA por la
 *  migración del PR 2) atienden como hoy. */
export function nivelEfectivo(
  agent: { participation: AgentParticipation | null; participationChosenAt: Date | null },
  edition: OrganizationEdition,
): AgentParticipation | null {
  if (agent.participation === null) return null;
  if (edition !== "COMPLETA" && agent.participationChosenAt === null) return null;
  return agent.participation;
}

/** Las tools de PRIMER_CONTACTO: informar y tomar datos. Las que comprometen
 *  algo (oportunidades, reservar unidad o turno, "sin interés") las hace una
 *  persona. La derivación es de sistema y está siempre. */
export const TOOLS_DE_PRIMER_CONTACTO: ReadonlySet<string> = new Set([
  "search_vehicles",
  "get_service_types",
  "get_availability",
  "get_contact_info",
  "get_contact_activities",
  "create_lead",
  "update_lead",
  "update_contact_custom_fields",
]);

/** Si el nivel permite la tool. AUTONOMA: todas (como hoy). */
export function toolDelNivel(nombre: string, nivel: AgentParticipation): boolean {
  if (nivel === "AUTONOMA") return true;
  if (nivel === "PRIMER_CONTACTO") return TOOLS_DE_PRIMER_CONTACTO.has(nombre);
  return false;
}

/** D12: fijo en el código. */
export const MAX_RESPUESTAS_PRIMER_CONTACTO = 2;

export const MOTIVO_NIVEL_SIN_ELEGIR =
  "El agente no tiene elegido cuánto hace la IA: la conversación la atiende una persona";
export const MOTIVO_SOLO_SEGUIMIENTO =
  "El agente está en «Solo seguimiento»: la conversación la atiende una persona";
export const MOTIVO_DENTRO_DE_HORARIO =
  "Dentro del horario de la sucursal atiende una persona: el agente responde solo fuera de horario";
export const MOTIVO_TOPE_DE_PRIMER_CONTACTO =
  "El agente ya hizo el primer contacto: sigue una persona del equipo";

/** Lo que ve el cliente del widget web cuando el agente no conversa (el
 *  widget espera una respuesta). */
export const TEXTO_DEL_WIDGET_SIN_IA =
  "Gracias por escribir. Te va a responder una persona del equipo.";

/** La instrucción de rol de PRIMER_CONTACTO, para el prompt. */
export const INSTRUCCION_DE_PRIMER_CONTACTO =
  "Tu tarea es el primer contacto: recibí la consulta, respondé lo básico con lo que tenés (las unidades del stock, los horarios, la información del negocio), tomá el nombre y los datos de la persona, y pasala con una persona del equipo con request_human_handoff. No reserves unidades ni turnos, ni registres oportunidades: eso lo hace una persona del equipo.";

export type DecisionDeAtencion =
  | { atiende: true }
  | { atiende: false; deriva: true; motivo: string }
  | { atiende: false; deriva: false };

/** Si el agente atiende este turno o deriva sin llamar al modelo. Para
 *  AUTONOMA siempre atiende: el camino de hoy, sin ningún cambio. */
export function decidirAtencion(args: {
  nivel: AgentParticipation | null;
  conversacionDerivada: boolean;
  onlyOutsideBusinessHours: boolean;
  dentroDeHorario: boolean;
  respuestasDelAgente: number;
}): DecisionDeAtencion {
  const { nivel } = args;
  if (nivel === "AUTONOMA") return { atiende: true };
  // Con cualquier otro nivel, una conversación ya derivada calla: el agente no
  // vuelve a hablar ni se crea otra tarea con cada mensaje del cliente.
  if (args.conversacionDerivada) return { atiende: false, deriva: false };
  if (nivel === null) return { atiende: false, deriva: true, motivo: MOTIVO_NIVEL_SIN_ELEGIR };
  if (nivel === "SOLO_SEGUIMIENTO") {
    return { atiende: false, deriva: true, motivo: MOTIVO_SOLO_SEGUIMIENTO };
  }
  if (args.onlyOutsideBusinessHours && args.dentroDeHorario) {
    return { atiende: false, deriva: true, motivo: MOTIVO_DENTRO_DE_HORARIO };
  }
  if (args.respuestasDelAgente >= MAX_RESPUESTAS_PRIMER_CONTACTO) {
    return { atiende: false, deriva: true, motivo: MOTIVO_TOPE_DE_PRIMER_CONTACTO };
  }
  return { atiende: true };
}
