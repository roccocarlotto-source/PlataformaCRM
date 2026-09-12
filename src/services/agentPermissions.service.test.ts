import assert from "node:assert/strict";
import { test } from "node:test";
import { puedeEjecutarTool, type AgentParaPermisos } from "./agentPermissions.service";

// Unitarios, sin base: puedeEjecutarTool es pura. Se cubren las cuatro
// comprobaciones de §6 en su orden, la combinación, y la tolerancia a
// guardrails mal formados — que es tan importante como las comprobaciones
// mismas, porque un Json libre escrito por un admin puede venir de cualquier
// forma.

function agente(overrides: Partial<AgentParaPermisos> = {}): AgentParaPermisos {
  return {
    enabledTools: ["create_opportunity", "create_booking", "get_availability"],
    guardrails: {},
    ...overrides,
  };
}

const SIN_DATOS = {};

// ---------------------------------------------------------------------------
// (1) enabledTools
// ---------------------------------------------------------------------------

test("(1) una tool que no está en enabledTools se rechaza, y el motivo lo dice", () => {
  const decision = puedeEjecutarTool(agente(), "update_opportunity", {}, SIN_DATOS);
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /no está habilitada/);
  assert.match(decision.reason ?? "", /update_opportunity/);
});

test("(1) una tool habilitada, sin guardrails, se permite sin reason", () => {
  assert.deepEqual(puedeEjecutarTool(agente(), "create_opportunity", {}, SIN_DATOS), {
    allowed: true,
  });
});

test("(1) enabledTools vacío rechaza todo", () => {
  const decision = puedeEjecutarTool(
    agente({ enabledTools: [] }),
    "create_opportunity",
    {},
    SIN_DATOS,
  );
  assert.equal(decision.allowed, false);
});

// ---------------------------------------------------------------------------
// (2) accionesProhibidas
// ---------------------------------------------------------------------------

test("(2) accionesProhibidas gana sobre enabledTools", () => {
  // Habilitada en general, prohibida por guardrail: no se ejecuta.
  const decision = puedeEjecutarTool(
    agente({ guardrails: { accionesProhibidas: ["create_booking"] } }),
    "create_booking",
    {},
    SIN_DATOS,
  );
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /prohibida/);
});

test("(2) una acción prohibida distinta no afecta a las demás", () => {
  const decision = puedeEjecutarTool(
    agente({ guardrails: { accionesProhibidas: ["create_booking"] } }),
    "create_opportunity",
    {},
    SIN_DATOS,
  );
  assert.equal(decision.allowed, true);
});

// ---------------------------------------------------------------------------
// (3) infoNoModificable — formato Entidad.campo, comparado por nombre de campo
// ---------------------------------------------------------------------------

test("(3) un arg que coincide con un campo protegido rechaza — se descarta el prefijo de entidad", () => {
  const decision = puedeEjecutarTool(
    agente({ guardrails: { infoNoModificable: ["Contact.email"] } }),
    "create_opportunity",
    { title: "x", email: "otro@example.test" },
    SIN_DATOS,
  );
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /información protegida/);
  assert.match(decision.reason ?? "", /email/);
});

test("(3) la comparación no distingue mayúsculas", () => {
  const decision = puedeEjecutarTool(
    agente({ guardrails: { infoNoModificable: ["Contact.Email"] } }),
    "create_opportunity",
    { EMAIL: "x" },
    SIN_DATOS,
  );
  assert.equal(decision.allowed, false);
});

test("(3) un campo protegido que no aparece en los args no bloquea nada", () => {
  const decision = puedeEjecutarTool(
    agente({ guardrails: { infoNoModificable: ["Contact.email", "Contact.phone"] } }),
    "create_opportunity",
    { title: "Corte", amount: 1500 },
    SIN_DATOS,
  );
  assert.equal(decision.allowed, true);
});

test("(3) también funciona sin prefijo de entidad", () => {
  const decision = puedeEjecutarTool(
    agente({ guardrails: { infoNoModificable: ["amount"] } }),
    "create_opportunity",
    { title: "Corte", amount: 1500 },
    SIN_DATOS,
  );
  assert.equal(decision.allowed, false);
});

// ---------------------------------------------------------------------------
// (4) datosRequeridosAntesDeAccion — args + lo que la conversación ya sabe
// ---------------------------------------------------------------------------

const REQUIERE_PARA_RESERVAR = {
  datosRequeridosAntesDeAccion: { create_booking: ["contactId", "serviceTypeId"] },
};

test("(4) falta un dato requerido: rechaza y el motivo dice cuál", () => {
  const decision = puedeEjecutarTool(
    agente({ guardrails: REQUIERE_PARA_RESERVAR }),
    "create_booking",
    { resourceId: "r1" },
    { contactId: "c1" },
  );
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /hace falta conocer: serviceTypeId/);
  assert.ok(!decision.reason?.includes("contactId"), "contactId ya estaba disponible");
});

test("(4) el dato puede venir de los args O de lo que la conversación sabe", () => {
  // serviceTypeId en args, contactId en la conversación: los dos cuentan.
  const decision = puedeEjecutarTool(
    agente({ guardrails: REQUIERE_PARA_RESERVAR }),
    "create_booking",
    { serviceTypeId: "s1" },
    { contactId: "c1" },
  );
  assert.equal(decision.allowed, true);
});

test("(4) un valor vacío NO cuenta como disponible", () => {
  const decision = puedeEjecutarTool(
    agente({ guardrails: REQUIERE_PARA_RESERVAR }),
    "create_booking",
    { serviceTypeId: "   " },
    { contactId: null },
  );
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /contactId, serviceTypeId/);
});

test("(4) los requisitos de OTRA tool no aplican", () => {
  const decision = puedeEjecutarTool(
    agente({ guardrails: REQUIERE_PARA_RESERVAR }),
    "create_opportunity",
    { title: "x" },
    SIN_DATOS,
  );
  assert.equal(decision.allowed, true);
});

// ---------------------------------------------------------------------------
// Orden y combinación
// ---------------------------------------------------------------------------

test("las comprobaciones se aplican en orden: la (1) corta antes que la (2)", () => {
  // No habilitada Y prohibida: el motivo es el de (1), que es el que se
  // evalúa primero.
  const decision = puedeEjecutarTool(
    agente({ enabledTools: [], guardrails: { accionesProhibidas: ["create_booking"] } }),
    "create_booking",
    {},
    SIN_DATOS,
  );
  assert.equal(decision.allowed, false);
  assert.match(decision.reason ?? "", /no está habilitada/);
});

test("todo configurado y todo satisfecho: se permite", () => {
  const decision = puedeEjecutarTool(
    agente({
      guardrails: {
        accionesProhibidas: ["update_opportunity"],
        infoNoModificable: ["Contact.email"],
        datosRequeridosAntesDeAccion: { create_booking: ["contactId", "serviceTypeId"] },
      },
    }),
    "create_booking",
    { resourceId: "r1", serviceTypeId: "s1", startsAt: "2026-09-14T12:00:00Z" },
    { contactId: "c1" },
  );
  assert.deepEqual(decision, { allowed: true });
});

// ---------------------------------------------------------------------------
// Tolerancia: un guardrails mal formado no tumba el turno
// ---------------------------------------------------------------------------

test("guardrails con tipos equivocados se tratan como no configurados", () => {
  const casos: unknown[] = [
    null,
    "texto",
    [],
    { accionesProhibidas: "create_booking" },
    { infoNoModificable: 42 },
    { datosRequeridosAntesDeAccion: ["contactId"] },
    { datosRequeridosAntesDeAccion: { create_booking: "contactId" } },
    { accionesProhibidas: [1, null, "otra_tool"] },
  ];

  for (const guardrails of casos) {
    const decision = puedeEjecutarTool(
      agente({ guardrails }),
      "create_booking",
      { resourceId: "r1" },
      SIN_DATOS,
    );
    assert.equal(
      decision.allowed,
      true,
      `debía permitir con guardrails=${JSON.stringify(guardrails)}`,
    );
  }
});
