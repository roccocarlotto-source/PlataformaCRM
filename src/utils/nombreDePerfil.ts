// firstName/lastName son VARCHAR(100).
export const MAX_LARGO_DE_NOMBRE = 100;

// El nombre de perfil que manda un canal (WhatsApp, Instagram), en texto
// libre, partido en nombre y apellido: "Juan Pérez García" -> Juan / Pérez
// García. La primera palabra es el nombre y el resto el apellido, que es lo
// menos malo que se puede hacer con un nombre en texto libre. Una sola
// palabra deja el apellido vacío —no se inventa uno—. Sin nombre, null: el
// provisorio lo decide cada canal.
export function partirNombreDePerfil(
  nombre: string | null | undefined,
): { firstName: string; lastName: string } | null {
  const palabras = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) {
    return null;
  }
  const [primera, ...resto] = palabras;
  return {
    firstName: primera.slice(0, MAX_LARGO_DE_NOMBRE),
    lastName: resto.join(" ").slice(0, MAX_LARGO_DE_NOMBRE),
  };
}
