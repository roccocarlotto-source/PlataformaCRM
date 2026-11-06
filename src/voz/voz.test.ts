import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import {
  avisoInicial,
  FRASE_SIN_AUDIO,
  LARGO_MAXIMO_DE_LO_DICHO,
  loQueDijoElCliente,
} from "../controllers/voz.controller";
import { motivoParaNoResponder, MENSAJE_LLAMADA } from "../services/conversationReply.service";
import { armarSystemPrompt } from "../services/agentOrchestration.service";
import { datosQueFaltanParaActuar, TOOLS_FUERA_DE_VOZ } from "../services/agentTools.service";
import { esNombreProvisorio } from "../utils/nombreProvisorio";
import { buscarAccesoDeVoz, hashDelSecretoDeVoz, leerAccesosDeVoz } from "./accesos";
import {
  crearEsperaDeVoz,
  DEMORA_DE_LA_PRIMERA_FRASE_MS,
  DEMORA_POR_HERRAMIENTA_MS,
  FRASES_GENERICAS,
  FRASES_POR_HERRAMIENTA,
  SILENCIO_ENTRE_FRASES_MS,
} from "./esperaDeVoz";
import { INSTRUCCION_CANAL_DE_VOZ } from "./instrucciones";
import { crearSalidaPorOraciones, finDelProximoTramo, restoDespuesDe } from "./salidaPorOraciones";
import { chunkDeCierre, chunkDeTexto } from "./sse";
import { digitosDelLlamante } from "./turnoDeVoz.service";
import { crearRegistroDeTurnos, TurnoEnCurso } from "./turnosEnCurso";

const ORG = "11111111-1111-4111-8111-111111111111";
const AGENTE = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  mock.timers.reset();
});

// --- accesos ---------------------------------------------------------------

test("el acceso se encuentra por el hash del secreto, y solo con el exacto", () => {
  const acceso = {
    hash: hashDelSecretoDeVoz("secreto"),
    organizationId: ORG,
    agentId: AGENTE,
    numero: "+59829000000",
  };
  assert.equal(buscarAccesoDeVoz([acceso], "secreto"), acceso);
  assert.equal(buscarAccesoDeVoz([acceso], "secreto "), null);
  assert.equal(buscarAccesoDeVoz([], "secreto"), null);
});

test("una lista de accesos rota se rechaza", () => {
  assert.deepEqual(leerAccesosDeVoz("[]"), []);
  assert.throws(() => leerAccesosDeVoz("no es json"));
  assert.throws(() => leerAccesosDeVoz('[{"hash":"corto"}]'));
});

// --- oraciones -------------------------------------------------------------

function salidaDePrueba(revisar: (acumulado: string) => boolean = () => true) {
  const dichos: string[] = [];
  const salida = crearSalidaPorOraciones({
    decir: (texto) => dichos.push(texto),
    formatear: (texto) => texto.replace(/\*/g, ""),
  });
  salida.empezarRonda(revisar);
  return { dichos, salida };
}

test("el texto sale de a oraciones, sin esperar al final", () => {
  const { dichos, salida } = salidaDePrueba();
  salida.agregar("Hola");
  salida.agregar(", tenemos dos.");
  assert.deepEqual(dichos, []);
  salida.agregar(" ¿Cuál");
  assert.deepEqual(dichos, ["Hola, tenemos dos. "]);
  const dicho = salida.cerrar("Hola, tenemos dos. ¿Cuál querés?");
  assert.deepEqual(dichos, ["Hola, tenemos dos. ", "¿Cuál querés?"]);
  assert.equal(dicho, "Hola, tenemos dos. ¿Cuál querés?");
});

test("los decimales de un precio no cortan la oración", () => {
  assert.equal(finDelProximoTramo("Sale USD 12.500 con todo"), -1);
});

test("una oración larga se corta en la coma", () => {
  const larga = `${"a".repeat(70)}, ${"b".repeat(20)}`;
  assert.equal(finDelProximoTramo(larga), 72);
  assert.equal(finDelProximoTramo("corta, sin punto"), -1);
});

test("un tramo que no pasa la revisión no se dice, ni lo que sigue", () => {
  const { dichos, salida } = salidaDePrueba((acumulado) => !acumulado.includes("secreto"));
  salida.agregar("Hola. Te cuento el secreto. Y más. ");
  assert.deepEqual(dichos, ["Hola. "]);
  const dicho = salida.cerrar("Eso no te lo puedo compartir.");
  assert.deepEqual(dichos, ["Hola. ", "Eso no te lo puedo compartir."]);
  assert.equal(dicho, "Hola. Eso no te lo puedo compartir.");
});

test("la revisión mira todo lo dicho, no solo la última oración", () => {
  const revisados: string[] = [];
  const { salida } = salidaDePrueba((acumulado) => {
    revisados.push(acumulado);
    return true;
  });
  salida.agregar("Uno. Dos. ");
  salida.empezarRonda((acumulado) => {
    revisados.push(acumulado);
    return true;
  });
  salida.agregar("Tres. ");
  assert.deepEqual(revisados, ["Uno.", "Uno. Dos.", "Uno. Dos. Tres."]);
});

test("una etiqueta inventada se retiene hasta el cierre", () => {
  const { dichos, salida } = salidaDePrueba();
  salida.agregar("<respuesta>Hola. Sí tenemos. ");
  assert.deepEqual(dichos, []);
  salida.cerrar("Hola. Sí tenemos.");
  assert.deepEqual(dichos, ["Hola. Sí tenemos."]);
});

test("lo escrito antes de una herramienta queda en lo dicho", () => {
  const { dichos, salida } = salidaDePrueba();
  salida.agregar("Me fijo. Y ");
  salida.empezarRonda(() => true);
  salida.agregar("Hay dos.");
  assert.equal(salida.cerrar("Hay dos."), "Me fijo. Hay dos.");
  assert.deepEqual(dichos, ["Me fijo. ", "Hay dos."]);
});

test("el cierre no repite lo dicho aunque cambien los espacios o el formato", () => {
  const { dichos, salida } = salidaDePrueba();
  salida.agregar("El *Kwid* está. Sale ");
  salida.cerrar("El Kwid  está.\nSale caro.");
  assert.deepEqual(dichos, ["El Kwid está. ", "Sale caro."]);
  assert.equal(restoDespuesDe("Hola  mundo", "Hola mu"), "ndo");
  assert.equal(restoDespuesDe("Otra cosa", "Hola"), null);
});

test("cerrar dos veces no vuelve a decir nada", () => {
  const { dichos, salida } = salidaDePrueba();
  salida.cerrar("Listo.");
  salida.cerrar("Otra cosa.");
  salida.agregar("Y esto. ");
  assert.deepEqual(dichos, ["Listo."]);
});

// --- frases de espera ------------------------------------------------------

function esperaDePrueba() {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const dichas: string[] = [];
  const espera = crearEsperaDeVoz({ decir: (f) => dichas.push(f), usadas: new Set() });
  return { dichas, espera };
}

test("sin texto, una frase genérica a tiempo y otra por cada silencio largo", () => {
  const { dichas, espera } = esperaDePrueba();
  mock.timers.tick(DEMORA_DE_LA_PRIMERA_FRASE_MS - 1);
  assert.deepEqual(dichas, []);
  mock.timers.tick(1);
  assert.deepEqual(dichas, [FRASES_GENERICAS[0]]);
  mock.timers.tick(SILENCIO_ENTRE_FRASES_MS);
  assert.deepEqual(dichas, [FRASES_GENERICAS[0], FRASES_GENERICAS[1]]);
  espera.parar();
  mock.timers.tick(10 * SILENCIO_ENTRE_FRASES_MS);
  assert.equal(dichas.length, 2);
});

test("una herramienta lenta avisa qué está haciendo", () => {
  const { dichas, espera } = esperaDePrueba();
  espera.empezoHerramienta("search_vehicles");
  mock.timers.tick(DEMORA_POR_HERRAMIENTA_MS);
  assert.deepEqual(dichas, [FRASES_POR_HERRAMIENTA.search_vehicles]);
  espera.parar();
});

test("una herramienta rápida no dice nada", () => {
  const { dichas, espera } = esperaDePrueba();
  espera.empezoHerramienta("search_vehicles");
  mock.timers.tick(DEMORA_POR_HERRAMIENTA_MS - 1);
  espera.terminoHerramienta();
  espera.huboTexto();
  mock.timers.tick(SILENCIO_ENTRE_FRASES_MS - 1);
  assert.deepEqual(dichas, []);
  espera.parar();
});

test("todas las frases terminan como espera la plataforma", () => {
  for (const frase of [...FRASES_GENERICAS, ...Object.values(FRASES_POR_HERRAMIENTA)]) {
    assert.match(frase, /\.\.\. $/);
  }
});

test("las frases no se repiten hasta agotarse, y nunca dos iguales seguidas", () => {
  const { dichas, espera } = esperaDePrueba();
  mock.timers.tick(DEMORA_DE_LA_PRIMERA_FRASE_MS);
  for (let i = 0; i < 12; i++) {
    mock.timers.tick(SILENCIO_ENTRE_FRASES_MS);
  }
  espera.parar();
  assert.equal(dichas.length, 13);
  assert.equal(new Set(dichas.slice(0, FRASES_GENERICAS.length)).size, FRASES_GENERICAS.length);
  for (let i = 1; i < dichas.length; i++) {
    assert.notEqual(dichas[i], dichas[i - 1]);
  }
});

// --- turnos en curso -------------------------------------------------------

test("quien llega tarde escucha lo dicho y lo que sigue", () => {
  const turno = new TurnoEnCurso();
  const oido: (string | null)[] = [];
  turno.decir("uno");
  turno.escuchar((parte) => oido.push(parte));
  turno.decir("dos");
  turno.terminar();
  turno.decir("tres");
  assert.deepEqual(oido, ["uno", "dos", null]);
});

test("dejar de escuchar no frena el turno", () => {
  const turno = new TurnoEnCurso();
  const oido: (string | null)[] = [];
  const dejar = turno.escuchar((parte) => oido.push(parte));
  dejar();
  turno.decir("uno");
  turno.terminar();
  assert.deepEqual(oido, []);
  const tarde: (string | null)[] = [];
  turno.escuchar((parte) => tarde.push(parte));
  assert.deepEqual(tarde, ["uno", null]);
});

test("la misma clave no arranca dos veces, y un turno viejo se olvida", () => {
  mock.timers.enable({ apis: ["Date"] });
  const registro = crearRegistroDeTurnos(1000);
  let arranques = 0;
  const contar = () => {
    arranques++;
  };
  const turno = registro.obtenerOArrancar("a", contar);
  assert.equal(registro.obtenerOArrancar("a", contar), turno);
  assert.equal(arranques, 1);
  turno.terminar();
  mock.timers.tick(999);
  assert.equal(registro.obtenerOArrancar("a", contar), turno);
  mock.timers.tick(1);
  assert.notEqual(registro.obtenerOArrancar("a", contar), turno);
  assert.equal(arranques, 2);
});

// --- el pedido -------------------------------------------------------------

test("lo que dijo el cliente es el último mensaje, si es suyo", () => {
  assert.equal(loQueDijoElCliente([{ role: "user", content: " hola " }]), "hola");
  assert.equal(
    loQueDijoElCliente([{ role: "user", content: [{ text: "hola" }, { text: "che" }] }]),
    "hola che",
  );
  assert.equal(loQueDijoElCliente([{ role: "assistant", content: "hola" }]), "");
  assert.equal(
    loQueDijoElCliente([{ role: "user", content: "a".repeat(LARGO_MAXIMO_DE_LO_DICHO + 1) }])
      .length,
    LARGO_MAXIMO_DE_LO_DICHO,
  );
  assert.ok(FRASE_SIN_AUDIO.length > 0);
});

test("el aviso es lo que dijo la plataforma antes que el cliente", () => {
  assert.equal(
    avisoInicial([
      { role: "system", content: "x" },
      { role: "assistant", content: "Aviso" },
      { role: "user", content: "hola" },
    ]),
    "Aviso",
  );
  assert.equal(avisoInicial([{ role: "user", content: "hola" }]), null);
});

test("el stream tiene el formato de OpenAI", () => {
  const datos = { id: "x", modelo: "m", creado: 1 };
  assert.deepEqual(JSON.parse(chunkDeTexto(datos, "hola").slice(6)), {
    id: "x",
    object: "chat.completion.chunk",
    created: 1,
    model: "m",
    choices: [{ index: 0, delta: { content: "hola" }, finish_reason: null }],
  });
  assert.equal(
    (JSON.parse(chunkDeCierre(datos).slice(6)) as { choices: { finish_reason: string }[] })
      .choices[0].finish_reason,
    "stop",
  );
});

test("un número oculto o una variable sin resolver no es un teléfono", () => {
  assert.equal(digitosDelLlamante("+59899123456"), "59899123456");
  assert.equal(digitosDelLlamante("59899123456"), "59899123456");
  assert.equal(digitosDelLlamante("anonymous"), null);
  assert.equal(digitosDelLlamante("{{system__caller_id}}"), null);
  assert.equal(digitosDelLlamante(""), null);
  assert.equal(digitosDelLlamante(null), null);
});

// --- lo que cambia en el resto del agente ----------------------------------

test("el bloque de voz va solo en las llamadas", () => {
  const agente = { instructions: "Sos el agente.", tone: null, guardrails: {} };
  const conCanal = (canal: "VOICE" | "WHATSAPP" | "WEB") =>
    armarSystemPrompt(agente, [], undefined, undefined, null, [], canal);
  assert.ok(conCanal("VOICE").includes(INSTRUCCION_CANAL_DE_VOZ));
  assert.equal(conCanal("WHATSAPP").includes(INSTRUCCION_CANAL_DE_VOZ), false);
  assert.equal(conCanal("WEB").includes(INSTRUCCION_CANAL_DE_VOZ), false);
});

test("por teléfono no se cobra ni se llenan campos personalizados", () => {
  assert.deepEqual([...TOOLS_FUERA_DE_VOZ], ["get_payment_info", "update_contact_custom_fields"]);
});

test("una llamada con número no pide otro dato; con número oculto, sí", () => {
  const contacto = { firstName: "Ana", lastName: "Pérez", email: null };
  assert.deepEqual(datosQueFaltanParaActuar({ ...contacto, phone: "+59899123456" }, "VOICE"), []);
  assert.deepEqual(datosQueFaltanParaActuar({ ...contacto, phone: null }, "VOICE"), [
    "un teléfono o un email",
  ]);
});

test("el nombre que pone una llamada es provisorio", () => {
  assert.equal(esNombreProvisorio({ firstName: "Llamada", lastName: "+59899123456" }), true);
  assert.equal(esNombreProvisorio({ firstName: "Llamada", lastName: "Pérez" }), false);
});

test("a una llamada no se le responde por escrito, y cerrada dice cerrada", () => {
  assert.equal(
    motivoParaNoResponder({ channel: "VOICE", status: "ACTIVE" }, new Date(0)),
    MENSAJE_LLAMADA,
  );
  assert.notEqual(
    motivoParaNoResponder({ channel: "VOICE", status: "CLOSED" }, new Date(0)),
    MENSAJE_LLAMADA,
  );
});
