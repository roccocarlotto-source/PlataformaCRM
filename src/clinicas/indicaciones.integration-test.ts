import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import {
  ENCABEZADO_INDICACIONES,
  ENCABEZADO_KNOWLEDGE_BASE,
  runAgentTurn,
} from "../services/agentOrchestration.service";
import { createBranch } from "../services/branch.service";
import {
  resetLlmProviderParaTests,
  setLlmProviderForTests,
  type LlmCompletionRequest,
  type LlmProvider,
} from "../services/llmProvider.service";
import { mensajeDeConsultaClinica } from "./config/mensajesDeSalud";
import { daIndicacionClinica } from "./guardrailsDeSalud";
import { TOOL_DE_INDICACIONES } from "./toolDeIndicaciones";

// ---------------------------------------------------------------------------
// R18 (docs/rubros.md §5.4), contra la app real y Postgres: las indicaciones de
// la base de conocimiento de una clínica.
//
// - Por HTTP: una clínica carga y cambia el tipo; un tipo inválido es 400; una
//   automotora no lo puede mandar (400) y no lo ve en sus respuestas.
// - En el prompt: las indicaciones van en su bloque, SOLO CON SUS TÍTULOS,
//   solo para los agentes de esa sede (R20) y solo de esa organización.
// - Cuando el paciente pide una, el texto sale tal cual, sin volver al modelo
//   (prueba de la Clínica Demo: el modelo las parafraseaba).
// - Los guardrails van primero: una consulta de salud se deriva sin llamar al
//   modelo aunque haya una indicación parecida cargada.
//
// El modelo es un doble: ninguna evaluación paga.
// ---------------------------------------------------------------------------

let clinica: OrgDePrueba;
let otraClinica: OrgDePrueba;
let automotora: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);

const sedes: Record<string, string> = {};
const agentes: Record<string, string> = {};
let contactos: Record<string, string> = {};
let nombreDeLaClinica = "";

const INDICACION = "Venir con la zona rasurada y sin cremas.";

class ElModeloNoSeLlama extends Error {}

async function agente(org: OrgDePrueba, branchId: string): Promise<string> {
  const a = await prisma.agent.create({
    data: {
      organizationId: org.id,
      branchId,
      name: "Asistente",
      instructions: "Sos el asistente.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: [],
      channels: ["WEB"],
      guardrails: {} as Prisma.InputJsonValue,
    },
  });
  return a.id;
}

async function contacto(org: OrgDePrueba): Promise<string> {
  const c = await prisma.contact.create({
    data: { organizationId: org.id, firstName: "Paciente", lastName: "Ejemplo" },
  });
  return c.id;
}

before(async () => {
  ({ baseUrl, cerrar } = await levantarApp());
  clinica = await crearOrgDePrueba("indicaciones-kb", "COMPLETA", "CLINICA", 1);
  otraClinica = await crearOrgDePrueba("indicaciones-kb", "COMPLETA", "CLINICA", 1);
  automotora = await crearOrgDePrueba("indicaciones-kb", "COMPLETA", "AUTOMOTORA", 1);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: clinica.id } });
  nombreDeLaClinica = org.name;
  for (const [clave, o, nombre] of [
    ["a", clinica, "Sede Centro"],
    ["b", clinica, "Sede Norte"],
    ["otra", otraClinica, "Sede Única"],
    ["auto", automotora, "Sucursal Centro"],
  ] as const) {
    const b = await createBranch(o.id, { name: nombre, timezone: "America/Montevideo" });
    sedes[clave] = b.id;
    agentes[clave] = await agente(o, b.id);
  }
  contactos = {
    a: await contacto(clinica),
    b: await contacto(clinica),
    otra: await contacto(otraClinica),
    auto: await contacto(automotora),
  };
});

after(async () => {
  resetLlmProviderParaTests();
  for (const org of [clinica, otraClinica, automotora]) {
    if (!org) continue;
    const where = { organizationId: org.id };
    await prisma.message.deleteMany({ where });
    await prisma.conversation.deleteMany({ where });
    await prisma.agent.deleteMany({ where });
    await borrarOrgDePrueba(org);
  }
  if (cerrar) await cerrar();
});

function proveedorQueGuarda() {
  const requests: LlmCompletionRequest[] = [];
  const proveedor: LlmProvider = {
    name: "guionado",
    complete(request) {
      requests.push(request);
      return Promise.resolve({ text: "Te paso las indicaciones.", toolCalls: [] });
    },
  };
  return { proveedor, requests };
}

async function pedidoAlModelo(org: OrgDePrueba, clave: string, texto: string) {
  const { proveedor, requests } = proveedorQueGuarda();
  setLlmProviderForTests(proveedor);
  await runAgentTurn(
    {
      organizationId: org.id,
      agentId: agentes[clave],
      contactId: contactos[clave],
      channel: "WEB",
      texto,
    },
    { llmProvider: proveedor },
  );
  assert.equal(requests.length, 1);
  return requests[0];
}

async function promptDe(org: OrgDePrueba, clave: string, texto: string) {
  return (await pedidoAlModelo(org, clave, texto)).systemPrompt;
}

test("una clínica carga una indicación, la ve con su tipo y lo puede cambiar; un tipo inválido es 400", async () => {
  const creada = await pedir(clinica, "POST", "/api/knowledge-base", {
    branchId: sedes.a,
    title: "Antes de la depilación láser",
    content: INDICACION,
    kind: "INDICACIONES",
  });
  assert.equal(creada.status, 201, JSON.stringify(creada.json));
  assert.equal(creada.json.kind, "INDICACIONES");

  const general = await pedir(clinica, "POST", "/api/knowledge-base", {
    branchId: sedes.a,
    title: "Horarios",
    content: "Lunes a viernes de 9 a 18.",
  });
  assert.equal(general.status, 201);
  assert.equal(general.json.kind, "GENERAL", "sin kind, GENERAL");

  const lista = await pedir(clinica, "GET", "/api/knowledge-base");
  const kinds = (lista.json.data as { kind: string }[]).map((e) => e.kind).sort();
  assert.deepEqual(kinds, ["GENERAL", "INDICACIONES"]);

  const cambio = await pedir(clinica, "PATCH", `/api/knowledge-base/${general.json.id as string}`, {
    kind: "INDICACIONES",
  });
  assert.equal(cambio.status, 200);
  assert.equal(cambio.json.kind, "INDICACIONES");
  const vuelta = await pedir(clinica, "PATCH", `/api/knowledge-base/${general.json.id as string}`, {
    kind: "GENERAL",
  });
  assert.equal(vuelta.json.kind, "GENERAL");

  const invalido = await pedir(clinica, "POST", "/api/knowledge-base", {
    branchId: sedes.a,
    title: "x",
    content: "y",
    kind: "RECETA",
  });
  assert.equal(invalido.status, 400);
});

test("el agente de la sede recibe el título de la indicación en su bloque, sin el texto, y la tool para mandarla", async () => {
  const pedido = await pedidoAlModelo(
    clinica,
    "a",
    "¿qué tengo que hacer antes de la depilación láser?",
  );
  const prompt = pedido.systemPrompt;
  const kb = prompt.indexOf(ENCABEZADO_KNOWLEDGE_BASE);
  const ind = prompt.indexOf(ENCABEZADO_INDICACIONES);
  assert.ok(kb >= 0 && ind > kb, "los dos bloques, las indicaciones después");
  assert.ok(prompt.slice(ind).includes("- Antes de la depilación láser"));
  assert.ok(!prompt.includes(INDICACION), "el texto no va al modelo");
  // La tool del sistema, aunque el agente no tiene ninguna en enabledTools.
  assert.deepEqual(
    pedido.tools.map((t) => t.name),
    [TOOL_DE_INDICACIONES, "request_human_handoff"],
  );
});

test("el paciente pide una indicación: le llega el texto de la clínica tal cual, sin volver al modelo ni a la capa 3", async () => {
  // Un texto que la capa 3 bloquearía si lo escribiera el modelo: acá lo
  // escribió la clínica, y sale igual.
  const texto = "Aplicate protector solar cada 2 horas durante una semana.\nNo te expongas al sol.";
  assert.equal(daIndicacionClinica(texto), true);
  await prisma.knowledgeBaseEntry.create({
    data: {
      organizationId: clinica.id,
      branchId: sedes.a,
      title: "Después del peeling",
      content: texto,
      kind: "INDICACIONES",
    },
  });
  const requests: LlmCompletionRequest[] = [];
  const proveedor: LlmProvider = {
    name: "guionado",
    complete(request) {
      requests.push(request);
      return Promise.resolve(
        requests.length === 1
          ? {
              text: null,
              toolCalls: [
                {
                  id: "c1",
                  name: TOOL_DE_INDICACIONES,
                  arguments: { titulo: "después del peeling" },
                },
              ],
            }
          : { text: "En resumen: ponete protector.", toolCalls: [] },
      );
    },
  };
  setLlmProviderForTests(proveedor);
  const contactId = await contacto(clinica);
  const r = await runAgentTurn(
    {
      organizationId: clinica.id,
      agentId: agentes.a,
      contactId,
      channel: "WEB",
      texto: "¿qué tengo que hacer después del peeling?",
    },
    { llmProvider: proveedor },
  );
  assert.equal(requests.length, 1, "no se vuelve al modelo");
  assert.equal(r.respuesta, texto);
  assert.equal(r.handoff, false);
  const saliente = await prisma.message.findFirstOrThrow({
    where: { organizationId: clinica.id, conversationId: r.conversationId, senderType: "AGENT" },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(saliente.content, texto);
  const llamada = (saliente.toolCalls as { name: string; allowed: boolean }[]).find(
    (t) => t.name === TOOL_DE_INDICACIONES,
  );
  assert.equal(llamada?.allowed, true);
});

test("límite por sede y aislamiento: otra sede y otra clínica no reciben la indicación", async () => {
  const deOtraSede = await promptDe(clinica, "b", "hola");
  assert.ok(!deOtraSede.includes(INDICACION));
  assert.ok(!deOtraSede.includes(ENCABEZADO_INDICACIONES));

  const deOtraClinica = await promptDe(otraClinica, "otra", "hola");
  assert.ok(!deOtraClinica.includes(INDICACION));
  const ajena = await pedir(otraClinica, "GET", "/api/knowledge-base");
  assert.equal((ajena.json.data as unknown[]).length, 0);
});

test("los guardrails van primero: una consulta de salud se deriva sin el modelo aunque haya una indicación", async () => {
  const proveedor: LlmProvider = {
    name: "falla-si-lo-llaman",
    complete() {
      throw new ElModeloNoSeLlama("Se llamó al modelo y no tenía que llamarse");
    },
  };
  setLlmProviderForTests(proveedor);
  const r = await runAgentTurn(
    {
      organizationId: clinica.id,
      agentId: agentes.a,
      contactId: await contacto(clinica),
      channel: "WEB",
      texto: "¿Es normal que me arda después de la depilación láser?",
    },
    { llmProvider: proveedor },
  );
  assert.equal(r.respuesta, mensajeDeConsultaClinica(nombreDeLaClinica));
  assert.equal(r.handoff, true);
});

test("automotora sin cambios: no puede mandar el tipo (400), no lo ve, y su prompt no tiene el bloque", async () => {
  const conKind = await pedir(automotora, "POST", "/api/knowledge-base", {
    branchId: sedes.auto,
    title: "Horarios",
    content: "Lunes a viernes de 9 a 18.",
    kind: "GENERAL",
  });
  assert.equal(conKind.status, 400);

  const creada = await pedir(automotora, "POST", "/api/knowledge-base", {
    branchId: sedes.auto,
    title: "Horarios",
    content: "Lunes a viernes de 9 a 18.",
  });
  assert.equal(creada.status, 201);
  assert.ok(!("kind" in creada.json));
  const lista = await pedir(automotora, "GET", "/api/knowledge-base");
  for (const e of lista.json.data as Record<string, unknown>[]) assert.ok(!("kind" in e));
  const una = await pedir(automotora, "GET", `/api/knowledge-base/${creada.json.id as string}`);
  assert.ok(!("kind" in una.json));
  const patch = await pedir(
    automotora,
    "PATCH",
    `/api/knowledge-base/${creada.json.id as string}`,
    {
      kind: "INDICACIONES",
    },
  );
  assert.equal(patch.status, 400);

  const pedido = await pedidoAlModelo(automotora, "auto", "hola");
  assert.ok(pedido.systemPrompt.includes("Lunes a viernes de 9 a 18."));
  assert.ok(!pedido.systemPrompt.includes(ENCABEZADO_INDICACIONES));
  // Ni la tool de indicaciones: solo la de derivar, como siempre.
  assert.deepEqual(
    pedido.tools.map((t) => t.name),
    ["request_human_handoff"],
  );
});
