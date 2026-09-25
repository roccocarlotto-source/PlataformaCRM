import { createHash } from "node:crypto";
import type { ConversationChannel } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { createContact } from "../repositories/contact.repository";
import {
  createConversation,
  findConversationByExternalThreadId,
} from "../repositories/conversation.repository";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";

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
// findOpenConversation. Para un sessionId que ya tiene historia, quien decide
// si hace falta una Conversation nueva es runAgentTurn
// (findOrCreateOpenConversation), con el contactId que sale de acá.
//
// SERIALIZADO POR ORGANIZACIÓN (ítem 126 de
// docs/auditoria-2026-09-24-punta-a-punta.md, B-03), con el mismo lock que
// whatsappContact.service.ts. Un doble submit del primer mensaje de una
// sesión nueva corría dos veces el buscar-o-crear en paralelo: los dos veían
// "no hay conversación con este sessionId" y creaban dos Contacts "Visitante".
//
// EL LOCK SOLO NO ALCANZABA, y por eso el placeholder nace CON su
// conversación, en la misma transacción: lo que ata el sessionId al contacto
// es la Conversation, no el Contact. Si la transacción creara solo el Contact
// y la conversación la creara después runAgentTurn, el segundo request
// tomaría el lock, seguiría sin ver ninguna conversación con ese sessionId, y
// crearía otro contacto igual. Con la conversación adentro, el segundo la
// encuentra y reusa el contacto.
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
  // El atajo del caso común (una sesión que ya escribió antes), sin lock.
  const previa = await findConversationByExternalThreadId(
    organizationId,
    agentId,
    channel,
    sessionId,
  );
  if (previa) {
    return previa.contactId;
  }

  return prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(organizationId, tx);

    // Releído bajo el lock: es la lectura que el lock protege.
    const ganadora = await findConversationByExternalThreadId(
      organizationId,
      agentId,
      channel,
      sessionId,
      tx,
    );
    if (ganadora) {
      return ganadora.contactId;
    }

    const contacto = await createContact(
      {
        organizationId,
        companyId: null,
        // Sin vendedor: nadie lo asignó todavía. Es la limitación documentada
        // del paso 4 (derivación silenciosa hasta que exista un "vendedor por
        // defecto" por sucursal) y del paso 2b (create_opportunity falla con
        // un error claro si el contacto no tiene ownerId).
        ownerId: null,
        firstName: WIDGET_CONTACT_FIRST_NAME,
        lastName: widgetContactLastName(sessionId),
        source: WIDGET_CONTACT_SOURCE,
      },
      tx,
    );
    // La conversación que ata el sessionId al contacto (ver el encabezado).
    // branchId es la sucursal del agente, la misma que runAgentTurn le daría:
    // cuando el turno la busque, findOrCreateOpenConversation la encuentra
    // abierta y la usa.
    await createConversation(
      {
        organizationId,
        branchId,
        agentId,
        contactId: contacto.id,
        channel,
        externalThreadId: sessionId,
      },
      tx,
    );
    return contacto.id;
  });
}
