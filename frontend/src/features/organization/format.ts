import type { OrganizationExchangeRate } from "./types";

// Texto de una cotización para mostrar: "1 USD = 40,1235 UYU". Función pura
// en archivo aparte (mismo criterio que opportunity/format.ts) porque la
// consumen dos pantallas: la de configuración de la organización y el hint
// de la ficha de vehículo.
//
// `rate` llega como string decimal ("40.123456"): Number() antes de
// formatear, nunca el string crudo. Hasta 4 decimales, que es lo que se
// muestra de una cotización; el valor completo sigue usándose para calcular.
const rateFormatter = new Intl.NumberFormat("es-UY", { maximumFractionDigits: 4 });

export function formatExchangeRate(rate: OrganizationExchangeRate): string {
  return `1 USD = ${rateFormatter.format(Number(rate.rate))} ${rate.targetCurrency}`;
}
