import assert from "node:assert/strict";
import { test } from "node:test";
import { crearSalidaPorOraciones } from "../voz/salidaPorOraciones";
import { formatearParaElCanal } from "./formatoPorCanal";
import { leerDatosEnVoz, leerMail, leerTelefono } from "./lecturaEnVoz";

test("un celular uruguayo se lee de a grupos de tres, con el 09x como lo dice la gente", () => {
  const leido = "cero noventa y seis, cuatro seis ocho, siete ocho ocho";
  assert.equal(leerTelefono("096468788"), leido);
  assert.equal(leerTelefono("096 468 788"), leido);
  assert.equal(leerTelefono("096-468-788"), leido);
  // En formato internacional, igual: con el 0.
  assert.equal(leerTelefono("+59896468788"), leido);
  assert.equal(leerTelefono("+598 96 468 788"), leido);
});

test("los grupos que escribió el modelo se respetan, y si sobra una cifra el último va de cuatro", () => {
  assert.equal(leerTelefono("2900 1234"), "dos nueve cero cero, uno dos tres cuatro");
  assert.equal(
    leerTelefono("0991234567"),
    "cero noventa y nueve, uno dos tres, cuatro cinco seis siete",
  );
  assert.equal(leerTelefono("012345678"), "cero doce, tres cuatro cinco, seis siete ocho");
});

test("un teléfono de otro país lleva el más y va cifra por cifra", () => {
  assert.equal(
    leerTelefono("+5491123456789"),
    "más cinco cuatro nueve, uno uno dos, tres cuatro cinco, seis siete ocho nueve",
  );
});

test("un mail se deletrea letra por letra, y los dominios conocidos se dicen como palabra", () => {
  assert.equal(
    leerMail("ana.r_2@gmail.com"),
    "a, ene, a, punto, erre, guion bajo, dos, arroba, gmail, punto, com",
  );
  assert.equal(
    leerMail("Persona@Empresa.com.uy"),
    "pe, e, erre, ese, o, ene, a, arroba, e, eme, pe, erre, e, ese, a, punto, com, punto, u, i griega",
  );
});

test("en el texto del agente, el teléfono y el mail salen como se dicen", () => {
  assert.equal(
    leerDatosEnVoz("Entonces, para confirmar: tu teléfono es 096 468 788. ¿Es correcto?"),
    "Entonces, para confirmar: tu teléfono es cero noventa y seis, cuatro seis ocho, siete ocho ocho. ¿Es correcto?",
  );
  assert.equal(
    leerDatosEnVoz("Tu mail es lucia@gmail.com, ¿está bien?"),
    "Tu mail es ele, u, ce, i, a, arroba, gmail, punto, com, ¿está bien?",
  );
});

test("un monto sin separadores no se lee como teléfono", () => {
  for (const texto of [
    "Sale 1500000 pesos.",
    "El precio 2500000 incluye el service.",
    "precio 2500000",
    "Son $ 14500000 en total.",
    "Lo dejamos en 25000000 pesos.",
    "Cuesta 12500000",
    "Tiene 680000 km.",
    "Sale US$ 11500000.",
    "Sale 11 500 000 pesos.",
  ]) {
    assert.equal(leerDatosEnVoz(texto), texto, texto);
  }
});

test("la regla del teléfono no toca patentes, años, kilómetros ni precios con puntos", () => {
  for (const texto of [
    "La patente es SBA 1234.",
    "Patente SBA1234, del 2019.",
    "Es un Gol Trend 1.6 del 2019, con 68.000 km.",
    "Sale 11.500 dólares y acepta permuta.",
    "Del 2019 al 2021 hay tres.",
    "Te espero el martes 12 a las 16.",
    "Una unidad de 1.500.000 pesos.",
  ]) {
    assert.equal(leerDatosEnVoz(texto), texto, texto);
  }
});

test("un número largo sin 0, sin más y sin grupos queda como está", () => {
  assert.equal(leerDatosEnVoz("El código es 12345678."), "El código es 12345678.");
});

test("solo por teléfono: en los demás canales el teléfono y el mail quedan escritos", () => {
  const texto = "Te llamamos al 096 468 788 o te escribimos a ana@gmail.com.";
  assert.equal(
    formatearParaElCanal(texto, "VOICE"),
    "Te llamamos al cero noventa y seis, cuatro seis ocho, siete ocho ocho o te escribimos a a, ene, a, arroba, gmail, punto, com.",
  );
  for (const canal of ["WHATSAPP", "MESSENGER", "INSTAGRAM", "WEB"] as const) {
    assert.equal(formatearParaElCanal(texto, canal), texto, canal);
  }
});

test("lo que ya se dijo con el teléfono leído no se repite al cerrar la respuesta", () => {
  const dichos: string[] = [];
  const salida = crearSalidaPorOraciones({
    decir: (t) => dichos.push(t),
    formatear: (t) => formatearParaElCanal(t, "VOICE"),
  });
  salida.empezarRonda(() => true);
  salida.agregar("Tu teléfono es 096 468 788. ¿Es correcto?");
  const final = formatearParaElCanal("Tu teléfono es 096 468 788. ¿Es correcto?", "VOICE");
  salida.cerrar(final);
  assert.deepEqual(dichos, [
    "Tu teléfono es cero noventa y seis, cuatro seis ocho, siete ocho ocho. ",
    "¿Es correcto?",
  ]);
});
