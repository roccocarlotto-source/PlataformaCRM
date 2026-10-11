import type { MeResponse, TerminoDelVocabulario, Vocabulario } from "./AuthContext";

// ---------------------------------------------------------------------------
// Vocabulario por rubro (docs/rubros.md §3): lo arma el backend
// (src/config/vocabulario.ts) y llega en `vocabulario` de /api/me, igual que
// `modulos`. El frontend no tiene una tabla propia: lo de acá son solo los
// textos para un backend anterior que no lo manda, que son los de cada rubro
// en el backend.
//
// Sin React, como tieneModulo: un componente compartido recibe el vocabulario
// por prop (o lo calcula con `me` que ya tiene) en vez de llamar a useAuth.
// ---------------------------------------------------------------------------

/** El nombre del producto mientras /me no llegó (o un backend anterior no lo
 *  manda). index.html tiene el mismo texto en <title>: se carga antes de que
 *  exista una sesión. */
export const MARCA_POR_DEFECTO = "Plataforma CRM";

function termino(singular: string, plural: string): TerminoDelVocabulario {
  const titulo = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);
  return { singular, plural, singularTitulo: titulo(singular), pluralTitulo: titulo(plural) };
}

export const VOCABULARIO_AUTOMOTORA_POR_DEFECTO: Vocabulario = {
  marca: MARCA_POR_DEFECTO,
  contacto: termino("cliente", "clientes"),
  recurso: termino("recurso", "recursos"),
  tipoDeServicio: termino("tipo de servicio", "tipos de servicio"),
  reserva: termino("reserva", "reservas"),
  agenda: termino("calendario", "calendarios"),
  responsable: termino("vendedor", "vendedores"),
};

export const VOCABULARIO_DE_CLINICA_POR_DEFECTO: Vocabulario = {
  marca: MARCA_POR_DEFECTO,
  contacto: termino("paciente", "pacientes"),
  recurso: termino("profesional", "profesionales"),
  tipoDeServicio: termino("prestación", "prestaciones"),
  reserva: termino("turno", "turnos"),
  agenda: termino("agenda", "agendas"),
  responsable: termino("responsable", "responsables"),
};

export function esClinica(me: MeResponse | null | undefined): boolean {
  return me?.industry === "CLINICA";
}

/** El vocabulario de quien está en la app: el de /me, o el de su rubro. */
export function vocabularioDe(me: MeResponse | null | undefined): Vocabulario {
  if (me?.vocabulario) return me.vocabulario;
  return esClinica(me) ? VOCABULARIO_DE_CLINICA_POR_DEFECTO : VOCABULARIO_AUTOMOTORA_POR_DEFECTO;
}

/** El nombre del producto (docs/rubros.md §0.3): de la configuración de marca
 *  del backend, no escrito en cada pantalla. */
export function marcaDe(me: MeResponse | null | undefined): string {
  return vocabularioDe(me).marca;
}
