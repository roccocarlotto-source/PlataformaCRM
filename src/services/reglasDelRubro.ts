import type { OrganizationIndustry } from "@prisma/client";
import { REGLAS_DE_CLINICA } from "../clinicas/reglasDeClinica";
import type {
  EntradaDeKnowledgeBase,
  TextosDelPrompt,
  ToolCallDelTurno,
} from "./agentOrchestration.service";
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

/** Lo que una regla decide sobre la respuesta del modelo SIN derivar: la
 *  respuesta no sale y en su lugar va `mensaje` (fijo). */
export interface CorreccionDelRubro {
  // Para la auditoría en Message.toolCalls.
  regla: string;
  mensaje: string;
}

/** Corrige la respuesta del modelo mirando lo que hicieron las tools del
 *  turno (en una clínica: no afirmar un turno agendado, movido o cancelado
 *  si la tool no lo hizo en ESTE turno). */
export type VerificadorDeAfirmaciones = (
  respuesta: string,
  toolsDelTurno: readonly ToolCallDelTurno[],
  contexto: ContextoDeLaRegla,
) => CorreccionDelRubro | null;

/** Lo que decide el turno después de una ronda de tools, sin volver al
 *  modelo: derivar con una decisión del rubro (mensaje fijo, aviso fijo y la
 *  marca que calla al agente), o mandar un texto fijo que NO es del modelo
 *  (en una clínica, las indicaciones tal cual las cargó). */
export type DesenlaceDeLasTools =
  | { tipo: "derivar"; decision: DecisionDelRubro }
  | { tipo: "textual"; regla: string; mensaje: string };

export interface ReglasDelRubro {
  /** Antes de todo: aunque una persona atienda la conversación, aunque el
   *  agente esté callado por una regla, y también sin agente
   *  (derivarEntranteSinAgente). */
  entradaPrioritaria: readonly VerificadorDeEntrada[];
  /** Antes del modelo, si nadie atiende la conversación. */
  entrada: readonly VerificadorDeEntrada[];
  /** Sobre la respuesta del modelo, después de las guardas de siempre. */
  salida: readonly VerificadorDeSalida[];
  /** Sobre la respuesta del modelo, después de `salida`: si una corrige, la
   *  respuesta se reemplaza por su mensaje fijo, sin derivar. */
  correccionesDeSalida: readonly VerificadorDeAfirmaciones[];
  /** Retoques de forma sobre una respuesta del modelo que ya pasó todas las
   *  guardas (en una clínica: sin "de ejemplo"). */
  retoquesDeSalida: readonly ((respuesta: string) => string)[];
  /** Después de cada ronda de tools: si lo que devolvieron decide el turno, el
   *  turno termina ahí, sin volver al modelo. null = nunca. */
  desenlaceDeLasTools:
    | ((
        entradas: readonly ToolCallDelTurno[],
        contexto: ContextoDeLaRegla,
      ) => DesenlaceDeLasTools | null)
    | null;
  /** Tools del sistema del rubro: como request_human_handoff, se ofrecen sin
   *  estar en enabledTools y en cualquier nivel que converse, y no pasan por
   *  puedeEjecutarTool. Las arma el rubro con la base de conocimiento del
   *  turno (en una clínica, mandar las indicaciones). null = ninguna. */
  toolsDelSistema: ((entradas: readonly EntradaDeKnowledgeBase[]) => ToolDelAgente[]) | null;
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
  /** Tools que solo tiene este rubro (no están en el catálogo): se ofrecen si
   *  el agente las tiene en enabledTools y pasan toolDelRubro y el nivel (en
   *  una clínica, las de turnos de R11, docs/rubros.md §5.1). */
  toolsExclusivas: Readonly<Record<string, ToolDelAgente>>;
  /** Los textos del prompt del rubro (§3.2). null = los de una automotora,
   *  las constantes de siempre. `conGestionDeTurnos`: si este turno se le
   *  ofrece al modelo alguna de las toolsExclusivas. */
  textosDelPrompt:
    ((organizationId: string, conGestionDeTurnos: boolean) => Promise<TextosDelPrompt>) | null;
}

export const SIN_REGLAS: ReglasDelRubro = {
  entradaPrioritaria: [],
  entrada: [],
  salida: [],
  correccionesDeSalida: [],
  retoquesDeSalida: [],
  desenlaceDeLasTools: null,
  toolsDelSistema: null,
  callaDespuesDeDerivar: false,
  instruccionesDelPrompt: [],
  camposFueraDeLasTools: {},
  toolsPropias: {},
  toolsExclusivas: {},
  textosDelPrompt: null,
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

/** La primera corrección de una lista de verificadores de afirmaciones, o
 *  null. */
export function primeraCorreccionDeSalida(
  verificadores: readonly VerificadorDeAfirmaciones[],
  respuesta: string,
  toolsDelTurno: readonly ToolCallDelTurno[],
  contexto: ContextoDeLaRegla,
): CorreccionDelRubro | null {
  for (const verificador of verificadores) {
    const correccion = verificador(respuesta, toolsDelTurno, contexto);
    if (correccion) return correccion;
  }
  return null;
}

/** El nombre con el que una corrección queda en Message.toolCalls. A
 *  diferencia de la marca de una regla, NO calla al agente: no hubo
 *  derivación. */
export const AUDITORIA_DE_CORRECCION_DEL_RUBRO = "correccion_del_rubro";

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
