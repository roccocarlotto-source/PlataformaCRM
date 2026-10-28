import { contarConsultas } from "../lib/contarConsultas.test-helper";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "../lib/prisma";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { createBranch } from "./branch.service";
import { erasePersonalData, OPCIONES_DE_TRANSACCION_DEL_BORRADO } from "./contact.service";

// ---------------------------------------------------------------------------
// Cuántas idas y vueltas a la base hace el borrado a pedido en el peor caso
// razonable (revisión de #585): un contacto con 20 conversaciones, 10
// oportunidades con su cotización y su entrega, 3 eventos de ingesta y 5
// tareas. Con ~350 ms por consulta en producción (Render → Supabase en São
// Paulo), la cantidad decide si la transacción entra en su timeout.
//
// La cantidad NO depende de cuántas filas tenga cada tabla, salvo los eventos
// de ingesta promovidos (uno por evento: cada uno redacta sus notas en el
// código). El tope de abajo fija las dos cosas: si alguien vuelve a escribir
// un UPDATE por fila, el número crece con el escenario y el test falla.
// ---------------------------------------------------------------------------

const orgs: OrgDePrueba[] = [];

after(async () => {
  for (const org of orgs) {
    const where = { organizationId: org.id };
    await prisma.delivery.deleteMany({ where });
    await prisma.quote.deleteMany({ where });
    await prisma.ingestionEvent.deleteMany({ where });
    await prisma.source.deleteMany({ where });
    await prisma.agentInboundJob.deleteMany({ where });
    await prisma.message.deleteMany({ where });
    await prisma.conversation.deleteMany({ where });
    await prisma.agent.deleteMany({ where });
    await borrarOrgDePrueba(org);
  }
});

// Medido el 2026-10-28 con este escenario: 46 (3 lecturas antes de la
// transacción y 43 adentro). Ver la nota del timeout en erasePersonalData
// (contact.service.ts): si este número sube, revisar ese timeout.
const TOPE_DE_CONSULTAS = 48;
const MS_POR_CONSULTA_EN_PRODUCCION = 350;

test("peor caso razonable (20 conversaciones, 10 oportunidades con cotización y entrega): el borrado no pasa el tope de consultas y entra en su timeout con el doble de margen", async () => {
  const org = await crearOrgDePrueba("borrado-consultas", "COMPLETA", "AUTOMOTORA", 1);
  orgs.push(org);
  const organizationId = org.id;
  const adminId = org.authIds[0];
  const branch = await createBranch(
    organizationId,
    { name: "Sede Centro", timezone: "America/Montevideo" },
    "AUTOMOTORA",
  );
  const contact = await prisma.contact.create({
    data: {
      organizationId,
      firstName: "Persona",
      lastName: "Ejemplo",
      email: "persona@example.com",
      phone: "+59899000333",
    },
  });
  const agent = await prisma.agent.create({
    data: {
      organizationId,
      branchId: branch.id,
      name: "Asistente",
      instructions: "Sos el asistente.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: [],
      channels: ["WHATSAPP"],
      guardrails: {},
    },
  });
  for (let i = 0; i < 20; i++) {
    const conversation = await prisma.conversation.create({
      data: {
        organizationId,
        branchId: branch.id,
        agentId: agent.id,
        contactId: contact.id,
        channel: "WHATSAPP",
        // Una sola abierta por contacto y canal.
        status: i === 0 ? "ACTIVE" : "CLOSED",
      },
    });
    const entrante = await prisma.message.create({
      data: {
        organizationId,
        conversationId: conversation.id,
        direction: "INBOUND",
        senderType: "CONTACT",
        content: "Hola",
      },
    });
    const respuesta = await prisma.message.create({
      data: {
        organizationId,
        conversationId: conversation.id,
        direction: "OUTBOUND",
        senderType: "AGENT",
        content: "Hola, te ayudo",
      },
    });
    await prisma.agentInboundJob.create({
      data: {
        organizationId,
        messageId: entrante.id,
        channelAccountId: "100000000000001",
        externalUserId: "59899000333",
        status: "DONE",
        responseMessageId: respuesta.id,
      },
    });
  }
  const pipeline = await prisma.pipeline.create({ data: { organizationId, name: "Ventas" } });
  const stage = await prisma.stage.create({
    data: { organizationId, pipelineId: pipeline.id, name: "Contacto", order: 1 },
  });
  for (let i = 0; i < 10; i++) {
    const opportunity = await prisma.opportunity.create({
      data: {
        organizationId,
        ownerId: adminId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        contactId: contact.id,
        title: `Venta ${i}`,
      },
    });
    await prisma.quote.create({
      data: {
        organizationId,
        opportunityId: opportunity.id,
        createdById: adminId,
        amount: 100,
        currency: "USD",
        lines: [{ description: "Auto", amount: "100.00" }],
      },
    });
    await prisma.delivery.create({
      data: {
        organizationId,
        opportunityId: opportunity.id,
        checklist: [{ label: "Llaves", checked: true }],
      },
    });
  }
  for (let i = 0; i < 5; i++) {
    await prisma.activity.create({
      data: {
        organizationId,
        authorId: adminId,
        type: "TASK",
        contactId: contact.id,
        subject: "Llamar",
      },
    });
  }
  const source = await prisma.source.create({
    data: { organizationId, name: "Landing", type: "WEBHOOK" },
  });
  for (let i = 0; i < 3; i++) {
    await prisma.ingestionEvent.create({
      data: {
        organizationId,
        sourceId: source.id,
        externalId: `ev-${i}-${organizationId}`,
        rawPayload: { email: "persona@example.com" },
        status: "PROCESSED",
        promotedContactId: contact.id,
      },
    });
  }

  const { resultado, consultas } = await contarConsultas(() =>
    erasePersonalData(organizationId, contact.id, adminId),
  );
  assert.equal(resultado.conversacionesCerradas, 20);
  assert.equal(resultado.oportunidadesAnonimizadas, 10);
  assert.ok(
    consultas.length <= TOPE_DE_CONSULTAS,
    `${consultas.length} consultas (tope ${TOPE_DE_CONSULTAS}):\n${consultas.join("\n")}`,
  );
  // Lo que tardaría en producción, con margen de sobra bajo el timeout.
  assert.ok(
    consultas.length * MS_POR_CONSULTA_EN_PRODUCCION * 2 <=
      OPCIONES_DE_TRANSACCION_DEL_BORRADO.timeout,
    "el timeout del borrado no deja el doble de margen",
  );
});
