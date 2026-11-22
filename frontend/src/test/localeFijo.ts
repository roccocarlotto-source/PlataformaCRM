// ---------------------------------------------------------------------------
// Idioma y zona horaria fijos para los tests, los mismos que el CI (ubuntu en
// inglés y en UTC). Sin esto, todo lo que formatea fechas, horas o números
// sin un locale explícito (toLocaleString(), Intl.DateTimeFormat() sin
// argumentos…) toma el de la máquina: en una PC en español la hora termina en
// "a. m." y el snapshot de textosDelRubro ("conversación") sale distinto que
// en el CI ("AM").
//
// - La zona: TZ=UTC en vite.config.ts (test.env). Node la toma aunque se
//   asigne después de arrancar.
// - El idioma: en Windows, Node (ICU) no lee LANG: usa el idioma del sistema.
//   Por eso acá se envuelven las APIs que lo usan por defecto, para que sin
//   locale usen LOCALE_DE_LOS_TESTS. Con un locale explícito no cambia nada.
// - entorno.test.ts verifica las dos cosas.
// ---------------------------------------------------------------------------

export const LOCALE_DE_LOS_TESTS = "en-US";
export const ZONA_DE_LOS_TESTS = "UTC";

type Locales = string | string[] | undefined;

// [] también es "el de la máquina" (toLocaleTimeString([], {...}) es común).
const conLocale = (locales: Locales): string | string[] =>
  locales === undefined || (Array.isArray(locales) && locales.length === 0)
    ? LOCALE_DE_LOS_TESTS
    : locales;

/** Un constructor de Intl que, sin locale, usa el de los tests. Sirve con y sin
 *  `new` (Intl.DateTimeFormat() también se llama sin new). */
function envolverConstructor<T extends abstract new (...args: never[]) => unknown>(original: T): T {
  return new Proxy(original, {
    construct(objetivo, args: unknown[]) {
      const [locales, ...resto] = args;
      return Reflect.construct(objetivo, [conLocale(locales as Locales), ...resto]);
    },
    apply(objetivo, esto, args: unknown[]) {
      const [locales, ...resto] = args;
      return Reflect.apply(objetivo as unknown as (...a: unknown[]) => unknown, esto, [
        conLocale(locales as Locales),
        ...resto,
      ]);
    },
  });
}

/** Un método toLocale…/localeCompare que, sin locale, usa el de los tests.
 *  `posicion` es dónde va el locale entre los argumentos. */
function envolverMetodo(prototipo: object, nombre: string, posicion: number): void {
  const original = (prototipo as Record<string, (...args: unknown[]) => unknown>)[nombre];
  Object.defineProperty(prototipo, nombre, {
    configurable: true,
    writable: true,
    value: function (this: unknown, ...args: unknown[]) {
      const conDefault = [...args];
      conDefault[posicion] = conLocale(args[posicion] as Locales);
      return original.apply(this, conDefault);
    },
  });
}

const CONSTRUCTORES_DE_INTL = [
  "DateTimeFormat",
  "NumberFormat",
  "Collator",
  "PluralRules",
  "RelativeTimeFormat",
  "ListFormat",
] as const;

export function fijarLocaleDeLosTests(): void {
  for (const nombre of CONSTRUCTORES_DE_INTL) {
    // defineProperty y no una asignación: algunos están tipados readonly.
    Object.defineProperty(Intl, nombre, {
      configurable: true,
      writable: true,
      value: envolverConstructor(Intl[nombre]),
    });
  }
  envolverMetodo(Date.prototype, "toLocaleString", 0);
  envolverMetodo(Date.prototype, "toLocaleDateString", 0);
  envolverMetodo(Date.prototype, "toLocaleTimeString", 0);
  envolverMetodo(Number.prototype, "toLocaleString", 0);
  envolverMetodo(String.prototype, "localeCompare", 1);
}
