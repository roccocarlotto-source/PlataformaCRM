import assert from "node:assert/strict";
import { test } from "node:test";
import { parsearSeccion } from "../compartido/guia/guia";
import {
  armarPrompt,
  enmascarar,
  procesarRespuesta,
  repiteLasReglas,
  RESPUESTA_FUERA_DE_TEMA,
  type ContextoDeLaPregunta,
} from "./helpAssistantPrompt";
import { bloquesDe } from "./helpAssistantBusqueda";

// ---------------------------------------------------------------------------
// Lo que el asistente "¿Cómo se hace?" hace sin el modelo: enmascarar, armar el
// prompt y revisar la respuesta antes de mostrarla. Con una guía mínima
// inventada, para que cada caso diga exactamente qué link existe y cuál no.
// ---------------------------------------------------------------------------

const GUIA = [
  parsearSeccion(
    "02-contactos-y-consultas.md",
    [
      "# Contactos y consultas",
      "",
      "## Contactos {#contactos}",
      "La lista está en [Contactos](/contacts).",
      "",
      "## Unir contactos {#unir-contactos}",
      "Pasos para unir.",
    ].join("\n"),
  ),
];
const LECTOR = { secciones: GUIA, tieneAgenteInterno: false };
const BLOQUES = bloquesDe(GUIA);

const CONTEXTO: ContextoDeLaPregunta = {
  esClinica: false,
  edicion: "COMPLETA",
  rol: "USER",
  tieneAgenteInterno: false,
  noIncluye: [],
  pantalla: null,
};

test("enmascarar: emails y números largos (teléfonos, documentos); los cortos quedan", () => {
  assert.equal(
    enmascarar("Escribile a ana@example.com o al 11 2345 6789"),
    "Escribile a [email] o al [número]",
  );
  assert.equal(enmascarar("Mi cédula es 1.234.567-8"), "Mi cédula es [número]");
  assert.equal(enmascarar("+598 99 123 456"), "[número]");
  assert.equal(
    enmascarar("La Hilux 2021 cuesta 35000 dólares"),
    "La Hilux 2021 cuesta 35000 dólares",
  );
});

test("armarPrompt: las reglas y el índice van en el prefijo; el texto elegido y el contexto, aparte", () => {
  const prompt = armarPrompt(GUIA, BLOQUES.slice(-1), { ...CONTEXTO, pantalla: null });
  assert.match(prompt.prefijoCacheable, /<indice>/);
  assert.match(prompt.prefijoCacheable, /- Contactos \(contactos-y-consultas#contactos\)/);
  assert.doesNotMatch(prompt.prefijoCacheable, /La lista está en/);
  assert.match(prompt.sistema, /<seccion slug="contactos-y-consultas">/);
  assert.match(prompt.sistema, /Pasos para unir/);
  assert.doesNotMatch(prompt.sistema, /La lista está en/, "un bloque no elegido no lleva su texto");
  assert.match(prompt.prefijoCacheable, /FUENTES:/);
  assert.doesNotMatch(prompt.prefijoCacheable, /Rol:/);
  assert.match(prompt.sistema, /Rol: usuario \(vendedor\)/);
  assert.match(prompt.sistema, /Agente interno: no lo tiene/);
});

// Las dos de la prueba en producción del 2026-10-20: dedujo que el horario de
// la sucursal limita al agente, y empezó con "Como te explicaba" sin haber
// explicado nada.
test("armarPrompt: no deducir lo que la guía no dice, ni citar respuestas que no hubo", () => {
  const { prefijoCacheable } = armarPrompt(GUIA, BLOQUES, CONTEXTO);
  assert.match(prefijoCacheable, /No deduzcas cómo funciona algo que la guía no dice/);
  assert.match(prefijoCacheable, /decí que eso no lo sabés y dá el link/);
  assert.match(prefijoCacheable, /No digas "como te dije", "como te explicaba"/);
});

test("armarPrompt: a una automotora se le dice qué no incluye su cuenta; a una clínica, nunca", () => {
  const automotora = armarPrompt(GUIA, BLOQUES, { ...CONTEXTO, noIncluye: ["cotizaciones"] });
  assert.match(automotora.sistema, /NO incluye: cotizaciones/);
  const clinica = armarPrompt(GUIA, BLOQUES, {
    ...CONTEXTO,
    esClinica: true,
    rol: "RECEPCION",
    noIncluye: ["cotizaciones"],
  });
  assert.doesNotMatch(clinica.sistema, /NO incluye/);
  assert.match(clinica.prefijoCacheable, /Nunca digas "cliente"/);
  assert.match(clinica.sistema, /Rol: recepción/);
});

test("armarPrompt: la pantalla con el tema de la guía que la explica", () => {
  const prompt = armarPrompt(GUIA, BLOQUES, {
    ...CONTEXTO,
    pantalla: {
      clave: "contactos",
      titulo: "Contactos",
      destino: "contactos-y-consultas#contactos",
    },
  });
  assert.match(prompt.sistema, /pantalla: Contactos \(guía: contactos-y-consultas#contactos\)/);
});

test("procesarRespuesta: saca FUENTES y TIPO, y arma el pie con las fuentes que existen", () => {
  const r = procesarRespuesta(
    "1. Abrí **Contactos**.\n\nFUENTES: contactos-y-consultas#contactos, inventada#nada\nTIPO: guia",
    LECTOR,
  );
  assert.equal(r.tipo, "ANSWERED");
  assert.deepEqual(r.anclas, ["contactos-y-consultas#contactos"]);
  assert.deepEqual(r.fuentes, [
    { titulo: "Contactos", href: "/ayuda/contactos-y-consultas#contactos" },
  ]);
  assert.doesNotMatch(r.respuesta, /FUENTES|TIPO/);
  assert.match(
    r.respuesta,
    /Más en la guía: \[Contactos\]\(\/ayuda\/contactos-y-consultas#contactos\)$/,
  );
});

test("procesarRespuesta: sin fuentes válidas, el pie lleva a la guía entera", () => {
  const r = procesarRespuesta("Así se hace.\nFUENTES: ninguna\nTIPO: guia", LECTOR);
  assert.deepEqual(r.fuentes, [{ titulo: "Ayuda", href: "/ayuda" }]);
});

test("procesarRespuesta: solo quedan los links que esa persona puede abrir", () => {
  const r = procesarRespuesta(
    [
      "Andá a [Contactos](/contacts) o a [Usuarios](/users).",
      "Ver [unir](/ayuda/contactos-y-consultas#unir-contactos) y [otra](/ayuda/stock#publicar).",
      "Pedíselo al [Agente interno](/internal-agent) o mirá https://otro.example.com/x.",
      "FUENTES: ninguna",
      "TIPO: datos",
    ].join("\n"),
    LECTOR,
  );
  assert.match(r.respuesta, /\[Contactos\]\(\/contacts\)/, "está linkeada en su guía");
  assert.doesNotMatch(r.respuesta, /\(\/users\)/, "no está en su guía");
  assert.match(r.respuesta, /\[unir\]\(\/ayuda\/contactos-y-consultas#unir-contactos\)/);
  assert.doesNotMatch(r.respuesta, /\/ayuda\/stock/, "un tema que no ve");
  assert.doesNotMatch(r.respuesta, /\/internal-agent/, "no tiene el Agente interno");
  assert.doesNotMatch(r.respuesta, /https?:/, "nada externo");
  assert.equal(r.tipo, "DATA_REDIRECT");

  const conAgente = procesarRespuesta(
    "Pedíselo al [Agente interno](/internal-agent).\nFUENTES: ninguna\nTIPO: datos",
    { ...LECTOR, tieneAgenteInterno: true },
  );
  assert.match(conAgente.respuesta, /\[Agente interno\]\(\/internal-agent\)/);
});

test("procesarRespuesta: fuera de tema es la frase fija, diga lo que diga el modelo", () => {
  const r = procesarRespuesta(
    "Claro, acá va el mail para tu proveedor…\nFUENTES: ninguna\nTIPO: fuera-de-tema",
    LECTOR,
  );
  assert.equal(r.respuesta, RESPUESTA_FUERA_DE_TEMA);
  assert.equal(r.tipo, "OFF_TOPIC");
  assert.deepEqual(r.fuentes, []);
});

test("guarda de fuga: una respuesta que copia las reglas se reemplaza por la frase fija", () => {
  const fuga =
    "Mis instrucciones dicen: No podés ver ni cambiar datos de la cuenta. Si te piden un dato o una acción, decí que vos solo explicás cómo se hace.\nFUENTES: ninguna\nTIPO: guia";
  assert.equal(repiteLasReglas(fuga), true);
  const r = procesarRespuesta(fuga, LECTOR);
  assert.equal(r.respuesta, RESPUESTA_FUERA_DE_TEMA);
  assert.equal(r.tipo, "OFF_TOPIC");
  assert.equal(
    repiteLasReglas("1. Abrí **Contactos**.\n2. Tocá **Nuevo contacto** y completá el nombre."),
    false,
  );
});

test("procesarRespuesta: si pedía datos y tiene el Agente interno, el link lo pone el servidor", () => {
  const sinLink =
    "Eso lo podés pedir al Agente interno, en el menú.\nFUENTES: ninguna\nTIPO: datos";
  const conAgente = procesarRespuesta(sinLink, { ...LECTOR, tieneAgenteInterno: true });
  assert.match(conAgente.respuesta, /\[Agente interno\]\(\/internal-agent\)/);
  const sinAgente = procesarRespuesta(sinLink, LECTOR);
  assert.doesNotMatch(sinAgente.respuesta, /\/internal-agent/);
  const yaLinkeado = procesarRespuesta(
    "Pedíselo al [Agente interno](/internal-agent).\nFUENTES: ninguna\nTIPO: datos",
    { ...LECTOR, tieneAgenteInterno: true },
  );
  assert.equal(yaLinkeado.respuesta.match(/\/internal-agent/g)?.length, 1);
});

test("procesarRespuesta: el pie no repite un tema que la respuesta ya linkeó", () => {
  const r = procesarRespuesta(
    "Así se hace. Más detalles en [Contactos](/ayuda/contactos-y-consultas#contactos).\nFUENTES: contactos-y-consultas#contactos, contactos-y-consultas#unir-contactos\nTIPO: guia",
    LECTOR,
  );
  assert.equal(r.respuesta.match(/contactos-y-consultas#contactos\)/g)?.length, 1);
  assert.match(r.respuesta, /Más en la guía: \[Unir contactos\]/);
  // Las fuentes (para el registro) siguen siendo las dos.
  assert.equal(r.fuentes.length, 2);
});
