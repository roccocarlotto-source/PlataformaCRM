import type { ContactTerm, OrganizationIndustry } from "@prisma/client";
import { vocabularioDeClinica } from "../clinicas/config/rubro";
import { MARCA, termino, type Vocabulario } from "./terminos";

// ---------------------------------------------------------------------------
// Vocabulario por rubro (docs/rubros.md §3). /api/me lo devuelve armado, igual
// que `modulos`: el frontend no tiene una tabla propia de textos por rubro.
//
// R3 solo lo expone. Las pantallas siguen con sus textos escritos en el JSX
// hasta R17, que las pasa a leer de acá.
//
// AUTOMOTORA es EXACTAMENTE lo que dicen hoy las pantallas: "Clientes"
// (pestaña de Contactos y etapa CUSTOMER), "Recursos", "Tipos de servicio",
// "Reservas" y "Calendario" (menú) y "Vendedor por defecto" (Sucursales). Lo
// fija src/clinicas/automotoraSinCambios.test.ts.
// ---------------------------------------------------------------------------

export type { Termino, Vocabulario } from "./terminos";

export const VOCABULARIO_AUTOMOTORA: Vocabulario = {
  marca: MARCA,
  contacto: termino("cliente", "clientes"),
  recurso: termino("recurso", "recursos"),
  tipoDeServicio: termino("tipo de servicio", "tipos de servicio"),
  reserva: termino("reserva", "reservas"),
  agenda: termino("calendario", "calendarios"),
  responsable: termino("vendedor", "vendedores"),
};

/** El vocabulario de una organización. contactTerm solo cuenta en CLINICA (las
 *  automotoras no lo tienen: siempre "cliente"). */
export function vocabularioDe(
  industry: OrganizationIndustry,
  contactTerm: ContactTerm | null,
): Vocabulario {
  return industry === "CLINICA"
    ? vocabularioDeClinica(contactTerm ?? "PACIENTE")
    : VOCABULARIO_AUTOMOTORA;
}
