import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TERMINOS_CLINICOS,
  TERMINOS_DE_URGENCIA,
  clasificarMensajeDeSalud,
  daIndicacionClinica,
  normalizar,
  type Termino,
} from "./guardrailsDeSalud";

// ---------------------------------------------------------------------------
// Guardrails de salud (docs/rubros.md §5.3), sin base ni red. Capa 1: un caso
// por término (generado de las listas, así un término nuevo ya tiene el suyo)
// más frases reales con tildes, errores de tipeo y letras repetidas, y las
// que NO tienen que disparar. Capa 3: dosis, indicaciones y frases
// diagnósticas se bloquean; turnos y precios pasan.
// ---------------------------------------------------------------------------

// Una frase con el término adentro: el asterisco se completa ("hinch*" →
// "hinchó") y las partes de una combinación van separadas.
function fraseCon(termino: Termino): string {
  const partes = typeof termino === "string" ? [termino] : [...termino];
  return `Hola, ${partes.map((p) => p.replace(/\*/g, "ó")).join(" y ")}, gracias`;
}

test("normalizar: minúsculas, sin tildes ni signos, espacios colapsados y letras repetidas reducidas", () => {
  assert.equal(normalizar("  ¡Me ARDEEEE   muchísimo!!  "), "me arde muchisimo");
  assert.equal(normalizar("¿Se me hinchó la cara?"), "se me hincho la cara");
  assert.equal(normalizar("Pastillas"), "pastilas");
});

for (const termino of TERMINOS_DE_URGENCIA) {
  test(`URGENCIA: ${JSON.stringify(termino)}`, () => {
    assert.equal(clasificarMensajeDeSalud(fraseCon(termino)), "URGENCIA", fraseCon(termino));
  });
}

for (const termino of TERMINOS_CLINICOS) {
  test(`CLINICA: ${JSON.stringify(termino)}`, () => {
    assert.equal(clasificarMensajeDeSalud(fraseCon(termino)), "CLINICA", fraseCon(termino));
  });
}

test("URGENCIA en frases reales: con tildes, sin tildes, con errores de tipeo y letras repetidas", () => {
  for (const frase of [
    "No puedo respirar",
    "no puedo repirar bien",
    "NO PUEDO RESPIRAAAAR!!!",
    "Se me hinchó la cara después del tratamiento",
    "se me hincho la lengua",
    "tengo los labios inflamados y me cuesta tragar",
    "Me duele mucho el pecho",
    "siento presión en el pecho",
    "Me desmayé recién",
    "me desmalle", // error de tipeo: desmayé
    "Mi hija perdió el conocimiento",
    "está sangrando mucho y no para",
    "tengo una hemorajia",
    "no quiero vivir más",
    "creo que es una reacción alérgica grave",
    "es una emergencia",
  ]) {
    assert.equal(clasificarMensajeDeSalud(frase), "URGENCIA", frase);
  }
});

test("CLINICA en frases reales: síntomas, medicación, ¿es normal?, embarazo, diagnóstico", () => {
  for (const frase of [
    "Me arde la zona del láser",
    "me ardeeee",
    "Me salieron granitos después de la limpieza",
    "me quedó rojo el brazo",
    "Se me infectó la piel",
    "¿Puedo tomar ibuprofeno antes del turno?",
    "tomo antibióticos, ¿hay problema?",
    "¿Es normal que me pique?",
    "¿es normaaal que me pique así?",
    "Estoy embarazada de 3 meses, ¿puedo hacerme el peeling?",
    "estoy en período de lactancia",
    "¿Qué me pasa? Tengo manchas",
    "soy diabética",
    "me operaron hace un mes",
    "tengo una consulta clínica",
  ]) {
    assert.equal(clasificarMensajeDeSalud(frase), "CLINICA", frase);
  }
});

test("NINGUNO: turnos, precios, horarios y las frases parecidas que no son clínicas", () => {
  for (const frase of [
    "¿Cuánto sale la limpieza facial?",
    "Quiero un turno el martes",
    "Hola, ¿tienen lugar mañana a las 10?",
    "¿Dónde quedan?",
    "¿Aceptan tarjeta?",
    "¿Puedo usar tarjeta de débito?",
    "¿Puedo tomar el turno de las 11?",
    "¿Qué tengo que llevar?",
    "Quiero cancelar mi turno",
    "Gracias, nos vemos",
    "Buen día",
    "¿Hacen depilación láser?",
    "¿Cuál es el horario del sábado?",
    "¿Me pasás el precio de la sesión de masajes?",
    "¿De qué color es el esmalte?",
    "¿Por qué medio pago?",
    "Mi nombre es Ana Pérez",
    "¿Tienen estacionamiento?",
    "",
    "   ",
  ]) {
    assert.equal(clasificarMensajeDeSalud(frase), "NINGUNO", frase);
  }
});

// R11: "costra*" con un error de tipeo agarraba cualquier palabra que empezara
// con "contra". La raíz con tolerancia ahora exige que lo que sigue sea una
// terminación.
const FRASES_COMERCIALES = [
  "hace una contraoferta",
  "Te hago una contraoferta",
  "Firmo el contrato",
  "Olvidé mi contraseña",
  "Estoy en contra",
  "¿Pago contra reembolso?",
  "¿Cuál es el precio?",
  "¿Tienen alguna oferta?",
  "La oferta vence hoy",
  "Promoción de verano",
  "¿Hay promo?",
  "¿Me hacen descuento?",
  "Descuento por pago en efectivo",
  "Precio final con descuento",
  "Consulta de precio",
  "Quiero consultar el precio",
  "¿Cuánto cuesta el paquete de 6 sesiones?",
  "¿Tienen cuotas sin interés?",
  "Pago con transferencia",
  "Me pasás el presupuesto",
  "¿La primera consulta es gratis?",
  "Contratar el pack",
  "Me contacto mañana",
  "Costo total",
  "Me costó caro",
  "¿Puedo pagar la seña del turno?",
  "Cambiar el turno",
  "Cancelar el turno",
];

test("NINGUNO: frases comerciales comunes no disparan ningún término", () => {
  for (const frase of FRASES_COMERCIALES) {
    assert.equal(clasificarMensajeDeSalud(frase), "NINGUNO", frase);
  }
});

test("la tolerancia a un error de tipeo sigue agarrando síntomas y urgencias con su terminación", () => {
  for (const [frase, esperado] of [
    ["me salieron costras", "CLINICA"],
    ["tengo una cosrtra en la pierna", "CLINICA"],
    ["me quedó un hematona", "CLINICA"],
    ["tengo morretones", "CLINICA"],
    ["me desmalle", "URGENCIA"],
    ["me desmallé dos veces", "URGENCIA"],
    ["tengo una hemorajia", "URGENCIA"],
    ["me puse colorada y enrojesida", "CLINICA"],
  ] as const) {
    assert.equal(clasificarMensajeDeSalud(frase), esperado, frase);
  }
});

test("un pedido de reprogramar con un síntoma o una urgencia adentro sigue disparando", () => {
  assert.equal(
    clasificarMensajeDeSalud(
      "Te hago una contraoferta: cambiame el turno, que se me hinchó la cara",
    ),
    "URGENCIA",
  );
  assert.equal(
    clasificarMensajeDeSalud("Quiero cambiar el turno, me arde mucho la zona"),
    "CLINICA",
  );
});

test("pedir un turno urgente es agendar: no dispara; con un síntoma, dispara por el síntoma", () => {
  for (const frase of [
    "Necesito un turno urgente",
    "necesito un turno urgente",
    "¿Tienen algo urgente para mañana?",
    "Es urgente, ¿me dan un turno hoy?",
  ]) {
    assert.equal(clasificarMensajeDeSalud(frase), "NINGUNO", frase);
  }
  assert.equal(clasificarMensajeDeSalud("Turno urgente, me sangra mucho"), "URGENCIA");
  assert.equal(clasificarMensajeDeSalud("Necesito un turno urgente, me arde la zona"), "CLINICA");
});

test("la urgencia gana sobre la consulta clínica en el mismo mensaje", () => {
  assert.equal(clasificarMensajeDeSalud("me arde la cara y se me hinchó la lengua"), "URGENCIA");
});

// ---------------------------------------------------------------------------
// Capa 3
// ---------------------------------------------------------------------------

test("daIndicacionClinica: dosis, indicaciones sobre el cuerpo y frases diagnósticas se bloquean", () => {
  for (const respuesta of [
    "Tomá 400 mg de ibuprofeno cada 8 horas.",
    "Podés tomar un paracetamol.",
    "Aplicate hielo 10 minutos.",
    "Ponete crema con aloe a la noche.",
    "Tomate un antihistamínico y fijate.",
    "Suspendé la medicación hasta el turno.",
    "Dejá de usar la crema por unos días.",
    "Usalo dos veces al día.",
    "Parece ser una reacción alérgica.",
    "Es normal que te arda un poco.",
    "No es grave, se pasa solo.",
    "Puede ser una infección, nada más.",
    "Probablemente sea irritación por el láser.",
    "Son síntomas de una dermatitis.",
    "No te rasques la zona.",
  ]) {
    assert.equal(daIndicacionClinica(respuesta), true, respuesta);
  }
});

test("daIndicacionClinica: turnos, precios y horarios pasan", () => {
  for (const respuesta of [
    "Te reservé el turno para el martes a las 10.",
    "La limpieza facial cuesta $2500.",
    "Tenemos lugar el jueves a las 15 hs.",
    "La sesión dura 60 minutos.",
    "Aceptamos tarjeta y efectivo.",
    "Pasate por la clínica cuando quieras.",
    "Ponete en contacto con recepción y te ayudan.",
    "El precio de la depilación es de $1500 por sesión.",
    "Abrimos de lunes a viernes de 9 a 18.",
    "¿Querés que te agende para el sábado?",
  ]) {
    assert.equal(daIndicacionClinica(respuesta), false, respuesta);
  }
});
