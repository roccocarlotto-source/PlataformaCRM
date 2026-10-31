// Primero: el contador tiene que quedar como singleton antes de lib/prisma.
import { contarConsultas } from "../lib/contarConsultas.test-helper";
import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import type { ConversationChannel } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import {
  CATALOGO_DE_TOOLS,
  type ContextoDeEjecucionDeTool,
  type ResultadoDeTool,
} from "./agentTools.service";
import { relojDeReservas } from "./booking.service";
import { createBranch } from "./branch.service";
import { createResource } from "./resource.service";
import { createServiceType } from "./serviceType.service";
import { replaceWorkingHoursForResource } from "./workingHours.service";

// ---------------------------------------------------------------------------
// Cuántas consultas SQL cuestan get_availability y create_booking del agente
// (BEGIN y COMMIT incluidos: también son idas y vueltas). Para el agente de
// voz cada ida y vuelta cuenta: con el backend lejos de la base, una consulta
// es ~100-350 ms; en la misma región, ~1-2 ms.
//
// Lo que importa no es solo el total sino cuántas van UNA DETRÁS DE OTRA: las
// lecturas independientes se disparan juntas (enParalelo), así que el total
// no baja tanto como el tiempo. Los topes son el presupuesto: si una mejora
// los baja, se bajan; si un cambio los sube, que sea a conciencia.
//
// Se mide en caliente (una ejecución antes): la primera de cada proceso
// prepara las sentencias y no representa a las demás.
// ---------------------------------------------------------------------------

const TZ = "America/Montevideo";
const AHORA_FIJO = new Date("2027-02-28T12:00:00Z");
// Lunes 1 de marzo de 2027, en Montevideo (UTC-3).
const LUNES = (hora: number) => `2027-03-01T${String(hora).padStart(2, "0")}:00:00-03:00`;

let org: OrgDePrueba;
let contexto: ContextoDeEjecucionDeTool;
const medidas: { tool: string; consultas: number; tope: number }[] = [];

before(async () => {
  mock.method(relojDeReservas, "ahora", () => AHORA_FIJO);
  org = await crearOrgDePrueba("agenda-consultas", "COMPLETA", "AUTOMOTORA", 1);
  const sucursal = await createBranch(org.id, { name: "Centro", timezone: TZ });
  const recurso = await createResource(org.id, {
    branchId: sucursal.id,
    name: "Unidad de prueba",
    type: "ROOM",
  });
  await replaceWorkingHoursForResource(org.id, recurso.id, [
    { weekday: "MONDAY", startMinute: 540, endMinute: 1080 },
  ]);
  await createServiceType(org.id, {
    branchId: sucursal.id,
    resourceId: recurso.id,
    name: "Prueba de manejo",
    durationMin: 60,
  });
  const contacto = await prisma.contact.create({
    data: {
      organizationId: org.id,
      firstName: "Cliente",
      lastName: "Ejemplo",
      phone: "+59899000021",
      ownerId: org.authIds[0],
    },
  });
  const agente = await prisma.agent.create({
    data: {
      organizationId: org.id,
      branchId: sucursal.id,
      name: "Asistente",
      instructions: "Sos el asistente.",
      modelProvider: "openrouter",
      modelName: "doble/modelo",
      enabledTools: ["get_availability", "create_booking"],
      channels: ["WHATSAPP"],
      guardrails: {},
    },
  });
  const channel: ConversationChannel = "WHATSAPP";
  const conversacion = await prisma.conversation.create({
    data: {
      organizationId: org.id,
      branchId: sucursal.id,
      agentId: agente.id,
      contactId: contacto.id,
      channel,
    },
  });
  contexto = {
    organizationId: org.id,
    conversation: {
      id: conversacion.id,
      contactId: contacto.id,
      branchId: sucursal.id,
      agentId: agente.id,
      channel,
    },
  };
});

after(async () => {
  mock.restoreAll();
  if (medidas.length > 0) console.table(medidas);
  if (!org) return;
  const where = { organizationId: org.id };
  await prisma.conversation.deleteMany({ where });
  await prisma.booking.deleteMany({ where });
  await prisma.agent.deleteMany({ where });
  await prisma.serviceType.deleteMany({ where });
  await prisma.workingHours.deleteMany({ where });
  await prisma.resource.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await borrarOrgDePrueba(org);
});

async function medir(
  tool: string,
  args: () => Record<string, unknown>,
  tope: number,
): Promise<ResultadoDeTool> {
  const ejecutar = () => CATALOGO_DE_TOOLS.get(tool)!.ejecutar(args(), contexto);
  const enFrio = await ejecutar();
  assert.ok(enFrio.ok, JSON.stringify(enFrio));
  const { resultado, consultas } = await contarConsultas(ejecutar);
  assert.ok(resultado.ok, JSON.stringify(resultado));
  medidas.push({ tool, consultas: consultas.length, tope });
  if (process.env.CONSULTAS_DETALLE === tool) console.log(consultas.join("\n"));
  assert.ok(
    consultas.length <= tope,
    `${tool}: ${consultas.length} consultas, el presupuesto es ${tope}`,
  );
  return resultado;
}

test("get_availability: presupuesto de consultas (por nombre de servicio, un día)", async () => {
  const r = await medir(
    "get_availability",
    () => ({ servicio: "Prueba de manejo", desde: LUNES(0) }),
    // Eran 12 (2026-10-31); con el servicio y su recurso leídos una sola vez, 11.
    11,
  );
  assert.ok(r.ok && (r.data as { turnos: unknown[] }).turnos.length > 0);
});

test("create_booking: presupuesto de consultas (por nombre de servicio)", async () => {
  // Dos horarios distintos: la ejecución en frío y la medida reservan cada una
  // el suyo (el tope de reservas futuras por contacto es 2).
  let hora = 10;
  const r = await medir(
    "create_booking",
    () => ({ servicio: "Prueba de manejo", startsAt: LUNES(hora++) }),
    // Eran 25 (2026-10-31); 24 sin la relectura del servicio. La ganancia
    // grande no se ve acá sino en el tiempo: las lecturas previas van juntas.
    24,
  );
  assert.ok(r.ok);
});
