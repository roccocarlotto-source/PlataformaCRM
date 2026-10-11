// ---------------------------------------------------------------------------
// Las piezas del vocabulario por rubro (docs/rubros.md §3), aparte de
// vocabulario.ts para que src/clinicas/config/rubro.ts las use sin un import
// circular (vocabulario.ts importa el de clínicas).
// ---------------------------------------------------------------------------

export type Genero = "masculino" | "femenino";

/** Una palabra en sus cuatro formas: la pantalla no la flexiona. El género
 *  (R17) es para el artículo: "la reserva" pero "el turno". */
export interface Termino {
  singular: string;
  plural: string;
  singularTitulo: string;
  pluralTitulo: string;
  genero: Genero;
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
  // Branch (R17): "sucursal" en una automotora, "sede" en una clínica.
  sucursal: Termino;
}

/** Arma las cuatro formas desde el singular y el plural en minúscula. */
export function termino(singular: string, plural: string, genero: Genero = "masculino"): Termino {
  const titulo = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);
  return {
    singular,
    plural,
    singularTitulo: titulo(singular),
    pluralTitulo: titulo(plural),
    genero,
  };
}

export const MARCA = "Plataforma CRM";
