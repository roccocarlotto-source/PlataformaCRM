// ---------------------------------------------------------------------------
// Las piezas del vocabulario por rubro (docs/rubros.md §3), aparte de
// vocabulario.ts para que src/clinicas/config/rubro.ts las use sin un import
// circular (vocabulario.ts importa el de clínicas).
// ---------------------------------------------------------------------------

/** Una palabra en sus cuatro formas: la pantalla no la flexiona. */
export interface Termino {
  singular: string;
  plural: string;
  singularTitulo: string;
  pluralTitulo: string;
}

export interface Vocabulario {
  // El nombre del producto (§0.3): la configuración de marca, que el frontend
  // lee de acá (R17). Hoy es una sola para los dos rubros.
  marca: string;
  // A quién atiende el negocio: Contact.
  contacto: Termino;
  // Resource: quién o qué se reserva.
  recurso: Termino;
  // ServiceType.
  tipoDeServicio: Termino;
  // Booking.
  reserva: Termino;
  // La vista de calendario de las reservas.
  agenda: Termino;
  // Branch.defaultOwnerId: a quién se le asigna lo que entra.
  responsable: Termino;
}

/** Arma las cuatro formas desde el singular y el plural en minúscula. */
export function termino(singular: string, plural: string): Termino {
  const titulo = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);
  return { singular, plural, singularTitulo: titulo(singular), pluralTitulo: titulo(plural) };
}

export const MARCA = "Plataforma CRM";
