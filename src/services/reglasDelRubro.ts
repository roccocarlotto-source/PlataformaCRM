import type { HealthProfile, OrganizationIndustry } from "@prisma/client";
import { TOOLS_DE_TURNOS_DE_AUTOMOTORA } from "../automotora/toolsDeTurnos";
import { REGLAS_DE_CLINICA } from "../clinicas/reglasDeClinica";
import type { SaludDeLaClinica } from "../clinicas/repositories/clinicSettings.repository";
import type {
  EntradaDeKnowledgeBase,
  TextosDelPrompt,
  ToolCallDelTurno,
} from "./agentOrchestration.service";
import type { ToolDelAgente } from "./agentTools.service";
import { afirmacionesSinRespaldo, REGLA_AFIRMACION_SIN_ACCION } from "./afirmacionesDeTurnos";
import { desenlacePorTurnoRepetido } from "./turnoRepetido";

// ---------------------------------------------------------------------------
// Puntos de extensión del loop del agente por rubro (docs/rubros.md §0.3 y
// §5.3). Es el ÚNICO arreglo del núcleo para reglas propias de un rubro: el
// loop (responderEnLaConversacion) y la derivación sin agente
// (derivarEntranteSinAgente) preguntan acá, y no hay `if (industry ===
// "CLINICA")` en ellos.
//
// AUTOMOTORA tiene pocas reglas: las tools de turnos, la guarda de salida que
// no deja afirmar ni prometer un turno que no se hizo y la derivación por un
// turno repetido (las dos últimas desde la QA de la primera clínica,
// 2026-11-21, porque usa la misma create_booking). Ninguna instrucción y
// ningún campo recortado. Lo que tiene y lo que no lo fija
// src/clinicas/automotoraSinCambios.test.ts.
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
  // Lo que el ADMIN de una clínica configuró en los mensajes de salud (§5.3,
  // D11 revisada). Sin él, los textos y los términos del código. Solo lo
  // carga el rubro CLINICA (contextoDeLaOrganizacion).
  saludDeLaClinica?: SaludDeLaClinica;
  // El perfil de salud de una clínica (docs/primera-clinica.md §4): MEDICO,
  // el de siempre, o ESTETICA. Sin él, MEDICO. Solo lo carga CLINICA.
  perfilDeSalud?: HealthProfile;
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
  /** Instrucciones que dependen de la organización (de su contexto del turno):
   *  van ANTES de instruccionesDelPrompt. En una clínica, la instrucción de
   *  salud de su perfil (docs/primera-clinica.md §4). null = ninguna. */
  instruccionesDeLaOrganizacion: ((contexto: ContextoDeLaRegla) => readonly string[]) | null;
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
  /** Lo que el rubro suma al contexto de las reglas, leído de la base una vez
   *  por turno (en una clínica, los mensajes de salud que configuró el ADMIN).
   *  null = nada, y no hay consulta. */
  contextoDeLaOrganizacion:
    ((organizationId: string) => Promise<Omit<ContextoDeLaRegla, "nombreDeLaOrganizacion">>) | null;
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
  instruccionesDeLaOrganizacion: null,
  camposFueraDeLasTools: {},
  toolsPropias: {},
  toolsExclusivas: {},
  textosDelPrompt: null,
  contextoDeLaOrganizacion: null,
};

/** El reemplazo de una respuesta de una automotora que afirma o promete un
 *  turno que la tool no hizo en este turno (src/services/afirmacionesDeTurnos.ts).
 *  Honesto en los dos casos posibles: que no se haya hecho nada, o que el
 *  turno sea de un mensaje anterior y el modelo lo haya repetido de memoria. */
export const MENSAJE_AFIRMACION_SIN_ACCION_DE_AUTOMOTORA =
  "Perdón, me expresé mal y no quiero confirmarte algo que no hice. ¿Me decís qué necesitás con tu turno y lo reviso ahora en la agenda?";

/** AUTOMOTORA: las tools de turnos (ver, reprogramar y cancelar;
 *  src/automotora/toolsDeTurnos.ts, decisión de Rocco del 2026-10-31), la
 *  guarda de salida de los turnos y la derivación por un turno repetido (QA de
 *  la primera clínica, 2026-11-21: usa la misma create_booking que una
 *  clínica). Sus textos del prompt son las constantes de siempre
 *  (textosDeAutomotora), con el de gestión de turnos solo si se ofrecen. */
export const REGLAS_DE_AUTOMOTORA: ReglasDelRubro = {
  ...SIN_REGLAS,
  correccionesDeSalida: [
    (respuesta, toolsDelTurno) =>
      afirmacionesSinRespaldo(respuesta, toolsDelTurno).length > 0
        ? {
            regla: REGLA_AFIRMACION_SIN_ACCION,
            mensaje: MENSAJE_AFIRMACION_SIN_ACCION_DE_AUTOMOTORA,
          }
        : null,
  ],
  desenlaceDeLasTools: desenlacePorTurnoRepetido,
  toolsExclusivas: TOOLS_DE_TURNOS_DE_AUTOMOTORA,
};

const REGLAS_POR_RUBRO: Readonly<Record<OrganizationIndustry, ReglasDelRubro>> = {
  AUTOMOTORA: REGLAS_DE_AUTOMOTORA,
  CLINICA: REGLAS_DE_CLINICA,
};

export function reglasDelRubro(industry: OrganizationIndustry): ReglasDelRubro {
  return REGLAS_POR_RUBRO[industry];
}

/** El contexto de las reglas de un turno: el nombre de la organización y lo
 *  que sume el rubro. En AUTOMOTORA, solo el nombre y sin consulta. */
export async function armarContextoDeLaRegla(
  reglas: ReglasDelRubro,
  organizationId: string,
  nombreDeLaOrganizacion: string,
): Promise<ContextoDeLaRegla> {
  const delRubro = reglas.contextoDeLaOrganizacion
    ? await reglas.contextoDeLaOrganizacion(organizationId)
    : {};
  return { ...delRubro, nombreDeLaOrganizacion };
}

/** Las instrucciones del rubro para el system prompt de este turno: las que
 *  dependen de la organización y después las fijas. En AUTOMOTORA, ninguna;
 *  en una clínica MEDICO, las mismas y en el mismo orden que antes de que
 *  existiera el perfil de salud. Pura. */
export function instruccionesDelRubro(
  reglas: ReglasDelRubro,
  contexto: ContextoDeLaRegla,
): string[] {
  return [
    ...(reglas.instruccionesDeLaOrganizacion ? reglas.instruccionesDeLaOrganizacion(contexto) : []),
    ...reglas.instruccionesDelPrompt,
  ];
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
