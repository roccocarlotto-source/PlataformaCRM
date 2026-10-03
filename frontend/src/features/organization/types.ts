// Reconstruido desde el contrato real del backend
// (src/controllers/organization.controller.ts, src/services/organization.service.ts,
// src/routes/organization.routes.ts). No se agrega ningún campo que el backend
// no devuelva o no acepte.
//
// A diferencia de source/ o branch/, esto NO es una lista: la organización es
// siempre la del token (la ruta no lleva :id), así que hay un solo GET y un
// solo PATCH, sin paginación, filtros ni detail por id.

// Cotización USD→targetCurrency más reciente de una moneda configurada.
// Decimal y @db.Date se sirven como texto, igual que el resto del módulo de
// stock: "40.123456" y "YYYY-MM-DD". Nunca hay una fila USD→USD.
export interface OrganizationExchangeRate {
  targetCurrency: string;
  rate: string;
  rateDate: string;
}

export interface OrganizationSettings {
  id: string;
  name: string;
  // ISO 4217 de tres letras, o null = sin configurar. El backend acepta
  // cualquier código; la UI acota a CURRENCY_OPTIONS (lib/currencies.ts).
  preferredCurrency: string | null;
  alternateCurrency: string | null;
  // F5-b (docs-privados/prueba-en-vivo-2026-09-29.md (local, no está en GitHub)): código de país sin "+" ("598")
  // con el que el backend completa los teléfonos cargados en formato local.
  // null = sin país por defecto.
  defaultPhoneCountryCode: string | null;
  // Seguimiento de T-01: zona IANA de la organización. Nunca null: "UTC" si
  // nunca se configuró. El backend acepta cualquier zona IANA válida; la UI
  // acota a ORGANIZATION_TIMEZONE_OPTIONS (features/branch/timezones.ts).
  timezone: string;
  // Una fila por moneda configurada distinta de USD (con cotización cargada).
  // Con el universo USD/UYU de la UI, como máximo una.
  exchangeRates: OrganizationExchangeRate[];
}

// updateOrganizationSettingsSchema: cada campo es opcional Y nullable
// (null = desconfigurar esa moneda), y hay que mandar al menos uno. Si tras
// aplicar el body las dos quedan iguales (y ninguna es null), el backend
// responde 400 con "La moneda de preferencia y la alternativa no pueden ser
// la misma" — ese mensaje se muestra tal cual, no se replica en el cliente.
export interface UpdateOrganizationSettingsInput {
  preferredCurrency?: string | null;
  alternateCurrency?: string | null;
  defaultPhoneCountryCode?: string | null;
  // No nullable: la zona no se puede vaciar (400).
  timezone?: string;
}

// Conexión de la página de Facebook de la organización (ítem 173 en el
// frontend; backend del ítem 170) — la fila pública de GET
// /api/integrations/meta. Nunca trae el token. Una por organización, sin
// sucursal. REVOKED: se desconectó. ERROR: Meta dejó de aceptar el token;
// lastErrorMessage dice por qué.
export type MetaPageConnectionStatus = "ACTIVE" | "REVOKED" | "ERROR";

export interface MetaPageConnection {
  id: string;
  organizationId: string;
  pageId: string;
  // null = la página no tiene una cuenta de Instagram Business vinculada.
  instagramBusinessAccountId: string | null;
  status: MetaPageConnectionStatus;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  connectedAt: string;
  createdAt: string;
  updatedAt: string;
}
