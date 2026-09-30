import { Prisma, type ConversationChannel } from "@prisma/client";
import { logger } from "../lib/logger";
import { prisma, type Db } from "../lib/prisma";
import {
  countAgents,
  createAgent as createAgentRepo,
  findAgentById,
  findAgentByIdForPlatformAdmin,
  findManyAgents,
  setAgentFacebookPageId,
  setAgentModel,
  setAgentWhatsappPhoneNumberId,
  softDeleteAgent,
  updateAgent as updateAgentRepo,
  type AgentFilters,
  type AgentSortBy,
  type SortOrder,
} from "../repositories/agent.repository";
import { revokeEmbedTokensByAgent } from "../repositories/agentEmbedToken.repository";
import { findBranchById, lockBranchForUpdate } from "../repositories/branch.repository";
import { findActiveMetaConnectionByPageId } from "../repositories/metaPageConnection.repository";
import { AppError } from "../utils/AppError";
import { assertModeloSinCambios, modeloPorDefecto } from "./modeloDeIa.service";

// ---------------------------------------------------------------------------
// CRUD administrativo del Agent (docs/ai-agent-architecture.md §5, paso 2a de
// §9). Mismo patrón exacto que resource.service.ts: scopeado por
// organizationId en cada operación, branchId validado contra la organización,
// soft delete vía deletedAt.
//
// LO QUE NO HAY ACÁ, A PROPÓSITO: ninguna llamada al proveedor de LLM. Este
// service configura agentes; ejecutarlos es el loop del paso 2b, que consume
// esta configuración pero vive en otro archivo.
// ---------------------------------------------------------------------------

export interface ListAgentsParams {
  page: number;
  pageSize: number;
  search?: string;
  branchId?: string;
  isActive?: boolean;
  sortBy: AgentSortBy;
  sortOrder: SortOrder;
}

export async function listAgents(organizationId: string, params: ListAgentsParams) {
  const { page, pageSize, sortBy, sortOrder, ...filters } = params;
  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    findManyAgents(
      organizationId,
      filters as AgentFilters,
      { skip, take: pageSize },
      { sortBy, sortOrder },
    ),
    countAgents(organizationId, filters as AgentFilters),
  ]);

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

export async function getAgentById(organizationId: string, id: string) {
  const agent = await findAgentById(id, organizationId);
  if (!agent) {
    throw new AppError("Agente no encontrado", 404);
  }
  return agent;
}

// `db` explícito para poder revalidar DENTRO de la transacción de createAgent
// con el lock de la sucursal ya sostenido; el default es el pre-check rápido de
// afuera, que es UX y no la defensa. Mismo patrón que validateBranchId en
// resource.service.ts.
async function validateBranchId(organizationId: string, branchId: string, db: Db = prisma) {
  const branch = await findBranchById(branchId, organizationId, db);
  if (!branch) {
    throw new AppError("La sucursal indicada no existe o no pertenece a tu organización", 400);
  }
  return branch;
}

export interface CreateAgentInput {
  branchId: string;
  name: string;
  goal?: string | null;
  instructions: string;
  tone?: string | null;
  // B-05: opcionales, y solo pasan si son el modelo de la plataforma (ver
  // modeloDeIa.service.ts). El agente nace siempre con OPENROUTER_MODEL.
  modelProvider?: string;
  modelName?: string;
  enabledTools: string[];
  channels: ConversationChannel[];
  guardrails: Record<string, unknown>;
  // El texto en lenguaje natural del que salio `guardrails` (item 56). Viaja
  // como texto plano: no necesita el cast de Prisma.InputJsonValue.
  guardrailsText: string;
  allowedOrigins: string[];
  whatsappPhoneNumberId?: string | null;
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// EL NÚMERO DE WHATSAPP LO ASIGNA LA PLATAFORMA (ítem 127, A-01 de
// docs/auditoria-2026-09-24-punta-a-punta.md).
//
// La plataforma opera con UNA sola Meta App y un solo token, así que los
// mensajes de los números de todos los clientes entran al mismo webhook y
// whatsapp_phone_number_id es lo único que dice de qué agente son. Hasta el
// ítem 127 lo escribía el ADMIN del tenant: cualquier ADMIN podía cargar el
// phone_number_id de OTRO negocio (no es secreto: está en el panel de Meta y
// en cualquier payload) y recibir y contestar los mensajes de sus clientes; y
// el 409 de "ya está asignado" servía para enumerar qué ids estaban en uso.
//
// Desde el ítem 127 el tenant no lo cambia: crear y editar agente siguen
// aceptando el campo porque el formulario puede reenviar el valor que ya
// tiene, pero solo si es ESE valor (o null cuando no tiene). Cualquier otro es
// 403. El único camino que lo escribe es asignarNumeroDeWhatsapp(), detrás de
// requirePlatformAdmin. Sin migración: la columna UNIQUE queda como estaba.
// ---------------------------------------------------------------------------

export const MENSAJE_NUMERO_LO_ASIGNA_LA_PLATAFORMA =
  "El número de WhatsApp del agente lo asigna la plataforma: pedíselo al equipo de la plataforma";

function assertNumeroDeWhatsappSinCambios(
  actual: string | null,
  pedido: string | null | undefined,
): void {
  if (pedido === undefined || pedido === actual) return;
  throw new AppError(MENSAJE_NUMERO_LO_ASIGNA_LA_PLATAFORMA, 403);
}

// agents.whatsapp_phone_number_id es UNIQUE GLOBAL (ítem 81): el webhook de
// Meta no trae otra pista para saber de quién es un mensaje. Desde el ítem 127
// el choque solo lo puede ver un platform admin, así que el mensaje ya no
// sirve para enumerar desde un tenant. Cualquier otro P2002 se relanza tal cual.
function traducirNumeroDeWhatsappDuplicado(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = Array.isArray(err.meta?.target)
      ? err.meta.target.join(",")
      : String(err.meta?.target ?? "");
    if (target.includes("whatsapp_phone_number_id")) {
      throw new AppError("Ese número de WhatsApp ya está asignado a otro agente", 409);
    }
  }
  throw err;
}

export async function createAgent(organizationId: string, input: CreateAgentInput) {
  // Un agente nace sin número: solo se acepta que el body diga eso mismo.
  assertNumeroDeWhatsappSinCambios(null, input.whatsappPhoneNumberId);
  // B-05: y con el modelo de la plataforma.
  const modelo = modeloPorDefecto();
  assertModeloSinCambios(modelo, input);

  // 400 rápido en el caso común, sin abrir transacción.
  await validateBranchId(organizationId, input.branchId);

  return prisma.$transaction(async (tx) => {
    // Mismo lock que createResource: serializa contra deleteBranch para que
    // el agente no quede colgando de una sucursal borrada entre el pre-check y
    // el INSERT. La OTRA mitad —que deleteBranch cuente agentes activos y
    // rechace, como hace con los recursos— NO está en este PR: hoy deleteBranch
    // no sabe que los agentes existen. Es una decisión pendiente anotada en el
    // PR de 2a, no un olvido; el lock queda puesto para que el día que se
    // agregue el RESTRICT el lado create ya esté correcto.
    await lockBranchForUpdate(input.branchId, organizationId, tx);

    // Revalida con el lock sostenido: entre el pre-check y este punto,
    // deleteBranch pudo haber borrado la sucursal.
    await validateBranchId(organizationId, input.branchId, tx);

    return createAgentRepo(
      {
        organizationId,
        branchId: input.branchId,
        name: input.name,
        goal: input.goal ?? null,
        instructions: input.instructions,
        tone: input.tone ?? null,
        modelProvider: modelo.modelProvider,
        modelName: modelo.modelName,
        enabledTools: input.enabledTools,
        channels: input.channels,
        allowedOrigins: input.allowedOrigins,
        // El cast es el mismo precio que paga source.service.ts con
        // fieldMapping: InputJsonValue exige una firma de índice que
        // Record<string, unknown> no declara, aunque cualquier objeto JSON la
        // cumple. Zod ya garantizó que es un objeto plano.
        guardrails: input.guardrails as Prisma.InputJsonValue,
        guardrailsText: input.guardrailsText,
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      tx,
    );
  });
}

// SIN branchId: un Agent NO cambia de sucursal, y es una decisión, no un
// olvido — misma regla que Resource.
//
// Cada Conversation lleva su propio branchId denormalizado desde el agente
// (comentario del schema). Mover el agente dejaría a todas sus conversaciones
// históricas apuntando a una sucursal distinta de la del agente que las
// atendió, y la bandeja por sucursal de §5 las mostraría en el lugar
// equivocado. El camino honesto es crear el agente en la sucursal nueva y
// desactivar o borrar el viejo.
export interface UpdateAgentInput {
  name?: string;
  goal?: string | null;
  instructions?: string;
  tone?: string | null;
  modelProvider?: string;
  modelName?: string;
  enabledTools?: string[];
  channels?: ConversationChannel[];
  // Los dos o ninguno: updateAgentSchema lo exige en el borde (agent.controller.ts).
  guardrails?: Record<string, unknown>;
  guardrailsText?: string;
  allowedOrigins?: string[];
  whatsappPhoneNumberId?: string | null;
  isActive?: boolean;
}

// Las tres claves de guardrails que la pantalla YA NO PUEDE ESCRIBIR desde el
// ítem 72 (ver CLAVES_QUE_YA_NO_SE_TRADUCEN en
// agentGuardrailsTranslation.service.ts) pero que los agentes viejos pueden
// tener guardadas, y que armarSystemPrompt() sigue leyendo igual que siempre.
const CLAVES_HEREDADAS = [
  "temasProhibidos",
  "promesasProhibidas",
  "condicionesDeDerivacion",
] as const;

// POR QUÉ ESTA FUSIÓN EXISTE. El formulario manda SIEMPRE el objeto completo
// de guardrails en el PATCH, sin diferenciar qué cambió — así que un ADMIN que
// abre un agente viejo para corregirle el Nombre, sin tocar las Reglas del
// agente para nada, manda igual un `guardrails` nuevo. Y desde el ítem 72 ese
// objeto nuevo solo puede tener las tres claves que son un candado de código.
// Guardarlo tal cual le BORRARÍA en silencio a ese agente los temas
// prohibidos, las promesas prohibidas y las condiciones de derivación que
// tenía configuradas, que es exactamente lo contrario de la decisión tomada:
// los agentes existentes quedan como están, no se migran.
//
// Por eso las tres claves heredadas se toman SIEMPRE de la fila actual y nunca
// del input: no hay ningún camino por el que un guardado posterior pueda
// pisarlas ni vaciarlas. Todo lo demás es lo que vino en el PATCH.
export function preservarGuardrailsHeredados(
  actuales: unknown,
  nuevos: Record<string, unknown>,
): Record<string, unknown> {
  if (!actuales || typeof actuales !== "object" || Array.isArray(actuales)) {
    return nuevos;
  }

  const previos = actuales as Record<string, unknown>;
  const fusionados: Record<string, unknown> = { ...nuevos };
  for (const clave of CLAVES_HEREDADAS) {
    // `undefined` no se copia: una clave que el agente nunca tuvo no tiene que
    // aparecer como presente-y-vacía en el objeto guardado.
    if (previos[clave] !== undefined) {
      fusionados[clave] = previos[clave];
    }
  }
  return fusionados;
}

export async function updateAgent(organizationId: string, id: string, input: UpdateAgentInput) {
  // El agente actual, que ya se lee acá para el 404, es también de dónde salen
  // los guardrails heredados: no hace falta otra consulta.
  const actual = await getAgentById(organizationId, id);

  // El mismo número que ya tiene (el formulario lo reenvía) pasa y no se
  // escribe; otro es 403. Nunca llega al repositorio.
  const { guardrails, whatsappPhoneNumberId, modelProvider, modelName, ...resto } = input;
  assertNumeroDeWhatsappSinCambios(actual.whatsappPhoneNumberId, whatsappPhoneNumberId);
  // B-05: lo mismo con el modelo. El mismo que tiene pasa y no se escribe.
  assertModeloSinCambios(actual, { modelProvider, modelName });
  const result = await updateAgentRepo(id, organizationId, {
    ...resto,
    ...(guardrails !== undefined
      ? {
          guardrails: preservarGuardrailsHeredados(
            actual.guardrails,
            guardrails,
          ) as Prisma.InputJsonValue,
        }
      : {}),
  });
  if (result.count === 0) {
    throw new AppError("Agente no encontrado", 404);
  }

  return getAgentById(organizationId, id);
}

// PUT /api/admin/agents/:agentId/whatsapp-phone-number (ítem 127). Lo llama
// SOLO un platform admin (requirePlatformAdmin ya corrió): por eso busca el
// agente sin organización. 404 si no existe o está borrado; 409 si el número
// ya lo tiene otro agente, de cualquier organización; null lo libera.
//
// Sin tabla de auditoría: el repo no tiene un registro genérico de acciones de
// platform admin (las tablas de cambios del módulo QR son de ese módulo), así
// que queda una línea de log con quién, a qué agente, y de qué número a cuál.
export async function asignarNumeroDeWhatsapp(input: {
  agentId: string;
  whatsappPhoneNumberId: string | null;
  platformAdminUserId: string;
}) {
  const agente = await findAgentByIdForPlatformAdmin(input.agentId);
  if (!agente) {
    throw new AppError("Agente no encontrado", 404);
  }

  const result = await setAgentWhatsappPhoneNumberId(agente.id, input.whatsappPhoneNumberId).catch(
    traducirNumeroDeWhatsappDuplicado,
  );
  if (result.count === 0) {
    throw new AppError("Agente no encontrado", 404);
  }

  logger.info(
    {
      platformAdminUserId: input.platformAdminUserId,
      agentId: agente.id,
      organizationId: agente.organizationId,
      anterior: agente.whatsappPhoneNumberId,
      nuevo: input.whatsappPhoneNumberId,
    },
    "Número de WhatsApp de un agente asignado por platform admin",
  );

  return getAgentById(agente.organizationId, agente.id);
}

// PUT /api/admin/agents/:agentId/model (B-05). Lo llama SOLO un platform
// admin: busca el agente sin organización, 404 si no existe o está borrado.
// El nombre del modelo es libre, igual que antes (lo valida OpenRouter al
// usarlo): la decisión de qué modelo paga la plataforma es de quien la opera.
export async function asignarModeloDeAgente(input: {
  agentId: string;
  modelProvider: string;
  modelName: string;
  platformAdminUserId: string;
}) {
  const agente = await findAgentByIdForPlatformAdmin(input.agentId);
  if (!agente) {
    throw new AppError("Agente no encontrado", 404);
  }
  const result = await setAgentModel(agente.id, {
    modelProvider: input.modelProvider,
    modelName: input.modelName,
  });
  if (result.count === 0) {
    throw new AppError("Agente no encontrado", 404);
  }
  logger.info(
    {
      platformAdminUserId: input.platformAdminUserId,
      agentId: agente.id,
      organizationId: agente.organizationId,
      modelProvider: input.modelProvider,
      modelName: input.modelName,
    },
    "Modelo de IA de un agente asignado por platform admin",
  );
  return getAgentById(agente.organizationId, agente.id);
}

// ---------------------------------------------------------------------------
// LA PÁGINA DE FACEBOOK TAMBIÉN LA ASIGNA LA PLATAFORMA (ítem 169).
//
// Calco de asignarNumeroDeWhatsapp y por el mismo motivo: facebook_page_id es
// lo único que va a decir, en el webhook de Messenger/Instagram (ítem 171), de
// qué agente es un mensaje, y un page id no es secreto. A diferencia del
// número de WhatsApp, el CRUD del tenant ni siquiera acepta el campo: nació
// después del ítem 127, así que ningún formulario lo reenvía y el borde lo
// descarta sin más.
// ---------------------------------------------------------------------------

// agents.facebook_page_id es UNIQUE GLOBAL. Mismo criterio que
// traducirNumeroDeWhatsappDuplicado: solo un platform admin llega acá, y
// cualquier otro P2002 se relanza tal cual.
function traducirPaginaDeFacebookDuplicada(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = Array.isArray(err.meta?.target)
      ? err.meta.target.join(",")
      : String(err.meta?.target ?? "");
    if (target.includes("facebook_page_id")) {
      throw new AppError("Esa página de Facebook ya está asignada a otro agente", 409);
    }
  }
  throw err;
}

// PUT /api/admin/agents/:agentId/facebook-page (ítem 169). Mismo contrato que
// asignarNumeroDeWhatsapp: 404 si el agente no existe o está borrado; 409 si
// la página ya la tiene otro agente, de cualquier organización; null la
// libera; una línea de log con quién, a qué agente, y de qué página a cuál.
//
// Desde A-08 (docs-privados/auditoria-2026-09-30-corta.md, local), 409 también
// si la página no está conectada (conexión no REVOKED) en la organización del
// agente: un error de tipeo del platform admin mandaba los mensajes de los
// clientes de una organización a la bandeja de otra. El webhook exige lo mismo
// al recibir, por si la conexión cambia después de asignar.
export const MENSAJE_PAGINA_NO_CONECTADA_EN_LA_ORGANIZACION =
  "Esa página de Facebook no está conectada en la organización de este agente. Un ADMIN de la organización la tiene que conectar primero desde Configuración.";
export async function asignarPaginaDeFacebook(input: {
  agentId: string;
  facebookPageId: string | null;
  platformAdminUserId: string;
}) {
  const agente = await findAgentByIdForPlatformAdmin(input.agentId);
  if (!agente) {
    throw new AppError("Agente no encontrado", 404);
  }

  if (input.facebookPageId !== null) {
    const conexion = await findActiveMetaConnectionByPageId(input.facebookPageId);
    // El mismo 409 si no está conectada en ningún lado o si está conectada en
    // otra organización: al platform admin le alcanza con saber que no es de
    // esta, y no hace falta confirmar de quién es.
    if (!conexion || conexion.organizationId !== agente.organizationId) {
      throw new AppError(MENSAJE_PAGINA_NO_CONECTADA_EN_LA_ORGANIZACION, 409);
    }
  }

  const result = await setAgentFacebookPageId(agente.id, input.facebookPageId).catch(
    traducirPaginaDeFacebookDuplicada,
  );
  if (result.count === 0) {
    throw new AppError("Agente no encontrado", 404);
  }

  logger.info(
    {
      platformAdminUserId: input.platformAdminUserId,
      agentId: agente.id,
      organizationId: agente.organizationId,
      anterior: agente.facebookPageId,
      nuevo: input.facebookPageId,
    },
    "Página de Facebook de un agente asignada por platform admin",
  );

  return getAgentById(agente.organizationId, agente.id);
}

// Soft delete a secas: sin RESTRICT por conversaciones, y es una decisión.
// Conversation no tiene deletedAt (es historial, no configuración) y en 2a
// todavía no existe ningún camino que cree conversaciones. Cuando el loop de
// 2b las cree, la pregunta de qué pasa con las ACTIVAS de un agente borrado
// (cerrarlas, derivarlas a humano, bloquear el borrado) se decide ahí, con
// conversaciones reales enfrente — no acá, sobre hipótesis.
export async function deleteAgent(organizationId: string, id: string) {
  await getAgentById(organizationId, id);

  // En transacción con la revocación de sus tokens de embed (paso 5a), mismo
  // criterio que deleteSource con sus api_keys: dar de baja un agente tiene
  // que matar sus credenciales, no dejarlas vivas esperando a que el endpoint
  // público se acuerde de chequear deletedAt. La invariante vive en los datos.
  await prisma.$transaction(async (tx) => {
    const result = await softDeleteAgent(id, organizationId, tx);
    if (result.count === 0) {
      throw new AppError("Agente no encontrado", 404);
    }
    await revokeEmbedTokensByAgent(id, organizationId, tx);
  });
}
