import assert from "node:assert/strict";
import { test } from "node:test";
import { TOPE_DE_LARGO_POR_CANAL, partirMensaje } from "./partirMensaje";

// ---------------------------------------------------------------------------
// OPUS-B-02 / FABLE-B-05 (docs-privados, local): tope de largo por canal.
// ---------------------------------------------------------------------------

const bytes = (texto: string) => Buffer.byteLength(texto, "utf8");

// Una respuesta como las que arma el agente con varias unidades.
function listadoDeUnidades(cantidad: number): string {
  const unidades = Array.from(
    { length: cantidad },
    (_, i) =>
      `${String(i + 1)}. Volkswagen T-Cross Comfortline 2023 — 35.000 km, caja automática, nafta, color gris plata. Precio de lista: USD 25.400. Acepta permuta y tiene financiación disponible.`,
  );
  return `Te paso las opciones que tenemos disponibles:\n\n${unidades.join("\n\n")}\n\n¿Querés que te cuente más de alguna?`;
}

test("un mensaje que entra en el tope sale entero, sin tocar", () => {
  const corto = "  Hola, ¿en qué te ayudo?  ";
  for (const canal of ["WHATSAPP", "MESSENGER", "INSTAGRAM", "WEB"] as const) {
    assert.deepEqual(partirMensaje(corto, canal), [corto]);
  }
});

test("Web no tiene tope: un texto enorme sigue siendo un solo mensaje", () => {
  const enorme = "a".repeat(20_000);
  assert.deepEqual(partirMensaje(enorme, "WEB"), [enorme]);
});

test("Instagram: el listado largo sale en varios mensajes, cada uno dentro del tope EN BYTES, cortados entre unidades", () => {
  const texto = listadoDeUnidades(8);
  assert.ok(bytes(texto) > 1000, "el caso: no entra en un mensaje de Instagram");

  const partes = partirMensaje(texto, "INSTAGRAM");

  assert.ok(partes.length > 1);
  for (const parte of partes) {
    assert.ok(bytes(parte) <= TOPE_DE_LARGO_POR_CANAL.INSTAGRAM!.maximo, String(bytes(parte)));
    assert.ok(parte.length > 0);
  }
  // No se pierde ni se inventa nada: juntas, las partes son el texto.
  assert.equal(partes.join("\n\n"), texto);
  // Cada parte termina en el final de una unidad, no a mitad de una frase.
  for (const parte of partes.slice(0, -1)) {
    assert.match(parte, /financiación disponible\.$/);
  }
});

test("Messenger: mismo listado, tope de caracteres más alto, menos partes", () => {
  const texto = listadoDeUnidades(20);
  const partes = partirMensaje(texto, "MESSENGER");
  assert.ok(partes.length > 1);
  assert.ok(partes.length < partirMensaje(texto, "INSTAGRAM").length);
  for (const parte of partes) {
    assert.ok(parte.length <= TOPE_DE_LARGO_POR_CANAL.MESSENGER!.maximo);
  }
  assert.equal(partes.join("\n\n"), texto);
});

test("WhatsApp: hasta 4096 caracteres es un mensaje; más, se parte", () => {
  assert.equal(partirMensaje("a".repeat(4096), "WHATSAPP").length, 1);
  const partes = partirMensaje(`${"palabra ".repeat(700)}fin`, "WHATSAPP");
  assert.equal(partes.length, 2);
  assert.ok(partes.every((p) => p.length <= 4096));
});

test("sin párrafos ni renglones corta en el final de una oración, y si no en un espacio", () => {
  const oraciones = "Esta es una oración bastante larga para la prueba. ".repeat(40).trim();
  const porOracion = partirMensaje(oraciones, "INSTAGRAM");
  for (const parte of porOracion) {
    assert.match(parte, /prueba\.$/);
  }

  const palabras = "palabra ".repeat(300).trim();
  const porEspacio = partirMensaje(palabras, "INSTAGRAM");
  for (const parte of porEspacio) {
    assert.match(parte, /^palabra( palabra)*$/, "ninguna palabra partida al medio");
  }
});

test("un texto sin ningún corte posible se parte donde entra, sin romper un emoji ni un acento", () => {
  const sinEspacios = "ñ".repeat(1200);
  const partes = partirMensaje(sinEspacios, "INSTAGRAM");
  assert.equal(partes.join(""), sinEspacios);
  assert.ok(partes.every((p) => bytes(p) <= 950));

  const emojis = "🚗".repeat(600);
  const deEmojis = partirMensaje(emojis, "INSTAGRAM");
  assert.equal(deEmojis.join(""), emojis);
  for (const parte of deEmojis) {
    assert.ok(bytes(parte) <= 950);
    assert.equal(bytes(parte) % 4, 0, "ningún emoji cortado por la mitad");
  }
});

test("cada parte es un pedazo literal del original (lo necesita quien reconoce los ecos)", () => {
  const texto = listadoDeUnidades(12);
  for (const canal of ["MESSENGER", "INSTAGRAM"] as const) {
    for (const parte of partirMensaje(texto, canal)) {
      assert.ok(texto.includes(parte));
    }
  }
});
