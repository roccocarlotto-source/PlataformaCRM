import assert from "node:assert/strict";
import { test } from "node:test";
import { instruccionesDelRubro, reglasDelRubro } from "../services/reglasDelRubro";
import {
  MENSAJE_DE_CONSULTA_CLINICA_POR_DEFECTO,
  MENSAJE_DE_CONSULTA_DE_ESTETICA_POR_DEFECTO,
  mensajeDeConsultaClinica,
} from "./config/mensajesDeSalud";
import {
  INSTRUCCION_DE_FECHAS_DE_CLINICA,
  INSTRUCCION_DE_TONO_DE_CLINICA,
} from "./config/textosDelAgente";
import {
  INSTRUCCION_SALUD,
  INSTRUCCION_SALUD_DE_ESTETICA,
  TERMINOS_CLINICOS_DE_ESTETICA,
  TERMINOS_DE_URGENCIA,
  TERMINOS_DE_URGENCIA_DE_ESTETICA,
  clasificarMensajeDeSalud,
  daIndicacionClinica,
  type Termino,
} from "./guardrailsDeSalud";
import { normalizarMensajesDeSalud } from "./services/mensajesDeSalud.service";

// ---------------------------------------------------------------------------
// El perfil de salud de una clínica (docs/primera-clinica.md §4, PR2): MEDICO,
// el de siempre, o ESTETICA, un centro de belleza. Sin base.
//
// Lo primero: MEDICO no cambia (el prompt, la capa 1 y la capa 3 son las de
// antes del perfil). Después, lo que hace ESTETICA.
// ---------------------------------------------------------------------------

const reglas = reglasDelRubro("CLINICA");
const contexto = (perfil?: "MEDICO" | "ESTETICA") => ({
  nombreDeLaOrganizacion: "Centro Ejemplo",
  ...(perfil ? { perfilDeSalud: perfil } : {}),
});

test("MEDICO, o sin perfil: las instrucciones del prompt son las de antes, en el mismo orden", () => {
  const deAntes = [
    INSTRUCCION_SALUD,
    INSTRUCCION_DE_TONO_DE_CLINICA,
    INSTRUCCION_DE_FECHAS_DE_CLINICA,
  ];
  assert.deepEqual(instruccionesDelRubro(reglas, contexto()), deAntes);
  assert.deepEqual(instruccionesDelRubro(reglas, contexto("MEDICO")), deAntes);
});

test("ESTETICA: la instrucción de salud de un centro de belleza va primero, y no habla de pacientes ni de un centro de salud", () => {
  assert.deepEqual(instruccionesDelRubro(reglas, contexto("ESTETICA")), [
    INSTRUCCION_SALUD_DE_ESTETICA,
    INSTRUCCION_DE_TONO_DE_CLINICA,
    INSTRUCCION_DE_FECHAS_DE_CLINICA,
  ]);
  assert.doesNotMatch(INSTRUCCION_SALUD_DE_ESTETICA, /paciente|centro de salud|cl[ií]nica/i);
  // Sigue derivando ante un problema de salud o una urgencia.
  assert.match(INSTRUCCION_SALUD_DE_ESTETICA, /request_human_handoff/);
  assert.match(INSTRUCCION_SALUD_DE_ESTETICA, /emergencias/);
});

test("AUTOMOTORA: ninguna instrucción del rubro, con o sin perfil en el contexto", () => {
  const automotora = reglasDelRubro("AUTOMOTORA");
  assert.deepEqual(instruccionesDelRubro(automotora, contexto()), []);
  assert.deepEqual(instruccionesDelRubro(automotora, contexto("ESTETICA")), []);
});

// ---------------------------------------------------------------------------
// Capa 1
// ---------------------------------------------------------------------------

test("la urgencia de ESTETICA es la de siempre menos exactamente lo decidido, más la autolesión explícita", () => {
  const clave = (t: Termino) => JSON.stringify(t);
  const deEstetica = new Set(TERMINOS_DE_URGENCIA_DE_ESTETICA.map(clave));
  const sacados = TERMINOS_DE_URGENCIA.filter((t) => !deEstetica.has(clave(t))).map(clave);
  assert.deepEqual(sacados.sort(), [
    '"cortarme"',
    '"emergencia"',
    '"shock"',
    '["hinch*","ojo*"]',
    '["hinch*","parpado*"]',
    '["inflam*","ojo*"]',
    '["inflam*","parpado*"]',
  ]);
  const deSiempre = new Set(TERMINOS_DE_URGENCIA.map(clave));
  const sumados = TERMINOS_DE_URGENCIA_DE_ESTETICA.filter((t) => !deSiempre.has(clave(t)));
  assert.deepEqual(sumados, [["cortar*", "venas"]]);
  // Lo que en ESTETICA se deriva a una persona (decisión de Rocco del
  // 2026-11-21), en lugar de la lista clínica del código.
  assert.deepEqual(TERMINOS_CLINICOS_DE_ESTETICA.map(clave), [
    '["hinch*","ojo*"]',
    '["inflam*","ojo*"]',
    '["hinch*","parpado*"]',
    '["inflam*","parpado*"]',
    '["alergi*","tintura*"]',
    '["alergi*","tinte*"]',
    '["alergi*","pegamento*"]',
    '["alergi*","pestan*"]',
  ]);
});

const FRASES_DE_UN_SALON = [
  "Hola, quiero cortarme el pelo el sábado",
  "Quería cortarle el pelo a mi hijo",
  "¿Tienen shock de keratina?",
  "Quiero un masaje, tengo dolor de espalda",
  "¿Hacen masajes para embarazadas?",
  "Perdón la molestia, ¿tienen turno mañana?",
  "¿Hacen tintura sin amoníaco?",
  "Quiero extensiones de pestañas",
  "Tengo manchas en la cara, ¿qué tratamiento hacen?",
  "Hacen alisado sin químicos?",
  "Tengo una emergencia con el color, ¿me pueden atender hoy?",
];

test("ESTETICA: las frases de un salón no disparan nada; en MEDICO siguen como siempre", () => {
  for (const frase of FRASES_DE_UN_SALON) {
    assert.equal(clasificarMensajeDeSalud(frase, undefined, "ESTETICA"), "NINGUNO", frase);
  }
  // MEDICO, sin cambios (lo fija también guardrailsDeSalud.test.ts).
  assert.equal(clasificarMensajeDeSalud("Hola, quiero cortarme el pelo el sábado"), "URGENCIA");
  assert.equal(clasificarMensajeDeSalud("Quiero un masaje, tengo dolor de espalda"), "CLINICA");
});

test("ESTETICA: la hinchazón de ojos o párpados y la alergia a la tintura, el tinte, el pegamento o las pestañas se derivan (sin el mensaje del 911)", () => {
  for (const frase of [
    "Me quedaron los ojos hinchados después del lifting de pestañas",
    "Se me inflamaron los párpados con el tinte",
    "Soy alérgica a la tintura, ¿qué me recomiendan?",
    "Creo que tengo alergia al pegamento de las pestañas",
    "Me dio una reacción alérgica con el tinte",
  ]) {
    assert.equal(clasificarMensajeDeSalud(frase, undefined, "ESTETICA"), "CLINICA", frase);
  }
});

test("ESTETICA: el shock anafiláctico y la anafilaxia siguen siendo urgencias (sale solo 'shock' suelto)", () => {
  for (const frase of [
    "me dio un shock anafiláctico",
    "tuve anafilaxia con un tinte",
    "creo que es un shock anafilactico, se me hincha la garganta",
  ]) {
    assert.equal(clasificarMensajeDeSalud(frase, undefined, "ESTETICA"), "URGENCIA", frase);
  }
  assert.equal(
    clasificarMensajeDeSalud("¿Tienen shock de keratina?", undefined, "ESTETICA"),
    "NINGUNO",
  );
});

test("ESTETICA: las urgencias reales siguen siendo urgencias", () => {
  for (const frase of [
    "no puedo respirar",
    "se me hinchó la cara después del tinte",
    "se me hinchan los labios, me arde",
    "se me cierra la garganta",
    "me desmayé en el lavatorio",
    "me quiero matar",
    "quiero cortarme las venas",
    "sangra mucho después de la depilación",
    "me duele el pecho",
    "llamen una ambulancia",
  ]) {
    assert.equal(clasificarMensajeDeSalud(frase, undefined, "ESTETICA"), "URGENCIA", frase);
  }
});

test("ESTETICA: los términos que agregó la clínica a mano corren igual, de urgencia y clínicos", () => {
  const deLaClinica = { urgencia: ["quemadura con la cera"], clinicos: ["contraindicacion"] };
  assert.equal(
    clasificarMensajeDeSalud("tengo una quemadura con la cera", deLaClinica, "ESTETICA"),
    "URGENCIA",
  );
  assert.equal(
    clasificarMensajeDeSalud("¿tiene alguna contraindicacion?", deLaClinica, "ESTETICA"),
    "CLINICA",
  );
});

// ---------------------------------------------------------------------------
// Capa 3
// ---------------------------------------------------------------------------

test("capa 3 de ESTETICA: los consejos de cuidado pasan (en MEDICO se bloquean)", () => {
  for (const respuesta of [
    "Después del color, aplicate una crema hidratante en las puntas.",
    "No te laves el pelo por 48 horas después del alisado.",
    "Es normal que el color baje un poco en las primeras semanas.",
    "El shampoo viene en frasco de 300 ml.",
    "Con 2 gotas de sérum en las puntas alcanza.",
    "Después de la depilación, ponete hielo si te molesta.",
    "Dejá de usar la plancha por una semana.",
  ]) {
    assert.equal(daIndicacionClinica(respuesta, "ESTETICA"), false, respuesta);
  }
  assert.equal(daIndicacionClinica("Después del color, aplicate una crema hidratante."), true);
  assert.equal(daIndicacionClinica("No te laves el pelo por 48 horas."), true);
});

test("capa 3 de ESTETICA: dosis, medicamentos y diagnósticos se siguen bloqueando", () => {
  for (const respuesta of [
    "Tomate un ibuprofeno si te duele.",
    "Son 500 mg cada 8 horas.",
    "Puede ser una alergia a la tintura.",
    "Ponete pomada en la zona.",
    "Suspendé el antibiótico antes del tratamiento.",
    "Tenés una dermatitis, seguro.",
    "No es grave, se te va a pasar.",
  ]) {
    assert.equal(daIndicacionClinica(respuesta, "ESTETICA"), true, respuesta);
  }
});

// ---------------------------------------------------------------------------
// Mensajes por defecto y la pantalla del ADMIN
// ---------------------------------------------------------------------------

test("el mensaje por defecto de una consulta en ESTETICA no habla de indicaciones médicas", () => {
  assert.equal(
    mensajeDeConsultaClinica("Centro Ejemplo", null, "ESTETICA"),
    MENSAJE_DE_CONSULTA_DE_ESTETICA_POR_DEFECTO.replace("{clinica}", "Centro Ejemplo"),
  );
  assert.doesNotMatch(MENSAJE_DE_CONSULTA_DE_ESTETICA_POR_DEFECTO, /m[eé]dic/i);
  // MEDICO, el de siempre; el texto de la clínica gana en los dos.
  assert.equal(
    mensajeDeConsultaClinica("Centro Ejemplo"),
    MENSAJE_DE_CONSULTA_CLINICA_POR_DEFECTO.replace("{clinica}", "Centro Ejemplo"),
  );
  assert.equal(
    mensajeDeConsultaClinica(
      "Centro Ejemplo",
      "Te escribe una persona del equipo enseguida.",
      "ESTETICA",
    ),
    "Te escribe una persona del equipo enseguida.",
  );
});

test("la pantalla del ADMIN: en ESTETICA, guardar el texto por defecto de su perfil es no guardar nada", () => {
  const vacio = {
    urgencyMessageText: null,
    clinicalMessageText: MENSAJE_DE_CONSULTA_DE_ESTETICA_POR_DEFECTO,
    extraUrgencyTerms: [],
    // En ESTETICA no hay lista clínica del código: "dolor" se conserva como
    // término de la clínica.
    extraClinicalTerms: ["dolor"],
  };
  const normalizado = normalizarMensajesDeSalud(vacio, "ESTETICA");
  assert.equal(normalizado.clinicalMessageText, null);
  assert.deepEqual(normalizado.extraClinicalTerms, ["dolor"]);
  // En MEDICO, el mismo texto es uno propio de la clínica.
  assert.equal(
    normalizarMensajesDeSalud(vacio, "MEDICO").clinicalMessageText,
    MENSAJE_DE_CONSULTA_DE_ESTETICA_POR_DEFECTO,
  );
});
