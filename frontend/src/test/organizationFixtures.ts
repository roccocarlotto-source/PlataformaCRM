import type {
  OrganizationExchangeRate,
  OrganizationSettings,
} from "../features/organization/types";

// Fixtures compartidas entre los tests que consumen features/organization/
// (la página de configuración y la ficha de vehículo, que usa la cotización
// para sugerir el precio en la otra moneda).
export function makeExchangeRate(
  overrides: Partial<OrganizationExchangeRate> = {},
): OrganizationExchangeRate {
  return {
    targetCurrency: "UYU",
    rate: "40.5",
    rateDate: "2026-09-10",
    ...overrides,
  };
}

// Sin cotización por defecto: es el estado de una organización recién
// creada (sin moneda distinta de USD configurada), y el que necesitan los
// tests que no hablan de cotizaciones para que el auto-cálculo de la ficha
// de vehículo no se meta en el medio.
export function makeOrganizationSettings(
  overrides: Partial<OrganizationSettings> = {},
): OrganizationSettings {
  return {
    id: "org-1",
    name: "Automotora Demo",
    preferredCurrency: "USD",
    alternateCurrency: null,
    defaultPhoneCountryCode: null,
    timezone: "UTC",
    exchangeRates: [],
    // Una automotora COMPLETA, como todas las de hoy (docs/rubros.md).
    edition: "COMPLETA",
    industry: "AUTOMOTORA",
    contactTerm: null,
    ...overrides,
  };
}
