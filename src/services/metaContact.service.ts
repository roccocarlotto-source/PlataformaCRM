import { ConversationChannel, Prisma } from "@prisma/client";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import {
  createContact,
  findContactById,
  replaceContactNameIfUnchanged,
} from "../repositories/contact.repository";
import {
  createContactChannelIdentity,
  findContactIdByExternalIdentity,
  reassignContactChannelIdentity,
} from "../repositories/contactChannelIdentity.repository";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import { META_CONTACT_FIRST_NAMES, PREFIJO_DEL_APELLIDO_DE_META } from "../utils/nombreProvisorio";
import { obtenerTokenParaEnviar } from "./metaPageConnection.service";
import {
  MetaProfileError,
  obtenerPerfilDeMetaReal,
  type ObtenerPerfilDeMeta,
} from "./metaProfile.service";

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
// EL NOMBRE DE PERFIL LLEGA DESPUÉS. WhatsApp recibe el nombre gratis en el
// propio payload; Messenger e Instagram no: conseguirlo exige una llamada
// aparte a la Graph API con el Page Access Token. Esa llamada NO va en el
// camino del webhook, que tiene que contestar en milisegundos (ítem 125): el
// contacto nuevo se crea con un nombre genérico reconocible ("Messenger
// …a1b2c3d4") y completarNombreDesdeElPerfil lo reemplaza por el real cuando
// Meta contesta, sin que nadie lo espere. Si Meta no lo da (falta el permiso,
// la persona no tiene perfil, se cortó la red), queda el genérico.
// ---------------------------------------------------------------------------

export type CanalMeta = typeof ConversationChannel.INSTAGRAM | typeof ConversationChannel.MESSENGER;

// Lo que queda en Contact.source, igual que WHATSAPP_CONTACT_SOURCE: el nombre
// del canal, el mismo que lleva el contacto genérico como nombre. Es una de
// las FUENTES_CON_NOMBRE_DE_PERFIL de utils/nombreProvisorio.ts.
export const META_CONTACT_SOURCE: Record<CanalMeta, string> = META_CONTACT_FIRST_NAMES;

// Cuántos caracteres del final del PSID/IGSID van en el apellido: los
// suficientes para distinguir dos contactos en el listado, sin volcar un id de
// 16+ dígitos que no le dice nada a nadie.
export const LARGO_DEL_SUFIJO = 8;

export function nombreGenerico(
  channel: CanalMeta,
  externalId: string,
): { firstName: string; lastName: string } {
  // La forma que reconoce esNombreProvisorio (utils/nombreProvisorio.ts).
  return {
    firstName: META_CONTACT_FIRST_NAMES[channel],
    lastName: `${PREFIJO_DEL_APELLIDO_DE_META}${externalId.slice(-LARGO_DEL_SUFIJO)}`,
  };
}

function esChoqueDeUnique(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export interface ContactoDeMeta {
  contactId: string;
  // true si esta llamada lo dio de alta (con el nombre genérico): es la señal
  // para ir a buscar el nombre del perfil. false si ya existía.
  creado: boolean;
}

export async function resolveMetaContact(
  organizationId: string,
  channel: CanalMeta,
  externalId: string,
): Promise<ContactoDeMeta> {
  const identidad = { organizationId, channel, externalId };

  try {
    return await prisma.$transaction(async (tx) => {
      await lockOrganizationForUpdate(organizationId, tx);

      const existente = await findContactIdByExternalIdentity(identidad, tx);
      // El contacto existe y está vivo: es él.
      if (existente && (await findContactById(existente, organizationId, tx))) {
        return { contactId: existente, creado: false };
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
      return { contactId: contacto.id, creado: true };
    });
  } catch (err) {
    // Otro webhook creó la identidad entre nuestra lectura y nuestro create.
    // La transacción se revirtió entera, Contact incluido; el ganador es el
    // que quedó. Se confirma releyendo para no confundir un P2002 de otra
    // tabla con esta carrera.
    if (esChoqueDeUnique(err)) {
      // El nombre del perfil lo busca el que lo creó.
      const ganador = await findContactIdByExternalIdentity(identidad);
      if (ganador) return { contactId: ganador, creado: false };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// El nombre real del contacto recién creado, desde su perfil de Messenger o
// Instagram (metaProfile.service.ts).
//
// NUNCA LANZA y nadie la espera: el webhook la dispara y sigue (ver
// metaWebhook.service.ts). Cualquier fallo —la conexión sin token, Meta que
// no da el permiso o tarda, la persona sin perfil— deja el nombre genérico y
// una línea de log con el motivo, sin datos de la persona.
//
// NO PISA UN NOMBRE CARGADO: el reemplazo exige en el WHERE que el contacto
// siga con el nombre genérico de ESTE id (replaceContactNameIfUnchanged). Si
// una persona lo editó o el agente lo anotó desde el chat mientras Meta
// contestaba, gana ese.
// ---------------------------------------------------------------------------

export interface CompletarNombreInput {
  organizationId: string;
  channel: CanalMeta;
  // El Page ID de la conexión, también para Instagram: es el dueño del token.
  pageId: string;
  // PSID (Messenger) o IGSID (Instagram).
  externalId: string;
  contactId: string;
}

export interface DepsDelNombreDeMeta {
  pageAccessToken: (organizationId: string, pageId: string) => Promise<string>;
  obtenerPerfil: ObtenerPerfilDeMeta;
}

export const depsDelNombreDeMetaReales: DepsDelNombreDeMeta = {
  pageAccessToken: obtenerTokenParaEnviar,
  obtenerPerfil: obtenerPerfilDeMetaReal,
};

export type ResultadoDelNombre = "completado" | "sin-perfil" | "ya-tenia-nombre" | "fallo";

export async function completarNombreDesdeElPerfil(
  entrada: CompletarNombreInput,
  deps: DepsDelNombreDeMeta = depsDelNombreDeMetaReales,
): Promise<ResultadoDelNombre> {
  const { organizationId, channel, pageId, externalId, contactId } = entrada;
  try {
    const pageAccessToken = await deps.pageAccessToken(organizationId, pageId);
    const perfil = await deps.obtenerPerfil({ pageAccessToken, channel, userId: externalId });
    if (!perfil) {
      // En Messenger es lo que pasa sin el acceso a "Business Asset User
      // Profile Access": Meta contesta 200 con solo el id.
      logger.info(
        { channel, contactId },
        "Meta no devolvió un nombre para el perfil: el contacto queda con el nombre genérico",
      );
      return "sin-perfil";
    }
    const { count } = await replaceContactNameIfUnchanged(
      contactId,
      organizationId,
      nombreGenerico(channel, externalId),
      perfil,
    );
    return count === 1 ? "completado" : "ya-tenia-nombre";
  } catch (err) {
    if (err instanceof MetaProfileError) {
      // Un rechazo de Meta (falta el permiso, la persona no tiene perfil): se
      // espera que pase seguido, así que va el código y no un stack por cada
      // contacto nuevo.
      logger.info(
        { channel, contactId, status: err.status, codigo: err.codigo, subcodigo: err.subcodigo },
        "Meta rechazó el pedido del perfil: el contacto queda con el nombre genérico",
      );
    } else {
      logger.warn(
        { err, channel, contactId },
        "No se pudo leer el nombre del perfil de Meta: el contacto queda con el nombre genérico",
      );
    }
    return "fallo";
  }
}
