import type { ConversationChannel } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// ContactChannelIdentity — acceso a datos (ítem 169, paso 1 de 5 de los
// canales de Meta). Ver el modelo en schema.prisma.
//
// El PSID/IGSID de un contacto en Instagram o Messenger, que no es un
// teléfono. WhatsApp NO pasa por acá: sigue resolviendo por Contact.phone
// (resolveWhatsappContact). Nada llama todavía a estas funciones: las usa el
// webhook del ítem 171.
//
// SIN deletedAt en ningún WHERE: la tabla no tiene soft delete. Una identidad
// es un hecho ("este PSID es este contacto"), no configuración.
// ---------------------------------------------------------------------------

export interface IdentidadExterna {
  organizationId: string;
  channel: ConversationChannel;
  // El PSID o IGSID tal cual lo manda Meta.
  externalId: string;
}

// A qué contacto corresponde un id externo, o null si todavía no se vio.
//
// Devuelve el contactId aunque ese Contact esté dado de baja (soft delete), a
// propósito: la identidad sigue ocupando su lugar en el UNIQUE, así que
// "ignorarla" y crear un contacto nuevo chocaría con P2002 igual. Qué hacer con
// un contacto borrado que vuelve a escribir lo decide el webhook (ítem 171),
// con el dato completo, y no este repositorio escondiéndolo.
export function findContactIdByExternalIdentity(
  identidad: IdentidadExterna,
  db: Db = prisma,
): Promise<string | null> {
  return db.contactChannelIdentity
    .findUnique({
      where: {
        organizationId_channel_externalId: {
          organizationId: identidad.organizationId,
          channel: identidad.channel,
          externalId: identidad.externalId,
        },
      },
      select: { contactId: true },
    })
    .then((fila) => fila?.contactId ?? null);
}

// Registra la identidad de un contacto recién creado.
//
// UN create Y NO UN upsert, y es deliberado: la carrera real no es sobre esta
// fila sino sobre el Contact que se crea junto con ella. Si dos webhooks del
// mismo contacto nuevo corren a la vez, los dos crean un Contact; el UNIQUE
// (organization_id, channel, external_id) hace que el SEGUNDO create de acá
// sea P2002, y el caller —que tiene que llamar a esto EN LA MISMA transacción
// que el create del Contact— revierte su Contact entero y relee con
// findContactIdByExternalIdentity. Un upsert "resolvería" el choque en
// silencio y dejaría el segundo Contact huérfano, que es exactamente el
// duplicado que este UNIQUE existe para impedir. Mismo patrón que
// conversations_open_unique en registrarEntrante.
export function createContactChannelIdentity(
  data: IdentidadExterna & { contactId: string },
  db: Db = prisma,
) {
  return db.contactChannelIdentity.create({ data });
}
