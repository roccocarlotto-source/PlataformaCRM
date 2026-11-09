import assert from "node:assert/strict";
import { test } from "node:test";
import {
  argumentosDeLaAccion,
  decidirAccion,
  leerHerramientasDeLaPlataforma,
  MENSAJE_A_QUIEN_ATIENDE,
  MENSAJE_AL_CLIENTE_AL_TRANSFERIR,
  numeroParaTransferir,
  SIN_HERRAMIENTAS_DE_LA_PLATAFORMA,
  terminaEnPregunta,
  type HerramientasDeLaPlataforma,
} from "./accionesDeLaLlamada";
import { chunkDeCierre, chunkDeHerramienta } from "./sse";
import { TurnoEnCurso } from "./turnosEnCurso";

// ---------------------------------------------------------------------------
// Transferir y colgar (PR 7), sin base: qué ofrece la plataforma, qué se
// decide al final del turno y cómo sale por el stream.
// ---------------------------------------------------------------------------

const NUMERO = "+59899123456";

const definicionDeTransferir = (numeros?: string[]) => ({
  type: "function",
  function: {
    name: "transfer_to_number",
    description: "Transfiere la llamada",
    parameters: {
      type: "object",
      properties: {
        transfer_number: numeros ? { type: "string", enum: numeros } : { type: "string" },
        client_message: { type: "string" },
        agent_message: { type: "string" },
      },
    },
  },
});

const COLGAR = { type: "function", function: { name: "end_call", parameters: {} } };

test("lee lo que ofrece la plataforma, en el formato de OpenAI o plano", () => {
  const leidas = leerHerramientasDeLaPlataforma([
    COLGAR,
    definicionDeTransferir(),
    { name: "skip_turn" },
  ]);
  assert.deepEqual(leidas, {
    transferir: { numeros: null },
    colgar: true,
    nombres: ["end_call", "transfer_to_number", "skip_turn"],
  });
  assert.deepEqual(
    leerHerramientasDeLaPlataforma([definicionDeTransferir(["+598 99 123 456"])]).transferir,
    { numeros: ["+598 99 123 456"] },
  );
});

test("lo que no entiende no lo usa, y nunca falla", () => {
  for (const tools of [undefined, null, "end_call", {}, [1, "x", null, { function: 3 }]]) {
    const leidas = leerHerramientasDeLaPlataforma(tools);
    assert.equal(leidas.transferir, null);
    assert.equal(leidas.colgar, false);
  }
});

test("el número de la sucursal se compara por dígitos con la lista de la plataforma", () => {
  assert.equal(numeroParaTransferir(NUMERO, null), NUMERO);
  assert.equal(numeroParaTransferir(NUMERO, ["+598 99 123 456"]), "+598 99 123 456");
  assert.equal(numeroParaTransferir(NUMERO, ["+59899000000"]), null);
});

const plataforma = (p: Partial<HerramientasDeLaPlataforma>): HerramientasDeLaPlataforma => ({
  ...SIN_HERRAMIENTAS_DE_LA_PLATAFORMA,
  ...p,
});
const derivar = { derivar: true, fueraDeHorario: false, colgar: false };
const conTodo = plataforma({ transferir: { numeros: null }, colgar: true });

test("derivar con la sucursal abierta, número y plataforma: transfiere al número de la sucursal", () => {
  assert.deepEqual(decidirAccion(derivar, "Te paso con alguien.", NUMERO, conTodo), {
    accion: { tipo: "transferir", numero: NUMERO },
  });
});

test("derivar sin poder transferir: sin acción, con el motivo para el log", () => {
  const casos: [Parameters<typeof decidirAccion>, string][] = [
    [[{ ...derivar, fueraDeHorario: true }, "x", NUMERO, conTodo], "fuera-de-horario"],
    [[derivar, "x", null, conTodo], "sin-numero"],
    [[derivar, "x", NUMERO, plataforma({ colgar: true })], "plataforma-sin-transferencia"],
    [
      [derivar, "x", NUMERO, plataforma({ transferir: { numeros: ["+59899000000"] } })],
      "numero-no-cargado-en-la-plataforma",
    ],
  ];
  for (const [args, motivo] of casos) {
    assert.deepEqual(decidirAccion(...args), { accion: null, sinTransferencia: motivo });
  }
});

test("colgar: solo si la plataforma lo ofrece y lo último dicho no es una pregunta", () => {
  const colgar = { derivar: false, fueraDeHorario: false, colgar: true };
  assert.deepEqual(decidirAccion(colgar, "Gracias por llamar, chau.", null, conTodo), {
    accion: { tipo: "colgar" },
  });
  assert.deepEqual(decidirAccion(colgar, "Listo. ¿Algo más?", null, conTodo), { accion: null });
  assert.deepEqual(decidirAccion(colgar, "Chau.", null, plataforma({})), { accion: null });
  // Sin pedirlo, nunca.
  assert.deepEqual(decidirAccion({ ...colgar, colgar: false }, "Chau.", null, conTodo), {
    accion: null,
  });
  // Derivar gana sobre colgar.
  assert.equal(
    decidirAccion({ ...derivar, colgar: true }, "Te paso.", NUMERO, conTodo).accion?.tipo,
    "transferir",
  );
});

test("terminaEnPregunta mira solo el final", () => {
  assert.equal(terminaEnPregunta("¿Querés el martes? "), true);
  assert.equal(terminaEnPregunta("¿Querés el martes? Te espero."), false);
});

test("los argumentos van como JSON en texto, sin datos del cliente", () => {
  const transferir = argumentosDeLaAccion({ tipo: "transferir", numero: NUMERO });
  assert.equal(transferir.nombre, "transfer_to_number");
  assert.deepEqual(JSON.parse(transferir.argumentos), {
    reason: "El cliente pidió hablar con una persona",
    transfer_number: NUMERO,
    client_message: MENSAJE_AL_CLIENTE_AL_TRANSFERIR,
    agent_message: MENSAJE_A_QUIEN_ATIENDE,
  });
  const colgar = argumentosDeLaAccion({ tipo: "colgar" });
  assert.equal(colgar.nombre, "end_call");
  assert.equal(typeof (JSON.parse(colgar.argumentos) as { reason: unknown }).reason, "string");
});

test("por el stream: la herramienta en el formato de OpenAI y el cierre con tool_calls", () => {
  const datos = { id: "chatcmpl-1", modelo: "agente", creado: 1 };
  const trozo = JSON.parse(
    chunkDeHerramienta(datos, { id: "call_1", nombre: "end_call", argumentos: "{}" }).slice(6),
  ) as { choices: { delta: unknown; finish_reason: string | null }[] };
  assert.deepEqual(trozo.choices[0].delta, {
    tool_calls: [
      { index: 0, id: "call_1", type: "function", function: { name: "end_call", arguments: "{}" } },
    ],
  });
  assert.equal(trozo.choices[0].finish_reason, null);
  assert.match(chunkDeCierre(datos, "tool_calls"), /"finish_reason":"tool_calls"/);
  assert.match(chunkDeCierre(datos), /"finish_reason":"stop"/);
});

test("la acción del final le llega al que escucha y al que se engancha después", () => {
  const turno = new TurnoEnCurso();
  const vistos: unknown[] = [];
  turno.escuchar((texto, accion) => vistos.push([texto, accion]));
  turno.decir("Te paso con alguien.");
  turno.terminar({ tipo: "transferir", numero: NUMERO });
  assert.deepEqual(vistos, [
    ["Te paso con alguien.", undefined],
    [null, { tipo: "transferir", numero: NUMERO }],
  ]);

  const tarde: unknown[] = [];
  turno.escuchar((texto, accion) => tarde.push([texto, accion ?? null]));
  assert.deepEqual(tarde, [
    ["Te paso con alguien.", null],
    [null, { tipo: "transferir", numero: NUMERO }],
  ]);
});
