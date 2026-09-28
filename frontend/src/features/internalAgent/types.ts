// Reconstruido desde el contrato real del backend del agente de IA interno
// (ítem 179): src/controllers/internalAgent.controller.ts,
// src/services/internalAgent.service.ts y los modelos InternalAgent /
// InternalAgentMessage de prisma/schema.prisma. No se agrega ningún campo que
// el backend no devuelva o no acepte.

// La configuración: un registro único por organización (singleton, sin lista).
export interface InternalAgent {
  id: string;
  organizationId: string;
  name: string;
  instructions: string;
  modelProvider: string;
  modelName: string;
  enabledTools: string[];
  createdAt: string;
  updatedAt: string;
}

// PUT /api/internal-agent: reemplazo completo. modelProvider/modelName/
// enabledTools tienen default en el backend; la pantalla los manda siempre
// salvo modelName vacío (ver InternalAgentSettingsPage).
export interface PutInternalAgentInput {
  name: string;
  instructions: string;
  modelProvider: string;
  modelName?: string;
  enabledTools: string[];
}

export type InternalAgentMessageSenderType = "USER" | "AGENT";

export interface InternalAgentMessage {
  id: string;
  organizationId: string;
  internalAgentId: string;
  userId: string;
  senderType: InternalAgentMessageSenderType;
  content: string;
  // Auditoría de las tools del turno (misma forma que Message.toolCalls). El
  // chat no la muestra: ver InternalAgentChatPage.
  toolCalls: unknown;
  createdAt: string;
}

// GET /api/internal-agent/messages: el hilo de quien pregunta, lo más nuevo
// primero. agentName va acá (ítem 180) porque un USER no puede leer la
// configuración y el chat lo muestra en el encabezado.
export interface InternalAgentMessageListResponse {
  agentName: string;
  data: InternalAgentMessage[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
