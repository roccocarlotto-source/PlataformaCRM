import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DIAS_DE_RETENCION_IDENTIDAD_SIN_CONFIRMAR,
  esCandidataAPurga,
  fechaDeCorteDeIdentidades,
  type IdentidadCandidata,
} from "./authCleanup.service";

// Unitario, sin base ni red: esCandidataAPurga es una función pura, y es donde
// vive la única decisión de este script que puede destruir algo irreversible.
//
// La aserción que importa es la de `invited_at`. La versión ingenua del
// predicado —"sin confirmar y vieja"— borraría las identidades que
// inviteUserByEmail crea para los invitados, que están sin confirmar
// exactamente hasta que aceptan. Ese caso tiene su propio test y no es
// decorativo: es el modo de fallo que convertiría una tarea de higiene en un
// borrado de gente real.

const CORTE = new Date("2026-08-21T00:00:00.000Z");

function identidad(overrides: Partial<IdentidadCandidata> = {}): IdentidadCandidata {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alguien@example.test",
    created_at: "2026-08-01T00:00:00.000Z",
    email_confirmed_at: null,
    invited_at: null,
    ...overrides,
  };
}

test("una identidad sin confirmar, sin invitación y anterior al corte es candidata", () => {
  assert.equal(esCandidataAPurga(identidad(), CORTE), true);
});

test("una identidad YA CONFIRMADA nunca es candidata, por vieja que sea", () => {
  assert.equal(
    esCandidataAPurga(
      identidad({
        created_at: "2020-01-01T00:00:00.000Z",
        email_confirmed_at: "2020-01-02T00:00:00.000Z",
      }),
      CORTE,
    ),
    false,
  );
});

test("una identidad de INVITACIÓN nunca es candidata — es el caso que la versión ingenua borraría", () => {
  // inviteUserByEmail deja email_confirmed_at en null hasta que el invitado
  // acepta. Sin mirar invited_at, una invitación de dos semanas sin aceptar
  // cumple "sin confirmar y vieja" y se borraría la identidad de alguien a
  // quien un ADMIN invitó a propósito.
  assert.equal(
    esCandidataAPurga(
      identidad({
        created_at: "2026-07-01T00:00:00.000Z",
        email_confirmed_at: null,
        invited_at: "2026-07-01T00:00:00.000Z",
      }),
      CORTE,
    ),
    false,
  );
});

test("una identidad sin confirmar pero POSTERIOR al corte no es candidata — puede ser un registro en curso", () => {
  assert.equal(
    esCandidataAPurga(identidad({ created_at: "2026-08-27T00:00:00.000Z" }), CORTE),
    false,
  );
});

test("una identidad exactamente en el corte no es candidata — la comparación es estricta", () => {
  assert.equal(esCandidataAPurga(identidad({ created_at: CORTE.toISOString() }), CORTE), false);
});

test("una created_at que no parsea no se borra: un dato que no se entiende no justifica una operación irreversible", () => {
  assert.equal(esCandidataAPurga(identidad({ created_at: "no es una fecha" }), CORTE), false);
});

test("email_confirmed_at e invited_at ausentes (undefined) se tratan como null", () => {
  const sinCampos: IdentidadCandidata = {
    id: "00000000-0000-0000-0000-000000000002",
    created_at: "2026-08-01T00:00:00.000Z",
  };
  assert.equal(esCandidataAPurga(sinCampos, CORTE), true);
});

test("fechaDeCorteDeIdentidades resta exactamente los días de la política", () => {
  const ahora = new Date("2026-08-28T12:34:56.000Z");
  const corte = fechaDeCorteDeIdentidades(ahora);

  const diferenciaEnDias = (ahora.getTime() - corte.getTime()) / (24 * 60 * 60 * 1000);
  assert.equal(diferenciaEnDias, DIAS_DE_RETENCION_IDENTIDAD_SIN_CONFIRMAR);

  // La hora del día se preserva: el corte es "hace N días a esta misma hora",
  // no "hace N días a medianoche". Un corte a medianoche movería la ventana
  // efectiva entre 0 y 24 horas según cuándo se corra el script.
  assert.equal(corte.toISOString(), "2026-08-21T12:34:56.000Z");
});
