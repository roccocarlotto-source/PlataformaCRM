import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canReadActivity,
  canUserPatchActivity,
  scopeActivityFiltersToActor,
  type ActivityActor,
} from "../services/activity.service";
import { puedeAtenderLaConversacion } from "../services/conversationReply.service";
import {
  estaEnSusSedes,
  exigirSedeDelActor,
  filtroDeSedes,
  sedesDelActor,
} from "../services/permisos";
import { AppError } from "../utils/AppError";
import {
  ADMIN_SIN_SEDES,
  SEDES_OBLIGATORIAS,
  elegirRecepcion,
  resolverSedesDelRol,
} from "./services/sedesDeUsuarios.service";

// ---------------------------------------------------------------------------
// Usuarios por sede (docs/rubros.md §11.5, D19, PR R20). Sin base de datos:
// sedesDelActor y sus helpers, las tareas de Recepción, la elección de a quién
// va un aviso y las reglas de qué sedes se guardan.
// ---------------------------------------------------------------------------

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";

const recepcion = (sedes?: string[]): ActivityActor => ({
  userId: "yo",
  role: "RECEPCION",
  industry: "CLINICA",
  ...(sedes ? { sedes } : {}),
});

test("sedesDelActor: 'todas' para cualquier usuario de una automotora y para cualquier ADMIN", () => {
  assert.equal(sedesDelActor({ role: "ADMIN", industry: "AUTOMOTORA" }), "todas");
  assert.equal(sedesDelActor({ role: "USER", industry: "AUTOMOTORA" }), "todas");
  assert.equal(sedesDelActor({ role: "ADMIN", industry: "CLINICA" }), "todas");
  // Un ADMIN con filas en user_branches no queda limitado.
  assert.equal(sedesDelActor({ role: "ADMIN", industry: "CLINICA", sedes: [A] }), "todas");
  // Sin rubro (un camino que no lo pasa), ADMIN y USER siguen como antes.
  assert.equal(sedesDelActor({ role: "USER" }), "todas");
});

test("sedesDelActor: Recepción ve sus sedes; sin sedes ve vacío, no todo (falla cerrado)", () => {
  assert.deepEqual(sedesDelActor(recepcion([A, B])), [A, B]);
  assert.deepEqual(sedesDelActor(recepcion([])), []);
  assert.deepEqual(sedesDelActor(recepcion()), []);
  assert.deepEqual(sedesDelActor({ role: "RECEPCION" }), []);
});

test("estaEnSusSedes y exigirSedeDelActor: otra sede es 404 con el mensaje del recurso", () => {
  assert.equal(estaEnSusSedes(recepcion([A]), A), true);
  assert.equal(estaEnSusSedes(recepcion([A]), B), false);
  assert.equal(estaEnSusSedes(recepcion([]), A), false);
  // "Sin sede" (una tarea) no es de ninguna: no la limita.
  assert.equal(estaEnSusSedes(recepcion([]), null), true);
  assert.equal(estaEnSusSedes({ role: "USER", industry: "AUTOMOTORA" }, B), true);

  assert.throws(
    () => exigirSedeDelActor(recepcion([A]), B, "Reserva no encontrada"),
    (err) =>
      err instanceof AppError && err.statusCode === 404 && err.message === "Reserva no encontrada",
  );
  assert.doesNotThrow(() => exigirSedeDelActor(recepcion([A]), A, "x"));
});

test("filtroDeSedes: 'todas' deja el filtro pedido tal cual; Recepción lo acota a sus sedes", () => {
  const usuario = { role: "USER" as const, industry: "AUTOMOTORA" as const };
  assert.deepEqual(filtroDeSedes(usuario), {});
  assert.deepEqual(filtroDeSedes(usuario, C), { branchId: C });

  assert.deepEqual(filtroDeSedes(recepcion([A, B])), { branchIds: [A, B] });
  assert.deepEqual(filtroDeSedes(recepcion([A, B]), B), { branchId: B });
  // Pedir una sede ajena: lista vacía, no la sede pedida.
  assert.deepEqual(filtroDeSedes(recepcion([A]), C), { branchIds: [] });
  assert.deepEqual(filtroDeSedes(recepcion([])), { branchIds: [] });
});

test("conversaciones: Recepción atiende cualquiera (la sede la decide getConversation/conversacionQueAtiende)", () => {
  assert.equal(puedeAtenderLaConversacion(recepcion([A]), { assignedUserId: "otra" }), true);
});

// ---------------------------------------------------------------------------
// Tareas de Recepción
// ---------------------------------------------------------------------------

test("tareas: ADMIN y USER se acotan exactamente como antes de R20", () => {
  const admin: ActivityActor = { userId: "yo", role: "ADMIN", industry: "CLINICA" };
  const usuario: ActivityActor = { userId: "yo", role: "USER", industry: "AUTOMOTORA" };
  assert.deepEqual(scopeActivityFiltersToActor(admin, { assigneeId: "otra" }), {
    assigneeId: "otra",
  });
  assert.deepEqual(scopeActivityFiltersToActor(usuario, { assigneeId: "otra" }), {
    assigneeId: "yo",
  });
  // USER: una tarea de una sede o sin sede que no le asignaron, no la ve.
  assert.equal(canReadActivity(usuario, { assigneeId: "otra", branchId: null }), false);
  assert.equal(canReadActivity(usuario, { assigneeId: "otra", branchId: A }), false);
});

test("tareas: Recepción ve las suyas, las de sus sedes y las sin sede; no las de otra sede", () => {
  const actor = recepcion([A]);
  assert.equal(canReadActivity(actor, { assigneeId: "yo", branchId: B }), true);
  assert.equal(canReadActivity(actor, { assigneeId: "otra", branchId: A }), true);
  assert.equal(canReadActivity(actor, { assigneeId: "otra", branchId: null }), true);
  assert.equal(canReadActivity(actor, { assigneeId: null, branchId: null }), true);
  assert.equal(canReadActivity(actor, { assigneeId: "otra", branchId: B }), false);

  assert.deepEqual(scopeActivityFiltersToActor(actor, { assigneeId: "yo", completed: false }), {
    assigneeId: "yo",
    completed: false,
    visibleParaRecepcion: { userId: "yo", branchIds: [A] },
  });
});

test("tareas: una Recepción sin sedes ve solo las suyas y las sin sede", () => {
  const actor = recepcion([]);
  assert.equal(canReadActivity(actor, { assigneeId: "yo", branchId: A }), true);
  assert.equal(canReadActivity(actor, { assigneeId: "otra", branchId: null }), true);
  assert.equal(canReadActivity(actor, { assigneeId: "otra", branchId: A }), false);
});

test("tareas: Recepción edita y completa las pendientes que ve; nunca confirma", () => {
  const actor = recepcion([A]);
  const deSuSede = { assigneeId: "otra", authorId: "otra", completedAt: null, branchId: A };
  const sinSede = { assigneeId: null, authorId: "admin", completedAt: null, branchId: null };
  const deOtraSede = { ...deSuSede, branchId: B };
  assert.equal(canUserPatchActivity(actor, deSuSede, { subject: "x" }), true);
  assert.equal(canUserPatchActivity(actor, sinSede, { assigneeId: "yo" }), true);
  assert.equal(canUserPatchActivity(actor, deSuSede, { completedAt: new Date() }), true);
  assert.equal(canUserPatchActivity(actor, deOtraSede, { completedAt: new Date() }), false);
  assert.equal(canUserPatchActivity(actor, deSuSede, { confirmed: true }), false);
  assert.equal(
    canUserPatchActivity(actor, { ...deSuSede, completedAt: new Date() }, { subject: "x" }),
    false,
  );
});

// ---------------------------------------------------------------------------
// A quién va un aviso (§11.4)
// ---------------------------------------------------------------------------

test("elegirRecepcion: el Responsable por defecto si es Recepción de la sede; si no, la de menos tareas", () => {
  const t0 = new Date("2026-01-01T00:00:00Z");
  const t1 = new Date("2026-02-01T00:00:00Z");
  const candidatos = [
    { id: "r1", createdAt: t0, tareasAbiertas: 3 },
    { id: "r2", createdAt: t1, tareasAbiertas: 1 },
    { id: "r3", createdAt: t0, tareasAbiertas: 1 },
  ];
  assert.equal(elegirRecepcion(candidatos, "r1"), "r1");
  // El responsable que no es Recepción de esa sede no cuenta.
  assert.equal(elegirRecepcion(candidatos, "un-vendedor"), "r3");
  assert.equal(elegirRecepcion(candidatos, null), "r3");
  assert.equal(elegirRecepcion([], "r1"), null);
});

// ---------------------------------------------------------------------------
// Qué sedes se guardan (las ramas sin base: la validación contra la
// organización la cubre el test de integración).
// ---------------------------------------------------------------------------

test("resolverSedesDelRol: en una automotora no se guarda nada, traiga lo que traiga", async () => {
  for (const role of ["ADMIN", "USER"] as const) {
    assert.equal(
      await resolverSedesDelRol("org", "AUTOMOTORA", role, [A], { obligatorias: true }),
      null,
    );
  }
});

test("resolverSedesDelRol: un ADMIN de clínica queda sin sedes; pedirle sedes es 400", async () => {
  assert.deepEqual(
    await resolverSedesDelRol("org", "CLINICA", "ADMIN", undefined, { obligatorias: true }),
    [],
  );
  await assert.rejects(
    resolverSedesDelRol("org", "CLINICA", "ADMIN", [A], { obligatorias: false }),
    (err) =>
      err instanceof AppError && err.statusCode === 400 && err.details?.code === ADMIN_SIN_SEDES,
  );
});

test("resolverSedesDelRol: una Recepción sin sedes es 400 SEDES_OBLIGATORIAS", async () => {
  for (const branchIds of [undefined, []]) {
    await assert.rejects(
      resolverSedesDelRol("org", "CLINICA", "RECEPCION", branchIds, { obligatorias: true }),
      (err) =>
        err instanceof AppError &&
        err.statusCode === 400 &&
        err.details?.code === SEDES_OBLIGATORIAS,
    );
  }
  // Editar una Recepción sin mandar sedes conserva las que tiene.
  assert.equal(
    await resolverSedesDelRol("org", "CLINICA", "RECEPCION", undefined, { obligatorias: false }),
    null,
  );
});
