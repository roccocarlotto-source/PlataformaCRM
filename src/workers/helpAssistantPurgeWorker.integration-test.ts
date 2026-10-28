import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "../lib/prisma";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { DIAS_DE_RETENCION_DEL_AGENTE_INTERNO } from "../repositories/internalAgent.repository";
import { purgarTextosViejos } from "./helpAssistantPurgeWorker";

// ---------------------------------------------------------------------------
// La pasada diaria de retención (helpAssistantPurgeWorker.ts) contra Postgres:
// borra lo de más de 90 días —preguntas al asistente de ayuda y, desde DAT-03,
// mensajes del agente interno— y deja lo reciente (revisión de #585: la purga
// del agente interno no tenía test).
//
// Se mira la base, no el número que devuelve la purga: la purga no se acota a
// una organización, y en la base local puede haber filas viejas de otros tests.
// ---------------------------------------------------------------------------

const DIA = 24 * 60 * 60 * 1000;
const orgs: OrgDePrueba[] = [];

after(async () => {
  for (const org of orgs) {
    const where = { organizationId: org.id };
    await prisma.helpAssistantQuestion.deleteMany({ where });
    await prisma.internalAgentMessage.deleteMany({ where });
    await prisma.internalAgent.deleteMany({ where });
    await borrarOrgDePrueba(org);
  }
});

test("a los 90 días se borran los mensajes del agente interno y las preguntas de ayuda; lo reciente queda", async () => {
  const org = await crearOrgDePrueba("purga-de-textos", "COMPLETA", "AUTOMOTORA", 1);
  orgs.push(org);
  const organizationId = org.id;
  const userId = org.authIds[0];
  const ahora = new Date();
  const viejo = new Date(ahora.getTime() - (DIAS_DE_RETENCION_DEL_AGENTE_INTERNO + 1) * DIA);
  const reciente = new Date(ahora.getTime() - (DIAS_DE_RETENCION_DEL_AGENTE_INTERNO - 1) * DIA);

  const agente = await prisma.internalAgent.create({
    data: {
      organizationId,
      name: "Interno",
      instructions: "Ayudá al equipo.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
    },
  });
  const mensaje = (createdAt: Date) =>
    prisma.internalAgentMessage.create({
      data: {
        organizationId,
        internalAgentId: agente.id,
        userId,
        senderType: "USER",
        content: "Buscame a la persona",
        createdAt,
      },
    });
  const pregunta = (createdAt: Date) =>
    prisma.helpAssistantQuestion.create({
      data: {
        organizationId,
        userId,
        industry: "AUTOMOTORA",
        edition: "COMPLETA",
        role: "ADMIN",
        question: "¿Cómo cargo una venta?",
        outcome: "ANSWERED",
        model: "doble/modelo",
        createdAt,
      },
    });
  const mensajeViejo = await mensaje(viejo);
  const mensajeReciente = await mensaje(reciente);
  const preguntaVieja = await pregunta(viejo);
  const preguntaReciente = await pregunta(reciente);

  const borradas = await purgarTextosViejos(ahora);

  assert.ok(borradas >= 2, `borró ${String(borradas)}`);
  const quedan = (ids: string[]) =>
    prisma.internalAgentMessage.findMany({ where: { id: { in: ids } }, select: { id: true } });
  assert.deepEqual(await quedan([mensajeViejo.id, mensajeReciente.id]), [
    { id: mensajeReciente.id },
  ]);
  const preguntas = await prisma.helpAssistantQuestion.findMany({
    where: { id: { in: [preguntaVieja.id, preguntaReciente.id] } },
    select: { id: true },
  });
  assert.deepEqual(preguntas, [{ id: preguntaReciente.id }]);
});
