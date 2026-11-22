import assert from "node:assert/strict";
import { test } from "node:test";
import { parsearSeccion } from "./guia";
import { conElTermino, markdownConElTermino, seccionesConElTermino } from "./terminoDeContacto";

const CLIENTE = { singular: "cliente", plural: "clientes" };
const PACIENTE = { singular: "paciente", plural: "pacientes" };

const MARKDOWN = [
  "# Pacientes y consultas",
  "",
  "### Qué muestra la lista de pacientes",
  "",
  "La ficha del paciente está en [Unir pacientes](/ayuda/contactos-y-consultas#unir-pacientes).",
  "Usá `{paciente}` en el texto.",
  "",
  "## Unir pacientes {#unir-pacientes}",
  "",
  "```",
  "paciente sin tocar",
  "```",
].join("\n");

test("conElTermino: singular, plural y mayúscula; con paciente o sin término, igual", () => {
  assert.equal(
    conElTermino("Pacientes: el paciente y los pacientes", CLIENTE),
    "Clientes: el cliente y los clientes",
  );
  assert.equal(conElTermino("el paciente", PACIENTE), "el paciente");
  assert.equal(conElTermino("el paciente", null), "el paciente");
});

test("markdownConElTermino: cambia lo que se lee y deja las anclas, los links y el código", () => {
  const cambiado = markdownConElTermino(MARKDOWN, CLIENTE);
  assert.match(cambiado, /^# Clientes y consultas$/m);
  // El ### sin ancla conserva la del texto original.
  assert.match(
    cambiado,
    /^### Qué muestra la lista de clientes \{#que-muestra-la-lista-de-pacientes\}$/m,
  );
  assert.match(
    cambiado,
    /La ficha del cliente está en \[Unir clientes\]\(\/ayuda\/contactos-y-consultas#unir-pacientes\)\./,
  );
  assert.match(cambiado, /Usá `\{paciente\}` en el texto\./);
  assert.match(cambiado, /^## Unir clientes \{#unir-pacientes\}$/m);
  assert.match(cambiado, /^paciente sin tocar$/m);
  assert.equal(markdownConElTermino(MARKDOWN, PACIENTE), MARKDOWN);
});

test("seccionesConElTermino: títulos siempre, el markdown solo si se pide; las anclas, nunca", () => {
  const seccion = parsearSeccion("02-contactos-y-consultas.md", MARKDOWN);
  const [soloTitulos] = seccionesConElTermino([seccion], CLIENTE);
  assert.equal(soloTitulos.titulo, "Clientes y consultas");
  assert.equal(soloTitulos.markdown, MARKDOWN);
  const [conTexto] = seccionesConElTermino([seccion], CLIENTE, { markdown: true });
  assert.doesNotMatch(
    conTexto.markdown.replace(/\{#[^}]*\}|\]\([^)]*\)|`[^`]*`/g, ""),
    /aciente(?! sin tocar)/,
  );
  assert.deepEqual(
    conTexto.encabezados.map((e) => [e.ancla, e.titulo]),
    [
      ["que-muestra-la-lista-de-pacientes", "Qué muestra la lista de clientes"],
      ["unir-pacientes", "Unir clientes"],
    ],
  );
  // Las anclas que se leen del markdown cambiado son las mismas.
  assert.deepEqual(
    parsearSeccion("02-contactos-y-consultas.md", conTexto.markdown).encabezados.map(
      (e) => e.ancla,
    ),
    seccion.encabezados.map((e) => e.ancla),
  );
});
