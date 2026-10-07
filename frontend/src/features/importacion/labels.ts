import type {
  AccionDeCampo,
  CampoPersonalizado,
  Etapa,
  Politica,
  TipoDeHistorial,
  TipoDePlan,
  TipoImportable,
} from "./types";

// Los textos del asistente de importación. Los destinos son los de
// DESTINOS_DE_CONTACTO / DESTINOS_DE_EMPRESA del backend
// (utils/importacionMapeo.ts); un campo personalizado es "custom:<key>".

export const TIPOS: { value: TipoImportable; label: string }[] = [
  { value: "COMPANY", label: "Empresas" },
  { value: "CONTACT", label: "Contactos" },
  { value: "ACTIVITY", label: "Historial (notas, llamadas y tareas)" },
  { value: "VEHICLE", label: "Stock de vehículos" },
];

// Los valores del stock (docs/importacion-de-datos.md §5.4). Reservada entra
// como «No disponible»; Vendida y Entregada, como vendidas (se omiten salvo la
// casilla).
export const ESTADOS_DE_STOCK = [
  { value: "AVAILABLE", label: "Disponible" },
  { value: "IN_PREPARATION", label: "En preparación" },
  { value: "IN_TRANSIT", label: "En tránsito" },
  { value: "UNAVAILABLE", label: "No disponible" },
  { value: "RESERVED", label: "Reservada (entra como No disponible)" },
  { value: "SOLD", label: "Vendida" },
  { value: "DELIVERED", label: "Entregada (como vendida)" },
];
export const CONDICIONES: { value: "NEW" | "USED"; label: string }[] = [
  { value: "NEW", label: "Nuevo (0 km)" },
  { value: "USED", label: "Usado" },
];
export const COMBUSTIBLES = [
  { value: "GASOLINE", label: "Nafta" },
  { value: "DIESEL", label: "Diésel" },
  { value: "HYBRID", label: "Híbrido" },
  { value: "ELECTRIC", label: "Eléctrico" },
  { value: "CNG", label: "GNC" },
  { value: "GASOLINE_CNG", label: "Nafta y GNC" },
];
export const TRANSMISIONES = [
  { value: "MANUAL", label: "Manual" },
  { value: "AUTOMATIC", label: "Automática" },
  { value: "AUTOMATIC_SEQUENTIAL", label: "Automática secuencial" },
  { value: "CVT", label: "CVT" },
];

export const TIPOS_DE_HISTORIAL: { value: TipoDeHistorial; label: string }[] = [
  { value: "NOTE", label: "Nota" },
  { value: "CALL", label: "Llamada" },
  { value: "TASK", label: "Tarea" },
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
  VEHICLE: {
    externalId: "Id en el sistema de origen",
    stockCode: "Código de stock del origen",
    make: "Marca",
    model: "Modelo",
    trim: "Versión",
    year: "Año",
    mileage: "Kilómetros",
    condition: "Condición (nuevo o usado)",
    price: "Precio",
    currency: "Moneda",
    priceUsd: "Precio en dólares",
    priceLocal: "Precio en moneda local",
    cost: "Costo",
    minPrice: "Precio mínimo",
    status: "Estado",
    color: "Color",
    fuelType: "Combustible",
    transmission: "Caja",
    licensePlate: "Patente",
    vin: "VIN",
  },
  ACTIVITY: {
    externalId: "Id en el sistema de origen",
    type: "Tipo (nota, llamada o tarea)",
    contactExternalId: "Id del contacto en el origen",
    contactEmail: "Email del contacto",
    contactPhone: "Teléfono del contacto",
    subject: "Asunto",
    body: "Texto",
    occurredAt: "Fecha",
    dueDate: "Vencimiento (tareas)",
    done: "Hecha (tareas)",
    authorName: "Autor original",
    assigneeEmail: "Responsable (email, tareas)",
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
    priceListUsd: "Precio en dólares",
    priceListLocal: "Precio en moneda local",
    acquisitionCostUsd: "Costo (USD)",
    minAcceptablePriceUsd: "Precio mínimo (USD)",
    exteriorColor: "Color",
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
  SKIP: { label: "Se omite", variant: "neutral" },
  FAIL: { label: "Falla", variant: "danger" },
};

export const ORDEN_DE_PLANES: TipoDePlan[] = [
  "CREATE",
  "UPDATE",
  "CONFLICT",
  "UNCHANGED",
  "SKIP",
  "FAIL",
];

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
