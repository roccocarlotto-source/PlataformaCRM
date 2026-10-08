import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ConversationChannel } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  findUnidentifiedContactIds,
  LARGO_DEL_ULTIMO_MENSAJE,
} from "../repositories/consultasSinIdentificar.repository";
import { AppError } from "../utils/AppError";
import { tieneNombreCompleto } from "../utils/nombreProvisorio";
import { desmontar, montar, type Escenario } from "./automation.test-helper";
import {
  CONTACTO_NO_ES_CONSULTA,
  descartarConsulta,
  listarConsultasSinIdentificar,
  listContacts,
  updateContact,
} from "./contact.service";
import { createOpportunity } from "./opportunity.service";

// ---------------------------------------------------------------------------
// "Consultas sin identificar" (ítem 184) contra Postgres real: el predicado
// SQL dice lo mismo que utils/nombreProvisorio.ts, las dos vistas del listado
// se reparten los contactos, una consulta pasa sola a Clientes cuando da su
// nombre o se le crea una oportunidad, y descartar cierra lo abierto y da de
// baja. Escenario de automation.test-helper (una organización con su ADMIN
// real, pipeline, etapa y empresa, que es lo que una oportunidad exige).
// ---------------------------------------------------------------------------

let e: Escenario;
let branchId: string;
let agentId: string;

before(async () => {
  e = await montar("consultas");
  const branch = await prisma.branch.create({
    data: { organizationId: e.organizationId, name: "Centro", timezone: "America/Montevideo" },
  });
  branchId = branch.id;
  const agent = await prisma.agent.create({
    data: {
      organizationId: e.organizationId,
      branchId,
      name: "Vera",
      instructions: "Atendé consultas.",
      modelProvider: "openrouter",
      modelName: "test/model",
      enabledTools: [],
      guardrails: {},
      channels: ["WEB"],
    },
  });
  agentId = agent.id;
});

after(async () => {
  await desmontar(e);
});

function crearContacto(
  firstName: string,
  lastName: string,
  extra: { phone?: string; organizationId?: string } = {},
) {
  return prisma.contact.create({
    data: {
      organizationId: extra.organizationId ?? e.organizationId,
      firstName,
      lastName,
      ...(extra.phone ? { phone: extra.phone } : {}),
    },
  });
}

// Una conversación con sus mensajes; `escribio` es el instante del ÚLTIMO
// entrante (los demás se ordenan a un minuto cada uno, hacia atrás).
async function conversar(
  contactId: string,
  channel: ConversationChannel,
  mensajes: { de: "cliente" | "agente"; texto: string }[],
  escribio: Date,
  status: "ACTIVE" | "TRANSFERRED_TO_HUMAN" | "CLOSED" = "ACTIVE",
) {
  const ultimo = mensajes.length - 1;
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: e.organizationId,
      branchId,
      agentId,
      contactId,
      channel,
      status,
      lastMessageAt: escribio,
    },
  });
  await prisma.message.createMany({
    data: mensajes.map((m, i) => ({
      organizationId: e.organizationId,
      conversationId: conversation.id,
      direction: m.de === "cliente" ? ("INBOUND" as const) : ("OUTBOUND" as const),
      senderType: m.de === "cliente" ? ("CONTACT" as const) : ("AGENT" as const),
      content: m.texto,
      createdAt: new Date(escribio.getTime() - (ultimo - i) * 60_000),
    })),
  });
  return conversation;
}

// La pestaña con sus columnas propias (ultimaConsulta), que el tipo de
// listContacts no expone por ser una unión.
function consultas(extra: Record<string, unknown> = {}) {
  return listarConsultasSinIdentificar(e.organizationId, { page: 1, pageSize: 50, ...extra });
}

function listar(vista: "clientes" | "consultas" | undefined, extra: Record<string, unknown> = {}) {
  return listContacts(e.organizationId, {
    page: 1,
    pageSize: 50,
    sortBy: "createdAt",
    sortOrder: "desc",
    vista,
    ...extra,
  });
}

test("el predicado SQL coincide con tieneNombreCompleto de nombreProvisorio.ts, nombre por nombre", async () => {
  // Los casos de nombreProvisorio.test.ts más los bordes que una pantalla
  // puede traer. La verdad es la función TS; el SQL tiene que decir lo mismo.
  const casos: [string, string][] = [
    ["WhatsApp", "+59899123456"],
    ["Visitante", "caa2c873"],
    ["Visitante", "Pérez"],
    ["Messenger", "…08366039"],
    ["Instagram", "…77"],
    ["Instagram", "García"],
    ["@usuario", ""],
    ["@usuario", "Gómez"],
    ["", "Pérez"],
    ["   ", "Pérez"],
    ["Martín", ""],
    ["Martín", "."],
    ["Juancho 🚗", "🚗"],
    ["Ana", "Gómez"],
    ["Ñoño", "Íñiguez"],
    ["José María", "de la Cruz"],
    ["123", "456"],
    ["whatsapp", "Pérez"],
  ];
  const creados = await Promise.all(casos.map(([n, a]) => crearContacto(n, a)));

  const sinIdentificar = new Set(await findUnidentifiedContactIds(e.organizationId));

  for (const contacto of creados) {
    const esperado = !tieneNombreCompleto(contacto);
    assert.equal(
      sinIdentificar.has(contacto.id),
      esperado,
      `"${contacto.firstName}" "${contacto.lastName}": TS dice ${String(esperado)} y SQL ${String(sinIdentificar.has(contacto.id))}`,
    );
  }

  await prisma.contact.deleteMany({ where: { id: { in: creados.map((c) => c.id) } } });
});

test("vista=consultas trae la última conversación de cada una, ordenadas por quién escribió último; vista=clientes las excluye; sin vista, todos", async () => {
  const hoy = new Date("2026-10-08T15:00:00.000Z");
  const wa = await crearContacto("WhatsApp", "+59899111222", { phone: "+59899111222" });
  const visitante = await crearContacto("Visitante", "0badf00d");
  const sinChat = await crearContacto("Instagram", "…9001");
  const cliente = await crearContacto("Ana", "Gómez");

  const convWa = await conversar(
    wa.id,
    "WHATSAPP",
    [
      { de: "cliente", texto: "Hola, ¿tienen la Hilux SRV 2022?" },
      { de: "agente", texto: "Sí, hay una unidad." },
      { de: "cliente", texto: "¿Cuánto sale? ".padEnd(LARGO_DEL_ULTIMO_MENSAJE + 40, "x") },
    ],
    new Date(hoy.getTime() - 2 * 3_600_000),
  );
  // El visitante escribió DESPUÉS: va primero. Y tiene una conversación
  // vieja cerrada, que no es la que se muestra.
  await conversar(
    visitante.id,
    "WEB",
    [{ de: "cliente", texto: "Consulta vieja" }],
    new Date(hoy.getTime() - 48 * 3_600_000),
    "CLOSED",
  );
  const convWeb = await conversar(
    visitante.id,
    "WEB",
    [{ de: "cliente", texto: "¿Tienen financiación?" }],
    new Date(hoy.getTime() - 3_600_000),
  );
  await conversar(cliente.id, "WHATSAPP", [{ de: "cliente", texto: "Soy Ana" }], hoy);

  const pestania = await consultas();
  assert.deepEqual(
    pestania.data.map((c) => c.id),
    [visitante.id, wa.id, sinChat.id],
    "de la que escribió más recientemente a la más vieja; sin conversación, al final",
  );
  assert.equal(pestania.pagination.total, 3);

  const filaWeb = pestania.data[0];
  assert.deepEqual(filaWeb.ultimaConsulta, {
    conversationId: convWeb.id,
    channel: "WEB",
    ultimoMensaje: "¿Tienen financiación?",
    ultimoMensajeAt: new Date(hoy.getTime() - 3_600_000),
  });
  const filaWa = pestania.data[1];
  assert.equal(filaWa.ultimaConsulta?.conversationId, convWa.id);
  assert.equal(filaWa.ultimaConsulta?.channel, "WHATSAPP");
  assert.equal(
    filaWa.ultimaConsulta?.ultimoMensaje?.length,
    LARGO_DEL_ULTIMO_MENSAJE,
    "el último mensaje viaja recortado",
  );
  assert.equal(filaWa.ultimaConsulta?.ultimoMensaje?.startsWith("¿Cuánto sale?"), true);
  assert.equal(pestania.data[2].ultimaConsulta, null);
  // La fila es el contacto de siempre, con su include.
  assert.equal("vehicleOfInterest" in filaWa, true);

  const clientes = await listar("clientes");
  assert.deepEqual(
    clientes.data.map((c) => c.id),
    [cliente.id],
    "Clientes no muestra las consultas",
  );

  const todos = await listar(undefined);
  assert.equal(todos.data.length, 4, "sin vista, el listado de siempre con todos");

  // Filtros de la pestaña: canal y búsqueda por teléfono.
  const porCanal = await consultas({ channel: "WEB" });
  assert.deepEqual(
    porCanal.data.map((c) => c.id),
    [visitante.id],
  );
  const porTelefono = await consultas({ search: "99111222" });
  assert.deepEqual(
    porTelefono.data.map((c) => c.id),
    [wa.id],
  );
});

test("una consulta pasa sola a Clientes cuando da su nombre o cuando se le crea una oportunidad", async () => {
  const porNombre = await crearContacto("WhatsApp", "+59899333444");
  const porOportunidad = await crearContacto("Visitante", "deadbeef");

  const antes = await listar("consultas");
  assert.ok(antes.data.some((c) => c.id === porNombre.id));
  assert.ok(antes.data.some((c) => c.id === porOportunidad.id));

  await updateContact(e.organizationId, e.userId, porNombre.id, {
    firstName: "Martín",
    lastName: "Pérez",
  });
  await createOpportunity(e.organizationId, e.userId, {
    title: "Hilux SRV",
    pipelineId: e.pipelineId,
    stageId: e.stageId,
    companyId: e.companyId,
    contactId: porOportunidad.id,
    amount: 1,
  });

  const despues = await listar("consultas");
  assert.equal(
    despues.data.some((c) => c.id === porNombre.id),
    false,
  );
  assert.equal(
    despues.data.some((c) => c.id === porOportunidad.id),
    false,
  );
  const clientes = await listar("clientes");
  assert.ok(clientes.data.some((c) => c.id === porNombre.id));
  assert.ok(clientes.data.some((c) => c.id === porOportunidad.id));
});

test("descartar cierra las conversaciones abiertas y da de baja; no vale para un contacto identificado ni para otra organización", async () => {
  const consulta = await crearContacto("Messenger", "…55");
  const activa = await conversar(
    consulta.id,
    "MESSENGER",
    [{ de: "cliente", texto: "Hola" }],
    new Date(),
  );
  const derivada = await conversar(
    consulta.id,
    "WHATSAPP",
    [{ de: "cliente", texto: "Quiero hablar con alguien" }],
    new Date(),
    "TRANSFERRED_TO_HUMAN",
  );

  await descartarConsulta(e.organizationId, consulta.id);

  const borrado = await prisma.contact.findUniqueOrThrow({ where: { id: consulta.id } });
  assert.notEqual(borrado.deletedAt, null, "soft delete, no borrado físico");
  for (const id of [activa.id, derivada.id]) {
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id } });
    assert.equal(conv.status, "CLOSED");
  }
  assert.equal(
    (await listar("consultas")).data.some((c) => c.id === consulta.id),
    false,
    "ya no está en la pestaña",
  );

  // Un contacto con nombre no se descarta por acá: va por la baja de la ficha.
  const identificado = await crearContacto("Laura", "Suárez");
  await assert.rejects(descartarConsulta(e.organizationId, identificado.id), (err: unknown) => {
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 409);
    assert.equal(err.message, CONTACTO_NO_ES_CONSULTA);
    return true;
  });
  const intacto = await prisma.contact.findUniqueOrThrow({ where: { id: identificado.id } });
  assert.equal(intacto.deletedAt, null);

  // Otra organización: 404 y nada cambia.
  const otra = await montar("consultas-otra");
  try {
    const ajena = await crearContacto("WhatsApp", "+59899555666", {
      organizationId: otra.organizationId,
    });
    await assert.rejects(descartarConsulta(e.organizationId, ajena.id), (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      return true;
    });
    const sigue = await prisma.contact.findUniqueOrThrow({ where: { id: ajena.id } });
    assert.equal(sigue.deletedAt, null);
    assert.equal(
      (
        await listContacts(otra.organizationId, {
          page: 1,
          pageSize: 10,
          sortBy: "createdAt",
          sortOrder: "desc",
          vista: "consultas",
        })
      ).data.length,
      1,
      "la pestaña de la otra organización ve solo lo suyo",
    );
  } finally {
    await desmontar(otra);
  }
});
