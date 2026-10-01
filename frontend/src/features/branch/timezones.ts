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

// ---------------------------------------------------------------------------
// Zonas para la ORGANIZACIÓN (Configuración → Organización, seguimiento de
// T-01). Lista aparte y más larga a propósito, que NO revierte el criterio de
// arriba para sucursales.
//
// La zona de una sucursal define horarios de turnos: ahí importa solo cómo se
// comporta el reloj, y Buenos Aires = Montevideo = São Paulo. La de la
// organización define "hoy / esta semana / este mes" del dashboard, y quien la
// elige busca SU ciudad. Ver "Montevideo" sin "Buenos Aires" se lee como "mi
// país no está". Por eso acá va una opción por ciudad de la región, aunque
// varias den el mismo offset.
//
// Mismo contrato que TIMEZONE_OPTIONS para valores fuera de la lista (por
// ejemplo "UTC", la zona de una organización recién creada): quien la use la
// muestra como opción extra mientras sea la vigente.
// ---------------------------------------------------------------------------

export const ORGANIZATION_TIMEZONE_OPTIONS = [
  { value: "America/Montevideo", label: "Montevideo (America/Montevideo)" },
  {
    value: "America/Argentina/Buenos_Aires",
    label: "Buenos Aires (America/Argentina/Buenos_Aires)",
  },
  { value: "America/Santiago", label: "Santiago (America/Santiago)" },
  { value: "America/Sao_Paulo", label: "São Paulo (America/Sao_Paulo)" },
  { value: "America/Asuncion", label: "Asunción (America/Asuncion)" },
  { value: "America/La_Paz", label: "La Paz (America/La_Paz)" },
  { value: "America/Lima", label: "Lima (America/Lima)" },
  { value: "America/Bogota", label: "Bogotá (America/Bogota)" },
  { value: "America/Mexico_City", label: "Ciudad de México (America/Mexico_City)" },
] as const;

export function isKnownOrganizationTimezone(timezone: string): boolean {
  return ORGANIZATION_TIMEZONE_OPTIONS.some((option) => option.value === timezone);
}
