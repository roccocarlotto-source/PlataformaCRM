import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { prisma } from "../lib/prisma";
import { createAgentInboundJob } from "../repositories/agentInboundJob.repository";
import { registrarEntrante } from "../services/agentOrchestration.service";
import { resetLlmProviderParaTests, setLlmProviderForTests } from "../services/llmProvider.service";
import { drenarTurnosPendientes, type DepsDeEnvio } from "./agentInboundWorker";

// ---------------------------------------------------------------------------
// El worker de turnos contra Postgres real, con DOS organizaciones (FABLE-G-03
// y FABLE-H-03 de docs-privados/auditoria-2026-10-05-FABLE.md, local).
//
// Antes la pasada corría los turnos de a uno: el turno lento de una
// organización frenaba los mensajes de todas. Lo que este archivo fija:
//   - con el turno de A colgado, el de B se contesta igual;
//   - una organización nunca corre más turnos a la vez que su tope, aunque
//     tenga varios mensajes esperando y haya carriles libres.
// El modelo y el envío son dobles: nunca se habla con OpenRouter ni con Meta.
// ---------------------------------------------------------------------------

interface Negocio {
  orgId: string;
  branchId: string;
  agentId: string;
  phoneNumberId: string;
  marca: string;
}

let a: Negocio;
let b: Negocio;

// Lo que el doble del modelo hace con cada organización, por la marca que
// lleva en las instrucciones de su agente.
let alLlamar: (marca: string) => Promise<void> = () => Promise.resolve();
let enviados: string[] = [];

const deps: DepsDeEnvio = {
  accessToken: () => "token-de-prueba",
  sendText: (input) => {
    enviados.push(input.phoneNumberId);
    return Promise.resolve({ wamid: `wamid.${randomUUID()}` });
  },
  downloadMedia: () => Promise.reject(new Error("solo texto")),
  pageAccessToken: () => Promise.reject(new Error("no es un job de Meta")),
  sendMetaText: () => Promise.reject(new Error("no es un job de Meta")),
};

async function crearNegocio(marca: string): Promise<Negocio> {
  const org = await prisma.organization.create({
    data: {
      name: `Worker ${marca} ${randomUUID()}`,
      slug: `worker-${marca.toLowerCase()}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  const branch = await prisma.branch.create({
    data: { organizationId: org.id, name: "Centro", timezone: "America/Montevideo" },
  });
  const phoneNumberId = `1${String(randomInt(10 ** 9, 10 ** 10 - 1))}${String(randomInt(1000, 9999))}`;
  const agent = await prisma.agent.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      name: `Agente ${marca}`,
      instructions: `Sos el agente de ${marca}.`,
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: [],
      channels: ["WHATSAPP"],
      guardrails: {},
      whatsappPhoneNumberId: phoneNumberId,
    },
  });
  return { orgId: org.id, branchId: branch.id, agentId: agent.id, phoneNumberId, marca };
}

// Un cliente nuevo le escribe al negocio: contacto, entrante y job, como los
// deja el webhook.
async function llegaUnMensaje(n: Negocio): Promise<string> {
  const waId = `598${String(randomInt(10_000_000, 99_999_999))}`;
  const contacto = await prisma.contact.create({
    data: { organizationId: n.orgId, firstName: "Cliente", lastName: waId, phone: `+${waId}` },
  });
  let jobId = "";
  await registrarEntrante(
    {
      organizationId: n.orgId,
      agentId: n.agentId,
      branchId: n.branchId,
      contactId: contacto.id,
      channel: "WHATSAPP",
      texto: "Hola, quiero info",
      externalThreadId: waId,
      externalMessageId: `wamid.${randomUUID()}`,
    },
    {
      enLaMismaTransaccion: async (tx, entrante) => {
        const job = await createAgentInboundJob(
          {
            organizationId: n.orgId,
            messageId: entrante.id,
            channel: "WHATSAPP",
            channelAccountId: n.phoneNumberId,
            externalUserId: waId,
          },
          tx,
        );
        jobId = job.id;
      },
    },
  );
  return jobId;
}

const estadoDe = async (jobId: string) =>
  (await prisma.agentInboundJob.findUniqueOrThrow({ where: { id: jobId } })).status;

async function esperarA(condicion: () => Promise<boolean>, queEs: string) {
  const limite = Date.now() + 10_000;
  while (!(await condicion())) {
    if (Date.now() > limite) throw new Error(`No pasó a tiempo: ${queEs}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

before(async () => {
  process.env.LOG_LEVEL = "fatal";
  a = await crearNegocio("A");
  b = await crearNegocio("B");
  setLlmProviderForTests({
    name: "doble",
    async complete(request) {
      await alLlamar(request.systemPrompt.includes("agente de A") ? "A" : "B");
      return { text: "¡Hola! ¿En qué te ayudo?", toolCalls: [] };
    },
  });
});

beforeEach(async () => {
  alLlamar = () => Promise.resolve();
  enviados = [];
  await prisma.agentInboundJob.updateMany({
    where: {
      organizationId: { in: [a.orgId, b.orgId] },
      status: { in: ["PENDING", "PROCESSING"] },
    },
    data: { status: "DONE", lockedUntil: null },
  });
});

after(async () => {
  resetLlmProviderParaTests();
  const where = { organizationId: { in: [a?.orgId, b?.orgId].filter(Boolean) as string[] } };
  await prisma.agentInboundJob.deleteMany({ where });
  await prisma.message.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.activity.deleteMany({ where });
  await prisma.agent.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.organization.deleteMany({ where: { id: { in: where.organizationId.in } } });
});

test("FABLE-G-03: con el turno de una organización colgado, el mensaje de otra se contesta igual", async () => {
  let soltarA!: () => void;
  const aColgado = new Promise<void>((resolve) => {
    soltarA = resolve;
  });
  let aEmpezo = false;
  alLlamar = async (marca) => {
    if (marca === "A") {
      aEmpezo = true;
      await aColgado;
    }
  };
  const jobA = await llegaUnMensaje(a);

  const pasada = drenarTurnosPendientes({
    organizationId: [a.orgId, b.orgId],
    deps,
    concurrencia: 2,
  });
  try {
    await esperarA(async () => aEmpezo, "que arranque el turno de A");
    // El mensaje de B llega DESPUÉS, con el turno de A todavía corriendo.
    const jobB = await llegaUnMensaje(b);

    await esperarA(async () => (await estadoDe(jobB)) === "DONE", "que B quede contestado");
    assert.equal(await estadoDe(jobA), "PROCESSING", "A sigue en su turno lento");
    assert.deepEqual(enviados, [b.phoneNumberId], "B ya recibió su respuesta");
  } finally {
    soltarA();
  }
  const resumen = await pasada;

  assert.equal(resumen.respondidos, 2);
  assert.equal(resumen.fallidos, 0);
  assert.equal(await estadoDe(jobA), "DONE");
});

test("FABLE-G-03: una organización no ocupa todos los carriles: sus turnos corren de a uno aunque haya dos carriles", async () => {
  let enCursoDeA = 0;
  let maximoDeA = 0;
  alLlamar = async (marca) => {
    if (marca !== "A") return;
    enCursoDeA++;
    maximoDeA = Math.max(maximoDeA, enCursoDeA);
    await new Promise((resolve) => setTimeout(resolve, 150));
    enCursoDeA--;
  };
  // Tres clientes distintos de A (tres conversaciones: el lock por
  // conversación no los serializa entre sí).
  const jobs = [await llegaUnMensaje(a), await llegaUnMensaje(a), await llegaUnMensaje(a)];

  const resumen = await drenarTurnosPendientes({
    organizationId: [a.orgId, b.orgId],
    deps,
    concurrencia: 2,
  });

  assert.equal(resumen.respondidos, 3);
  assert.equal(maximoDeA, 1, "con dos carriles, el tope de una organización es uno");
  for (const jobId of jobs) {
    assert.equal(await estadoDe(jobId), "DONE");
  }
});

test("con un solo carril, todo sigue como antes: de a uno y en orden de llegada", async () => {
  const orden: string[] = [];
  alLlamar = async (marca) => void orden.push(marca);
  await llegaUnMensaje(a);
  await llegaUnMensaje(b);
  await llegaUnMensaje(a);

  const resumen = await drenarTurnosPendientes({
    organizationId: [a.orgId, b.orgId],
    deps,
    concurrencia: 1,
  });

  assert.equal(resumen.respondidos, 3);
  assert.deepEqual(orden, ["A", "B", "A"]);
});
