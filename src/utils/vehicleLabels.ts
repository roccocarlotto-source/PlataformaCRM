import type {
  VehicleBodyType,
  VehicleColorFinish,
  VehicleCondition,
  VehicleDrivetrain,
  VehicleFuelType,
  VehiclePublicationCurrency,
  VehicleTransmission,
  VehicleWarranty,
} from "@prisma/client";

// ---------------------------------------------------------------------------
// Rótulos en castellano de los enums de Vehicle, del lado del BACKEND (ítem 70
// de docs/frontend-cambios-pendientes.md).
//
// SON UNA COPIA DELIBERADA de frontend/src/features/vehicle/labels.ts, que es
// la fuente de verdad de cómo este proyecto ya decidió nombrar cada valor en
// la pantalla. La copia existe porque el agente de IA arma su texto acá
// —construirContenidoDeVehiculo, vehicleKnowledgeBaseSync.service.ts— y no
// hay hoy ningún paquete compartido entre los dos tsconfig: la alternativa
// real no era importar, era inventar rótulos nuevos, y entonces el agente
// diría "Automática secuencial" donde la pantalla dice otra cosa del MISMO
// valor.
//
// Si alguno de estos textos cambia, cambia en los dos lados. Cada mapa es
// Record<Enum, string>, así que un valor nuevo del enum sin rótulo no compila
// —ni acá ni allá—, que es el guardarraíl que hace barata la sincronización
// manual.
//
// Solo los ocho enums que la base de conocimiento publica. `status`, `origin`
// y el resto no están a propósito: no salen en el contenido generado (ver la
// allowlist de construirContenidoDeVehiculo).
// ---------------------------------------------------------------------------

export const CONDITION_LABELS: Record<VehicleCondition, string> = {
  NEW: "Nuevo",
  USED: "Usado",
};

export const BODY_TYPE_LABELS: Record<VehicleBodyType, string> = {
  SEDAN: "Sedán",
  HATCHBACK: "Hatchback",
  SUV: "SUV",
  PICKUP: "Pickup",
  COUPE: "Coupé",
  WAGON: "Rural",
  VAN: "Van",
  UTILITY: "Utilitario",
  MINIVAN: "Minivan",
};

export const TRANSMISSION_LABELS: Record<VehicleTransmission, string> = {
  MANUAL: "Manual",
  AUTOMATIC: "Automática",
  AUTOMATIC_SEQUENTIAL: "Automática secuencial",
  CVT: "CVT",
};

export const FUEL_TYPE_LABELS: Record<VehicleFuelType, string> = {
  GASOLINE: "Nafta",
  DIESEL: "Diésel",
  HYBRID: "Híbrido",
  ELECTRIC: "Eléctrico",
  CNG: "GNC",
  GASOLINE_CNG: "Nafta / GNC",
};

export const COLOR_FINISH_LABELS: Record<VehicleColorFinish, string> = {
  SOLID: "Sólido",
  METALLIC: "Metalizado",
  PEARL: "Perlado",
  MATTE: "Mate",
};

export const DRIVETRAIN_LABELS: Record<VehicleDrivetrain, string> = {
  FRONT: "Delantera",
  REAR: "Trasera",
  FOUR_BY_FOUR: "4x4",
  AWD: "Integral (AWD)",
};

export const WARRANTY_LABELS: Record<VehicleWarranty, string> = {
  NONE: "Sin garantía",
  FACTORY: "De fábrica",
  DEALER_6M: "Del concesionario, 6 meses",
  DEALER_12M: "Del concesionario, 12 meses",
  OTHER: "Otra",
};

export const PUBLICATION_CURRENCY_LABELS: Record<VehiclePublicationCurrency, string> = {
  BOTH: "USD y moneda local",
  USD_ONLY: "Solo USD",
  LOCAL_ONLY: "Solo moneda local",
};
