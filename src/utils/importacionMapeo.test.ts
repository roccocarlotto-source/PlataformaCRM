import assert from "node:assert/strict";
import { test } from "node:test";
import { crearAjustesSchema } from "../schemas/importacion.schema";
import type { DefinicionDeCampo } from "./camposPersonalizados";
import {
  cambiosAAplicar,
  claveDeActividad,
  cuerpoDeActividad,
  traducirFilaDeActividad,
  clavesDeContacto,
  clavesDeEmpresa,
  compararEtapa,
  planearContacto,
  planearEmpresa,
  sugerirMapeo,
  tipoDePlan,
  traducirFilaDeContacto,
  traducirFilaDeEmpresa,
  type AjustesDeImportacion,
  type CandidatoDeContacto,
  type ContactoExistente,
} from "./importacionMapeo";

// El núcleo puro del asistente (docs/importacion-de-datos.md §3, §5 y §8.2).
// Datos inventados.

function ajustes(mapeo: Record<string, string>, extra: Partial<AjustesDeImportacion> = {}) {
  return {
    ...crearAjustesSchema("CONTACT").parse({ mapeo: { Nombre: "fullName", ...mapeo } }),
    ...extra,
  } as AjustesDeImportacion;
}

const DEFINICIONES: DefinicionDeCampo[] = [
  {
    key: "forma_de_pago",
    label: "Forma de pago",
    type: "MULTI_SELECT",
    options: ["Contado", "Permuta"],
    agentEditable: false,
  },
  { key: "presupuesto", label: "Presupuesto", type: "NUMBER", options: [], agentEditable: false },
  { key: "visita", label: "Visita", type: "DATE", options: [], agentEditable: false },
  { key: "financia", label: "Financia", type: "BOOLEAN", options: [], agentEditable: false },
  { key: "zona", label: "Zona", type: "SELECT", options: ["Norte", "Sur"], agentEditable: false },
];

// ---------------------------------------------------------------------------
// Traducción de una fila de contacto
// ---------------------------------------------------------------------------

test("contacto: nombre completo partido, email, teléfono normalizado con el país de la organización, etapa por mapeo", () => {
  const r = traducirFilaDeContacto(
    { Nombre: "Ana María Pérez", Mail: "Ana@Example.com", Cel: "099 123 456", Etapa: "Cliente" },
    ajustes(
      { Mail: "email", Cel: "phone", Etapa: "lifecycleStage" },
      { etapas: { Cliente: "CUSTOMER" } },
    ),
    [],
    "598",
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.candidato.firstName, "Ana");
  assert.equal(r.candidato.lastName, "María Pérez");
  assert.equal(r.candidato.email, "Ana@Example.com");
  assert.equal(r.candidato.phone, "+59899123456");
  assert.equal(r.candidato.lifecycleStage, "CUSTOMER");
  assert.deepEqual(clavesDeContacto(r.candidato), [
    "email:ana@example.com",
    "telefono:59899123456",
  ]);
});

test("contacto: una sola palabra queda con apellido «-» y advertencia; un teléfono imposible entra sin teléfono y avisa", () => {
  const r = traducirFilaDeContacto(
    { Nombre: "Beto", Cel: "abc" },
    ajustes({ Cel: "phone" }),
    [],
    null,
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.candidato.lastName, "-");
  assert.equal(r.candidato.phone, undefined);
  assert.equal(r.advertencias.length, 2);
});

test("contacto: email inválido, fecha imposible y opción inexistente juntan TODOS los errores de la fila", () => {
  const r = traducirFilaDeContacto(
    { Nombre: "Ana Pérez", Mail: "no-es-mail", Alta: "31/02/2020", Zona: "Oeste" },
    ajustes({ Mail: "email", Alta: "customerSince", Zona: "custom:zona" }),
    DEFINICIONES,
    null,
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.errores.length, 3);
  assert.match(
    r.errores.join(" | "),
    /no es un email válido.*no es una fecha válida.*no es una de las opciones/,
  );
});

test("contacto: campos personalizados por tipo, MULTI_SELECT incluido, con los ajustes de formato del lote", () => {
  const r = traducirFilaDeContacto(
    {
      Nombre: "Ana Pérez",
      Pago: "permuta; contado",
      Presu: "1.500,50",
      Visita: "14/03/2025",
      Financia: "Sí",
      Zona: "norte",
    },
    ajustes({
      Pago: "custom:forma_de_pago",
      Presu: "custom:presupuesto",
      Visita: "custom:visita",
      Financia: "custom:financia",
      Zona: "custom:zona",
    }),
    DEFINICIONES,
    null,
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.candidato.customFields, {
    forma_de_pago: ["Permuta", "Contado"],
    presupuesto: 1500.5,
    visita: "2025-03-14",
    financia: true,
    zona: "Norte",
  });
});

test("contacto: una columna mapeada a un campo personalizado borrado hace fallar la fila", () => {
  const r = traducirFilaDeContacto(
    { Nombre: "Ana Pérez", X: "1" },
    ajustes({ X: "custom:no_existe" }),
    [],
    null,
  );
  assert.equal(r.ok, false);
});

test("contacto: sin nombre falla; con id del origen, la clave es el id antes que el email", () => {
  const sin = traducirFilaDeContacto({ Nombre: "" }, ajustes({}), [], null);
  assert.equal(sin.ok, false);
  const con = traducirFilaDeContacto(
    { Nombre: "Ana Pérez", Id: "C-1", Mail: "a@example.com" },
    ajustes({ Id: "externalId", Mail: "email" }),
    [],
    null,
  );
  assert.equal(con.ok, true);
  if (con.ok) assert.deepEqual(clavesDeContacto(con.candidato), ["id:C-1", "email:a@example.com"]);
});

// ---------------------------------------------------------------------------
// El plan
// ---------------------------------------------------------------------------

function existente(extra: Partial<ContactoExistente> = {}): ContactoExistente {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    firstName: "Ana",
    lastName: "Pérez",
    email: "ana@example.com",
    phone: "+59899000000",
    jobTitle: null,
    source: "Carga manual",
    lifecycleStage: "LEAD",
    customerSince: null,
    leadNotes: "[2025-01-01] llamar",
    customFields: { zona: "Sur" },
    ownerId: null,
    companyId: null,
    vehicleOfInterestId: null,
    ...extra,
  };
}

function candidato(extra: Partial<CandidatoDeContacto> = {}): CandidatoDeContacto {
  return { firstName: "Ana", lastName: "Pérez", customFields: {}, ...extra };
}

test("plan: lo vacío se completa, lo igual no hace nada, lo distinto difiere", () => {
  const cambios = planearContacto(
    candidato({
      jobTitle: "Gerente",
      source: "Planilla",
      email: "ANA@example.com",
      customFields: { zona: "Norte" },
    }),
    existente(),
    {},
  );
  const por = Object.fromEntries(cambios.map((c) => [c.campo, c.accion]));
  assert.equal(por.jobTitle, "completar");
  assert.equal(por.email, "igual", "el email se compara sin mayúsculas");
  assert.equal(por.source, "difiere");
  assert.equal(por["custom:zona"], "difiere");
  assert.equal(tipoDePlan(cambios), "CONFLICT");
});

test("plan: el email y el teléfono que identifican al contacto no se pisan nunca, ni con OVERWRITE", () => {
  const cambios = planearContacto(
    candidato({ email: "otra@example.com", phone: "+59899111111" }),
    existente(),
    {},
  );
  const email = cambios.find((c) => c.campo === "email");
  const phone = cambios.find((c) => c.campo === "phone");
  assert.equal(email?.accion, "difiere_bloqueado");
  assert.equal(phone?.accion, "difiere_bloqueado");
  assert.deepEqual(cambiosAAplicar(cambios, "OVERWRITE"), []);
});

test("plan: la etapa solo avanza entre LEAD, MQL, SQL y CUSTOMER", () => {
  assert.equal(compararEtapa("LEAD", "CUSTOMER")?.accion, "difiere");
  assert.equal(compararEtapa("MQL", "SQL")?.accion, "difiere");
  assert.equal(compararEtapa("CUSTOMER", "LEAD")?.accion, "difiere_bloqueado");
  assert.equal(compararEtapa("CUSTOMER", "CUSTOMER")?.accion, "igual");
  assert.equal(compararEtapa("LEAD", undefined), null);
});

test("plan (decisión 24): a CHURNED solo desde CUSTOMER, de CHURNED solo a CUSTOMER; lo demás se omite con motivo", () => {
  assert.equal(compararEtapa("CUSTOMER", "CHURNED")?.accion, "difiere");
  assert.equal(compararEtapa("CHURNED", "CUSTOMER")?.accion, "difiere");
  for (const [actual, entrante] of [
    ["LEAD", "CHURNED"],
    ["SQL", "CHURNED"],
    ["CHURNED", "LEAD"],
    ["CHURNED", "MQL"],
  ] as const) {
    const r = compararEtapa(actual, entrante);
    assert.equal(r?.accion, "difiere_bloqueado", `${actual} -> ${entrante}`);
    assert.match(r?.motivo ?? "", /solo se pasa desde Cliente/);
  }
});

test("plan: las notas se agregan si no están; reimportar la misma nota no la duplica", () => {
  const nueva = planearContacto(candidato({ notas: "pidió financiación" }), existente(), {});
  assert.equal(nueva.find((c) => c.campo === "notes")?.accion, "agregar");
  const repetida = planearContacto(candidato({ notas: "llamar" }), existente(), {});
  assert.equal(repetida.find((c) => c.campo === "notes")?.accion, "igual");
});

test("políticas: FILL_EMPTY completa y conserva; OVERWRITE además pisa lo que difiere; SKIP no toca nada", () => {
  const cambios = planearContacto(
    candidato({ jobTitle: "Gerente", source: "Planilla" }),
    existente(),
    {},
  );
  assert.deepEqual(
    cambiosAAplicar(cambios, "FILL_EMPTY").map((c) => c.campo),
    ["jobTitle"],
  );
  assert.deepEqual(
    cambiosAAplicar(cambios, "OVERWRITE").map((c) => c.campo),
    ["jobTitle", "source"],
  );
  assert.deepEqual(cambiosAAplicar(cambios, "SKIP"), []);
});

test("tipoDePlan: sin nada que hacer, UNCHANGED; solo completar, UPDATE", () => {
  assert.equal(tipoDePlan(planearContacto(candidato(), existente(), {})), "UNCHANGED");
  assert.equal(
    tipoDePlan(planearContacto(candidato({ jobTitle: "x" }), existente(), {})),
    "UPDATE",
  );
});

// ---------------------------------------------------------------------------
// Empresas
// ---------------------------------------------------------------------------

test("empresa: el nombre es la clave normalizada (sin mayúsculas, tildes ni espacios de más)", () => {
  const a = crearAjustesSchema("COMPANY").parse({
    mapeo: { "Razón social": "name", Rubro: "industry" },
  });
  const r = traducirFilaDeEmpresa({ "Razón social": " Compañía  Ejemplo ", Rubro: "Autos" }, a);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(clavesDeEmpresa(r.candidato), ["nombre:compania ejemplo"]);
  const cambios = planearEmpresa(
    r.candidato,
    {
      id: "x",
      name: "COMPAÑÍA EJEMPLO",
      domain: null,
      industry: "Motos",
      phone: null,
      city: null,
      country: null,
      ownerId: null,
    },
    {},
  );
  assert.equal(cambios.find((c) => c.campo === "name")?.accion, "igual");
  assert.equal(cambios.find((c) => c.campo === "industry")?.accion, "difiere");
});

// ---------------------------------------------------------------------------
// Ajustes y sugerencia
// ---------------------------------------------------------------------------

test("ajustes: destino desconocido, destino repetido, sin nombre o con nombre doble se rechazan", () => {
  const s = crearAjustesSchema("CONTACT");
  assert.equal(s.safeParse({ mapeo: { A: "fullName", B: "noExiste" } }).success, false);
  assert.equal(s.safeParse({ mapeo: { A: "fullName", B: "email", C: "email" } }).success, false);
  assert.equal(s.safeParse({ mapeo: { B: "email" } }).success, false);
  assert.equal(s.safeParse({ mapeo: { A: "fullName", B: "firstName" } }).success, false);
  const ok = s.safeParse({ mapeo: { A: "firstName", B: "lastName", C: "custom:zona" } });
  assert.equal(ok.success, true);
  if (ok.success) {
    assert.equal(ok.data.duplicados, "FILL_EMPTY", "por defecto se completa lo vacío sin pisar");
    assert.equal(ok.data.crearEmpresas, true, "decisión 10: las empresas se crean");
  }
  assert.equal(
    crearAjustesSchema("COMPANY").safeParse({ mapeo: { A: "industry" } }).success,
    false,
  );
});

test("sugerirMapeo: sinónimos sin fuzzy matching, campos personalizados por etiqueta, un destino una sola vez", () => {
  const sugerido = sugerirMapeo(
    "CONTACT",
    [
      "Nombre",
      "Apellido",
      "Correo electrónico",
      "Celular",
      "Forma de pago",
      "Mail",
      "Observación rara",
    ],
    DEFINICIONES,
  );
  assert.deepEqual(sugerido, {
    Nombre: "firstName",
    Apellido: "lastName",
    "Correo electrónico": "email",
    Celular: "phone",
    "Forma de pago": "custom:forma_de_pago",
  });
});

// ---------------------------------------------------------------------------
// Historial (§5.3)
// ---------------------------------------------------------------------------

function ajustesDeHistorial(
  mapeo: Record<string, string>,
  tipoPorDefecto?: "NOTE" | "CALL" | "TASK",
) {
  return crearAjustesSchema("ACTIVITY").parse({
    mapeo,
    historial: {
      autorId: "11111111-1111-4111-8111-111111111111",
      tipoPorDefecto,
      tipos: { Llamada: "CALL", Tarea: "TASK" },
    },
  }) as AjustesDeImportacion;
}

test("historial: tipo por mapeo de valores, contacto por id o email, fecha original, asunto armado y autor original en el texto", () => {
  const r = traducirFilaDeActividad(
    {
      Tipo: "llamada",
      Cliente: "C-1",
      Fecha: "10/01/2021",
      Texto: "No atendió",
      Autor: "Vendedora Anterior",
    },
    ajustesDeHistorial({
      Tipo: "type",
      Cliente: "contactExternalId",
      Fecha: "occurredAt",
      Texto: "body",
      Autor: "authorName",
    }),
    null,
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.candidato.type, "CALL");
  assert.equal(r.candidato.contactExternalId, "C-1");
  assert.equal(r.candidato.occurredAt, "2021-01-10");
  assert.equal(r.candidato.subject, "Llamada del 10/01/2021");
  assert.equal(cuerpoDeActividad(r.candidato), "No atendió\n\nAutor original: Vendedora Anterior");
});

test("historial: sin a qué contacto va, o con un tipo desconocido, la fila falla; el tipo por defecto cubre la celda vacía", () => {
  const a = ajustesDeHistorial({ Tipo: "type", Mail: "contactEmail" }, "NOTE");
  assert.equal(traducirFilaDeActividad({ Tipo: "Nota", Mail: "" }, a, null).ok, false);
  assert.equal(
    traducirFilaDeActividad({ Tipo: "Reunión", Mail: "a@example.com" }, a, null).ok,
    false,
  );
  const vacio = traducirFilaDeActividad({ Tipo: "", Mail: "a@example.com" }, a, null);
  assert.equal(vacio.ok, true);
  if (vacio.ok) assert.equal(vacio.candidato.type, "NOTE");
});

test("historial: la clave es el id del origen o, sin él, una huella estable de lo que define la actividad", () => {
  const a = ajustesDeHistorial(
    { Mail: "contactEmail", Fecha: "occurredAt", Texto: "body" },
    "NOTE",
  );
  const fila = { Mail: "A@Example.com", Fecha: "10/01/2021", Texto: "Hola" };
  const uno = traducirFilaDeActividad(fila, a, null);
  const dos = traducirFilaDeActividad({ ...fila, Mail: "a@example.com" }, a, null);
  const otro = traducirFilaDeActividad({ ...fila, Texto: "Chau" }, a, null);
  assert.ok(uno.ok && dos.ok && otro.ok);
  if (!uno.ok || !dos.ok || !otro.ok) return;
  assert.match(claveDeActividad(uno.candidato), /^hash:[0-9a-f]{64}$/);
  assert.equal(
    claveDeActividad(uno.candidato),
    claveDeActividad(dos.candidato),
    "el email no distingue mayúsculas",
  );
  assert.notEqual(claveDeActividad(uno.candidato), claveDeActividad(otro.candidato));
  const conId = traducirFilaDeActividad(
    { ...fila, Id: "N-1" },
    ajustesDeHistorial({ Id: "externalId", Mail: "contactEmail" }, "NOTE"),
    null,
  );
  if (conId.ok) assert.equal(claveDeActividad(conId.candidato), "id:N-1");
});

test("ajustes de historial: sin autor, sin contacto mapeado, o sin tipo (ni columna ni por defecto) se rechazan", () => {
  const s = crearAjustesSchema("ACTIVITY");
  assert.equal(s.safeParse({ mapeo: { Mail: "contactEmail", Tipo: "type" } }).success, false);
  const autor = { autorId: "11111111-1111-4111-8111-111111111111", tipos: {} };
  assert.equal(s.safeParse({ mapeo: { Tipo: "type" }, historial: autor }).success, false);
  assert.equal(s.safeParse({ mapeo: { Mail: "contactEmail" }, historial: autor }).success, false);
  assert.equal(
    s.safeParse({
      mapeo: { Mail: "contactEmail" },
      historial: { ...autor, tipoPorDefecto: "NOTE" },
    }).success,
    true,
  );
});
