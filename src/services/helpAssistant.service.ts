import type { HelpAssistantFeedback } from "@prisma/client";
import { AYUDA } from "../compartido/guia/anclas";
import type { Seccion } from "../compartido/guia/guia";
import { modulosDe } from "../config/ediciones";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { findInternalAgentByOrganization } from "../repositories/internalAgent.repository";
import {
  contarPreguntasDesde,
  gastoDesde,
  guardarFeedback,
  registrarPregunta,
  type PreguntaARegistrar,
} from "../repositories/helpAssistantQuestion.repository";
import { findZonaDeLaOrganizacion } from "../repositories/organization.repository";
import { findPlatformAdminByUserId } from "../repositories/platformAdmin.repository";
import { findUserById } from "../repositories/user.repository";
import type { AuthContext } from "../types/auth";
import { AppError } from "../utils/AppError";
import { periodWindowInZone } from "../utils/zonedWindow";
import { guiaVisible } from "./guiaDeUso.service";
import {
  armarPrompt,
  enmascarar,
  LARGO_MAXIMO_DE_LA_PREGUNTA,
  LARGO_MAXIMO_DE_UNA_RESPUESTA_PREVIA,
  MODULOS_CON_NOMBRE,
  PARES_DE_HISTORIAL,
  preguntaDelimitada,
  procesarRespuesta,
  type Fuente,
  type TipoDeRespuesta,
} from "./helpAssistantPrompt";
import {
  getLlmProvider,
  type LlmCompletionRequest,
  type LlmCompletionResult,
  type LlmMessage,
} from "./llmProvider.service";

// ---------------------------------------------------------------------------
// El asistente "¿Cómo se hace?" (docs-privados/asistente-de-ayuda-diseno.md,
// local): una pregunta sobre cómo usar la plataforma, una llamada al modelo
// sin tools, con la guía que esa persona ve en Ayuda y nada más de su
// organización.
//
// En orden, y cortando en el primero que falla:
//   1. interruptor global (HELP_ASSISTANT_ENABLED) → 404, como si no existiera;
//   2. interruptor de la organización → 403 ASISTENTE_APAGADO;
//   3. freno de gasto diario de toda la plataforma → 503 ASISTENTE_EN_PAUSA;
//   4. tope del usuario en el día de su organización → 429 TOPE_DIARIO_ASISTENTE;
//   5. el modelo; si falla o la respuesta llega cortada → 502, y la pregunta
//      queda registrada como ERROR (no cuenta para el tope).
//
// Lo que entra al prompt de la organización: rubro, edición, módulos, rol,
// si tiene el Agente interno y la pantalla. Ni nombres ni datos de nadie. La
// pregunta y el historial van enmascarados (helpAssistantPrompt.enmascarar).
// ---------------------------------------------------------------------------

export const MENSAJE_SIN_RESPUESTA = "No pudimos responder ahora. Probá de nuevo en un momento.";
export const MENSAJE_TOPE_DIARIO = (limite: number) =>
  `Llegaste a las ${String(limite)} preguntas de hoy. Mañana podés seguir preguntando. Mientras tanto, toda la guía está en Ayuda.`;
export const MENSAJE_EN_PAUSA =
  "La ayuda no está disponible por hoy. Mientras tanto, toda la guía está en Ayuda.";
export const MENSAJE_APAGADO = "La ayuda no está habilitada en esta cuenta.";

export interface PreguntaEntrante {
  pregunta: string;
  /** La clave de AYUDA de la pantalla; si no es una clave conocida, se ignora. */
  pantalla?: string;
  /** Los pares anteriores de esta charla (los guarda el navegador). */
  historial?: { pregunta: string; respuesta: string }[];
}

export interface RespuestaDelAsistente {
  id: string;
  respuesta: string;
  fuentes: Fuente[];
  tipo: TipoDeRespuesta;
  restantesHoy: number;
}

export interface DepsDelAsistente {
  ahora: () => Date;
  habilitado: boolean;
  modelo: string | undefined;
  cachearPrompt: boolean;
  topeDiario: number;
  presupuestoDiarioUsd: number;
  zonaDeLaOrganizacion: (organizationId: string) => Promise<string>;
  preguntasDesde: (userId: string, desde: Date) => Promise<number>;
  gastoDesde: (desde: Date) => Promise<number>;
  esPlatformAdmin: (userId: string) => Promise<boolean>;
  tieneAgenteInterno: (auth: AuthContext, modulos: ReadonlySet<string>) => Promise<boolean>;
  completar: (pedido: LlmCompletionRequest) => Promise<LlmCompletionResult>;
  registrar: (datos: PreguntaARegistrar) => Promise<string>;
}

async function tieneAgenteInterno(
  auth: AuthContext,
  modulos: ReadonlySet<string>,
): Promise<boolean> {
  if (!modulos.has("agente_interno")) return false;
  const [agente, puede] = await Promise.all([
    findInternalAgentByOrganization(auth.organizationId),
    auth.role === "ADMIN"
      ? Promise.resolve(true)
      : findUserById(auth.userId, auth.organizationId).then(
          (user) => user?.canUseInternalAgent === true,
        ),
  ]);
  return agente !== null && puede;
}

export const depsDelAsistente: DepsDelAsistente = {
  ahora: () => new Date(),
  habilitado: env.HELP_ASSISTANT_ENABLED,
  modelo: env.HELP_ASSISTANT_MODEL,
  cachearPrompt: env.HELP_ASSISTANT_PROMPT_CACHE,
  topeDiario: env.HELP_ASSISTANT_DAILY_LIMIT,
  presupuestoDiarioUsd: env.HELP_ASSISTANT_DAILY_BUDGET_USD,
  zonaDeLaOrganizacion: (organizationId) => findZonaDeLaOrganizacion(organizationId),
  preguntasDesde: (userId, desde) => contarPreguntasDesde(userId, desde),
  gastoDesde: (desde) => gastoDesde(desde),
  esPlatformAdmin: async (userId) => (await findPlatformAdminByUserId(userId)) !== null,
  tieneAgenteInterno,
  completar: (pedido) => getLlmProvider().complete(pedido),
  registrar: (datos) => registrarPregunta(datos),
};

/** El asistente está disponible para esta persona (lo que muestra /api/me). */
export function asistenteDisponible(auth: AuthContext, habilitado = env.HELP_ASSISTANT_ENABLED) {
  return habilitado && (auth.helpAssistantEnabled ?? true);
}

function inicioDelDiaUtc(ahora: Date): Date {
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
}

function pantallaDe(clave: string | undefined, secciones: Seccion[]) {
  if (!clave || !Object.hasOwn(AYUDA, clave)) return null;
  const destino = AYUDA[clave as keyof typeof AYUDA];
  const [slug, ancla] = destino.split("#");
  const seccion = secciones.find((s) => s.slug === slug);
  const titulo = seccion?.encabezados.find((e) => e.ancla === ancla)?.titulo ?? null;
  return { clave, titulo, destino };
}

export async function preguntarAlAsistente(
  auth: AuthContext,
  entrada: PreguntaEntrante,
  deps: DepsDelAsistente = depsDelAsistente,
): Promise<RespuestaDelAsistente> {
  if (!deps.habilitado) throw new AppError("Ruta no encontrada", 404);
  if (!asistenteDisponible(auth, true)) {
    throw new AppError(MENSAJE_APAGADO, 403, true, { code: "ASISTENTE_APAGADO" });
  }

  const ahora = deps.ahora();
  if (
    deps.presupuestoDiarioUsd <= 0 ||
    (await deps.gastoDesde(inicioDelDiaUtc(ahora))) >= deps.presupuestoDiarioUsd
  ) {
    throw new AppError(MENSAJE_EN_PAUSA, 503, true, { code: "ASISTENTE_EN_PAUSA" });
  }

  const zona = await deps.zonaDeLaOrganizacion(auth.organizationId);
  const hechas = await deps.preguntasDesde(
    auth.userId,
    periodWindowInZone("day", ahora, zona).start,
  );
  if (hechas >= deps.topeDiario) {
    throw new AppError(MENSAJE_TOPE_DIARIO(deps.topeDiario), 429, true, {
      code: "TOPE_DIARIO_ASISTENTE",
      restantesHoy: 0,
    });
  }

  const modulos: ReadonlySet<string> = modulosDe(
    auth.edition,
    auth.industry,
    auth.modulosActivados,
  );
  const [esPlatformAdmin, conAgenteInterno] = await Promise.all([
    deps.esPlatformAdmin(auth.userId),
    deps.tieneAgenteInterno(auth, modulos),
  ]);
  // La sección Plataforma (la ve solo el platform admin) entra solo si pregunta
  // desde una pantalla de Plataforma: suma ~17k tokens, y con ella la vista más
  // grande pasaría los 100k, donde Haiku 5.5 cobra el prompt 5 veces más.
  const desdePlataforma =
    entrada.pantalla !== undefined &&
    Object.hasOwn(AYUDA, entrada.pantalla) &&
    AYUDA[entrada.pantalla as keyof typeof AYUDA].startsWith("plataforma#");
  const secciones = guiaVisible(
    {
      industry: auth.industry,
      modulos,
      role: auth.role,
      isPlatformAdmin: esPlatformAdmin && desdePlataforma,
    },
    { conAvisosDeAdmin: true },
  );
  const esClinica = auth.industry === "CLINICA";
  const prompt = armarPrompt(secciones, {
    esClinica,
    edicion: auth.edition,
    rol: auth.role,
    tieneAgenteInterno: conAgenteInterno,
    noIncluye: esClinica
      ? []
      : Object.entries(MODULOS_CON_NOMBRE)
          .filter(([modulo]) => !modulos.has(modulo))
          .map(([, nombre]) => nombre),
    pantalla: pantallaDe(entrada.pantalla, secciones),
  });

  const pregunta = enmascarar(entrada.pregunta.trim().slice(0, LARGO_MAXIMO_DE_LA_PREGUNTA));
  const mensajes: LlmMessage[] = [];
  for (const previo of (entrada.historial ?? []).slice(-PARES_DE_HISTORIAL)) {
    mensajes.push(
      { role: "user", content: preguntaDelimitada(enmascarar(previo.pregunta)) },
      {
        role: "assistant",
        content: enmascarar(previo.respuesta.slice(0, LARGO_MAXIMO_DE_UNA_RESPUESTA_PREVIA)),
      },
    );
  }
  mensajes.push({ role: "user", content: preguntaDelimitada(pregunta) });

  const registro = {
    organizationId: auth.organizationId,
    userId: auth.userId,
    industry: auth.industry,
    edition: auth.edition,
    role: auth.role,
    screen: pantallaDe(entrada.pantalla, secciones)?.clave ?? null,
    question: pregunta,
    model: deps.modelo ?? env.OPENROUTER_MODEL,
  };

  const inicio = Date.now();
  let resultado: LlmCompletionResult;
  try {
    resultado = await deps.completar({
      ...(deps.cachearPrompt
        ? { systemPromptCacheable: prompt.prefijoCacheable, systemPrompt: prompt.sistema }
        : { systemPrompt: `${prompt.prefijoCacheable}\n\n${prompt.sistema}` }),
      messages: mensajes,
      tools: [],
      ...(deps.modelo ? { model: deps.modelo } : {}),
    });
  } catch (err) {
    logger.error({ err }, "El asistente de ayuda no pudo llamar al modelo");
    await deps.registrar({
      ...registro,
      sources: [],
      outcome: "ERROR",
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: null,
      durationMs: Date.now() - inicio,
    });
    throw new AppError(MENSAJE_SIN_RESPUESTA, 502, true, { code: "ASISTENTE_SIN_RESPUESTA" });
  }
  const durationMs = Date.now() - inicio;
  const uso = {
    promptTokens: resultado.usage?.promptTokens ?? 0,
    completionTokens: resultado.usage?.completionTokens ?? 0,
    cacheReadTokens: resultado.usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: resultado.usage?.cacheWriteTokens ?? 0,
    costUsd: resultado.usage?.costUsd ?? null,
    durationMs,
  };

  // Cortada por largo, o sin texto: no se muestra a medias (§5 del diseño).
  if (resultado.cortadaPorLargo || !resultado.text?.trim()) {
    await deps.registrar({ ...registro, ...uso, sources: [], outcome: "ERROR" });
    throw new AppError(MENSAJE_SIN_RESPUESTA, 502, true, { code: "ASISTENTE_SIN_RESPUESTA" });
  }

  const procesada = procesarRespuesta(resultado.text, {
    secciones,
    tieneAgenteInterno: conAgenteInterno,
  });
  const id = await deps.registrar({
    ...registro,
    ...uso,
    sources: procesada.anclas,
    outcome: procesada.tipo,
  });
  return {
    id,
    respuesta: procesada.respuesta,
    fuentes: procesada.fuentes,
    tipo: procesada.tipo,
    restantesHoy: Math.max(0, deps.topeDiario - hechas - 1),
  };
}

/** El 👍/👎 de quien preguntó. 404 si la pregunta no es suya. */
export async function darFeedback(
  auth: AuthContext,
  id: string,
  feedback: HelpAssistantFeedback,
  guardar: typeof guardarFeedback = guardarFeedback,
): Promise<void> {
  if ((await guardar(id, auth.organizationId, auth.userId, feedback)) === 0) {
    throw new AppError("Pregunta no encontrada", 404);
  }
}
