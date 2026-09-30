import {
  countInternalAgentMessages,
  findInternalAgentByOrganization,
  findInternalAgentMessages,
  setInternalAgentModel,
  upsertInternalAgent,
  type InternalAgentConfigData,
} from "../repositories/internalAgent.repository";
import { logger } from "../lib/logger";
import { AppError } from "../utils/AppError";
import { assertModeloSinCambios, modeloPorDefecto } from "./modeloDeIa.service";
import { MENSAJE_SIN_AGENTE_INTERNO } from "./internalAgentOrchestration.service";

// ---------------------------------------------------------------------------
// Configuración e historial del agente de IA interno (ítem 179). El turno en
// sí vive en internalAgentOrchestration.service.ts.
// ---------------------------------------------------------------------------

async function requireInternalAgent(organizationId: string) {
  const agente = await findInternalAgentByOrganization(organizationId);
  if (!agente) {
    throw new AppError(MENSAJE_SIN_AGENTE_INTERNO, 404);
  }
  return agente;
}

export function getInternalAgent(organizationId: string) {
  return requireInternalAgent(organizationId);
}

// Registro único por organización: el PUT crea la primera vez y reemplaza
// después. No hay DELETE — no hay nada que dar de baja; un agente sin tools
// habilitadas solo conversa.
//
// B-05: el modelo no lo elige el tenant. La primera vez nace con el de la
// plataforma; después conserva el suyo. Un pedido con otro modelo es 403.
export async function putInternalAgent(
  organizationId: string,
  data: Omit<InternalAgentConfigData, "modelProvider" | "modelName"> &
    Partial<Pick<InternalAgentConfigData, "modelProvider" | "modelName">>,
) {
  const existente = await findInternalAgentByOrganization(organizationId);
  const modelo = existente
    ? { modelProvider: existente.modelProvider, modelName: existente.modelName }
    : modeloPorDefecto();
  assertModeloSinCambios(modelo, data);
  return upsertInternalAgent(organizationId, {
    name: data.name,
    instructions: data.instructions,
    enabledTools: data.enabledTools,
    ...modelo,
  });
}

// PUT /api/admin/organizations/:organizationId/internal-agent/model (B-05):
// el platform admin cambia el modelo del agente interno de una organización.
// 404 si la organización todavía no lo configuró (no hay nada que cambiar).
export async function asignarModeloDeAgenteInterno(input: {
  organizationId: string;
  modelProvider: string;
  modelName: string;
  platformAdminUserId: string;
}) {
  const result = await setInternalAgentModel(input.organizationId, {
    modelProvider: input.modelProvider,
    modelName: input.modelName,
  });
  if (result.count === 0) {
    throw new AppError(MENSAJE_SIN_AGENTE_INTERNO, 404);
  }
  logger.info(
    {
      platformAdminUserId: input.platformAdminUserId,
      organizationId: input.organizationId,
      modelProvider: input.modelProvider,
      modelName: input.modelName,
    },
    "Modelo de IA del agente interno asignado por platform admin",
  );
  return requireInternalAgent(input.organizationId);
}

export interface ListInternalAgentMessagesParams {
  page: number;
  pageSize: number;
}

// El hilo de QUIEN PREGUNTA, y de nadie más: el userId sale de req.auth, no
// de un parámetro. Ni un ADMIN lee el hilo de otro por acá.
//
// agentName (ítem 180) viaja acá porque el chat lo muestra en su encabezado y
// un USER habilitado no puede leer GET /internal-agent (ADMIN-only, por las
// instructions). El nombre no es sensible; el resto de la configuración sí
// queda afuera.
export async function listInternalAgentMessages(
  organizationId: string,
  userId: string,
  params: ListInternalAgentMessagesParams,
) {
  const agente = await requireInternalAgent(organizationId);
  const skip = (params.page - 1) * params.pageSize;

  const [data, total] = await Promise.all([
    findInternalAgentMessages(organizationId, agente.id, userId, {
      skip,
      take: params.pageSize,
    }),
    countInternalAgentMessages(organizationId, agente.id, userId),
  ]);

  return {
    agentName: agente.name,
    data,
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / params.pageSize),
    },
  };
}
