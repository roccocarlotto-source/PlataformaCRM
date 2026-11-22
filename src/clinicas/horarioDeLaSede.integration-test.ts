import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import { prisma } from "../lib/prisma";
import {
  borrarOrgDePrueba,
  crearOrgDePrueba,
  crearPedir,
  levantarApp,
  type OrgDePrueba,
} from "../routes/gateDeModulos.test-helper";
import { relojDeReservas } from "../services/booking.service";
import { createBranch } from "../services/branch.service";
import { replaceBusinessHoursForBranch } from "../services/branchBusinessHours.service";
import { createResource } from "../services/resource.service";
import { createServiceType } from "../services/serviceType.service";
import { replaceWorkingHoursForResource } from "../services/workingHours.service";

// ---------------------------------------------------------------------------
// La agenda de una clínica no ofrece ni acepta turnos con la SEDE cerrada,
// aunque la profesional tenga horario (QA de la primera clínica, 2026-11-21:
// la sede abría de martes a sábado, una profesional tenía horario el lunes y
// la agenda ofreció y reservó el lunes). El recorte es al horario de atención
// PROPIO de la sede; sin uno cargado, como antes. Un ADMIN puede forzar.
// La automotora no cambia: src/clinicas/automotoraSinCambios.integration-test.ts.
// ---------------------------------------------------------------------------

const TZ = "America/Argentina/Buenos_Aires";
// El reloj de las reservas: domingo 06/09/2026. Lunes 07 y martes 08, futuros.
const AHORA_FIJO = new Date("2026-09-06T12:00:00Z");
const LUNES = (hora: number) => `2026-09-07T${String(hora + 3).padStart(2, "0")}:00:00.000Z`;
const MARTES = (hora: number) => `2026-09-08T${String(hora + 3).padStart(2, "0")}:00:00.000Z`;
const MAR_A_SAB = ["TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] as const;

let clinica: OrgDePrueba;
let baseUrl: string;
let cerrar: () => Promise<void>;
const pedir = crearPedir(() => baseUrl);
const ids = {} as { sede: string; ana: string; masaje: string; contacto: string };

const sedeAbre = (desdeMin: number, hastaMin: number) =>
  replaceBusinessHoursForBranch(
    clinica.id,
    ids.sede,
    MAR_A_SAB.map((weekday) => ({ weekday, startMinute: desdeMin, endMinute: hastaMin })),
  );

before(async () => {
  mock.method(relojDeReservas, "ahora", () => AHORA_FIJO);
  ({ baseUrl, cerrar } = await levantarApp());
  clinica = await crearOrgDePrueba("horario-de-la-sede", "COMPLETA", "CLINICA", 1);
  ids.sede = (await createBranch(clinica.id, { name: "Centro", timezone: TZ }, "CLINICA")).id;
  ids.ana = (
    await createResource(clinica.id, { branchId: ids.sede, name: "Ana", type: "PERSON" })
  ).id;
  // Ana trabaja el lunes y el martes, de 9 a 13.
  await replaceWorkingHoursForResource(clinica.id, ids.ana, [
    { weekday: "MONDAY", startMinute: 540, endMinute: 780 },
    { weekday: "TUESDAY", startMinute: 540, endMinute: 780 },
  ]);
  ids.masaje = (
    await createServiceType(clinica.id, {
      branchId: ids.sede,
      resourceId: ids.ana,
      name: "Masaje",
      durationMin: 60,
    })
  ).id;
  ids.contacto = (
    await prisma.contact.create({
      data: { organizationId: clinica.id, firstName: "Clienta", lastName: "Ejemplo" },
    })
  ).id;
});

after(async () => {
  if (cerrar) await cerrar();
  if (!clinica) return;
  const where = { organizationId: clinica.id };
  await prisma.activity.deleteMany({ where });
  await prisma.outboxEvent.deleteMany({ where });
  await prisma.bookingMessage.deleteMany({ where });
  await prisma.booking.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.serviceTypeResource.deleteMany({ where });
  await prisma.serviceType.deleteMany({ where });
  await prisma.workingHours.deleteMany({ where });
  await prisma.resource.deleteMany({ where });
  await prisma.branchBusinessHours.deleteMany({ where });
  await prisma.clinicBranchSettings.deleteMany({ where });
  await borrarOrgDePrueba(clinica);
});

async function disponibles(dia: (h: number) => string) {
  const r = await pedir(
    clinica,
    "GET",
    `/api/clinica/disponibilidad?serviceTypeId=${ids.masaje}&from=${dia(0)}&to=${dia(20)}`,
  );
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return (r.json.availability as { startsAt: string }[]).map((t) => t.startsAt);
}

const reservar = (startsAt: string, force?: boolean) =>
  pedir(clinica, "POST", "/api/clinica/turnos", {
    serviceTypeId: ids.masaje,
    contactId: ids.contacto,
    startsAt,
    resourceId: ids.ana,
    ...(force ? { force: true } : {}),
  });

test("sin horario propio de la sede, todo como antes: el lunes se ofrece", async () => {
  await replaceBusinessHoursForBranch(clinica.id, ids.sede, []);
  assert.deepEqual(await disponibles(LUNES), [LUNES(9), LUNES(10), LUNES(11), LUNES(12)]);
});

test("con la sede cerrada el lunes: no se ofrece, no se reserva (400) y no se reprograma ahí; el martes, sí", async () => {
  await sedeAbre(9 * 60, 19 * 60);
  try {
    assert.deepEqual(await disponibles(LUNES), []);
    assert.deepEqual(await disponibles(MARTES), [MARTES(9), MARTES(10), MARTES(11), MARTES(12)]);

    const lunes = await reservar(LUNES(9));
    assert.equal(lunes.status, 400, JSON.stringify(lunes.json));
    const martes = await reservar(MARTES(9));
    assert.equal(martes.status, 201, JSON.stringify(martes.json));

    const reprogramar = await pedir(
      clinica,
      "PATCH",
      `/api/bookings/${String(martes.json.id)}/reschedule`,
      {
        startsAt: LUNES(10),
      },
    );
    assert.equal(reprogramar.status, 400, JSON.stringify(reprogramar.json));
    const igual = await prisma.booking.findUniqueOrThrow({ where: { id: String(martes.json.id) } });
    assert.equal(igual.startsAt.toISOString(), MARTES(9));

    // Un ADMIN puede forzar, como con el horario de trabajo.
    const forzado = await reservar(LUNES(11), true);
    assert.equal(forzado.status, 201, JSON.stringify(forzado.json));
  } finally {
    await prisma.booking.deleteMany({ where: { organizationId: clinica.id } });
  }
});

test("si la sede abre después que la profesional, sus turnos arrancan a la hora en que abre la sede, y lo ofrecido se acepta", async () => {
  await sedeAbre(10 * 60, 19 * 60);
  try {
    assert.deepEqual(await disponibles(MARTES), [MARTES(10), MARTES(11), MARTES(12)]);
    assert.equal((await reservar(MARTES(9))).status, 400, "antes de que abra la sede");
    const ofrecido = await reservar(MARTES(10));
    assert.equal(ofrecido.status, 201, JSON.stringify(ofrecido.json));
  } finally {
    await prisma.booking.deleteMany({ where: { organizationId: clinica.id } });
  }
});

test("el horario de la profesional trae el de la sede (o null sin horario propio), para la grilla del panel", async () => {
  await sedeAbre(9 * 60, 19 * 60);
  const con = await pedir(clinica, "GET", `/api/resources/${ids.ana}/working-hours`);
  assert.equal(con.status, 200);
  assert.equal((con.json.workingHours as unknown[]).length, 2);
  assert.deepEqual(
    (con.json.horarioDeLaSede as { weekday: string }[]).map((f) => f.weekday),
    [...MAR_A_SAB],
  );

  await replaceBusinessHoursForBranch(clinica.id, ids.sede, []);
  const sin = await pedir(clinica, "GET", `/api/resources/${ids.ana}/working-hours`);
  assert.equal(sin.json.horarioDeLaSede, null);
});
