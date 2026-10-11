import type { MeResponse, TerminoDelVocabulario, Vocabulario } from "./AuthContext";

type Genero = "masculino" | "femenino";

/** Un término con su género: lo que reciben las pantallas. */
export type Termino = Required<TerminoDelVocabulario>;

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

function termino(singular: string, plural: string, genero: Genero = "masculino"): Termino {
  const titulo = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);
  return {
    singular,
    plural,
    singularTitulo: titulo(singular),
    pluralTitulo: titulo(plural),
    genero,
  };
}

/** El vocabulario con todos sus términos (y sus géneros): lo que reciben las
 *  pantallas. */
export type VocabularioCompleto = { marca: string } & {
  [K in Exclude<keyof Vocabulario, "marca">]-?: Termino;
};

export const VOCABULARIO_AUTOMOTORA_POR_DEFECTO: VocabularioCompleto = {
  marca: MARCA_POR_DEFECTO,
  contacto: termino("cliente", "clientes"),
  recurso: termino("recurso", "recursos"),
  tipoDeServicio: termino("tipo de servicio", "tipos de servicio"),
  reserva: termino("reserva", "reservas", "femenino"),
  agenda: termino("calendario", "calendarios"),
  responsable: termino("vendedor", "vendedores"),
  sucursal: termino("sucursal", "sucursales", "femenino"),
};

export const VOCABULARIO_DE_CLINICA_POR_DEFECTO: VocabularioCompleto = {
  marca: MARCA_POR_DEFECTO,
  contacto: termino("paciente", "pacientes"),
  recurso: termino("profesional", "profesionales"),
  tipoDeServicio: termino("prestación", "prestaciones", "femenino"),
  reserva: termino("turno", "turnos"),
  agenda: termino("agenda", "agendas", "femenino"),
  responsable: termino("responsable", "responsables"),
  sucursal: termino("sede", "sedes", "femenino"),
};

export function esClinica(me: MeResponse | null | undefined): boolean {
  return me?.industry === "CLINICA";
}

/** El vocabulario de quien está en la app: el de /me, completado con el de
 *  su rubro (un backend anterior puede no mandarlo, o no mandar un término
 *  nuevo). */
export function vocabularioDe(me: MeResponse | null | undefined): VocabularioCompleto {
  const delRubro = esClinica(me)
    ? VOCABULARIO_DE_CLINICA_POR_DEFECTO
    : VOCABULARIO_AUTOMOTORA_POR_DEFECTO;
  const deMe = me?.vocabulario;
  if (!deMe) return delRubro;
  const completo = { ...delRubro, marca: deMe.marca ?? delRubro.marca };
  for (const clave of Object.keys(delRubro) as (keyof VocabularioCompleto)[]) {
    if (clave === "marca") continue;
    const termino = deMe[clave];
    if (termino) completo[clave] = { ...delRubro[clave], ...termino };
  }
  return completo;
}

/** Los artículos y adjetivos que concuerdan con el término: "la reserva" /
 *  "el turno", "Nueva sucursal" / "Nuevo profesional". */
export function concordancia(t: Termino) {
  const f = t.genero === "femenino";
  return {
    el: f ? "la" : "el",
    los: f ? "las" : "los",
    Los: f ? "Las" : "Los",
    un: f ? "una" : "un",
    del: f ? "de la" : "del",
    este: f ? "esta" : "este",
    Este: f ? "Esta" : "Este",
    nuevo: f ? "nueva" : "nuevo",
    Nuevo: f ? "Nueva" : "Nuevo",
  };
}

/** El nombre del producto (docs/rubros.md §0.3): de la configuración de marca
 *  del backend, no escrito en cada pantalla. */
export function marcaDe(me: MeResponse | null | undefined): string {
  return vocabularioDe(me).marca;
}
