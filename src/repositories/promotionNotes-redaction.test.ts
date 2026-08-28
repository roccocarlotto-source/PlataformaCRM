import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { MARCADOR_DE_DATO_BORRADO } from "./contact.repository";
import { redactPromotionNotes } from "./ingestionEvent.repository";
import type { PromotionNote } from "../types/promotion";

// ---------------------------------------------------------------------------
// Redacción de `promotionNotes` en el borrado a pedido (D2-4).
//
// Es una función pura sobre el valor de una columna JSONB, así que se prueba
// sin base: acá lo que importa son las formas, incluidos los casos que ninguna
// promoción produce pero que una escritura directa a la tabla sí podría dejar.
//
// LA REGLA QUE TODOS ESTOS TESTS VERIFICAN, dicha una vez: se conserva QUÉ
// PASÓ (`tipo`, `campo`, `motivo`) y se destruye CON QUÉ VALOR (`crm`,
// `entrante`).
// ---------------------------------------------------------------------------

// Valores reconocibles: si alguno sobrevive a la redacción, el assert lo
// señala sin ambigüedad.
const TELEFONO_VIEJO = "+54 11 4444-4444";
const TELEFONO_NUEVO = "+54 11 5555-5555";

function comoArray(resultado: ReturnType<typeof redactPromotionNotes>): Record<string, unknown>[] {
  assert.notEqual(resultado, Prisma.DbNull, "se esperaba un array, no NULL");
  return resultado as unknown as Record<string, unknown>[];
}

test("una NotaConflicto conserva tipo y campo, y pierde los dos valores", () => {
  const notas: PromotionNote[] = [
    { tipo: "conflicto", campo: "phone", crm: TELEFONO_VIEJO, entrante: TELEFONO_NUEVO },
  ];

  const redactadas = comoArray(redactPromotionNotes(notas as unknown as Prisma.JsonValue));

  assert.equal(redactadas.length, 1);
  assert.deepEqual(redactadas[0], {
    tipo: "conflicto",
    campo: "phone",
    crm: MARCADOR_DE_DATO_BORRADO,
    entrante: MARCADOR_DE_DATO_BORRADO,
  });

  // El dato no puede sobrevivir en NINGUNA parte de la estructura, no solo en
  // la clave donde lo esperábamos.
  const serializado = JSON.stringify(redactadas);
  assert.ok(!serializado.includes(TELEFONO_VIEJO));
  assert.ok(!serializado.includes(TELEFONO_NUEVO));
});

test("una NotaIgnorado conserva tipo, campo y motivo, y pierde solo `entrante`", () => {
  const notas: PromotionNote[] = [
    {
      tipo: "ignorado",
      campo: "lifecycleStage",
      entrante: "CUSTOMER",
      motivo: "la ingesta nunca escribe lifecycleStage",
    },
  ];

  const redactadas = comoArray(redactPromotionNotes(notas as unknown as Prisma.JsonValue));

  assert.deepEqual(redactadas[0], {
    tipo: "ignorado",
    campo: "lifecycleStage",
    entrante: MARCADOR_DE_DATO_BORRADO,
    motivo: "la ingesta nunca escribe lifecycleStage",
  });
});

test("una NotaRevisionManual queda intacta: no tiene ningún valor que redactar", () => {
  const notas: PromotionNote[] = [
    { tipo: "revision_manual", motivo: "contacto sin email: no se deduplica" },
  ];

  const redactadas = comoArray(redactPromotionNotes(notas as unknown as Prisma.JsonValue));

  assert.deepEqual(redactadas[0], {
    tipo: "revision_manual",
    motivo: "contacto sin email: no se deduplica",
  });
});

test("un array con las tres notas redacta cada una según su tipo, y conserva el orden", () => {
  const notas: PromotionNote[] = [
    { tipo: "conflicto", campo: "firstName", crm: "Ana", entrante: "Anita" },
    { tipo: "revision_manual", motivo: "sin email" },
    { tipo: "ignorado", campo: "lifecycleStage", entrante: "CUSTOMER", motivo: "nunca se escribe" },
  ];

  const redactadas = comoArray(redactPromotionNotes(notas as unknown as Prisma.JsonValue));

  assert.equal(redactadas.length, 3);
  assert.equal(redactadas[0].tipo, "conflicto");
  assert.equal(redactadas[0].crm, MARCADOR_DE_DATO_BORRADO);
  assert.equal(redactadas[1].tipo, "revision_manual");
  assert.equal(redactadas[1].motivo, "sin email");
  assert.equal(redactadas[2].tipo, "ignorado");
  assert.equal(redactadas[2].entrante, MARCADOR_DE_DATO_BORRADO);

  const serializado = JSON.stringify(redactadas);
  assert.ok(!serializado.includes("Ana"), "ningún valor de la persona sobrevive");
  assert.ok(!serializado.includes("Anita"));
});

test("NULL se mantiene NULL: un evento sin conflictos no tiene nada que redactar", () => {
  assert.equal(redactPromotionNotes(null), Prisma.DbNull);
});

// ---------------------------------------------------------------------------
// FAIL-CLOSED. La columna es JSONB y una escritura directa a la base puede
// dejar ahí cualquier cosa. En una función de BORRADO, "no reconozco esto" no
// puede significar "lo dejo como está" — sería dejar dato personal sin
// redactar justo en la operación que existe para destruirlo.
// ---------------------------------------------------------------------------

test("una forma que no es un array se borra entera", () => {
  assert.equal(redactPromotionNotes({ algo: TELEFONO_VIEJO } as Prisma.JsonValue), Prisma.DbNull);
  assert.equal(redactPromotionNotes(TELEFONO_VIEJO), Prisma.DbNull);
  assert.equal(redactPromotionNotes(42), Prisma.DbNull);
});

test("un `tipo` desconocido borra el array entero, no solo esa nota", () => {
  const notas = [
    { tipo: "conflicto", campo: "phone", crm: TELEFONO_VIEJO, entrante: TELEFONO_NUEVO },
    { tipo: "algo_que_no_existe", valorMisterioso: TELEFONO_NUEVO },
  ];

  // No se redacta la primera y se descarta la segunda: no hay forma de saber
  // qué claves de una nota desconocida son valores, así que se va todo.
  assert.equal(redactPromotionNotes(notas as unknown as Prisma.JsonValue), Prisma.DbNull);
});

test("un elemento que no es un objeto también borra el array entero", () => {
  assert.equal(
    redactPromotionNotes([TELEFONO_VIEJO] as unknown as Prisma.JsonValue),
    Prisma.DbNull,
  );
  assert.equal(redactPromotionNotes([null] as unknown as Prisma.JsonValue), Prisma.DbNull);
});

test("un array vacío se mantiene como array vacío", () => {
  // La promoción nunca lo produce (markEventProcessed normaliza a NULL), pero
  // si estuviera, no hay nada que redactar ni razón para cambiarlo de forma.
  const redactadas = comoArray(redactPromotionNotes([] as unknown as Prisma.JsonValue));
  assert.deepEqual(redactadas, []);
});
