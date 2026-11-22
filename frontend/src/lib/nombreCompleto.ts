// El nombre completo de un contacto, como se muestra en cualquier pantalla:
// nombre y apellido, sin espacios de más. En una clínica el apellido es
// opcional y se guarda vacío (ISSUE-028), así que "Gabi" + "" tiene que ser
// "Gabi" y no "Gabi " (que en un texto armado deja dos espacios seguidos).
export function nombreCompleto(contacto: { firstName: string; lastName?: string | null }): string {
  return `${contacto.firstName} ${contacto.lastName ?? ""}`.trim();
}
