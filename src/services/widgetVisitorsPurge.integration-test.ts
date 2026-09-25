import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import {
  WIDGET_CONTACT_FIRST_NAME,
  WIDGET_CONTACT_SOURCE,
  countVisitantesPurgables,
  fechaDeCorteDeVisitantes,
  purgeVisitantesSinMensajes,
} from "./widgetContact.service";

// ---------------------------------------------------------------------------
// Purga de "Visitante" sin mensajes del cliente (ítem 138, B-10/F-05) contra
// Postgres real: lo que se prueba es el `where` de
// buildVisitantesPurgablesWhere, que es lo único que decide.
//
// LE PREGUNTA A LA BASE, mismo criterio que ingestionEvent-purge: qué quedó
// dado de baja se lee de vuelta de `contacts`, no del número que devolvió el
// updateMany. Y TODO ACOTADO a la organización del fixture: la purga real
// corre sin acotar, y este test no puede tocar otras organizaciones.
// ---------------------------------------------------------------------------

const DIA = 24 * 60 * 60 * 1000;
// Bien lejos del borde de los 7 días, por lo mismo que en ingestionEvent-purge.
const VIEJO = new Date(Date.now() - 20 * DIA);
const RECIENTE = new Date(Date.now() - DIA);

let fx: { orgId: string; branchId: string; agentId: string };

before(async () => {
  const org = await prisma.organization.create({
    data: {
      name: `Purga visitantes ${randomUUID()}`,
      slug: `purga-visitantes-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  const branch = await prisma.branch.create({
    data: { organizationId: org.id, name: "Centro", timezone: "America/Montevideo" },
  });
  const agent = await prisma.agent.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      name: "Agente",
      instructions: "Sos el agente.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: [],
      channels: ["WEB"],
      guardrails: {},
    },
  });
  fx = { orgId: org.id, branchId: branch.id, agentId: agent.id };
});

after(async () => {
  if (!fx) return;
  const where = { organizationId: fx.orgId };
  await prisma.message.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.agent.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.organization.delete({ where: { id: fx.orgId } });
});

// Un placeholder tal como lo deja resolveWidgetContact: el Contact con su
// conversación del widget. `entrante`/`saliente` agregan mensajes.
async function crearVisitante(opciones: {
  createdAt: Date;
  entrante?: boolean;
  saliente?: boolean;
  firstName?: string;
  email?: string;
}): Promise<string> {
  const contacto = await prisma.contact.create({
    data: {
      organizationId: fx.orgId,
      firstName: opciones.firstName ?? WIDGET_CONTACT_FIRST_NAME,
      lastName: randomUUID().slice(0, 8),
      source: WIDGET_CONTACT_SOURCE,
      email: opciones.email ?? null,
      createdAt: opciones.createdAt,
    },
    select: { id: true },
  });
  const conversacion = await prisma.conversation.create({
    data: {
      organizationId: fx.orgId,
      branchId: fx.branchId,
      agentId: fx.agentId,
      contactId: contacto.id,
      channel: "WEB",
      externalThreadId: randomUUID(),
    },
    select: { id: true },
  });
  if (opciones.entrante) {
    await prisma.message.create({
      data: {
        organizationId: fx.orgId,
        conversationId: conversacion.id,
        direction: "INBOUND",
        senderType: "CONTACT",
        content: "Hola",
      },
    });
  }
  if (opciones.saliente) {
    await prisma.message.create({
      data: {
        organizationId: fx.orgId,
        conversationId: conversacion.id,
        direction: "OUTBOUND",
        senderType: "AGENT",
        content: "¡Hola! ¿En qué te ayudo?",
      },
    });
  }
  return contacto.id;
}

async function dadoDeBaja(id: string): Promise<boolean> {
  const fila = await prisma.contact.findUniqueOrThrow({
    where: { id },
    select: { deletedAt: true },
  });
  return fila.deletedAt !== null;
}

test("solo el Visitante viejo que nunca escribió entra: con mensaje del cliente, reciente, o con datos cargados, no", async () => {
  const viejoSinMensajes = await crearVisitante({ createdAt: VIEJO });
  // Un saliente solo (el agente saludó, el visitante nunca contestó) sigue
  // siendo "nunca escribió".
  const viejoSoloSaliente = await crearVisitante({ createdAt: VIEJO, saliente: true });
  const viejoConMensaje = await crearVisitante({ createdAt: VIEJO, entrante: true });
  const recienteSinMensajes = await crearVisitante({ createdAt: RECIENTE });
  const viejoConEmail = await crearVisitante({
    createdAt: VIEJO,
    email: `visitante-${randomUUID().slice(0, 8)}@example.test`,
  });
  // Un contacto real que no es el placeholder del widget, aunque venga del
  // widget y no tenga mensajes.
  const noEsVisitante = await crearVisitante({ createdAt: VIEJO, firstName: "Ana" });

  const corte = fechaDeCorteDeVisitantes();
  const scope = { organizationId: fx.orgId };

  // El dry-run cuenta lo mismo que después se da de baja.
  assert.equal(await countVisitantesPurgables(corte, scope), 2);
  const { count } = await purgeVisitantesSinMensajes(corte, scope);
  assert.equal(count, 2);

  assert.equal(await dadoDeBaja(viejoSinMensajes), true, "viejo sin mensajes: se da de baja");
  assert.equal(await dadoDeBaja(viejoSoloSaliente), true, "viejo con solo saliente: se da de baja");
  assert.equal(await dadoDeBaja(viejoConMensaje), false, "escribió: se queda");
  assert.equal(await dadoDeBaja(recienteSinMensajes), false, "dentro de los 7 días: se queda");
  assert.equal(await dadoDeBaja(viejoConEmail), false, "tiene datos cargados: se queda");
  assert.equal(await dadoDeBaja(noEsVisitante), false, "no es el placeholder: se queda");

  // Soft delete: la fila sigue ahí, y una segunda corrida no la vuelve a contar.
  assert.equal(await countVisitantesPurgables(corte, scope), 0);
});
