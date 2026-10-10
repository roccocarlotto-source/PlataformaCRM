import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { Express } from "express";
import {
  ROLES_POR_RUBRO,
  ROL_NO_DISPONIBLE_EN_EL_RUBRO,
  exigirRolDelRubro,
} from "../config/ediciones";
import { rutasMontadas, type RutaMontada } from "../routes/rutasMontadas.test-helper";
import { KNOWN_ROLES } from "../types/auth";
import { AppError } from "../utils/AppError";
import { puedeAtenderLaConversacion } from "./conversationReply.service";
import { CAPACIDADES, CAPACIDADES_POR_ROL, puede } from "./permisos";

// ---------------------------------------------------------------------------
// Roles y permisos (docs/rubros.md §11, PR R12). Sin base de datos.
//
//   - ADMIN y USER dan EXACTAMENTE lo que daba el `role === "ADMIN"` que cada
//     capacidad reemplazó.
//   - Recepción: la fila de §11.2 que este PR implementa.
//   - El router real: ninguna ruta con authorize() se le abre a Recepción (en
//     R12 todas las que exigen un rol son de ADMIN: configuración). Las rutas
//     sin authorize la dejan pasar como a un USER, y el límite lo pone el
//     service (permisos.ts).
//   - Qué rol admite cada rubro, y el 400 cruzado.
// ---------------------------------------------------------------------------

test("ADMIN y USER: cada capacidad es lo que decía role === 'ADMIN'", () => {
  for (const role of ["ADMIN", "USER"] as const) {
    for (const capacidad of CAPACIDADES) {
      assert.equal(puede({ role }, capacidad), role === "ADMIN", `${role}: ${capacidad}`);
    }
  }
});

test("Recepción: edita cualquier contacto, atiende cualquier conversación y opera las tareas de sus sedes; nada más", () => {
  assert.deepEqual([...CAPACIDADES_POR_ROL.RECEPCION].sort(), [
    "atender_cualquier_conversacion",
    "editar_cualquier_contacto",
    "operar_tareas_de_sus_sedes",
  ]);
});

test("atender una conversación: ADMIN cualquiera, USER la asignada, Recepción cualquiera", () => {
  const ajena = { assignedUserId: "otra-persona" };
  const sinAsignar = { assignedUserId: null };
  const propia = { assignedUserId: "yo" };
  const casos: [string, boolean, boolean, boolean][] = [
    // rol, ajena, sin asignar, propia
    ["ADMIN", true, true, true],
    ["USER", false, false, true],
    ["RECEPCION", true, true, true],
  ];
  for (const [role, enAjena, enSinAsignar, enPropia] of casos) {
    const actor = { userId: "yo", role: role as "ADMIN" | "USER" | "RECEPCION" };
    assert.equal(puedeAtenderLaConversacion(actor, ajena), enAjena, `${role} ajena`);
    assert.equal(
      puedeAtenderLaConversacion(actor, sinAsignar),
      enSinAsignar,
      `${role} sin asignar`,
    );
    assert.equal(puedeAtenderLaConversacion(actor, propia), enPropia, `${role} propia`);
  }
});

// ---------------------------------------------------------------------------
// El router real
// ---------------------------------------------------------------------------

let montadas: RutaMontada[];

before(async () => {
  process.env.LOG_LEVEL = "fatal";
  const { app }: { app: Express } = await import("../app.js");
  montadas = rutasMontadas(app);
});

test("el recorrido encuentra las rutas con authorize (si da pocas, el recorrido está roto)", () => {
  const conRol = montadas.filter((r) => r.roles !== null);
  assert.ok(conRol.length > 60, `solo ${String(conRol.length)} rutas con authorize`);
  assert.ok(conRol.some((r) => r.ruta === "POST /api/invitations"));
});

test("toda ruta con authorize deja pasar a ADMIN, y ninguna se le abre a Recepción ni a USER", () => {
  const conRol = montadas.filter((r) => r.roles !== null);
  assert.deepEqual(
    conRol.filter((r) => !r.roles?.includes("ADMIN")).map((r) => r.ruta),
    [],
    "rutas con authorize que no dejan pasar a ADMIN",
  );
  // §11.2: lo que Recepción no hace es configurar, y todo lo de configurar es
  // authorize("ADMIN"). Si un PR abre una ruta a Recepción (la agenda de
  // clínica, R5 en adelante), la suma acá a propósito.
  // R6: los bloqueos de un profesional (docs/rubros.md §4.5, §11.2).
  const abiertasARecepcion: string[] = [
    "GET /api/clinica/profesionales/:resourceId/bloqueos",
    "POST /api/clinica/profesionales/:resourceId/bloqueos",
    "DELETE /api/clinica/bloqueos/:id",
    // R9: reprogramar un turno (§4.7, §11.2).
    "PATCH /api/bookings/:id/reschedule",
    // R10: atendido / no vino (§4.8, §11.2).
    "PATCH /api/bookings/:id/attended",
    "PATCH /api/bookings/:id/no-show",
  ];
  assert.deepEqual(
    conRol.filter((r) => r.roles?.includes("RECEPCION")).map((r) => r.ruta),
    abiertasARecepcion,
  );
  assert.deepEqual(
    conRol.filter((r) => r.roles?.includes("USER")).map((r) => r.ruta),
    [],
    "hoy ninguna ruta tiene authorize con USER: las de USER no llevan authorize",
  );
});

test("las rutas de configuración de §11.2 exigen ADMIN (Recepción recibe 403)", () => {
  const roles = new Map(montadas.map((r) => [r.ruta, r.roles]));
  for (const ruta of [
    "PATCH /api/users/:id",
    "POST /api/invitations",
    "POST /api/agents",
    "POST /api/automations",
    "POST /api/knowledge-base",
    "PATCH /api/organization",
    "POST /api/branches",
    "POST /api/resources",
    "POST /api/service-types",
    "PUT /api/resources/:resourceId/working-hours",
    "POST /api/branches/:branchId/google-calendar/connect",
    "DELETE /api/contacts/:id",
    "POST /api/contacts/:id/erase-personal-data",
    "POST /api/contacts/:id/merge",
    "POST /api/imports",
  ]) {
    assert.deepEqual(roles.get(ruta), ["ADMIN"], ruta);
  }
  // Y las operativas no tienen authorize: el límite está en el service.
  for (const ruta of [
    "POST /api/bookings",
    "PATCH /api/bookings/:id/cancel",
    "PATCH /api/contacts/:id",
    "POST /api/conversations/:id/messages",
    "POST /api/conversations/:id/close",
    "POST /api/activities",
    "PATCH /api/activities/:id",
  ]) {
    assert.equal(roles.get(ruta), null, ruta);
  }
});

// ---------------------------------------------------------------------------
// Roles por rubro (§11.1, D21)
// ---------------------------------------------------------------------------

test("ROLES_POR_RUBRO: automotora ADMIN y USER; clínica ADMIN y RECEPCION; todos conocidos", () => {
  assert.deepEqual(ROLES_POR_RUBRO.AUTOMOTORA, ["ADMIN", "USER"]);
  assert.deepEqual(ROLES_POR_RUBRO.CLINICA, ["ADMIN", "RECEPCION"]);
  assert.deepEqual([...KNOWN_ROLES].sort(), ["ADMIN", "RECEPCION", "USER"]);
});

test("exigirRolDelRubro: 400 cruzado (USER en clínica, RECEPCION en automotora)", () => {
  const error = (fn: () => void) => {
    try {
      fn();
      return undefined;
    } catch (err) {
      assert.ok(err instanceof AppError);
      return err;
    }
  };
  for (const [rol, industry] of [
    ["USER", "CLINICA"],
    ["RECEPCION", "AUTOMOTORA"],
  ] as const) {
    const err = error(() => exigirRolDelRubro(rol, industry));
    assert.equal(err?.statusCode, 400);
    assert.deepEqual(err?.details, { code: ROL_NO_DISPONIBLE_EN_EL_RUBRO, rol, industry });
  }
  for (const [rol, industry] of [
    ["ADMIN", "AUTOMOTORA"],
    ["USER", "AUTOMOTORA"],
    ["ADMIN", "CLINICA"],
    ["RECEPCION", "CLINICA"],
  ] as const) {
    assert.equal(
      error(() => exigirRolDelRubro(rol, industry)),
      undefined,
      `${rol} en ${industry}`,
    );
  }
});
