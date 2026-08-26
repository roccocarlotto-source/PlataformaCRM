import assert from "node:assert/strict";
import { test } from "node:test";
import { ingestContactSchema } from "./ingestContact.schema";

// El contrato de payload del webhook. Lo que se prueba acá no es "zod
// funciona": es que las reglas que la promoción da por sentadas se cumplan
// ANTES de llegar al SQL, porque el `COALESCE` del upsert no puede distinguir
// una cadena vacía de un valor real.

test('un campo vacío se trata como AUSENTE, no como valor — si no, pisaría el dato del CRM', () => {
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
