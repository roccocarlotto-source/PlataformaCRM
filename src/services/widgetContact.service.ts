import { createHash } from "node:crypto";
import { MessageDirection, type ConversationChannel, type Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { createContact } from "../repositories/contact.repository";
import {
  createConversation,
  findConversationByExternalThreadId,
} from "../repositories/conversation.repository";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import { AppError } from "../utils/AppError";

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

// ---------------------------------------------------------------------------
// Ítem 138 (B-10/F-05): tope de contactos NUEVOS por embed token y por hora.
//
// Cada sessionId desconocido crea un "Visitante <hash>", y el sessionId lo
// elige el navegador: un script que rota sessionId con el token público
// llenaba el CRM del cliente de contactos basura (con el cupo de 20/min por
// token, hasta 28.800 por día). Los limiters de rateLimit.ts cuentan
// MENSAJES; esto cuenta solo lo que cuesta un Contact, y por eso vive acá y
// no en la cadena de middlewares: recién adentro de la transacción, después
// de releer bajo el lock, se sabe si el sessionId de verdad es nuevo.
//
// Contador en memoria por embedTokenId, ventana fija de una hora — la misma
// política de store que los limiters de rateLimit.ts (se resetea en cada
// deploy y no se comparte entre instancias; ver el encabezado de ese
// archivo). Se eligió sobre un COUNT de Contact porque el Contact no guarda
// de qué token vino: contar por organización mezclaría los tokens de todos
// los sitios del cliente. El Map no crece sin control: tiene una entrada por
// token que creó contactos, y los tokens son pocos por organización.
//
// Al superarlo, 429 con el mismo mensaje que el resto de los cupos del
// widget, no un rechazo silencioso: el visitante ve "probá de nuevo". Un
// sessionId que YA tiene conversación no pasa por acá (atajo de arriba y
// relectura bajo el lock), así que las sesiones en curso siguen funcionando
// aunque el tope esté agotado.
//
// VALORES: 200 contactos nuevos por hora por token. Un sitio con tráfico real
// alto (más de 200 conversaciones nuevas por hora) lo va a tocar: se ajusta
// acá.
// ---------------------------------------------------------------------------
export const WIDGET_NEW_CONTACTS_WINDOW_MS = 60 * 60 * 1000;
export const WIDGET_NEW_CONTACTS_MAX = 200;

// Factory, mismo criterio que create*RateLimiter: los tests levantan un
// contador propio sin heredar el de la instancia de producción.
export function crearTopeDeContactosNuevos(overrides?: {
  windowMs?: number;
  max?: number;
  ahora?: () => number;
}) {
  const windowMs = overrides?.windowMs ?? WIDGET_NEW_CONTACTS_WINDOW_MS;
  const max = overrides?.max ?? WIDGET_NEW_CONTACTS_MAX;
  const ahora = overrides?.ahora ?? Date.now;
  const ventanas = new Map<string, { inicio: number; cantidad: number }>();

  // Cuenta un contacto nuevo para el token, o lanza 429 si ya no hay cupo. El
  // intento rechazado no suma: el cupo se libera al cerrar la ventana.
  return function consumir(embedTokenId: string): void {
    const t = ahora();
    let ventana = ventanas.get(embedTokenId);
    if (!ventana || t - ventana.inicio >= windowMs) {
      ventana = { inicio: t, cantidad: 0 };
      ventanas.set(embedTokenId, ventana);
    }
    if (ventana.cantidad >= max) {
      throw new AppError("Demasiados mensajes seguidos. Probá de nuevo en un momento.", 429);
    }
    ventana.cantidad += 1;
  };
}

const consumirCupoDeContactoNuevo = crearTopeDeContactosNuevos();

export async function resolveWidgetContact(
  organizationId: string,
  agentId: string,
  branchId: string,
  channel: ConversationChannel,
  sessionId: string,
  // Ítem 138: el token por el que entró el mensaje, para el tope de
  // contactos nuevos por hora.
  embedTokenId: string,
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

    // Recién acá: es el único punto donde se sabe que se va a crear un
    // Contact. Lanzar dentro de la transacción la revierte sin haber escrito
    // nada.
    consumirCupoDeContactoNuevo(embedTokenId);

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

// ---------------------------------------------------------------------------
// Ítem 138 (B-10/F-05): purga de los "Visitante" que nunca escribieron.
//
// El placeholder nace con su conversación ANTES de que runAgentTurn guarde el
// primer mensaje (ver el encabezado). Si el turno no llega a guardarlo —un
// 429, un agente que no opera en WEB, un script que abre sesiones sin
// escribir—, queda un Contact vacío en el CRM del cliente para siempre. Esto
// los encuentra y los da de baja.
//
// EL CRITERIO, y por qué cada parte:
//   - firstName = WIDGET_CONTACT_FIRST_NAME y source = WIDGET_CONTACT_SOURCE:
//     el placeholder que crea resolveWidgetContact y nada más. NO se usa
//     nombreEsUnMarcador de contact.service.ts aunque sea el criterio de
//     "nombre de marcador" del resto del código: hoy reconoce solo "" y
//     "WhatsApp", no "Visitante" (B-11 de la misma auditoría, abierto), y un
//     WhatsApp siempre tiene teléfono y mensajes.
//   - sin NINGÚN mensaje INBOUND en ninguna de sus conversaciones: la
//     definición de "el visitante nunca escribió". Los OUTBOUND no cuentan.
//   - sin email ni teléfono, y sin oportunidades, reservas ni actividades:
//     red de seguridad. Sin mensajes no debería tener nada de eso, pero una
//     persona de la organización puede haberlo cargado a mano sobre el
//     placeholder, y ahí ya no es basura.
//   - createdAt anterior al corte (DIAS_DE_GRACIA_VISITANTE_SIN_MENSAJES):
//     un placeholder recién creado puede estar esperando que su primer turno
//     termine.
//
// SOFT DELETE (deletedAt), no DELETE: es el patrón de Contact en todo el
// repo, deja sus conversaciones vacías con la FK intacta, y se revierte con
// un UPDATE si el criterio resultara equivocado.
//
// Esto NO corre solo: lo corre scripts/purge-widget-visitors.ts a mano (ver
// ese archivo).
// ---------------------------------------------------------------------------
export const DIAS_DE_GRACIA_VISITANTE_SIN_MENSAJES = 7;

export function fechaDeCorteDeVisitantes(ahora: Date = new Date()): Date {
  const corte = new Date(ahora);
  corte.setUTCDate(corte.getUTCDate() - DIAS_DE_GRACIA_VISITANTE_SIN_MENSAJES);
  return corte;
}

// organizationId OPCIONAL y el script nunca lo pasa, mismo motivo que
// PurgaScope en ingestionEvent.repository.ts: el test de integración corre
// contra una base que puede estar compartida y no puede tocar otras
// organizaciones.
export function buildVisitantesPurgablesWhere(
  corte: Date,
  scope: { organizationId?: string } = {},
): Prisma.ContactWhereInput {
  return {
    ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
    deletedAt: null,
    firstName: WIDGET_CONTACT_FIRST_NAME,
    source: WIDGET_CONTACT_SOURCE,
    email: null,
    phone: null,
    createdAt: { lt: corte },
    conversations: { none: { messages: { some: { direction: MessageDirection.INBOUND } } } },
    opportunities: { none: {} },
    bookings: { none: {} },
    activities: { none: {} },
  };
}

// Un único `where` para contar y para dar de baja: el --dry-run no puede
// contar una cosa y el borrado real hacer otra.
export function countVisitantesPurgables(corte: Date, scope: { organizationId?: string } = {}) {
  return prisma.contact.count({ where: buildVisitantesPurgablesWhere(corte, scope) });
}

export function purgeVisitantesSinMensajes(corte: Date, scope: { organizationId?: string } = {}) {
  return prisma.contact.updateMany({
    where: buildVisitantesPurgablesWhere(corte, scope),
    data: { deletedAt: new Date() },
  });
}
