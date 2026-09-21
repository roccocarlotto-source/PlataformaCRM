import { createContact, findContactIdByNormalizedPhone } from "../repositories/contact.repository";
import { lockOrganizationForUpdate } from "../repositories/organization.repository";
import { prisma } from "../lib/prisma";

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

export const WHATSAPP_CONTACT_SOURCE = "WhatsApp";

// El fallback cuando Meta no manda profile.name (la persona no configuró
// nombre, o su privacidad lo oculta).
export const WHATSAPP_CONTACT_FALLBACK_FIRST_NAME = "WhatsApp";

// firstName/lastName son VARCHAR(100).
const MAX_NOMBRE = 100;

// Solo dígitos. El wa_id de Meta ya viene así (sin "+"), pero se normaliza
// igual: es el MISMO criterio con el que se compara contra Contact.phone
// (findContactIdByNormalizedPhone), y los dos lados tienen que coincidir.
export function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

// "Juan Pérez García" -> Juan / Pérez García: la primera palabra es el nombre
// y el resto el apellido, que es lo menos malo que se puede hacer con un
// nombre de perfil en texto libre. Una sola palabra deja el apellido vacío —
// no se inventa uno. Sin nombre, "WhatsApp +<número>", para que el contacto
// sea reconocible en el listado.
export function nombreDelPerfil(
  profileName: string | undefined,
  digitos: string,
): { firstName: string; lastName: string } {
  const palabras = (profileName ?? "").trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) {
    return { firstName: WHATSAPP_CONTACT_FALLBACK_FIRST_NAME, lastName: `+${digitos}` };
  }
  const [primera, ...resto] = palabras;
  return {
    firstName: primera.slice(0, MAX_NOMBRE),
    lastName: resto.join(" ").slice(0, MAX_NOMBRE),
  };
}

export async function resolveWhatsappContact(
  organizationId: string,
  waId: string,
  profileName: string | undefined,
): Promise<string> {
  const digitos = soloDigitos(waId);

  return prisma.$transaction(async (tx) => {
    await lockOrganizationForUpdate(organizationId, tx);

    const existente = await findContactIdByNormalizedPhone(organizationId, digitos, tx);
    if (existente) {
      return existente;
    }

    const { firstName, lastName } = nombreDelPerfil(profileName, digitos);
    const contacto = await createContact(
      {
        organizationId,
        companyId: null,
        // Sin vendedor, igual que el placeholder del widget: nadie lo asignó.
        // Quien lo resuelve, si hace falta, es resolverOwnerDelContacto
        // (vendedor por defecto de la sucursal) dentro de las tools del agente.
        ownerId: null,
        firstName,
        lastName,
        // Con "+" adelante: es la forma en la que Contact.phone se guarda en
        // el resto del sistema (+598XXXXXXXXX, sin separadores).
        phone: `+${digitos}`,
        source: WHATSAPP_CONTACT_SOURCE,
      },
      tx,
    );
    return contacto.id;
  });
}
