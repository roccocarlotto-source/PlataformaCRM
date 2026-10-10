import type { MeResponse } from "../../auth/AuthContext";
import type { Conversation } from "./types";

// Quién atiende una conversación desde el CRM (I-03): responder, reintentar un
// envío y devolverla al agente. El vendedor asignado o cualquier ADMIN
// (decisión de Rocco). Solo decide qué se muestra: el backend vuelve a
// decidirlo en cada request (puedeAtenderLaConversacion, 403).
export function puedeAtender(
  me: Pick<MeResponse, "id" | "role"> | null | undefined,
  conversation: Pick<Conversation, "assignedUserId">,
): boolean {
  if (!me) return false;
  // R12: Recepción atiende cualquier conversación, asignada o no (backend:
  // atender_cualquier_conversacion, src/services/permisos.ts).
  return me.role === "ADMIN" || me.role === "RECEPCION" || conversation.assignedUserId === me.id;
}
