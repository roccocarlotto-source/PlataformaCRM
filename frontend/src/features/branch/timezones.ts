// ---------------------------------------------------------------------------
// Zonas horarias que ofrece el <select> de BranchFormPage (ítem 20 de
// docs/frontend-cambios-pendientes.md).
//
// Es una restricción DEL LADO DEL CLIENTE: el backend acepta cualquier zona
// IANA que el runtime reconozca (esZonaHorariaValida en src/utils/timezone.ts)
// y no cambia. Se acota a la región por el mismo motivo que CURRENCY_OPTIONS
// (lib/currencies.ts): un texto libre obliga a replicar la validación IANA o
// a enterarse del error recién al guardar, y sigue permitiendo el tipeo
// ("Buenos Aires", "GMT-3") que esa validación existe para evitar.
//
// Quien la use tiene que seguir soportando un valor persistido FUERA de la
// lista (una sucursal creada por API con "UTC", por ejemplo): mostrarlo como
// opción extra mientras sea el valor vigente, para que el <select> nunca
// muestre Montevideo mientras el PATCH manda otra cosa. Ver isKnownTimezone.
// ---------------------------------------------------------------------------

export const TIMEZONE_OPTIONS = [
  { value: "America/Montevideo", label: "Montevideo (America/Montevideo)" },
  {
    value: "America/Argentina/Buenos_Aires",
    label: "Buenos Aires (America/Argentina/Buenos_Aires)",
  },
  { value: "America/Sao_Paulo", label: "São Paulo (America/Sao_Paulo)" },
  { value: "America/Santiago", label: "Santiago (America/Santiago)" },
  { value: "America/Asuncion", label: "Asunción (America/Asuncion)" },
] as const;

export type KnownTimezone = (typeof TIMEZONE_OPTIONS)[number]["value"];

// La zona de la operación real (Uruguay): default al crear una sucursal.
export const DEFAULT_TIMEZONE: KnownTimezone = "America/Montevideo";

export function isKnownTimezone(timezone: string): timezone is KnownTimezone {
  return TIMEZONE_OPTIONS.some((option) => option.value === timezone);
}
