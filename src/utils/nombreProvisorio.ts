// ---------------------------------------------------------------------------
// Los nombres que pone el CANAL cuando todavía no se sabe cómo se llama la
// persona, y cómo reconocerlos (OPUS-B-03 de
// docs-privados/auditoria-2026-10-04-OPUS.md y FABLE-B-10 de
// docs-privados/auditoria-2026-10-05-FABLE.md, locales).
//
//   - WhatsApp sin nombre de perfil: "WhatsApp" + el número.
//   - Widget web: "Visitante" + un identificador corto de la sesión.
//
// Un nombre provisorio NO es un nombre:
//   - el chat puede reemplazarlo cuando la persona dice cómo se llama (un
//     nombre que cargó un vendedor, en cambio, no se pisa desde el chat);
//   - no se le pasa al modelo como si fuera el nombre del cliente: antes el
//     agente saludaba "¡Hola, Visitante caa2c873!".
//
// El marcador del widget no se reconocía: todos los leads web quedaban como
// "Visitante xxxxxxxx" aunque la persona dijera su nombre.
//
// Las constantes viven acá, y no en el service de cada canal, para que quien
// decide sobre el nombre (contact.service, el prompt del agente) no tenga que
// importar el service de un canal.
// ---------------------------------------------------------------------------

export const WHATSAPP_CONTACT_FALLBACK_FIRST_NAME = "WhatsApp";
export const WIDGET_CONTACT_FIRST_NAME = "Visitante";

// El apellido que el widget le pone a su visitante: los primeros 8 caracteres
// en hexadecimal del hash de la sesión (widgetContactLastName). Se exige esa
// forma para no tratar como provisorio a un contacto que alguien cargó a mano
// con el nombre "Visitante" y un apellido de verdad.
const SUFIJO_DEL_VISITANTE = /^[0-9a-f]{8}$/;

export function esNombreProvisorio(contacto: {
  firstName: string;
  lastName: string | null;
}): boolean {
  const nombre = contacto.firstName.trim();
  if (nombre.length === 0 || nombre === WHATSAPP_CONTACT_FALLBACK_FIRST_NAME) {
    return true;
  }
  return nombre === WIDGET_CONTACT_FIRST_NAME && SUFIJO_DEL_VISITANTE.test(contacto.lastName ?? "");
}
