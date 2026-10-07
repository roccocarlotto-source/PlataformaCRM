import type {
  AccionDeCampo,
  CampoPersonalizado,
  Etapa,
  Politica,
  TipoDePlan,
  TipoImportable,
} from "./types";

// Los textos del asistente de importación. Los destinos son los de
// DESTINOS_DE_CONTACTO / DESTINOS_DE_EMPRESA del backend
// (utils/importacionMapeo.ts); un campo personalizado es "custom:<key>".

export const TIPOS: { value: TipoImportable; label: string }[] = [
  { value: "COMPANY", label: "Empresas" },
  { value: "CONTACT", label: "Contactos" },
];

export const DESTINOS: Record<TipoImportable, Record<string, string>> = {
  CONTACT: {
    externalId: "Id en el sistema de origen",
    firstName: "Nombre",
    lastName: "Apellido",
    fullName: "Nombre completo",
    email: "Email",
    phone: "Teléfono",
    jobTitle: "Puesto",
    notes: "Notas",
    lifecycleStage: "Etapa",
    source: "Origen",
    ownerEmail: "Vendedor (email)",
    vehicleRef: "Vehículo de interés (código o patente)",
    companyName: "Empresa (nombre)",
    customerSince: "Cliente desde",
  },
  COMPANY: {
    externalId: "Id en el sistema de origen",
    name: "Nombre",
    domain: "Dominio",
    industry: "Rubro",
    phone: "Teléfono",
    city: "Ciudad",
    country: "País",
    ownerEmail: "Responsable (email)",
  },
};

export const PREFIJO_PERSONALIZADO = "custom:";

// Las opciones del destino de una columna: los fijos y, para contactos, los
// campos personalizados de la organización.
export function opcionesDeDestino(tipo: TipoImportable, campos: CampoPersonalizado[]) {
  const fijos = Object.entries(DESTINOS[tipo]).map(([value, label]) => ({ value, label }));
  if (tipo !== "CONTACT") return fijos;
  return [
    ...fijos,
    ...campos.map((c) => ({
      value: `${PREFIJO_PERSONALIZADO}${c.key}`,
      label: c.label,
      subtitle: "Campo personalizado",
    })),
  ];
}

// El nombre de un campo en el plan (incluye los resueltos: ownerId, companyId…).
export function etiquetaDeCampo(
  tipo: TipoImportable,
  campo: string,
  campos: CampoPersonalizado[],
): string {
  if (campo.startsWith(PREFIJO_PERSONALIZADO)) {
    const key = campo.slice(PREFIJO_PERSONALIZADO.length);
    return campos.find((c) => c.key === key)?.label ?? key;
  }
  const resueltos: Record<string, string> = {
    ownerId: tipo === "CONTACT" ? "Vendedor" : "Responsable",
    companyId: "Empresa",
    vehicleOfInterestId: "Vehículo de interés",
  };
  return resueltos[campo] ?? DESTINOS[tipo][campo] ?? campo;
}

export const PLAN: Record<
  TipoDePlan,
  { label: string; variant: "neutral" | "info" | "success" | "danger" }
> = {
  CREATE: { label: "Se crea", variant: "success" },
  UPDATE: { label: "Se actualiza", variant: "info" },
  CONFLICT: { label: "Choca", variant: "danger" },
  UNCHANGED: { label: "Sin cambios", variant: "neutral" },
  FAIL: { label: "Falla", variant: "danger" },
};

export const ORDEN_DE_PLANES: TipoDePlan[] = ["CREATE", "UPDATE", "CONFLICT", "UNCHANGED", "FAIL"];

export const ACCION: Record<AccionDeCampo, string> = {
  completar: "Se completa",
  agregar: "Se agrega",
  difiere: "Distinto",
  difiere_bloqueado: "No se pisa",
  igual: "Igual",
};

export const POLITICAS: { value: Politica; label: string }[] = [
  { value: "FILL_EMPTY", label: "Completar lo vacío sin pisar" },
  { value: "OVERWRITE", label: "Pisar con lo del archivo" },
  { value: "SKIP", label: "Omitir" },
];

export const ETAPAS: { value: Etapa; label: string }[] = [
  { value: "LEAD", label: "Lead" },
  { value: "MQL", label: "MQL" },
  { value: "SQL", label: "SQL" },
  { value: "CUSTOMER", label: "Cliente" },
  { value: "CHURNED", label: "Perdido" },
];

export const RESULTADOS: Record<string, string> = {
  CREATED: "Creados",
  UPDATED: "Actualizados",
  UNCHANGED: "Sin cambios",
  SKIPPED: "Omitidos",
};

export function textoDeValor(valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (Array.isArray(valor)) return valor.join(", ");
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  return String(valor);
}
