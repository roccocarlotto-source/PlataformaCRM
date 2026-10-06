import assert from "node:assert/strict";
import { test } from "node:test";
import { formatearParaElCanal } from "./formatoPorCanal";

// Los casos vistos en producción el 05/10/2026: el agente mandó
// "*Renault Kwid Zen (2021)*" por Messenger y el cliente vio los asteriscos.

test("Messenger e Instagram: la negrita simple y la doble salen sin asteriscos", () => {
  for (const canal of ["MESSENGER", "INSTAGRAM"] as const) {
    assert.equal(
      formatearParaElCanal("Tenemos el *Renault Kwid Zen (2021)* disponible.", canal),
      "Tenemos el Renault Kwid Zen (2021) disponible.",
    );
    assert.equal(
      formatearParaElCanal("**Precio:** USD 12.500 · **Año:** 2021", canal),
      "Precio: USD 12.500 · Año: 2021",
    );
  }
});

test("Messenger: cursiva con guion bajo, títulos y viñetas", () => {
  const texto = ["## Opciones", "- _Kwid Zen_ 2021", "* Gol Trend 2019", "  - usado"].join("\n");
  assert.equal(
    formatearParaElCanal(texto, "MESSENGER"),
    ["Opciones", "• Kwid Zen 2021", "• Gol Trend 2019", "  • usado"].join("\n"),
  );
});

test("WhatsApp: **x** pasa a *x*, y lo que WhatsApp ya entiende queda igual", () => {
  assert.equal(
    formatearParaElCanal("Tenemos el **Renault Kwid Zen (2021)** disponible.", "WHATSAPP"),
    "Tenemos el *Renault Kwid Zen (2021)* disponible.",
  );
  assert.equal(
    formatearParaElCanal("*Kwid* _2021_\n- 45.000 km", "WHATSAPP"),
    "*Kwid* _2021_\n- 45.000 km",
  );
  assert.equal(
    formatearParaElCanal("# Opciones\n**A** y **B**", "WHATSAPP"),
    "Opciones\n*A* y *B*",
  );
});

test("los links no se tocan, en ningún canal", () => {
  const texto =
    "Mirá la ficha: https://autos.example.com/catalogo/kwid_zen_2021?ref=*promo*&a_b=1 y **avisame**";
  assert.equal(
    formatearParaElCanal(texto, "MESSENGER"),
    "Mirá la ficha: https://autos.example.com/catalogo/kwid_zen_2021?ref=*promo*&a_b=1 y avisame",
  );
  assert.equal(
    formatearParaElCanal(texto, "WHATSAPP"),
    "Mirá la ficha: https://autos.example.com/catalogo/kwid_zen_2021?ref=*promo*&a_b=1 y *avisame*",
  );
});

test("lo que no es formato no se toca: guiones bajos de una palabra, mails, multiplicaciones", () => {
  const texto = "Escribí a ventas_norte@example.com, son 2 * 3 cuotas y el modelo kwid_zen.";
  assert.equal(formatearParaElCanal(texto, "MESSENGER"), texto);
  assert.equal(formatearParaElCanal(texto, "WHATSAPP"), texto);
});

test("web: texto plano, igual que Messenger (el widget no renderiza markup)", () => {
  assert.equal(formatearParaElCanal("**Hola**, *Ana*\n- uno", "WEB"), "Hola, Ana\n• uno");
});

test("un texto sin marcas vuelve idéntico", () => {
  const texto = "Hola, ¿en qué te ayudo? Tenemos pickups desde USD 15.000.";
  for (const canal of ["WHATSAPP", "MESSENGER", "INSTAGRAM", "WEB"] as const) {
    assert.equal(formatearParaElCanal(texto, canal), texto);
  }
});
