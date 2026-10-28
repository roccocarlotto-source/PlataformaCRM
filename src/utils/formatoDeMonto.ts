// ---------------------------------------------------------------------------
// Un importe escrito para que lo lea una persona, o un modelo que le va a
// escribir a una persona: "23.000 USD", "5.200,50 UYU", "−500 USD". Las mismas
// reglas que formatMoney del frontend (frontend/src/design-system/
// currencyFormat.ts), que es el formato de montos de todo el sistema (UX-09 de
// docs-privados/auditoria-2026-10-21/informe-etapa-2.md, local):
//
//   - punto cada tres dígitos y coma decimal, como se escribe en Uruguay;
//   - los centavos solo si existen ("23.000", no "23.000,00"), y si existen,
//     con dos posiciones y sin redondear ("5.200,50");
//   - el negativo con el signo menos tipográfico, que no se confunde con un
//     guion;
//   - la moneda después del número.
//
// El backend no puede importar el código del frontend: por eso esta copia, con
// su propio test. Se usa donde el backend arma TEXTO con un monto (el contexto
// que le llega al modelo); la API sigue devolviendo el valor canónico
// ("23000.00") y cada pantalla lo formatea.
// ---------------------------------------------------------------------------

const ENTERO = new Intl.NumberFormat("es-UY", { maximumFractionDigits: 0 });

export function formatearMonto(amount: { toString(): string } | number, currency: string): string {
  // En centavos enteros, como el frontend: un Decimal de Prisma o un string
  // con a lo sumo dos decimales se convierte sin restos de punto flotante.
  const centavos = Math.round(Number(amount.toString()) * 100);
  const signo = centavos < 0 ? "−" : "";
  const absoluto = Math.abs(centavos);
  const entero = ENTERO.format(Math.floor(absoluto / 100));
  const resto = absoluto % 100;
  const decimales = resto === 0 ? "" : `,${String(resto).padStart(2, "0")}`;
  return `${signo}${entero}${decimales} ${currency}`.trim();
}
