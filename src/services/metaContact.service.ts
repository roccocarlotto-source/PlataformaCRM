import { ConversationChannel, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { createContact, findContactById } from "../repositories/contact.repository";
import {
  createContactChannelIdentity,
  findContactIdByExternalIdentity,
  reassignContactChannelIdentity,
} from "../repositories/contactChannelIdentity.repository";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";

// ---------------------------------------------------------------------------
// El Contact de quien escribe por Messenger o Instagram (ítem 171, paso 3 de 5
// de los canales de Meta). El calco de whatsappContact.service.ts con UNA
// diferencia de fondo: acá no hay teléfono. Meta identifica a la persona por
// un id propio de la página (PSID en Messenger, IGSID en Instagram), que se
// guarda en ContactChannelIdentity y se busca por igualdad exacta.
//
// SERIALIZADO POR ORGANIZACIÓN, igual que WhatsApp: el lock de la fila de la
// organización cubre el buscar-o-crear en una transacción corta, para que dos
// webhooks en paralelo del mismo remitente nuevo no vean los dos "no existe".
// Pero acá el lock es la defensa del caso común, NO la garantía: la garantía
// es el UNIQUE (organization_id, channel, external_id) de la identidad. Si
// algo se le escapa al lock, el segundo create de la identidad es P2002, su
// transacción se revierte ENTERA (Contact incluido, por eso los dos van en la
// misma) y se relee — el contrato que documenta createContactChannelIdentity.
//
// SIN NOMBRE DE PERFIL, SIMPLIFICACIÓN DELIBERADA. WhatsApp recibe el nombre
// gratis en el propio payload; Messenger e Instagram no: conseguirlo exige una
// llamada aparte a la Graph API con el Page Access Token. Sumarla al camino
// del webhook —que tiene que contestar en milisegundos (ítem 125)— no entra en
// el alcance de este ítem, así que el contacto nuevo se crea con un nombre
// genérico reconocible ("Messenger …a1b2c3d4"). Si hace falta el nombre real,
// es una vuelta aparte (idealmente en el worker, fuera del camino caliente).
// Mismo criterio que "una sola página por organización" del ítem 170.
// ---------------------------------------------------------------------------

export type CanalMeta = typeof ConversationChannel.INSTAGRAM | typeof ConversationChannel.MESSENGER;

// Lo que queda en Contact.source, igual que WHATSAPP_CONTACT_SOURCE.
export const META_CONTACT_SOURCE: Record<CanalMeta, string> = {
  INSTAGRAM: "Instagram",
  MESSENGER: "Messenger",
};

// Cuántos caracteres del final del PSID/IGSID van en el apellido: los
// suficientes para distinguir dos contactos en el listado, sin volcar un id de
// 16+ dígitos que no le dice nada a nadie.
export const LARGO_DEL_SUFIJO = 8;

export function nombreGenerico(
  channel: CanalMeta,
  externalId: string,
): { firstName: string; lastName: string } {
  return {
    firstName: META_CONTACT_SOURCE[channel],
    lastName: `…${externalId.slice(-LARGO_DEL_SUFIJO)}`,
  };
}

function esChoqueDeUnique(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function resolveMetaContact(
  organizationId: string,
  channel: CanalMeta,
  externalId: string,
): Promise<string> {
  const identidad = { organizationId, channel, externalId };

  try {
    return await prisma.$transaction(async (tx) => {
      await lockOrganizationForUpdate(organizationId, tx);

      const existente = await findContactIdByExternalIdentity(identidad, tx);
      // El contacto existe y está vivo: es él.
      if (existente && (await findContactById(existente, organizationId, tx))) {
        return existente;
      }

      const contacto = await createContact(
        {
          organizationId,
          companyId: null,
          // Sin vendedor, igual que WhatsApp: lo resuelve, si hace falta,
          // resolverOwnerDelContacto dentro de las tools del agente.
          ownerId: null,
          ...nombreGenerico(channel, externalId),
          source: META_CONTACT_SOURCE[channel],
        },
        tx,
      );

      // La identidad ya existía pero su contacto se dio de baja: la persona
      // vuelve a escribir y se la atiende con un contacto nuevo, mismo
      // resultado que WhatsApp (que no encuentra el teléfono de un borrado y
      // crea otro). No se "resucita" el borrado: darlo de baja fue una
      // decisión de alguien.
      if (existente) {
        await reassignContactChannelIdentity({ ...identidad, contactId: contacto.id }, tx);
      } else {
        await createContactChannelIdentity({ ...identidad, contactId: contacto.id }, tx);
      }
      return contacto.id;
    });
  } catch (err) {
    // Otro webhook creó la identidad entre nuestra lectura y nuestro create.
    // La transacción se revirtió entera, Contact incluido; el ganador es el
    // que quedó. Se confirma releyendo para no confundir un P2002 de otra
    // tabla con esta carrera.
    if (esChoqueDeUnique(err)) {
      const ganador = await findContactIdByExternalIdentity(identidad);
      if (ganador) return ganador;
    }
    throw err;
  }
}
