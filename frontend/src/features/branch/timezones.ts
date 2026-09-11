// ---------------------------------------------------------------------------
// Zonas horarias que ofrece el <select> de BranchFormPage (ítem 20 de
// docs/frontend-cambios-pendientes.md; acotada en el ítem 26).
//
// Es una restricción DEL LADO DEL CLIENTE: el backend acepta cualquier zona
// IANA que el runtime reconozca (esZonaHorariaValida en src/utils/timezone.ts)
// y no cambia. Se acota a la región por el mismo motivo que CURRENCY_OPTIONS
// (lib/currencies.ts): un texto libre obliga a replicar la validación IANA o
// a enterarse del error recién al guardar, y sigue permitiendo el tipeo
// ("Buenos Aires", "GMT-3") que esa validación existe para evitar.
//
// Criterio para la lista: UNA opción por comportamiento real de horarios. No
// se listan zonas que hoy son equivalentes entre sí: Buenos Aires y São Paulo
// son, igual que Montevideo, UTC-3 fijo todo el año sin horario de verano, y
// elegir cualquiera de las tres daba exactamente lo mismo (§26). Montevideo
// queda como representante por ser la zona de la operación real. Santiago y
// Asunción sí cambian de offset durante el año, así que son opciones
// distintas de verdad.
//
// Quien la use tiene que seguir soportando un valor persistido FUERA de la
// lista (una sucursal creada por API con "UTC", o una guardada con
// America/Argentina/Buenos_Aires antes del §26): mostrarlo como opción extra
// mientras sea el valor vigente, para que el <select> nunca muestre
// Montevideo mientras el PATCH manda otra cosa. Ver isKnownTimezone.
// ---------------------------------------------------------------------------

export const TIMEZONE_OPTIONS = [
  { value: "America/Montevideo", label: "Montevideo (America/Montevideo)" },
  { value: "America/Santiago", label: "Santiago (America/Santiago)" },
  { value: "America/Asuncion", label: "Asunción (America/Asuncion)" },
] as const;

export type KnownTimezone = (typeof TIMEZONE_OPTIONS)[number]["value"];

// La zona de la operación real (Uruguay): default al crear una sucursal.
export const DEFAULT_TIMEZONE: KnownTimezone = "America/Montevideo";

export function isKnownTimezone(timezone: string): timezone is KnownTimezone {
  return TIMEZONE_OPTIONS.some((option) => option.value === timezone);
}
