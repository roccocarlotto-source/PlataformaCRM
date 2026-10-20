import assert from "node:assert/strict";
import { test } from "node:test";
import { AVISO_DE_ADMIN, type Seccion } from "../compartido/guia/guia";
import { modulosDe } from "../config/ediciones";
import { guiaDeUso, guiaVisible, type LectorDeLaGuia } from "./guiaDeUso.service";

// ---------------------------------------------------------------------------
// La guía del backend, con los archivos reales de docs/guia-de-uso/. La
// lógica de qué ve cada quien la prueban los tests del frontend
// (features/guia/*.test.ts), que usan el mismo código compartido; acá se
// prueba que el backend lee los mismos archivos y arma el lector desde la
// sesión (rubro, módulos de modulosDe, rol) como corresponde.
// ---------------------------------------------------------------------------

const automotora = (
  role: LectorDeLaGuia["role"],
  edition: "COMPLETA" | "ESENCIAL" = "COMPLETA",
): LectorDeLaGuia => ({
  industry: "AUTOMOTORA",
  modulos: modulosDe(edition, "AUTOMOTORA", []),
  role,
  isPlatformAdmin: false,
});
const clinica = (role: LectorDeLaGuia["role"]): LectorDeLaGuia => ({
  industry: "CLINICA",
  modulos: modulosDe("COMPLETA", "CLINICA", []),
  role,
  isPlatformAdmin: false,
});

const slugs = (secciones: Seccion[]) => secciones.map((s) => s.slug);
const anclas = (secciones: Seccion[], slug: string) =>
  secciones.find((s) => s.slug === slug)?.encabezados.map((e) => e.ancla) ?? [];

test("lee las dos guías del disco, sin el README", () => {
  const { raiz, clinica: deClinica } = guiaDeUso();
  assert.ok(raiz.length >= 15);
  assert.ok(deClinica.length >= 11);
  assert.equal(raiz[0].slug, "primeros-pasos");
  assert.ok(!slugs(raiz).includes("README"));
});

test("cada {#ancla} explícita de los archivos queda con ese nombre (los links y los registros la usan)", () => {
  const { raiz, clinica: deClinica } = guiaDeUso();
  for (const seccion of [...raiz, ...deClinica]) {
    const parseadas = new Set(seccion.encabezados.map((e) => e.ancla));
    for (const [, ancla] of seccion.markdown.matchAll(/^#{2,3} .+\{#([a-z0-9-]+)\}\s*$/gm)) {
      assert.ok(parseadas.has(ancla), `${seccion.slug}#${ancla}`);
    }
  }
});

test("un ADMIN de automotora ve todas las secciones menos Plataforma y Taller", () => {
  const visibles = slugs(guiaVisible(automotora("ADMIN")));
  assert.deepEqual(
    visibles,
    slugs(guiaDeUso().raiz).filter((s) => s !== "plataforma" && s !== "servicios"),
  );
});

test("un USER no ve los bloques de administrador ni las secciones que se quedan sin nada", () => {
  const visibles = guiaVisible(automotora("USER"));
  assert.ok(!slugs(visibles).includes("organizacion-y-sucursales"));
  assert.ok(!slugs(visibles).includes("base-de-conocimiento"));
  assert.ok(!anclas(visibles, "usuarios-y-permisos").includes("invitar"));
  assert.ok(anclas(visibles, "usuarios-y-permisos").includes("roles"));
  assert.ok(anclas(visibles, "agentes-de-ia").includes("derivar"));
});

test("ESENCIAL no ve cotizaciones; sí las oportunidades simples", () => {
  const visibles = guiaVisible(automotora("ADMIN", "ESENCIAL"));
  const oportunidades = anclas(visibles, "oportunidades-y-procesos-de-venta");
  assert.ok(!oportunidades.includes("cotizaciones"));
  assert.ok(oportunidades.includes("oportunidades-esencial"));
});

test("una clínica ve su guía: nada de stock ni oportunidades; Recepción sin configuración", () => {
  const admin = guiaVisible(clinica("ADMIN"));
  assert.ok(!slugs(admin).includes("stock"));
  assert.ok(!slugs(admin).includes("oportunidades-y-procesos-de-venta"));
  assert.ok(anclas(admin, "actividades-y-agenda").includes("profesionales"));

  const recepcion = guiaVisible(clinica("RECEPCION"));
  assert.ok(!anclas(recepcion, "actividades-y-agenda").includes("profesionales"));
  assert.ok(anclas(recepcion, "actividades-y-agenda").includes("sobreturnos"));
  assert.ok(!slugs(recepcion).includes("organizacion-y-sucursales"));
});

test("para el asistente, un bloque de administrador queda como un aviso sin ancla y sin pasos", () => {
  const visibles = guiaVisible(automotora("USER"), { conAvisosDeAdmin: true });
  const usuarios = visibles.find((s) => s.slug === "usuarios-y-permisos");
  assert.ok(usuarios);
  assert.match(
    usuarios.markdown,
    new RegExp(`^## Invitar a una persona — ${AVISO_DE_ADMIN}$`, "m"),
  );
  assert.doesNotMatch(usuarios.markdown, /\{#invitar\}/);
  // Con avisos, la sección que se queda sin bloques sigue estando.
  assert.ok(slugs(visibles).includes("organizacion-y-sucursales"));
});

test("un USER no tiene links a pantallas de administrador; un ADMIN sí", () => {
  const deUser = guiaVisible(automotora("USER"))
    .map((s) => s.markdown)
    .join("\n");
  const deAdmin = guiaVisible(automotora("ADMIN"))
    .map((s) => s.markdown)
    .join("\n");
  // El bloque de los campos de contacto lo ven los dos; el link a su pantalla
  // de configuración, solo el ADMIN.
  assert.match(deAdmin, /\[Campos de contacto\]\(\/contact-custom-fields\)/);
  assert.match(deUser, /Campos de contacto/);
  assert.doesNotMatch(deUser, /\]\(\/contact-custom-fields(\/[^)]*)?\)/);
  assert.doesNotMatch(deUser, /\]\(\/automations(\/[^)]*)?\)/);
});
