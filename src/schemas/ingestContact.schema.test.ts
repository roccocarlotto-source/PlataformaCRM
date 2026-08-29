import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldMappingSchema } from "./fieldMapping.schema";
import { ingestContactSchema } from "./ingestContact.schema";

// El contrato de payload del webhook. Lo que se prueba acá no es "zod
// funciona": es que las reglas que la promoción da por sentadas se cumplan
// ANTES de llegar al SQL, porque el `COALESCE` del upsert no puede distinguir
// una cadena vacía de un valor real.

test("un campo vacío se trata como AUSENTE, no como valor — si no, pisaría el dato del CRM", () => {
  const r = ingestContactSchema.parse({
    firstName: "Ana",
    lastName: "Gómez",
    phone: "",
    jobTitle: "   ",
  });

  // undefined y no "": el repositorio traduce undefined a NULL, y
  // COALESCE(contacts.phone, NULL) conserva lo que el CRM ya tenía. Con ""
  // el COALESCE lo tomaría por un valor y pisaría un teléfono cargado a mano.
  assert.equal(r.phone, undefined);
  assert.equal(r.jobTitle, undefined);
});

// ---------------------------------------------------------------------------
// A-6 (docs/auditoria-2026-08-29.md) — un email VACÍO es ausencia, no un email
// inválido.
//
// La regla "cadena vacía = ausente" ya existía para phone y jobTitle, pero
// email tenía su propia copia con el transform al final de la cadena: .email()
// corría antes y rechazaba "" con "email inválido", así que la fila quedaba
// FAILED. Un formulario con el input de email sin completar manda "" (es lo
// que hace cualquier <form>), y csv-parse entrega "" para una celda vacía: toda
// fila CSV sin email fallaba, mientras que la misma fila en XLSX (celda vacía =
// null, que sí se descartaba) entraba.
// ---------------------------------------------------------------------------

test("A-6: un email VACÍO se trata como AUSENTE, igual que phone y jobTitle — no como 'email inválido'", () => {
  const resultado = ingestContactSchema.safeParse({
    firstName: "Ana",
    lastName: "Gómez",
    email: "",
  });

  assert.equal(resultado.success, true, "antes: 'email inválido' y la fila FAILED");
  assert.equal(resultado.success && resultado.data.email, undefined);
});

test("A-6: un email de solo espacios también es ausencia", () => {
  const r = ingestContactSchema.parse({ firstName: "Ana", lastName: "Gómez", email: "   " });
  assert.equal(r.email, undefined);
});

test("A-6: las tres reglas de 'vacío = ausente' son la misma: email, phone y jobTitle vacíos en el mismo payload", () => {
  const r = ingestContactSchema.parse({
    firstName: "Ana",
    lastName: "Gómez",
    email: "",
    phone: "",
    jobTitle: "  ",
  });

  assert.deepEqual(
    { email: r.email, phone: r.phone, jobTitle: r.jobTitle },
    { email: undefined, phone: undefined, jobTitle: undefined },
  );
});

test("A-6: la ausencia no afloja el formato — un email PRESENTE e inválido sigue siendo inválido", () => {
  // La regla de formato se aplica a lo que ya se decidió que es un valor: "" no
  // lo es, "no-es-un-email" sí.
  const resultado = ingestContactSchema.safeParse({
    firstName: "Ana",
    lastName: "Gómez",
    email: "no-es-un-email",
  });
  assert.equal(resultado.success, false);
  assert.ok(
    !resultado.success && resultado.error.issues.some((i) => i.message === "email inválido"),
  );
});

test("A-6: un email que no es string sigue rechazándose por tipo, no se convierte en ausencia", () => {
  // preprocess solo decide sobre strings vacíos: un número no es "ausente", es
  // un payload mal formado, y el mensaje de tipo no ecoa el valor (D2-7).
  const resultado = ingestContactSchema.safeParse({
    firstName: "Ana",
    lastName: "Gómez",
    email: 12345,
  });
  assert.equal(resultado.success, false);
});

test("los espacios al borde se recortan — el CHECK de la base los rechazaría", () => {
  const r = ingestContactSchema.parse({
    firstName: "  Ana  ",
    lastName: "  Gómez ",
    email: "  ana@ejemplo.com  ",
  });

  assert.equal(r.firstName, "Ana");
  assert.equal(r.lastName, "Gómez");
  // contacts_email_trimmed_check rechaza un email sin recortar, así que sin
  // esto la fila fallaría contra la base en vez de entrar (§9.6).
  assert.equal(r.email, "ana@ejemplo.com");
});

test("el email NO se baja a minúsculas — se guarda lo que la persona escribió", () => {
  const r = ingestContactSchema.parse({
    firstName: "Ana",
    lastName: "Gómez",
    email: "Ana@Ejemplo.COM",
  });

  // M-13/§9.6: la insensibilidad la garantiza el índice sobre lower(email). Si
  // la promoción bajara a minúsculas y contact.service no, el mismo contacto
  // quedaría escrito distinto según por qué puerta entró.
  assert.equal(r.email, "Ana@Ejemplo.COM");
});

test("las claves desconocidas se ignoran, no rompen la integración", () => {
  const r = ingestContactSchema.parse({
    firstName: "Ana",
    lastName: "Gómez",
    utm_source: "google",
    "campo raro": 42,
  });

  // Las desconocidas no sobreviven al parseo: no llegan al upsert ni pueden
  // terminar escritas en una columna por accidente.
  assert.deepEqual(Object.keys(r).sort(), ["firstName", "lastName"]);
  assert.equal("utm_source" in r, false);
  assert.equal("campo raro" in r, false);
  // Y no se pierden: el payload completo sigue intacto en rawPayload (§1), así
  // que el ítem 5 puede reprocesarlo con otro criterio.
});

test("sin los campos mínimos el payload es inválido — la fila se marcará FAILED", () => {
  for (const payload of [
    { email: "a@b.com" },
    { firstName: "Ana" },
    { firstName: "", lastName: "Gómez" },
    { firstName: "   ", lastName: "Gómez" },
  ]) {
    assert.equal(
      ingestContactSchema.safeParse(payload).success,
      false,
      `${JSON.stringify(payload)} no puede construir un Contact válido`,
    );
  }
});

test("un email con formato inválido invalida el payload", () => {
  const r = ingestContactSchema.safeParse({
    firstName: "Ana",
    lastName: "Gómez",
    email: "no-es-un-email",
  });

  // Guardarlo deduplicaría mal para siempre; marcarlo FAILED lo deja
  // consultable y corregible (§5).
  assert.equal(r.success, false);
});

test("un valor más largo que su columna invalida el payload en vez de reventar contra Postgres", () => {
  const largo = ingestContactSchema.safeParse({
    firstName: "x".repeat(101),
    lastName: "Gómez",
  });
  assert.equal(largo.success, false);

  const telefono = ingestContactSchema.safeParse({
    firstName: "Ana",
    lastName: "Gómez",
    phone: "9".repeat(31),
  });
  assert.equal(telefono.success, false);
});

// ---------------------------------------------------------------------------
// D2-7 — ningún mensaje de validación puede hacer eco del valor recibido.
//
// El hallazgo NO es que hoy filtre datos personales: se verificó que no lo
// hace. Es que nada lo garantizaba para el campo que alguien agregue mañana.
// El caso concreto es `z.enum` sin `errorMap`, cuyo mensaje por defecto es
// "Invalid enum value. Expected ..., received '<el valor real>'".
//
// Estos mensajes terminan concatenados en IngestionEvent.errorMessage (ver
// promotion.service.ts), que se renderiza fila por fila en
// IngestionEventListPage y viaja al navegador. Un eco convertiría esa columna
// en un segundo lugar donde vive un dato personal, sin clasificación, sin
// retención y fuera del alcance del borrado a pedido.
//
// EL VALOR ES RECONOCIBLE A PROPÓSITO: si aparece en un mensaje, aparece
// entero y el assert lo señala sin ambigüedad.
// ---------------------------------------------------------------------------

const VALOR_ESPIA = "VALOR-SECRETO-DE-PRUEBA-12345";

function mensajesDe(resultado: ReturnType<typeof ingestContactSchema.safeParse>): string[] {
  assert.equal(resultado.success, false, "el payload de prueba tiene que fallar la validación");
  return resultado.success ? [] : resultado.error.issues.map((issue) => issue.message);
}

// Base válida: cada caso rompe UN campo por vez, así el issue que se inspecciona
// es el del campo bajo prueba y no el ruido de los demás.
function payloadValido() {
  return {
    firstName: "Ana",
    lastName: "Gómez",
    email: "ana@ejemplo.test",
    phone: "+5411555555",
    jobTitle: "Compras",
  };
}

// Un valor que supera cualquier .max() del schema, construido a partir del
// espía para que siga siendo reconocible aunque se trunque.
function largoConEspia(largo: number): string {
  return VALOR_ESPIA + "x".repeat(Math.max(0, largo - VALOR_ESPIA.length));
}

test("D2-7: email con formato inválido NO ecoa el valor recibido", () => {
  const resultado = ingestContactSchema.safeParse({
    ...payloadValido(),
    email: VALOR_ESPIA,
  });

  const mensajes = mensajesDe(resultado);
  assert.ok(mensajes.length > 0, "tiene que haber al menos un issue");
  for (const mensaje of mensajes) {
    assert.ok(
      !mensaje.includes(VALOR_ESPIA),
      `el mensaje "${mensaje}" hace eco del valor recibido`,
    );
  }
});

test("D2-7: los campos con .max() no ecoan el valor al pasarse de largo", () => {
  // Los cuatro campos con tope, cada uno con su largo. Es el caso donde un
  // mensaje mal escrito ("«X» supera los N caracteres") sería más natural de
  // escribir y por eso el más fácil de introducir sin querer.
  const casos: [string, unknown][] = [
    ["firstName", largoConEspia(101)],
    ["lastName", largoConEspia(101)],
    ["email", `${largoConEspia(250)}@ejemplo.test`],
    ["phone", largoConEspia(31)],
    ["jobTitle", largoConEspia(101)],
  ];

  for (const [campo, valor] of casos) {
    const resultado = ingestContactSchema.safeParse({ ...payloadValido(), [campo]: valor });
    for (const mensaje of mensajesDe(resultado)) {
      assert.ok(
        !mensaje.includes(VALOR_ESPIA),
        `${campo}: el mensaje "${mensaje}" hace eco del valor recibido`,
      );
    }
  }
});

test("D2-7: los requeridos vacíos no ecoan, y el tipo equivocado tampoco", () => {
  // firstName/lastName vacíos (min(1)) y un tipo que no es string: los dos
  // caminos que no pasan por un .max() ni por .email().
  const vacios = ingestContactSchema.safeParse({ ...payloadValido(), firstName: "" });
  for (const mensaje of mensajesDe(vacios)) {
    assert.ok(!mensaje.includes(VALOR_ESPIA));
  }

  const tipoMalo = ingestContactSchema.safeParse({
    ...payloadValido(),
    phone: { secreto: VALOR_ESPIA },
  });
  for (const mensaje of mensajesDe(tipoMalo)) {
    assert.ok(
      !mensaje.includes(VALOR_ESPIA),
      `el mensaje "${mensaje}" hace eco de un valor no-string`,
    );
  }
});

// ---------------------------------------------------------------------------
// fieldMappingSchema entra en la misma regla, y no por simetría:
// promotion.service.ts lo REVALIDA en cada promoción (traducirConMapeo) y
// concatena sus issue.message en el mismo errorMessage. Su `z.enum` de destinos
// es exactamente el caso que el default de zod ecoaría.
// ---------------------------------------------------------------------------

test("D2-7: el destino inválido de un fieldMapping NO ecoa el valor recibido", () => {
  const resultado = fieldMappingSchema.safeParse({ Nombre: VALOR_ESPIA });

  assert.equal(resultado.success, false);
  const mensajes = resultado.success ? [] : resultado.error.issues.map((i) => i.message);
  assert.ok(mensajes.length > 0);
  for (const mensaje of mensajes) {
    assert.ok(
      !mensaje.includes(VALOR_ESPIA),
      `el mensaje "${mensaje}" hace eco del destino recibido — falta el errorMap del z.enum`,
    );
  }
});

test("D2-7: un encabezado demasiado largo tampoco se ecoa", () => {
  const resultado = fieldMappingSchema.safeParse({ [largoConEspia(300)]: "firstName" });

  assert.equal(resultado.success, false);
  const mensajes = resultado.success ? [] : resultado.error.issues.map((i) => i.message);
  for (const mensaje of mensajes) {
    assert.ok(!mensaje.includes(VALOR_ESPIA), `el mensaje "${mensaje}" hace eco del encabezado`);
  }
});
