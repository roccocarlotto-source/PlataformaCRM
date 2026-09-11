// ---------------------------------------------------------------------------
// Las dos monedas de la operación real (Uruguay): USD y UYU, sin "Otra".
//
// Es una restricción DEL LADO DEL CLIENTE: el backend acepta cualquier código
// ISO 4217 (currencySchema en src/utils/validation.ts) y no cambia. Nació
// como constante local de OpportunityFormPage (ítem 18.B de
// docs/frontend-cambios-pendientes.md) porque el texto libre solo generaba
// tipeos ("usd", "U$S"); se comparte acá desde el ítem 19 porque la pantalla
// de configuración de la organización ofrece exactamente la misma lista, y
// dos copias divergirían tarde o temprano.
//
// Quien la use tiene que seguir soportando un valor persistido FUERA de la
// lista (datos viejos, o cargados por API): mostrarlo como opción extra
// mientras sea el valor vigente, para que el <select> nunca muestre "USD"
// mientras el PATCH manda otra cosa. Ver isKnownCurrency.
// ---------------------------------------------------------------------------

export const CURRENCY_OPTIONS = ["USD", "UYU"] as const;

export type KnownCurrency = (typeof CURRENCY_OPTIONS)[number];

export function isKnownCurrency(currency: string): currency is KnownCurrency {
  return (CURRENCY_OPTIONS as readonly string[]).includes(currency);
}
