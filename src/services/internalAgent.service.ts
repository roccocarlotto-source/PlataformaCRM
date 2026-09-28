import {
  countInternalAgentMessages,
  findInternalAgentByOrganization,
  findInternalAgentMessages,
  upsertInternalAgent,
  type InternalAgentConfigData,
} from "../repositories/internalAgent.repository";
import { AppError } from "../utils/AppError";
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
export function putInternalAgent(organizationId: string, data: InternalAgentConfigData) {
  return upsertInternalAgent(organizationId, data);
}

export interface ListInternalAgentMessagesParams {
  page: number;
  pageSize: number;
}

// El hilo de QUIEN PREGUNTA, y de nadie más: el userId sale de req.auth, no
// de un parámetro. Ni un ADMIN lee el hilo de otro por acá.
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
    data,
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / params.pageSize),
    },
  };
}
