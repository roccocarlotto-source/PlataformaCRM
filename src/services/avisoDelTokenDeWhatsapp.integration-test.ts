import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, afterEach, test } from "node:test";
import type { OrganizationIndustry, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { createBranch } from "./branch.service";
import {
  anotarTokenDeWhatsappAceptado,
  anotarTokenDeWhatsappRechazado,
} from "./estadoDelTokenDeWhatsapp";
import { getOrganizationSettings } from "./organization.service";

// ---------------------------------------------------------------------------
// OPS-03, contra Postgres: el aviso "el token de WhatsApp dejó de servir" en
// la configuración aparece SOLO en una organización que usa la conexión global
// (un agente con número de WhatsApp y sin WABA propio). Decisión de Rocco del
// 2026-10-30: no en las que tienen su propio número, como las clínicas.
// ---------------------------------------------------------------------------

const organizaciones: string[] = [];

async function organizacion(
  etiqueta: string,
  {
    industry,
    conNumero,
    wabaPropio,
  }: { industry: OrganizationIndustry; conNumero: boolean; wabaPropio: boolean },
) {
  const org = await prisma.organization.create({
    data: {
      name: `Aviso WA ${etiqueta}`,
      slug: `aviso-wa-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      industry,
    },
  });
  organizaciones.push(org.id);
  if (wabaPropio) {
    await prisma.whatsappBusinessConnection.create({
      data: { organizationId: org.id, wabaId: `9${String(randomInt(100_000_000, 999_999_999))}` },
    });
  }
  if (conNumero) {
    const branch = await createBranch(org.id, { name: "Sede", timezone: "UTC" });
    await prisma.agent.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        name: "Asistente",
        instructions: "Sos el asistente.",
        modelProvider: "openrouter",
        modelName: "doble/modelo",
        enabledTools: [],
        channels: ["WHATSAPP"],
        guardrails: {} as Prisma.InputJsonValue,
        whatsappPhoneNumberId: `7${String(randomInt(100_000_000, 999_999_999))}`,
      },
    });
  }
  return org.id;
}

afterEach(() => {
  anotarTokenDeWhatsappAceptado();
});

after(async () => {
  const where = { organizationId: { in: organizaciones } };
  await prisma.agent.deleteMany({ where });
  await prisma.branchBusinessHours.deleteMany({ where });
  await prisma.clinicBranchSettings.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.whatsappBusinessConnection.deleteMany({ where });
  await prisma.clinicSettings.deleteMany({ where });
  await prisma.organization.deleteMany({ where: { id: { in: organizaciones } } });
});

test("con el token rechazado, la automotora que usa la conexión global ve el aviso con la fecha", async () => {
  const org = await organizacion("global", {
    industry: "AUTOMOTORA",
    conNumero: true,
    wabaPropio: false,
  });
  const desde = new Date("2026-10-30T15:00:00.000Z");
  anotarTokenDeWhatsappRechazado('{"error":{"code":190}}', desde);

  const settings = await getOrganizationSettings(org);
  assert.equal(settings.whatsappTokenInvalidoDesde, desde.toISOString());
});

test("con el token rechazado, una clínica con WABA propio NO ve el aviso", async () => {
  const org = await organizacion("propio", {
    industry: "CLINICA",
    conNumero: true,
    wabaPropio: true,
  });
  anotarTokenDeWhatsappRechazado('{"error":{"code":190}}');

  const settings = await getOrganizationSettings(org);
  assert.equal(settings.whatsappTokenInvalidoDesde, null);
});

test("con el token rechazado, una organización sin ningún número de WhatsApp NO ve el aviso", async () => {
  const org = await organizacion("sin-numero", {
    industry: "AUTOMOTORA",
    conNumero: false,
    wabaPropio: false,
  });
  anotarTokenDeWhatsappRechazado('{"error":{"code":190}}');

  const settings = await getOrganizationSettings(org);
  assert.equal(settings.whatsappTokenInvalidoDesde, null);
});

test("con el token andando, nadie ve el aviso", async () => {
  const org = await organizacion("anda", {
    industry: "AUTOMOTORA",
    conNumero: true,
    wabaPropio: false,
  });
  const settings = await getOrganizationSettings(org);
  assert.equal(settings.whatsappTokenInvalidoDesde, null);
});
