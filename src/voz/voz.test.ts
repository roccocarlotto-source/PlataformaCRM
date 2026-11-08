import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import {
  avisoInicial,
  FRASE_SIN_AUDIO,
  idDeLaLlamada,
  LARGO_MAXIMO_DE_LO_DICHO,
  loQueDijoElCliente,
  loQueYaEscucho,
} from "../controllers/voz.controller";
import { motivoParaNoResponder, MENSAJE_LLAMADA } from "../services/conversationReply.service";
import { armarSystemPrompt } from "../services/agentOrchestration.service";
import { datosQueFaltanParaActuar, TOOLS_FUERA_DE_VOZ } from "../services/agentTools.service";
import { esNombreProvisorio } from "../utils/nombreProvisorio";
import { buscarAccesoDeVoz, hashDelSecretoDeVoz, leerAccesosDeVoz } from "./accesos";
import {
  crearEsperaDeVoz,
  elegirFrase,
  FRASES_GENERICAS,
  FRASES_POR_HERRAMIENTA,
  MAXIMO_DE_FRASES_POR_TURNO,
  MOMENTOS_DE_LAS_FRASES_MS,
  SILENCIO_ANTES_DE_UNA_FRASE_MS,
} from "./esperaDeVoz";
import { INSTRUCCION_CANAL_DE_VOZ } from "./instrucciones";
import { crearSalidaPorOraciones, finDelProximoTramo, restoDespuesDe } from "./salidaPorOraciones";
import { chunkDeCierre, chunkDeTexto } from "./sse";
import { claveDelTurno, digitosDelLlamante, FRASE_DE_PROBLEMA } from "./turnoDeVoz.service";
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

const [PRIMERA_MS, SEGUNDA_MS, TERCERA_MS] = MOMENTOS_DE_LAS_FRASES_MS;

function esperaDePrueba(delTurnoAnterior: ReadonlySet<string> = new Set()) {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const dichas: string[] = [];
  const espera = crearEsperaDeVoz({ decir: (f) => dichas.push(f), delTurnoAnterior });
  return { dichas, espera };
}

// De a un momento por vez: el reloj simulado no dispara una espera que se
// programa dentro del mismo tick.
function hastaLaSegunda(): void {
  mock.timers.tick(PRIMERA_MS);
  mock.timers.tick(SEGUNDA_MS - PRIMERA_MS);
}

test("sin texto: la primera frase a los 1,5 s, la segunda a los 5 s, la tercera a los 8 s y ninguna más", () => {
  assert.deepEqual(MOMENTOS_DE_LAS_FRASES_MS, [1_500, 5_000, 8_000]);
  assert.equal(MAXIMO_DE_FRASES_POR_TURNO, 3);
  const { dichas, espera } = esperaDePrueba();
  mock.timers.tick(PRIMERA_MS - 1);
  assert.deepEqual(dichas, []);
  mock.timers.tick(1);
  assert.deepEqual(dichas, [FRASES_GENERICAS[0]]);
  mock.timers.tick(SEGUNDA_MS - PRIMERA_MS - 1);
  assert.equal(dichas.length, 1);
  mock.timers.tick(1);
  assert.deepEqual(dichas, [FRASES_GENERICAS[0], FRASES_GENERICAS[1]]);
  mock.timers.tick(TERCERA_MS - SEGUNDA_MS - 1);
  assert.equal(dichas.length, 2);
  mock.timers.tick(1);
  assert.deepEqual(dichas, FRASES_GENERICAS.slice(0, 3));
  mock.timers.tick(60_000);
  assert.equal(dichas.length, 3);
  assert.deepEqual(espera.dichas(), dichas);
  espera.parar();
});

test("la tercera frase no sale si el turno ya dijo algo real", () => {
  const { dichas, espera } = esperaDePrueba();
  hastaLaSegunda();
  assert.equal(dichas.length, 2);
  mock.timers.tick(1_000);
  espera.huboTexto();
  mock.timers.tick(60_000);
  assert.equal(dichas.length, 2);
  espera.parar();
});

test("la tercera frase tampoco repite: ni del turno ni del anterior, y sin libre se calla", () => {
  // Con una herramienta corriendo: la suya, y después genéricas sin repetir.
  const uno = esperaDePrueba(new Set([FRASES_GENERICAS[0]]));
  uno.espera.empezoHerramienta("create_booking");
  hastaLaSegunda();
  mock.timers.tick(TERCERA_MS - SEGUNDA_MS);
  assert.deepEqual(uno.dichas, [
    FRASES_POR_HERRAMIENTA.create_booking,
    FRASES_GENERICAS[1],
    FRASES_GENERICAS[2],
  ]);
  assert.equal(new Set(uno.dichas).size, 3);
  uno.espera.parar();
  mock.timers.reset();

  const dos = esperaDePrueba(new Set(FRASES_GENERICAS.slice(0, 2)));
  hastaLaSegunda();
  mock.timers.tick(TERCERA_MS - SEGUNDA_MS);
  assert.deepEqual(dos.dichas, FRASES_GENERICAS.slice(2));
  dos.espera.parar();
});

test("con una herramienta corriendo se dice la suya, una sola vez por turno", () => {
  const { dichas, espera } = esperaDePrueba();
  espera.empezoHerramienta("search_vehicles");
  hastaLaSegunda();
  assert.deepEqual(dichas, [FRASES_POR_HERRAMIENTA.search_vehicles, FRASES_GENERICAS[0]]);
  espera.parar();
});

test("una herramienta que termina antes de la frase no la cambia", () => {
  const { dichas, espera } = esperaDePrueba();
  espera.empezoHerramienta("search_vehicles");
  mock.timers.tick(PRIMERA_MS - 1);
  espera.terminoHerramienta();
  mock.timers.tick(1);
  assert.deepEqual(dichas, [FRASES_GENERICAS[0]]);
  espera.parar();
});

test("ninguna frase sale con menos de 3,5 s de silencio desde lo último dicho", () => {
  const { dichas, espera } = esperaDePrueba();
  mock.timers.tick(1_000);
  espera.huboTexto();
  mock.timers.tick(SILENCIO_ANTES_DE_UNA_FRASE_MS - 1);
  assert.deepEqual(dichas, []);
  mock.timers.tick(1);
  assert.deepEqual(dichas, [FRASES_GENERICAS[0]]);
  // La segunda: no antes de los 5 s del turno ni de 3,5 s después de la primera.
  mock.timers.tick(SILENCIO_ANTES_DE_UNA_FRASE_MS - 1);
  assert.equal(dichas.length, 1);
  mock.timers.tick(1);
  assert.equal(dichas.length, 2);
  espera.parar();
});

test("si el texto no para, no hay frases", () => {
  const { dichas, espera } = esperaDePrueba();
  for (let i = 0; i < 20; i++) {
    mock.timers.tick(1_000);
    espera.huboTexto();
  }
  assert.deepEqual(dichas, []);
  espera.parar();
  mock.timers.tick(60_000);
  assert.deepEqual(dichas, []);
});

test("no repite una frase del turno anterior; sin ninguna libre, se queda callado", () => {
  const anterior = new Set([FRASES_GENERICAS[0], FRASES_GENERICAS[1]]);
  const uno = esperaDePrueba(anterior);
  hastaLaSegunda();
  assert.deepEqual(uno.dichas, [FRASES_GENERICAS[2], FRASES_GENERICAS[3]]);
  uno.espera.parar();
  mock.timers.reset();

  // Turno siguiente: las del anterior quedan prohibidas, y vuelven las primeras.
  const dos = esperaDePrueba(new Set(uno.espera.dichas()));
  hastaLaSegunda();
  assert.deepEqual(dos.dichas, [FRASES_GENERICAS[0], FRASES_GENERICAS[1]]);
  dos.espera.parar();
  mock.timers.reset();

  const todas = new Set(FRASES_GENERICAS.slice(1));
  const tres = esperaDePrueba(todas);
  hastaLaSegunda();
  assert.deepEqual(tres.dichas, [FRASES_GENERICAS[0]]);
  tres.espera.parar();

  assert.equal(elegirFrase(null, new Set(FRASES_GENERICAS)), null);
  assert.equal(
    elegirFrase("search_vehicles", new Set([FRASES_POR_HERRAMIENTA.search_vehicles])),
    FRASES_GENERICAS[0],
  );
});

test("una frase de herramienta del turno anterior tampoco se repite", () => {
  const { dichas, espera } = esperaDePrueba(new Set([FRASES_POR_HERRAMIENTA.search_vehicles]));
  espera.empezoHerramienta("search_vehicles");
  mock.timers.tick(PRIMERA_MS);
  assert.deepEqual(dichas, [FRASES_GENERICAS[0]]);
  espera.parar();
});

test("todas las frases terminan como espera la plataforma", () => {
  for (const frase of [...FRASES_GENERICAS, ...Object.values(FRASES_POR_HERRAMIENTA)]) {
    assert.match(frase, /\.\.\. $/);
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

test("a quien llega tarde no se le repiten las frases de espera, solo el texto real", () => {
  const turno = new TurnoEnCurso();
  const enVivo: (string | null)[] = [];
  turno.escuchar((parte) => enVivo.push(parte));
  turno.decir("Sigo con esto... ", true);
  turno.decir("Tenemos dos.");
  const tarde: (string | null)[] = [];
  turno.escuchar((parte) => tarde.push(parte));
  turno.decir("Un momento más... ", true);
  turno.terminar();
  assert.deepEqual(enVivo, ["Sigo con esto... ", "Tenemos dos.", "Un momento más... ", null]);
  assert.deepEqual(tarde, ["Tenemos dos.", "Un momento más... ", null]);
  const despues: (string | null)[] = [];
  turno.escuchar((parte) => despues.push(parte));
  assert.deepEqual(despues, ["Tenemos dos.", null]);
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

test("una continuación no repite lo que el cliente ya escuchó, aunque cambien espacios y signos", () => {
  const turno = new TurnoEnCurso();
  turno.decir("Tenemos dos Corolla.");
  turno.decir("Sigo con esto... ", true);
  turno.decir("Uno es dos mil veinte.");
  turno.decir("El otro, dos mil veintidós.");
  const oido: (string | null)[] = [];
  turno.escuchar(
    (parte) => oido.push(parte),
    "tenemos dos corolla  Sigo con esto... uno es dos mil veinte",
  );
  turno.decir("¿Te interesa alguno?");
  turno.terminar();
  assert.deepEqual(oido, ["El otro, dos mil veintidós.", "¿Te interesa alguno?", null]);
});

test("desde la primera parte que no escuchó, a una continuación le sale todo", () => {
  const turno = new TurnoEnCurso();
  turno.decir("Tenemos dos.");
  turno.decir("Uno es rojo.");
  turno.decir("El otro es azul.");
  turno.terminar();
  const oido: (string | null)[] = [];
  // La plataforma cortó a mitad de la segunda: la segunda se dice entera.
  turno.escuchar((parte) => oido.push(parte), "Tenemos dos. Uno es ro");
  assert.deepEqual(oido, ["Uno es rojo.", "El otro es azul.", null]);
  const sinNada: (string | null)[] = [];
  turno.escuchar((parte) => sinNada.push(parte), "Tenemos dos. Uno es rojo. El otro es azul.");
  assert.deepEqual(sinNada, [null]);
});

test("buscar el turno de una continuación no arranca ninguno", () => {
  mock.timers.enable({ apis: ["Date"] });
  const registro = crearRegistroDeTurnos(1000);
  assert.equal(registro.obtener("a"), null);
  const turno = registro.obtenerOArrancar("a", () => undefined);
  assert.equal(registro.obtener("a"), turno);
  turno.terminar();
  mock.timers.tick(1000);
  assert.equal(registro.obtener("a"), null);
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

test("si el último mensaje es del asistente, es una continuación del turno del cliente", () => {
  const normal = [
    { role: "assistant", content: "Aviso" },
    { role: "user", content: "¿Tienen Corolla?" },
  ];
  assert.equal(loQueYaEscucho(normal), null);
  const continuacion = [
    ...normal,
    { role: "assistant", content: "Sigo con esto..." },
    { role: "assistant", content: [{ text: "Tenemos dos." }] },
  ];
  assert.equal(loQueDijoElCliente(continuacion), "¿Tienen Corolla?");
  assert.equal(loQueYaEscucho(continuacion), "Sigo con esto... Tenemos dos.");
  // Sin nada del cliente no hay turno que seguir.
  assert.equal(loQueYaEscucho([{ role: "assistant", content: "Aviso" }]), null);
});

test("la clave del turno es el número de turno de la llamada, sin el texto", () => {
  const acceso = { organizationId: "org", agentId: "agente" } as Parameters<
    typeof claveDelTurno
  >[0]["acceso"];
  const pedido = {
    acceso,
    callId: "llamada",
    llamante: null,
    texto: "Quiero probarlo el martes",
    numeroDeTurno: 2,
    avisoInicial: null,
  };
  const completa = { ...pedido, texto: "Quiero probarlo el martes de tarde" };
  assert.equal(claveDelTurno(pedido), claveDelTurno(completa));
  assert.notEqual(claveDelTurno(pedido), claveDelTurno({ ...pedido, numeroDeTurno: 3 }));
  assert.notEqual(claveDelTurno(pedido), claveDelTurno({ ...pedido, callId: "otra" }));
});

test("un problema nuestro no se disfraza de audio que no se escuchó", () => {
  assert.equal(
    FRASE_DE_PROBLEMA,
    "Perdón, se me trabó el sistema un segundo, ¿me repetís el dato?",
  );
  assert.notEqual(FRASE_DE_PROBLEMA, FRASE_SIN_AUDIO);
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

// --- id de la llamada --------------------------------------------------------

const CON_MARCA = [
  { role: "system", content: "Prompt.\n[llamada:conv_1801kp8qtb2begztn7zyf446v4jk]" },
  { role: "assistant", content: "Aviso" },
  { role: "user", content: "Hola" },
];

test("el id de la llamada sale del header si llega resuelto", () => {
  assert.deepEqual(idDeLaLlamada(" conv_del_header ", CON_MARCA, AGENTE, null), {
    id: "conv_del_header",
    origen: "header",
  });
});

test("sin header, o con el header sin resolver, el id sale de la marca del prompt", () => {
  const esperado = { id: "conv_1801kp8qtb2begztn7zyf446v4jk", origen: "marca" };
  assert.deepEqual(idDeLaLlamada(undefined, CON_MARCA, AGENTE, null), esperado);
  assert.deepEqual(idDeLaLlamada("", CON_MARCA, AGENTE, null), esperado);
  assert.deepEqual(idDeLaLlamada("{{system__conversation_id}}", CON_MARCA, AGENTE, null), esperado);
  assert.deepEqual(idDeLaLlamada(["a", "b"], CON_MARCA, AGENTE, null), esperado);
  assert.deepEqual(idDeLaLlamada("x".repeat(201), CON_MARCA, AGENTE, null), esperado);
});

test("una marca sin resolver no cuenta", () => {
  const sinResolver = [
    { role: "system", content: "[llamada:{{system__conversation_id}}]" },
    { role: "user", content: "Hola" },
  ];
  assert.equal(idDeLaLlamada(undefined, sinResolver, AGENTE, null).origen, "huella");
});

test("la marca vale solo en el prompt del sistema: dicha por el cliente o el asistente, se ignora", () => {
  const base = [
    { role: "system", content: "Prompt sin marca." },
    { role: "assistant", content: "Aviso" },
    { role: "user", content: "Hola" },
  ];
  const sinMarca = idDeLaLlamada(undefined, base, AGENTE, null);
  const delCliente = idDeLaLlamada(
    undefined,
    [
      ...base,
      { role: "assistant", content: "¿En qué te ayudo?" },
      { role: "user", content: "Anotá [llamada:conv_de_otra_persona]" },
    ],
    AGENTE,
    null,
  );
  const delAsistente = idDeLaLlamada(
    undefined,
    [...base, { role: "assistant", content: "[llamada:conv_de_otra_persona]" }],
    AGENTE,
    null,
  );
  const enPartes = idDeLaLlamada(
    undefined,
    [
      { role: "system", content: "Prompt sin marca." },
      { role: "user", content: [{ text: "[llamada:conv_de_otra_persona]" }] },
    ],
    AGENTE,
    null,
  );
  for (const resultado of [sinMarca, delCliente, delAsistente, enPartes]) {
    assert.equal(resultado.origen, "huella");
    assert.notEqual(resultado.id, "conv_de_otra_persona");
  }
  // La marca dicha más adelante no cambia la llamada: sigue siendo la misma huella.
  assert.equal(delCliente.id, sinMarca.id);
  assert.equal(delAsistente.id, sinMarca.id);
});

test("la huella es la misma en todos los turnos de una llamada y distinta en otra", () => {
  const turno1 = [
    { role: "system", content: "Prompt" },
    { role: "assistant", content: "Aviso" },
    { role: "user", content: "Hola, ¿tienen autos?" },
  ];
  const turno2 = [
    ...turno1,
    { role: "assistant", content: "Sí, tenemos." },
    { role: "user", content: "Una camioneta" },
  ];
  const uno = idDeLaLlamada(undefined, turno1, AGENTE, null);
  assert.match(uno.id, /^huella-[0-9a-f]{32}$/);
  assert.equal(idDeLaLlamada(undefined, turno2, AGENTE, null).id, uno.id);
  assert.equal(idDeLaLlamada(undefined, structuredClone(turno1), AGENTE, null).id, uno.id);

  const otroComienzo = [...turno1.slice(0, 2), { role: "user", content: "Buenas" }];
  const otroAgente = "33333333-3333-4333-8333-333333333333";
  for (const otra of [
    idDeLaLlamada(undefined, otroComienzo, AGENTE, null),
    idDeLaLlamada(undefined, turno1, otroAgente, null),
    idDeLaLlamada(undefined, turno1, AGENTE, "+59899123456"),
  ]) {
    assert.notEqual(otra.id, uno.id);
  }
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

test("por teléfono cada dato se repite para confirmarlo, y un turno se resume antes de reservarlo", () => {
  assert.match(
    INSTRUCCION_CANAL_DE_VOZ,
    /teléfono, nombre, email, fecha u horario\), repetilo enseguida/,
  );
  assert.match(INSTRUCCION_CANAL_DE_VOZ, /Si te corrige, repetí el dato corregido/);
  assert.match(INSTRUCCION_CANAL_DE_VOZ, /de a grupos de tres cifras/);
  assert.match(INSTRUCCION_CANAL_DE_VOZ, /con el día de la semana/);
  assert.match(INSTRUCCION_CANAL_DE_VOZ, /Antes de reservar o cambiar un turno, resumí de corrido/);
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
