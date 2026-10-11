import type { MeResponse, TerminoDelVocabulario, Vocabulario } from "../auth/AuthContext";
import { edicionDeMe, MODULOS_COMPLETA, MODULOS_ESENCIAL } from "./edicionFixtures";

// Los campos de rubro de `me` tal como los manda /api/me (docs/rubros.md §3):
// copia de src/config/vocabulario.ts y src/clinicas/config/rubro.ts (el
// backend). Si allá cambian los textos, acá se actualiza a mano.

function t(
  singular: string,
  plural: string,
  genero: "masculino" | "femenino" = "masculino",
): TerminoDelVocabulario {
  const titulo = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);
  return {
    singular,
    plural,
    singularTitulo: titulo(singular),
    pluralTitulo: titulo(plural),
    genero,
  };
}

export const VOCABULARIO_AUTOMOTORA_DE_ME: Vocabulario = {
  marca: "Plataforma CRM",
  contacto: t("cliente", "clientes"),
  recurso: t("recurso", "recursos"),
  tipoDeServicio: t("tipo de servicio", "tipos de servicio"),
  reserva: t("reserva", "reservas", "femenino"),
  agenda: t("calendario", "calendarios"),
  responsable: t("vendedor", "vendedores"),
  sucursal: t("sucursal", "sucursales", "femenino"),
};

export const VOCABULARIO_CLINICA_DE_ME: Vocabulario = {
  marca: "Plataforma CRM",
  contacto: t("paciente", "pacientes"),
  recurso: t("profesional", "profesionales"),
  tipoDeServicio: t("prestación", "prestaciones", "femenino"),
  reserva: t("turno", "turnos"),
  agenda: t("agenda", "agendas", "femenino"),
  responsable: t("responsable", "responsables"),
  sucursal: t("sede", "sedes", "femenino"),
};

// Lo que una clínica no tiene (FUERA_DE_CLINICA de src/config/ediciones.ts) y
// lo que solo tiene ella (SOLO_CLINICA).
const FUERA_DE_CLINICA = new Set([
  "stock",
  "oportunidades",
  "procesos_de_venta",
  "cotizaciones",
  "pagos",
  "entregas",
  "empresas",
  "dashboard_comercial",
  "financiacion",
  "permutas",
]);
const SOLO_CLINICA = ["agenda_clinica", "recordatorios_de_turno", "post_turno"];

/** Los campos de rubro y edición de `me` para una automotora. */
export function automotoraDeMe(
  edition: "COMPLETA" | "ESENCIAL",
): Pick<MeResponse, "edition" | "modulos" | "industry" | "vocabulario"> {
  return {
    ...edicionDeMe(edition),
    industry: "AUTOMOTORA",
    vocabulario: VOCABULARIO_AUTOMOTORA_DE_ME,
  };
}

/** Los campos de rubro y edición de `me` para una clínica con contactTerm
 *  PACIENTE. */
export function clinicaDeMe(
  edition: "COMPLETA" | "ESENCIAL",
): Pick<MeResponse, "edition" | "modulos" | "industry" | "vocabulario"> {
  const deLaEdicion = edition === "ESENCIAL" ? MODULOS_ESENCIAL : MODULOS_COMPLETA;
  return {
    edition,
    industry: "CLINICA",
    modulos: [...deLaEdicion.filter((m) => !FUERA_DE_CLINICA.has(m)), ...SOLO_CLINICA],
    vocabulario: VOCABULARIO_CLINICA_DE_ME,
  };
}
