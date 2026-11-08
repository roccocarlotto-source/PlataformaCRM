import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationChannel } from "@prisma/client";
import { cancelacionDelTurno, type SalidaDeVoz } from "./agentOrchestration.service";
import { CancelacionDelTurno, TurnoCancelado } from "./cancelacionDelTurno";

test("un turno se cancela mientras no pasó un punto sin vuelta", () => {
  const cancelacion = new CancelacionDelTurno();
  assert.equal(cancelacion.senal.aborted, false);
  assert.equal(cancelacion.intentarCancelar(), true);
  assert.equal(cancelacion.fueCancelado, true);
  // También corta la llamada al modelo en curso.
  assert.equal(cancelacion.senal.aborted, true);
  // El turno corta en el próximo punto sin vuelta.
  assert.throws(() => cancelacion.sinVuelta(), TurnoCancelado);
  assert.throws(() => cancelacion.comprobar(), TurnoCancelado);
});

test("pasado un punto sin vuelta, cancelar no hace nada", () => {
  const cancelacion = new CancelacionDelTurno();
  cancelacion.sinVuelta();
  assert.equal(cancelacion.intentarCancelar(), false);
  assert.equal(cancelacion.fueCancelado, false);
  assert.equal(cancelacion.senal.aborted, false);
  assert.doesNotThrow(() => cancelacion.sinVuelta());
  assert.doesNotThrow(() => cancelacion.comprobar());
});

test("seguir sin vuelta: false si ya se canceló; si no, desde ahí no se cancela", () => {
  const cancelada = new CancelacionDelTurno();
  cancelada.intentarCancelar();
  assert.equal(cancelada.seguirSinVuelta(), false);

  const sigue = new CancelacionDelTurno();
  assert.equal(sigue.seguirSinVuelta(), true);
  assert.equal(sigue.intentarCancelar(), false);
  assert.equal(sigue.fueCancelado, false);
});

test("solo una llamada se puede cancelar: WhatsApp, Messenger, Instagram y la web siguen igual", () => {
  const cancelacion = new CancelacionDelTurno();
  const voz = { cancelacion } as unknown as SalidaDeVoz;
  assert.equal(cancelacionDelTurno({ voz }, "VOICE"), cancelacion);
  const otros: ConversationChannel[] = ["WHATSAPP", "MESSENGER", "INSTAGRAM", "WEB"];
  for (const canal of otros) {
    // Aunque alguien le pase una, en otro canal no hay cancelación.
    assert.equal(cancelacionDelTurno({ voz }, canal), null, canal);
    assert.equal(cancelacionDelTurno({}, canal), null, canal);
  }
  assert.equal(cancelacionDelTurno({}, "VOICE"), null);
});
