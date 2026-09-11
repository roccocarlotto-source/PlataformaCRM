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
  // Una fila por moneda configurada distinta de USD (con cotización cargada).
  // Con el universo USD/UYU de la UI, como máximo una.
  exchangeRates: OrganizationExchangeRate[];
}

// updateOrganizationCurrencySchema: cada campo es opcional Y nullable
// (null = desconfigurar esa moneda), y hay que mandar al menos uno. Si tras
// aplicar el body las dos quedan iguales (y ninguna es null), el backend
// responde 400 con "La moneda de preferencia y la alternativa no pueden ser
// la misma" — ese mensaje se muestra tal cual, no se replica en el cliente.
export interface UpdateOrganizationCurrencyInput {
  preferredCurrency?: string | null;
  alternateCurrency?: string | null;
}
