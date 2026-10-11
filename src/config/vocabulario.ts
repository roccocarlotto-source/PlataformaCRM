import type { ContactTerm, OrganizationIndustry } from "@prisma/client";
import { vocabularioDeClinica } from "../clinicas/config/rubro";
import { MARCA, termino, type Vocabulario } from "./terminos";

// ---------------------------------------------------------------------------
// Vocabulario por rubro (docs/rubros.md §3). /api/me lo devuelve armado, igual
// que `modulos`: el frontend no tiene una tabla propia de textos por rubro.
//
// R3 lo expuso; desde R17 las pantallas compartidas (contactos,
// conversaciones, sucursales, turnos, agenda, base de conocimiento, agentes)
// leen de acá los textos que cambian por rubro.
//
// AUTOMOTORA es EXACTAMENTE lo que dicen hoy las pantallas: "Clientes"
// (pestaña de Contactos y etapa CUSTOMER), "Recursos", "Tipos de servicio",
// "Reservas" y "Calendario" (menú), "Vendedor por defecto" y "Sucursal". Lo
// fija src/clinicas/automotoraSinCambios.test.ts.
// ---------------------------------------------------------------------------

export type { Termino, Vocabulario } from "./terminos";

export const VOCABULARIO_AUTOMOTORA: Vocabulario = {
  marca: MARCA,
  contacto: termino("cliente", "clientes"),
  recurso: termino("recurso", "recursos"),
  tipoDeServicio: termino("tipo de servicio", "tipos de servicio"),
  reserva: termino("reserva", "reservas", "femenino"),
  agenda: termino("calendario", "calendarios"),
  responsable: termino("vendedor", "vendedores"),
  sucursal: termino("sucursal", "sucursales", "femenino"),
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
