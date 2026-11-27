import { MAX_LARGO_DE_NOMBRE, partirNombreDePerfil } from "../utils/nombreDePerfil";
import { enmascararBsuid, esBsuid } from "../utils/bsuid";
import { logger } from "../lib/logger";
import type { Db } from "../lib/prisma";
import {
  WHATSAPP_CONTACT_FALLBACK_FIRST_NAME,
  WHATSAPP_CONTACT_SOURCE,
  WHATSAPP_SIN_TELEFONO,
} from "../utils/nombreProvisorio";
import {
  createContact,
  findContactById,
  findContactIdByNormalizedPhone,
} from "../repositories/contact.repository";
import {
  createContactChannelIdentity,
  findContactIdByExternalIdentity,
  reassignContactChannelIdentity,
} from "../repositories/contactChannelIdentity.repository";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import { prisma } from "../lib/prisma";
import { normalizarTelefono, soloDigitos } from "../lib/telefono";

// ---------------------------------------------------------------------------
// El Contact de quien escribe por WhatsApp (ítem 81). Mismo papel que
// widgetContact.service.ts::resolveWidgetContact para el canal Web, con una
// diferencia de fondo: acá SÍ hay un dato real que identifica a la persona —su
// número de teléfono, el wa_id de Meta— así que en vez de un placeholder se
// busca primero un contacto existente de la organización con ese teléfono, y
// solo si no hay ninguno se crea uno con los datos que manda Meta.
//
// SERIALIZADO POR ORGANIZACIÓN: dos mensajes seguidos de un número nuevo
// pueden llegar en dos webhooks en paralelo, y sin lock los dos verían "no
// existe" y crearían dos contactos para la misma persona. El lock de la fila
// de la organización (mismo helper que ya usan otros services) cubre SOLO el
// buscar-o-crear, en una transacción corta: el turno del agente, que es lo
// lento, corre afuera.
// ---------------------------------------------------------------------------

// Las dos constantes viven en utils/nombreProvisorio.ts, junto a cómo se
// reconoce el marcador y qué fuentes traen el nombre del perfil; se reexportan
// para los que ya las importan de acá.
//   - WHATSAPP_CONTACT_SOURCE: lo que queda en Contact.source.
//   - WHATSAPP_CONTACT_FALLBACK_FIRST_NAME: el fallback cuando Meta no manda
//     profile.name (la persona no configuró nombre, o su privacidad lo oculta).
export { WHATSAPP_CONTACT_FALLBACK_FIRST_NAME, WHATSAPP_CONTACT_SOURCE };

// El nombre de perfil partido en nombre y apellido (partirNombreDePerfil).
// Sin nombre, "WhatsApp +<número>", para que el contacto sea reconocible en
// el listado.
export function nombreDelPerfil(
  profileName: string | undefined,
  digitos: string,
): { firstName: string; lastName: string } {
  return (
    partirNombreDePerfil(profileName) ?? {
      firstName: WHATSAPP_CONTACT_FALLBACK_FIRST_NAME,
      lastName: `+${digitos}`,
    }
  );
}

// PR0 (docs/mensajes-con-opciones.md §10.1): lo que Meta manda además del
// teléfono. `waId` es el remitente tal como lo leyó el webhook: los dígitos
// del teléfono o, si Meta no lo mandó, el BSUID.
export interface DatosDelRemitente {
  bsuid?: string;
  usuario?: string;
}

export async function resolveWhatsappContact(
  organizationId: string,
  waId: string,
  profileName: string | undefined,
  datos: DatosDelRemitente = {},
): Promise<string> {
  const sinTelefono = esBsuid(waId);
  const bsuid = datos.bsuid ?? (sinTelefono ? waId : undefined);
  if (!bsuid) {
    const digitos = soloDigitos(waId);
    return resolverContactoPorTelefono(organizationId, digitos, {
      ...nombreDelPerfil(profileName, digitos),
      source: WHATSAPP_CONTACT_SOURCE,
    });
  }
  return resolverContactoConBsuid(organizationId, {
    digitos: sinTelefono ? null : soloDigitos(waId),
    bsuid,
    profileName,
    usuario: datos.usuario,
  });
}

// D (Rocco, 2026-11-27): sin teléfono, el nombre del perfil; si no, el
// usuario ("@usuario", provisorio como el de Instagram); si no, "Contacto de
// WhatsApp" (provisorio).
export function nombreSinTelefono(
  profileName: string | undefined,
  usuario: string | undefined,
): { firstName: string; lastName: string } {
  const delPerfil = partirNombreDePerfil(profileName);
  if (delPerfil) return delPerfil;
  if (usuario?.trim()) {
    return { firstName: `@${usuario.trim()}`.slice(0, MAX_LARGO_DE_NOMBRE), lastName: "" };
  }
  return { ...WHATSAPP_SIN_TELEFONO };
}

// El orden: teléfono (como siempre) → BSUID → teléfono que quedó de una unión
// → contacto nuevo. Todo bajo el lock de la organización, como el alta por
// teléfono: dos entregas a la vez del mismo remitente nuevo no crean dos
// contactos.
async function resolverContactoConBsuid(
  organizationId: string,
  r: { digitos: string | null; bsuid: string; profileName?: string; usuario?: string },
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(organizationId, tx);

    if (r.digitos) {
      const porTelefono = await findContactIdByNormalizedPhone(organizationId, r.digitos, tx);
      if (porTelefono) {
        await atarBsuid(organizationId, r.bsuid, porTelefono, tx);
        return porTelefono;
      }
    }

    const porBsuid = await contactoVivoDeLaIdentidad(organizationId, r.bsuid, tx);
    if (porBsuid) {
      // Llegó sin teléfono y ahora Meta lo manda: se le guarda, porque nadie
      // más lo tiene (lo de arriba no encontró a nadie con ese teléfono).
      if (r.digitos) await guardarTelefonoSiFalta(organizationId, porBsuid, r.digitos, tx);
      return porBsuid;
    }

    if (r.digitos) {
      const porUnion = await contactoVivoDeLaIdentidad(organizationId, r.digitos, tx);
      if (porUnion) {
        await atarBsuid(organizationId, r.bsuid, porUnion, tx);
        return porUnion;
      }
    }

    const contacto = await createContact(
      {
        organizationId,
        companyId: null,
        ownerId: null,
        ...(r.digitos
          ? nombreDelPerfil(r.profileName, r.digitos)
          : nombreSinTelefono(r.profileName, r.usuario)),
        phone: r.digitos ? (normalizarTelefono(`+${r.digitos}`) ?? `+${r.digitos}`) : null,
        source: WHATSAPP_CONTACT_SOURCE,
        nameSetByChannel: true,
      },
      tx,
    );
    await atarBsuid(organizationId, r.bsuid, contacto.id, tx);
    return contacto.id;
  });
}

// El contacto de una identidad WHATSAPP (un BSUID, o los dígitos que dejó una
// unión), solo si sigue vivo.
async function contactoVivoDeLaIdentidad(
  organizationId: string,
  externalId: string,
  tx: Db,
): Promise<string | null> {
  const id = await findContactIdByExternalIdentity(
    { organizationId, channel: "WHATSAPP", externalId },
    tx,
  );
  return id && (await findContactById(id, organizationId, tx)) ? id : null;
}

// Deja el BSUID como identidad del contacto.
// - Ya era suyo: nada.
// - Era de un contacto dado de baja: pasa a este.
// - Es de OTRO contacto vivo: C (Rocco, 2026-11-27) — gana el teléfono, no se
//   mueve nada y queda un aviso para que una persona decida si los une. El log
//   no lleva el teléfono ni el BSUID completos.
async function atarBsuid(
  organizationId: string,
  bsuid: string,
  contactId: string,
  tx: Db,
): Promise<void> {
  const identidad = { organizationId, channel: "WHATSAPP" as const, externalId: bsuid };
  const actual = await findContactIdByExternalIdentity(identidad, tx);
  if (actual === contactId) return;
  if (actual === null) {
    await createContactChannelIdentity({ ...identidad, contactId }, tx);
    return;
  }
  if (!(await findContactById(actual, organizationId, tx))) {
    await reassignContactChannelIdentity({ ...identidad, contactId }, tx);
    return;
  }
  logger.warn(
    {
      organizationId,
      contactoDelTelefono: contactId,
      contactoDelBsuid: actual,
      bsuid: enmascararBsuid(bsuid),
    },
    "WhatsApp: el BSUID es de otro contacto que el del teléfono. Gana el teléfono; revisar si son la misma persona",
  );
}

async function guardarTelefonoSiFalta(
  organizationId: string,
  contactId: string,
  digitos: string,
  tx: Db,
): Promise<void> {
  await tx.contact.updateMany({
    where: { id: contactId, organizationId, phone: null },
    data: { phone: normalizarTelefono(`+${digitos}`) ?? `+${digitos}` },
  });
}

// Los mensajes de sistema de un cambio de identidad (whatsappWebhook.service.ts,
// leerCambioDeIdentidad): el BSUID nuevo queda en el mismo contacto, que se
// busca por el BSUID anterior o por el teléfono. El teléfono del contacto no
// se cambia solo: lo decide una persona. Si no se encuentra a nadie, no se
// crea nada: el próximo mensaje lo resuelve como siempre.
export async function aplicarCambioDeIdentidad(
  organizationId: string,
  cambio: {
    wamid: string;
    tipo: string;
    waIdAnterior?: string;
    bsuidAnterior?: string;
    waIdNuevo?: string;
    bsuidNuevo: string;
  },
): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(organizationId, tx);
    let contactId: string | null = null;
    if (cambio.bsuidAnterior) {
      contactId = await contactoVivoDeLaIdentidad(organizationId, cambio.bsuidAnterior, tx);
    }
    for (const telefono of [cambio.waIdAnterior, cambio.waIdNuevo]) {
      if (contactId || !telefono) continue;
      contactId = await findContactIdByNormalizedPhone(organizationId, soloDigitos(telefono), tx);
    }
    if (!contactId) return null;
    await atarBsuid(organizationId, cambio.bsuidNuevo, contactId, tx);
    logger.info(
      { organizationId, contactId, tipo: cambio.tipo, bsuid: enmascararBsuid(cambio.bsuidNuevo) },
      "WhatsApp: cambio de identidad del contacto",
    );
    return contactId;
  });
}

// El contacto con ese teléfono, o uno nuevo con los datos de `nuevo`. Lo
// comparten WhatsApp y las llamadas: el teléfono identifica a la misma persona.
export async function resolverContactoPorTelefono(
  organizationId: string,
  digitos: string,
  nuevo: { firstName: string; lastName: string; source: string },
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(organizationId, tx);
    const telefono = normalizarTelefono(`+${digitos}`) ?? `+${digitos}`;

    const existente = await findContactIdByNormalizedPhone(organizationId, digitos, tx);
    if (existente) {
      return existente;
    }

    // Un teléfono que ya no está en ningún contacto vivo porque se UNIÓ a otro
    // (contactMerge.service.ts): la unión lo dejó como identidad WHATSAPP del
    // que quedó. Solo si ese contacto sigue vivo.
    const porUnion = await findContactIdByExternalIdentity(
      { organizationId, channel: "WHATSAPP", externalId: digitos },
      tx,
    );
    if (porUnion && (await findContactById(porUnion, organizationId, tx))) {
      return porUnion;
    }

    const contacto = await createContact(
      {
        organizationId,
        companyId: null,
        // Sin vendedor, igual que el placeholder del widget: nadie lo asignó.
        // Quien lo resuelve, si hace falta, es resolverOwnerDelContacto
        // (vendedor por defecto de la sucursal) dentro de las tools del agente.
        ownerId: null,
        firstName: nuevo.firstName,
        lastName: nuevo.lastName,
        // "+" y solo dígitos: la forma única de Contact.phone (F5).
        phone: telefono,
        source: nuevo.source,
        // ISSUE-010: el nombre es el del perfil (o el provisorio): lo puso el
        // canal, y en una clínica el agente lo puede reemplazar una vez.
        nameSetByChannel: true,
      },
      tx,
    );
    return contacto.id;
  });
}

// B (Rocco, 2026-11-27): el destino de una plantilla (recordatorio, reseña,
// seguimientos). El teléfono del contacto, como siempre; si no tiene (llegó
// solo con su BSUID, PR0), su BSUID, al que Meta deja mandar plantillas desde
// julio de 2026. "" si no hay ninguno: el worker lo trata como hasta ahora a
// un contacto sin teléfono. `buscarBsuid` llega por las deps de cada worker
// (sin ella, como antes: solo el teléfono).
export async function destinoDeWhatsapp(
  phone: string | null,
  buscarBsuid?: () => Promise<string | null>,
): Promise<string> {
  const digitos = soloDigitos(phone ?? "");
  if (digitos !== "" || !buscarBsuid) return digitos;
  return (await buscarBsuid()) ?? "";
}

// El BSUID más reciente del contacto, o null.
export async function bsuidDelContacto(
  organizationId: string,
  contactId: string,
  db: Db = prisma,
): Promise<string | null> {
  const identidades = await db.contactChannelIdentity.findMany({
    where: { organizationId, contactId, channel: "WHATSAPP", externalId: { contains: "." } },
    orderBy: { createdAt: "desc" },
    select: { externalId: true },
  });
  return identidades.find((i) => esBsuid(i.externalId))?.externalId ?? null;
}
