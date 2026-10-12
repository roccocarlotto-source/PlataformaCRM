import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { OrganizationIndustry } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { MARCADOR_DE_DATO_BORRADO } from "../repositories/contact.repository";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { MENSAJE_CONTACTO_BORRADO } from "../utils/contactoBorrado";
import { createBranch } from "./branch.service";
import { erasePersonalData } from "./contact.service";

// ---------------------------------------------------------------------------
// Un contacto con los datos personales borrados queda en SOLO LECTURA
// (utils/contactoBorrado.ts), en los dos rubros. HTTP real contra la app
// entera: editarlo, marcarlo sin interés, darle un cupón, unirlo (de los dos
// lados), agendarle un turno, cargarle una nota, una tarea o una oportunidad,
// o pasarle una nota u oportunidad ajena, responde 409. Lo que es registro
// (completar su tarea, editar su oportunidad, repetir el borrado) sigue.
//
// Se lee de vuelta de la base: el contacto sigue con el marcador y no ganó
// ninguna fila nueva. Y un contacto sin borrar de la misma organización sigue
// funcionando: el 409 es por el borrado, no por la organización.
// ---------------------------------------------------------------------------

interface Escenario {
  org: OrgDePrueba;
  branchId: string;
  borradoId: string;
  otroId: string;
  resourceId: string;
  serviceTypeId: string;
  tareaDelBorradoId: string;
  notaDelOtroId: string;
  // Solo automotora (una clínica no tiene oportunidades).
  pipelineId?: string;
  stageId?: string;
  oportunidadDelBorradoId?: string;
  oportunidadDelOtroId?: string;
}

const orgs: OrgDePrueba[] = [];
let clinica: Escenario;
let automotora: Escenario;
let baseUrl = "";
let cerrarApp: () => Promise<void> = () => Promise.resolve();
const pedir = crearPedir(() => baseUrl);

async function montar(industry: OrganizationIndustry): Promise<Escenario> {
  const org = await crearOrgDePrueba("borrado-completo", "COMPLETA", industry, 2);
  orgs.push(org);
  const organizationId = org.id;
  const adminId = org.authIds[0];
  const branch = await createBranch(
    organizationId,
    { name: "Sede Centro", timezone: "America/Montevideo" },
    industry,
  );
  const crearContacto = (nombre: string) =>
    prisma.contact.create({
      data: {
        organizationId,
        firstName: nombre,
        lastName: "Ejemplar",
        email: `${nombre.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`,
      },
    });
  const borrado = await crearContacto("Anabela");
  const otro = await crearContacto("Bruno");
  const resource = await prisma.resource.create({
    data: { organizationId, branchId: branch.id, name: "Profesional", type: "PERSON" },
  });
  const serviceType = await prisma.serviceType.create({
    data: {
      organizationId,
      branchId: branch.id,
      resourceId: resource.id,
      name: "Consulta",
      durationMin: 30,
    },
  });
  const tarea = await prisma.activity.create({
    data: {
      organizationId,
      authorId: adminId,
      type: "TASK",
      contactId: borrado.id,
      subject: "Llamar",
    },
  });
  const nota = await prisma.activity.create({
    data: {
      organizationId,
      authorId: adminId,
      type: "NOTE",
      contactId: otro.id,
      subject: "Nota del otro",
    },
  });

  const escenario: Escenario = {
    org,
    branchId: branch.id,
    borradoId: borrado.id,
    otroId: otro.id,
    resourceId: resource.id,
    serviceTypeId: serviceType.id,
    tareaDelBorradoId: tarea.id,
    notaDelOtroId: nota.id,
  };

  if (industry === "AUTOMOTORA") {
    const pipeline = await prisma.pipeline.create({
      data: { organizationId, name: "Ventas", isDefault: true },
    });
    const stage = await prisma.stage.create({
      data: { organizationId, pipelineId: pipeline.id, name: "Nueva", order: 1 },
    });
    const crearOportunidad = (contactId: string, title: string) =>
      prisma.opportunity.create({
        data: {
          organizationId,
          pipelineId: pipeline.id,
          stageId: stage.id,
          contactId,
          ownerId: adminId,
          title,
        },
      });
    escenario.pipelineId = pipeline.id;
    escenario.stageId = stage.id;
    escenario.oportunidadDelBorradoId = (await crearOportunidad(borrado.id, "Compra")).id;
    escenario.oportunidadDelOtroId = (await crearOportunidad(otro.id, "Otra compra")).id;
  }

  await erasePersonalData(organizationId, borrado.id, adminId);
  return escenario;
}

before(async () => {
  ({ baseUrl, cerrar: cerrarApp } = await levantarApp());
  clinica = await montar("CLINICA");
  automotora = await montar("AUTOMOTORA");
});

after(async () => {
  await cerrarApp();
  for (const org of orgs) {
    const where = { organizationId: org.id };
    await prisma.discountVoucher.deleteMany({ where });
    await prisma.booking.deleteMany({ where });
    await prisma.serviceType.deleteMany({ where });
    await prisma.resource.deleteMany({ where });
    await prisma.clinicSettings.deleteMany({ where });
    await borrarOrgDePrueba(org);
  }
});

function assert409(r: { status: number; json: { error?: Record<string, unknown> } }, que: string) {
  assert.equal(r.status, 409, `${que}: ${JSON.stringify(r.json)}`);
  assert.equal(r.json.error?.message, MENSAJE_CONTACTO_BORRADO, que);
}

/** Lo que el contacto borrado tiene en la base: no puede cambiar. */
async function fotoDelBorrado(e: Escenario) {
  const where = { organizationId: e.org.id, contactId: e.borradoId };
  const contacto = await prisma.contact.findUniqueOrThrow({ where: { id: e.borradoId } });
  return {
    nombre: contacto.firstName,
    apellido: contacto.lastName,
    email: contacto.email,
    sinInteres: contacto.noInterestAt,
    borradoEl: contacto.personalDataErasedAt?.toISOString(),
    deletedAt: contacto.deletedAt,
    actividades: await prisma.activity.count({ where }),
    cupones: await prisma.discountVoucher.count({ where }),
    turnos: await prisma.booking.count({ where }),
    oportunidades: await prisma.opportunity.count({ where }),
  };
}

for (const rubro of ["CLINICA", "AUTOMOTORA"] as const) {
  const escenario = () => (rubro === "CLINICA" ? clinica : automotora);

  test(`${rubro}: editar, marcar sin interés, cupón, unir, agendar y notas o tareas dan 409 y no cambian nada`, async () => {
    const e = escenario();
    const antes = await fotoDelBorrado(e);
    assert.equal(antes.nombre, MARCADOR_DE_DATO_BORRADO);

    const llamar = (metodo: string, path: string, body?: unknown) =>
      pedir(e.org, metodo, path, body);
    const id = e.borradoId;

    assert409(await llamar("PATCH", `/api/contacts/${id}`, { firstName: "Anabela" }), "editar");
    assert409(await llamar("PATCH", `/api/contacts/${id}`, { noInterest: true }), "sin interés");
    assert409(
      await llamar("POST", "/api/vouchers", {
        contactId: id,
        branchId: e.branchId,
        label: "10% off",
        expiresInDays: 30,
      }),
      "cupón",
    );
    assert409(
      await llamar("GET", `/api/contacts/${e.otroId}/merge-preview?with=${id}`),
      "vista previa de la unión, el borrado como absorbido",
    );
    assert409(
      await llamar("POST", `/api/contacts/${e.otroId}/merge`, { absorbedId: id }),
      "unir, el borrado como absorbido",
    );
    assert409(
      await llamar("POST", `/api/contacts/${id}/merge`, { absorbedId: e.otroId }),
      "unir, el borrado como el que queda",
    );
    const inicio = new Date(Date.now() + 3 * 86400_000).toISOString();
    assert409(
      rubro === "CLINICA"
        ? await llamar("POST", "/api/clinica/turnos", {
            serviceTypeId: e.serviceTypeId,
            resourceId: e.resourceId,
            contactId: id,
            startsAt: inicio,
          })
        : await llamar("POST", "/api/bookings", {
            serviceTypeId: e.serviceTypeId,
            resourceId: e.resourceId,
            contactId: id,
            startsAt: inicio,
          }),
      "agendar",
    );
    assert409(
      await llamar("POST", "/api/activities", { type: "NOTE", subject: "Nota", contactId: id }),
      "nota",
    );
    assert409(
      await llamar("POST", "/api/activities", { type: "TASK", subject: "Tarea", contactId: id }),
      "tarea",
    );
    assert409(
      await llamar("PATCH", `/api/activities/${e.notaDelOtroId}`, { contactId: id }),
      "pasarle una nota ajena",
    );

    assert.deepEqual(await fotoDelBorrado(e), antes);
  });

  test(`${rubro}: lo que es registro sigue: completar su tarea y repetir el borrado`, async () => {
    const e = escenario();
    const completada = await pedir(e.org, "PATCH", `/api/activities/${e.tareaDelBorradoId}`, {
      completedAt: new Date().toISOString(),
    });
    assert.equal(completada.status, 200, JSON.stringify(completada.json));

    const otraVez = await pedir(
      e.org,
      "POST",
      `/api/contacts/${e.borradoId}/erase-personal-data`,
      {},
    );
    assert.equal(otraVez.status, 200, JSON.stringify(otraVez.json));
  });

  test(`${rubro}: un contacto sin borrar de la misma organización sigue funcionando`, async () => {
    const e = escenario();
    const editado = await pedir(e.org, "PATCH", `/api/contacts/${e.otroId}`, {
      lastName: "Ejemplo",
    });
    assert.equal(editado.status, 200, JSON.stringify(editado.json));
    const nota = await pedir(e.org, "POST", "/api/activities", {
      type: "NOTE",
      subject: "Nota",
      contactId: e.otroId,
    });
    assert.equal(nota.status, 201, JSON.stringify(nota.json));
    const cupon = await pedir(e.org, "POST", "/api/vouchers", {
      contactId: e.otroId,
      branchId: e.branchId,
      label: "10% off",
      expiresInDays: 30,
    });
    assert.equal(cupon.status, 201, JSON.stringify(cupon.json));
  });
}

test("AUTOMOTORA: crear una oportunidad o pasarle una a un contacto borrado da 409; editar la suya, no", async () => {
  const e = automotora;
  const antes = await fotoDelBorrado(e);

  assert409(
    await pedir(e.org, "POST", "/api/opportunities", {
      title: "Compra nueva",
      pipelineId: e.pipelineId,
      stageId: e.stageId,
      contactId: e.borradoId,
    }),
    "crear oportunidad",
  );
  assert409(
    await pedir(e.org, "PATCH", `/api/opportunities/${e.oportunidadDelOtroId}`, {
      contactId: e.borradoId,
    }),
    "pasarle una oportunidad ajena",
  );
  assert.deepEqual(await fotoDelBorrado(e), antes);

  const editada = await pedir(e.org, "PATCH", `/api/opportunities/${e.oportunidadDelBorradoId}`, {
    contactId: e.borradoId,
    amount: 1000,
  });
  assert.equal(editada.status, 200, JSON.stringify(editada.json));
});
