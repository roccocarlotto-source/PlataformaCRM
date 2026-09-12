import { createHash } from "node:crypto";
import type { ConversationChannel } from "@prisma/client";
import { createContact } from "../repositories/contact.repository";
import { findConversationByExternalThreadId } from "../repositories/conversation.repository";

// ---------------------------------------------------------------------------
// El Contact de un visitante anónimo del widget (paso 5b; nota del canal Web
// en §10 de docs/ai-agent-architecture.md, punto 4): un placeholder automático
// que se crea sin pedirle nada al visitante antes del primer mensaje, y que
// se REENCUENTRA por el sessionId que el navegador genera y guarda
// (crypto.randomUUID() en localStorage) y manda en cada mensaje.
//
// La unión sessionId -> Contact no es una tabla propia: es
// Conversation.externalThreadId. Toda conversación de este agente por este
// canal con ese sessionId cuelga del mismo Contact, así que basta con buscar
// cualquiera de ellas — incluidas las CLOSED, a diferencia de
// findOpenConversation. Quien decide si hace falta una Conversation nueva es
// runAgentTurn (findOpenConversation/createConversation), con el contactId
// que sale de acá.
//
// LIMITACIÓN CONOCIDA Y ACEPTADA: sin localStorage, o desde otro dispositivo,
// es un Contact nuevo. No hay fusión con un Contact existente aunque el
// visitante dé después el mismo email: create_lead/update_lead completan los
// datos sobre ESTE placeholder, no lo reemplazan.
// ---------------------------------------------------------------------------

export const WIDGET_CONTACT_FIRST_NAME = "Visitante";
export const WIDGET_CONTACT_SOURCE = "Widget web";

// Un identificador corto y estable derivado del sessionId, para que dos
// visitantes no se vean idénticos en el listado de Contacts ("Visitante
// a3f9c210" en vez de "Visitante Visitante"). Es cosmético, no criptográfico:
// se hashea solo para que el sessionId crudo —que el visitante eligió, o
// que un script pudo haber elegido por él— no termine tal cual en el nombre
// de un contacto, y para que tenga siempre el mismo largo.
export function widgetContactLastName(sessionId: string): string {
  return createHash("sha256").update(sessionId, "utf8").digest("hex").slice(0, 8);
}

export async function resolveWidgetContact(
  organizationId: string,
  agentId: string,
  branchId: string,
  channel: ConversationChannel,
  sessionId: string,
): Promise<string> {
  const previa = await findConversationByExternalThreadId(
    organizationId,
    agentId,
    channel,
    sessionId,
  );
  if (previa) {
    return previa.contactId;
  }

  // branchId no es columna de Contact (un contacto es de la organización, no
  // de una sucursal); se recibe para que la firma diga de qué agente/sucursal
  // viene el visitante y por si algún día el placeholder quiere anotarlo. Hoy
  // la sucursal queda registrada en la Conversation, que sí la tiene.
  void branchId;

  const contacto = await createContact({
    organizationId,
    companyId: null,
    // Sin vendedor: nadie lo asignó todavía. Es la limitación documentada del
    // paso 4 (derivación silenciosa hasta que exista un "vendedor por
    // defecto" por sucursal) y del paso 2b (create_opportunity falla con un
    // error claro si el contacto no tiene ownerId).
    ownerId: null,
    firstName: WIDGET_CONTACT_FIRST_NAME,
    lastName: widgetContactLastName(sessionId),
    source: WIDGET_CONTACT_SOURCE,
  });

  return contacto.id;
}
