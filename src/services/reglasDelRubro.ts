import type { OrganizationIndustry } from "@prisma/client";
import { REGLAS_DE_CLINICA } from "../clinicas/reglasDeClinica";
import type { ToolDelAgente } from "./agentTools.service";

// ---------------------------------------------------------------------------
// Puntos de extensión del loop del agente por rubro (docs/rubros.md §0.3 y
// §5.3). Es el ÚNICO arreglo del núcleo para reglas propias de un rubro: el
// loop (responderEnLaConversacion) y la derivación sin agente
// (derivarEntranteSinAgente) preguntan acá, y no hay `if (industry ===
// "CLINICA")` en ellos.
//
// AUTOMOTORA no tiene reglas: todas las listas vacías, ninguna instrucción y
// ningún campo recortado. El loop de una automotora es exactamente el de
// antes (lo fija src/clinicas/automotoraSinCambios.test.ts).
// ---------------------------------------------------------------------------

/** La tarea de una derivación decidida por una regla: cuerpo fijo, sin el
 *  brief (que resumiría lo que escribió el contacto). Con `urgente`, la tarea
 *  se crea aunque la conversación ya estuviera derivada, no reutiliza otra
 *  abierta, vence en el acto y su asunto lo dice. */
export interface AvisoFijo {
  cuerpo: string;
  urgente: boolean;
}

/** Lo que una regla decide: contestar `mensaje` (fijo, sin modelo) y derivar
 *  con `motivo`. */
export interface DecisionDelRubro {
  // Para la auditoría en Message.toolCalls.
  regla: string;
  motivo: string;
  mensaje: string;
  aviso: AvisoFijo;
}

export interface ContextoDeLaRegla {
  nombreDeLaOrganizacion: string;
}

export type VerificadorDeEntrada = (
  textos: readonly string[],
  contexto: ContextoDeLaRegla,
) => DecisionDelRubro | null;

export type VerificadorDeSalida = (
  respuesta: string,
  contexto: ContextoDeLaRegla,
) => DecisionDelRubro | null;

export interface ReglasDelRubro {
  /** Antes de todo: aunque una persona atienda la conversación, aunque el
   *  agente esté callado por una regla, y también sin agente
   *  (derivarEntranteSinAgente). */
  entradaPrioritaria: readonly VerificadorDeEntrada[];
  /** Antes del modelo, si nadie atiende la conversación. */
  entrada: readonly VerificadorDeEntrada[];
  /** Sobre la respuesta del modelo, después de las guardas de siempre. */
  salida: readonly VerificadorDeSalida[];
  /** Si después de una derivación por una de estas reglas el agente calla en
   *  esa conversación hasta que una persona la devuelva. */
  callaDespuesDeDerivar: boolean;
  /** Instrucciones fijas que se suman al system prompt, antes de la de
   *  identidad (que siempre va última). */
  instruccionesDelPrompt: readonly string[];
  /** Argumentos que una tool no ofrece ni recibe en este rubro. */
  camposFueraDeLasTools: Readonly<Record<string, readonly string[]>>;
  /** Versiones propias del rubro de tools del catálogo, por nombre: si el
   *  agente tiene la tool habilitada, se usa esta en su lugar (en una clínica,
   *  las de agenda con profesionales, docs/rubros.md §4.3 y §5.1). */
  toolsPropias: Readonly<Record<string, ToolDelAgente>>;
}

export const SIN_REGLAS: ReglasDelRubro = {
  entradaPrioritaria: [],
  entrada: [],
  salida: [],
  callaDespuesDeDerivar: false,
  instruccionesDelPrompt: [],
  camposFueraDeLasTools: {},
  toolsPropias: {},
};

const REGLAS_POR_RUBRO: Readonly<Record<OrganizationIndustry, ReglasDelRubro>> = {
  AUTOMOTORA: SIN_REGLAS,
  CLINICA: REGLAS_DE_CLINICA,
};

export function reglasDelRubro(industry: OrganizationIndustry): ReglasDelRubro {
  return REGLAS_POR_RUBRO[industry];
}

/** La primera decisión de una lista de verificadores, o null. */
export function primeraDecisionDeEntrada(
  verificadores: readonly VerificadorDeEntrada[],
  textos: readonly string[],
  contexto: ContextoDeLaRegla,
): DecisionDelRubro | null {
  for (const verificador of verificadores) {
    const decision = verificador(textos, contexto);
    if (decision) return decision;
  }
  return null;
}

export function primeraDecisionDeSalida(
  verificadores: readonly VerificadorDeSalida[],
  respuesta: string,
  contexto: ContextoDeLaRegla,
): DecisionDelRubro | null {
  for (const verificador of verificadores) {
    const decision = verificador(respuesta, contexto);
    if (decision) return decision;
  }
  return null;
}

/** El nombre con el que una decisión queda en Message.toolCalls. No es una
 *  tool: el modelo nunca la ve. La lee el silencio de después de derivar. */
export const AUDITORIA_DE_REGLA_DEL_RUBRO = "regla_del_rubro";

/** Si un Message.toolCalls guardado tiene la marca de una regla del rubro. */
export function tieneMarcaDeReglaDelRubro(toolCalls: unknown): boolean {
  return (
    Array.isArray(toolCalls) &&
    toolCalls.some(
      (entrada) =>
        typeof entrada === "object" &&
        entrada !== null &&
        (entrada as { name?: unknown }).name === AUDITORIA_DE_REGLA_DEL_RUBRO,
    )
  );
}
