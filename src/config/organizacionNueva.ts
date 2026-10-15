// ---------------------------------------------------------------------------
// Con qué nace una organización (2026-10-14, decisión de Rocco). Hasta acá el
// alta guardaba solo nombre, identificador, edición y rubro: quedaba sin país
// para los teléfonos (un "099 123 456" daba error), sin moneda (el Valor de
// una orden daba error) y con la zona en UTC. Hoy todas las organizaciones son
// uruguayas: estos son los valores por defecto, y el formulario de Plataforma
// → Nueva organización los muestra y deja cambiarlos.
// ---------------------------------------------------------------------------

export const DATOS_DE_ORGANIZACION_NUEVA = {
  // Uruguay (sin "+"; ver lib/telefono.ts).
  defaultPhoneCountryCode: "598",
  // La misma moneda por defecto que el dashboard (DASHBOARD_DEFAULT_CURRENCY).
  preferredCurrency: "USD",
  timezone: "America/Montevideo",
} as const;
