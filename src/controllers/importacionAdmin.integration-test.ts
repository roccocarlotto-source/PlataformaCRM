import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { errorHandler } from "../middlewares/errorHandler";
import { importUpload } from "../middlewares/importUpload";
import { notFound } from "../middlewares/notFound";
import { requirePlatformAdmin } from "../middlewares/requirePlatformAdmin";
import { anonymizeIngestionEventsOfContact } from "../repositories/ingestionEvent.repository";
import { findRoleByName } from "../repositories/role.repository";
import type { AuthContext } from "../types/auth";
import { AppError } from "../utils/AppError";
import { drenarPendientes } from "../workers/ingestionWorker";
import { procesarLotes } from "../workers/importBatchWorker";
import {
  cancelarHandler,
  configurarHandler,
  confirmarHandler,
  csvCambiosHandler,
  csvFallidasHandler,
  decidirHandler,
  deshacerHandler,
  filasHandler,
  obtenerHandler,
  opcionesHandler,
  subirHandler,
} from "./importacionAdmin.controller";

// ---------------------------------------------------------------------------
// El asistente de importación de Plataforma, de punta a punta contra la base
// local (docs/importacion-de-datos.md §8): subir, configurar, vista previa,
// decidir, confirmar, promover, informe y CSV. Los workers se corren a mano
// (procesarLotes, drenarPendientes) en vez de esperarlos.
//
// Con los archivos inventados de tests/fixtures/importacion. Cada test arma su
// organización (slug importacion-…, registrado en PATRONES_DE_SLUG_DE_PRUEBA).
// ---------------------------------------------------------------------------

let baseUrl: string;
let closeApp: () => Promise<void>;
let identidad: AuthContext | undefined;

function stubAuthenticate(req: Request, _res: Response, next: NextFunction): void {
  if (!identidad) {
    next(new AppError("Falta el token de autenticación", 401));
    return;
  }
  req.auth = identidad;
  next();
}

const BASE = "/api/admin/organizations/:organizationId/imports";

before(async () => {
  const app = express();
  app.use(express.json());
  const gate = [stubAuthenticate, requirePlatformAdmin];
  app.get(`${BASE}/options`, ...gate, opcionesHandler);
  app.post(BASE, ...gate, importUpload, subirHandler);
  app.get(`${BASE}/:batchId`, ...gate, obtenerHandler);
  app.put(`${BASE}/:batchId/config`, ...gate, configurarHandler);
  app.get(`${BASE}/:batchId/rows`, ...gate, filasHandler);
  app.patch(`${BASE}/:batchId/rows`, ...gate, decidirHandler);
  app.post(`${BASE}/:batchId/confirm`, ...gate, confirmarHandler);
  app.post(`${BASE}/:batchId/cancel`, ...gate, cancelarHandler);
  app.post(`${BASE}/:batchId/undo`, ...gate, deshacerHandler);
  app.get(`${BASE}/:batchId/failed.csv`, ...gate, csvFallidasHandler);
  app.get(`${BASE}/:batchId/changes.csv`, ...gate, csvCambiosHandler);
  app.use(notFound);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      closeApp = () => new Promise((r) => server.close(() => r()));
      resolve();
    });
  });
});

after(async () => {
  if (closeApp) await closeApp();
});

// ---------------------------------------------------------------------------
// Escenario
// ---------------------------------------------------------------------------

interface Escenario {
  organizationId: string;
  vendedorId: string;
  vendedorEmail: string;
  authUserId: string;
  platformAdminId: string;
}

async function montar(etiqueta: string): Promise<Escenario> {
  const rol = await findRoleByName("USER");
  if (!rol) throw new Error("No está sembrado el rol USER");
  const org = await prisma.organization.create({
    data: {
      name: `Importacion ${etiqueta}`,
      slug: `importacion-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      defaultPhoneCountryCode: "598",
    },
  });
  const email = `importacion-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  await prisma.user.create({
    data: {
      id: data.user.id,
      organizationId: org.id,
      roleId: rol.id,
      email,
      fullName: "Vendedor Ficticio",
    },
  });
  await prisma.contactCustomFieldDefinition.create({
    data: {
      organizationId: org.id,
      key: "forma_de_pago",
      label: "Forma de pago",
      type: "MULTI_SELECT",
      options: ["Contado", "Permuta"],
    },
  });
  const admin = await prisma.platformAdmin.create({ data: { userId: randomUUID() } });
  identidad = {
    userId: admin.userId,
    organizationId: randomUUID(),
    role: "ADMIN",
    email: "plataforma@example.test",
    fullName: "Plataforma",
  };
  return {
    organizationId: org.id,
    vendedorId: data.user.id,
    vendedorEmail: email,
    authUserId: data.user.id,
    platformAdminId: admin.userId,
  };
}

async function desmontar(e: Escenario): Promise<void> {
  const where = { organizationId: e.organizationId };
  await prisma.ingestionEvent.deleteMany({ where });
  await prisma.activity.deleteMany({ where });
  await prisma.externalRecordLink.deleteMany({ where });
  await prisma.importBatch.deleteMany({ where });
  await prisma.contact.deleteMany({ where });
  await prisma.company.deleteMany({ where });
  await prisma.contactCustomFieldDefinition.deleteMany({ where });
  await prisma.source.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.organization.delete({ where: { id: e.organizationId } });
  await prisma.platformAdmin.delete({ where: { userId: e.platformAdminId } });
  await getSupabaseAdmin().auth.admin.deleteUser(e.authUserId);
  identidad = undefined;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function url(e: Escenario, resto = "") {
  return `${baseUrl}/api/admin/organizations/${e.organizationId}/imports${resto}`;
}

// Lo que se lee de las respuestas, nada más.
interface LoteJson {
  id: string;
  status: string;
  sourceId: string;
  rowCount: number;
  counters: { analisis: { empresasNuevas: number } } | null;
}
interface DetalleJson {
  lote: LoteJson;
  resumen: { porResultado: Record<string, number>; porEstado: Record<string, number> };
}
interface SubidaJson {
  lote: LoteJson;
  lectura: { separador?: string };
  mapeoSugerido: Record<string, string>;
  error: { message: string };
}
interface FilaJson {
  id: string;
  rowNumber: number;
  plan: {
    tipo: string;
    advertencias: string[];
    errores?: string[];
    empresaNueva?: string;
    mismaQueFila?: number;
    cambios?: { campo: string; accion: string }[];
  };
}

async function subir(
  e: Escenario,
  contenido: string,
  campos: Record<string, string>,
  nombre = "contactos.csv",
) {
  const form = new FormData();
  form.append("file", new Blob([contenido]), nombre);
  for (const [k, v] of Object.entries(campos)) form.append(k, v);
  const res = await fetch(url(e), { method: "POST", body: form });
  return { status: res.status, body: (await res.json()) as SubidaJson };
}

function enviar(e: Escenario, metodo: string, resto: string, cuerpo?: unknown) {
  return fetch(url(e, resto), {
    method: metodo,
    headers: { "content-type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
}

async function fixture(nombre: string, vendedor = ""): Promise<string> {
  const texto = await readFile(
    join(process.cwd(), "tests", "fixtures", "importacion", nombre),
    "utf8",
  );
  return texto.replace("{{VENDEDOR}}", vendedor);
}

const MAPEO_DE_CONTACTOS = {
  "ID Cliente": "externalId",
  "Nombre completo": "fullName",
  Mail: "email",
  Celular: "phone",
  Etapa: "lifecycleStage",
  Vendedor: "ownerEmail",
  Empresa: "companyName",
  "Cliente desde": "customerSince",
  "Forma de pago": "custom:forma_de_pago",
  Notas: "notes",
};

const AJUSTES_DE_CONTACTOS = {
  mapeo: MAPEO_DE_CONTACTOS,
  etapas: { Cliente: "CUSTOMER", Interesado: "LEAD" },
  formato: { separadorDeOpciones: "," },
};

async function analizar(e: Escenario, batchId: string, ajustes: unknown) {
  const r = await enviar(e, "PUT", `/${batchId}/config`, ajustes);
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  await procesarLotes();
  const detalle = (await (await enviar(e, "GET", `/${batchId}`)).json()) as DetalleJson;
  assert.equal(detalle.lote.status, "READY", JSON.stringify(detalle.lote));
  return detalle;
}

async function filas(e: Escenario, batchId: string): Promise<FilaJson[]> {
  const r = (await (await enviar(e, "GET", `/${batchId}/rows?pageSize=100`)).json()) as {
    data: FilaJson[];
  };
  return r.data;
}

async function confirmarYPromover(e: Escenario, batchId: string) {
  const r = await enviar(e, "POST", `/${batchId}/confirm`);
  assert.equal(r.status, 200);
  for (;;) {
    const d = await drenarPendientes({ organizationId: e.organizationId });
    if (d.procesados + d.fallidos + d.pospuestos + d.muertos === 0) break;
  }
  await procesarLotes();
  const detalle = (await (await enviar(e, "GET", `/${batchId}`)).json()) as DetalleJson;
  assert.equal(detalle.lote.status, "DONE");
  return detalle;
}

async function importarContactos(
  e: Escenario,
  contenido: string,
  campos: Record<string, string>,
  ajustes: unknown = AJUSTES_DE_CONTACTOS,
) {
  const subida = await subir(e, contenido, { entityType: "CONTACT", ...campos });
  assert.equal(subida.status, 201, JSON.stringify(subida.body));
  const batchId = subida.body.lote.id as string;
  await analizar(e, batchId, ajustes);
  return { batchId, subida };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("contactos de punta a punta: vista previa por fila, promoción, empresa creada, vendedor, «Cliente desde», MULTI_SELECT y CSV de fallidas", async () => {
  const e = await montar("punta");
  try {
    const subida = await subir(e, await fixture("contactos.csv", e.vendedorEmail), {
      entityType: "CONTACT",
      sourceName: "Planilla de prueba",
    });
    assert.equal(subida.status, 201, JSON.stringify(subida.body));
    assert.equal(subida.body.lectura.separador, ";");
    assert.equal(subida.body.lote.status, "STAGED");
    assert.equal(subida.body.lote.rowCount, 5);
    assert.equal(subida.body.mapeoSugerido.Mail, "email");
    const batchId = subida.body.lote.id as string;

    // Antes de configurar, nada se promueve: las filas están STAGED.
    await drenarPendientes({ organizationId: e.organizationId });
    assert.equal(await prisma.contact.count({ where: { organizationId: e.organizationId } }), 0);

    const detalle = await analizar(e, batchId, AJUSTES_DE_CONTACTOS);
    assert.equal(detalle.lote.counters?.analisis.empresasNuevas, 1);
    const plan = Object.fromEntries((await filas(e, batchId)).map((f) => [f.rowNumber, f.plan]));
    assert.equal(plan[1].tipo, "CREATE");
    assert.equal(plan[1].empresaNueva, "Compañía Ejemplo");
    assert.equal(plan[2].tipo, "CREATE");
    assert.match(plan[2].advertencias.join(" "), /una sola palabra/);
    assert.equal(plan[3].tipo, "FAIL");
    assert.match((plan[3].errores ?? []).join(" "), /no es un email válido/);
    assert.match(plan[4].advertencias.join(" "), /no es un usuario activo/);
    assert.equal(plan[5].tipo, "UPDATE");
    assert.equal(plan[5].mismaQueFila, 1);
    // La vista previa no escribe nada de negocio.
    assert.equal(await prisma.contact.count({ where: { organizationId: e.organizationId } }), 0);
    assert.equal(await prisma.company.count({ where: { organizationId: e.organizationId } }), 0);

    const final = await confirmarYPromover(e, batchId);
    assert.deepEqual(final.resumen.porResultado, { CREATED: 3, UPDATED: 1 });
    assert.equal(final.resumen.porEstado.FAILED, 1);

    const contactos = await prisma.contact.findMany({
      where: { organizationId: e.organizationId },
      orderBy: { firstName: "asc" },
    });
    assert.deepEqual(
      contactos.map((c) => c.firstName),
      ["Ana", "Beto", "Diego"],
    );
    const [ana, beto, diego] = contactos;
    assert.equal(ana.lastName, "Pérez");
    assert.equal(ana.phone, "+59899111222");
    assert.equal(ana.lifecycleStage, "CUSTOMER");
    assert.equal(ana.ownerId, e.vendedorId);
    assert.equal(ana.customerSince?.toISOString().slice(0, 10), "2021-03-14");
    assert.ok(ana.importedAt, "importedAt marca lo que creó una importación");
    assert.deepEqual(ana.customFields, { forma_de_pago: ["Contado"] });
    assert.match(
      ana.leadNotes ?? "",
      /Prefiere que la llamen de tarde[\s\S]*Segunda fila del mismo cliente/,
    );
    assert.equal(ana.source, "Planilla de prueba");
    assert.equal(beto.lastName, "-");
    assert.deepEqual(beto.customFields, { forma_de_pago: ["Permuta", "Contado"] });
    assert.equal(diego.ownerId, null);

    // Una sola empresa, compartida por Ana y Diego, y vinculada al lote.
    const empresas = await prisma.company.findMany({ where: { organizationId: e.organizationId } });
    assert.equal(empresas.length, 1);
    assert.equal(ana.companyId, empresas[0].id);
    assert.equal(diego.companyId, empresas[0].id);
    const vinculoEmpresa = await prisma.externalRecordLink.findFirst({
      where: { organizationId: e.organizationId, entityType: "COMPANY" },
    });
    assert.equal(vinculoEmpresa?.createdByBatchId, batchId);

    // Importar no dispara automatizaciones (§1).
    assert.equal(
      await prisma.outboxEvent.count({ where: { organizationId: e.organizationId } }),
      0,
    );

    // El CSV de fallidas: BOM, ";", columnas originales + Motivo, fórmula neutralizada.
    const res = await enviar(e, "GET", `/${batchId}/failed.csv`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const lineas = bytes.toString("utf8").slice(1).split("\r\n");
    assert.equal(lineas[0], `${Object.keys(MAPEO_DE_CONTACTOS).join(";")};Motivo`);
    assert.equal(lineas.length, 3, "encabezado, la fila fallida y la línea vacía final");
    assert.match(lineas[1], /^C-003;Carla Gómez;no-es-un-mail;/);
    assert.match(lineas[1], /;'=1\+1;/);
  } finally {
    await desmontar(e);
  }
});

test("reimportar el MISMO archivo no duplica nada: todo queda sin cambios", async () => {
  const e = await montar("reimportar");
  try {
    const contenido = await fixture("contactos.csv", e.vendedorEmail);
    const { batchId, subida } = await importarContactos(e, contenido, { sourceName: "Planilla" });
    await confirmarYPromover(e, batchId);
    const sourceId = subida.body.lote.sourceId as string;

    const segunda = await importarContactos(e, contenido, { sourceId });
    const planes = (await filas(e, segunda.batchId)).map((f) => f.plan.tipo);
    assert.deepEqual(planes, ["UNCHANGED", "UNCHANGED", "FAIL", "UNCHANGED", "UNCHANGED"]);
    const final = await confirmarYPromover(e, segunda.batchId);
    assert.deepEqual(final.resumen.porResultado, { UNCHANGED: 4 });
    assert.equal(await prisma.contact.count({ where: { organizationId: e.organizationId } }), 3);
    assert.equal(await prisma.company.count({ where: { organizationId: e.organizationId } }), 1);
  } finally {
    await desmontar(e);
  }
});

test("duplicados: «completar lo vacío» completa y conserva; «pisar» por fila guarda el antes y el después; email, teléfono y etapa que retrocede no se pisan nunca", async () => {
  const e = await montar("pisar");
  try {
    const { batchId, subida } = await importarContactos(
      e,
      await fixture("contactos.csv", e.vendedorEmail),
      { sourceName: "Planilla" },
    );
    await confirmarYPromover(e, batchId);
    const sourceId = subida.body.lote.sourceId as string;

    const cambiado =
      "ID Cliente;Nombre completo;Mail;Celular;Etapa;Puesto\r\n" +
      "C-001;Ana Pérez Rodríguez;otra@example.com;099 999 999;Interesado;Gerente\r\n" +
      "C-002;Beto Ficticio;;;;Vendedor\r\n";
    const ajustes = {
      mapeo: {
        "ID Cliente": "externalId",
        "Nombre completo": "fullName",
        Mail: "email",
        Celular: "phone",
        Etapa: "lifecycleStage",
        Puesto: "jobTitle",
      },
      etapas: { Interesado: "LEAD" },
    };
    const segunda = await importarContactos(e, cambiado, { sourceId }, ajustes);
    const lista = await filas(e, segunda.batchId);
    const [filaAna, filaBeto] = lista;
    assert.equal(filaAna.plan.tipo, "CONFLICT");
    const accion = Object.fromEntries((filaAna.plan.cambios ?? []).map((c) => [c.campo, c.accion]));
    assert.equal(accion.jobTitle, "completar");
    assert.equal(accion.lastName, "difiere");
    assert.equal(accion.email, "difiere_bloqueado");
    assert.equal(accion.phone, "difiere_bloqueado");
    assert.equal(accion.lifecycleStage, "difiere_bloqueado");

    // Beto: pisar solo esa fila.
    const decidir = await enviar(e, "PATCH", `/${segunda.batchId}/rows`, {
      rowIds: [filaBeto.id],
      decision: "OVERWRITE",
    });
    assert.equal(decidir.status, 200);
    await confirmarYPromover(e, segunda.batchId);

    const ana = await prisma.contact.findFirstOrThrow({
      where: { organizationId: e.organizationId, firstName: "Ana" },
    });
    assert.equal(ana.jobTitle, "Gerente", "lo vacío se completa");
    assert.equal(ana.lastName, "Pérez", "con FILL_EMPTY lo distinto se conserva");
    assert.equal(ana.email, "ana.perez@example.com");
    assert.equal(ana.phone, "+59899111222");
    assert.equal(ana.lifecycleStage, "CUSTOMER", "la etapa no retrocede");

    const beto = await prisma.contact.findFirstOrThrow({
      where: { organizationId: e.organizationId, email: "beto@example.com" },
    });
    assert.equal(beto.lastName, "Ficticio", "OVERWRITE pisa lo que difiere");
    assert.equal(beto.jobTitle, "Vendedor");

    const csv = Buffer.from(
      await (await enviar(e, "GET", `/${segunda.batchId}/changes.csv`)).arrayBuffer(),
    )
      .toString("utf8")
      .slice(1);
    assert.match(csv, /^Fila;Registro;Campo;Antes;Después\r\n/);
    assert.match(csv, new RegExp(`2;${beto.id};lastName;'-;Ficticio`));
    assert.match(csv, new RegExp(`1;${ana.id};jobTitle;;Gerente`));

    // El borrado a pedido redacta el plan y el antes/después de las filas del contacto.
    await anonymizeIngestionEventsOfContact(beto.id, e.organizationId);
    const redactadas = await prisma.ingestionEvent.findMany({
      where: { organizationId: e.organizationId, promotedContactId: beto.id },
      select: { plan: true, changes: true },
    });
    assert.ok(redactadas.length >= 2);
    for (const r of redactadas) {
      assert.equal(r.plan, null);
      assert.equal(r.changes, null);
    }
  } finally {
    await desmontar(e);
  }
});

test("empresas: se crean, la que no tiene nombre falla, y reimportar con otro formato del nombre encuentra la misma", async () => {
  const e = await montar("empresas");
  try {
    const subida = await subir(
      e,
      await fixture("empresas.csv"),
      {
        entityType: "COMPANY",
        sourceName: "Planilla de empresas",
      },
      "empresas.csv",
    );
    assert.equal(subida.status, 201, JSON.stringify(subida.body));
    const batchId = subida.body.lote.id as string;
    await analizar(e, batchId, {
      mapeo: { "Razón social": "name", Rubro: "industry", Ciudad: "city", País: "country" },
    });
    const final = await confirmarYPromover(e, batchId);
    assert.deepEqual(final.resumen.porResultado, { CREATED: 2 });
    assert.equal(final.resumen.porEstado.FAILED, 1);

    const otra = await subir(
      e,
      "Razón social;Teléfono\r\nCOMPAÑIA  EJEMPLO;2900 0000\r\n",
      { entityType: "COMPANY", sourceId: subida.body.lote.sourceId },
      "empresas-2.csv",
    );
    await analizar(e, otra.body.lote.id, { mapeo: { "Razón social": "name", Teléfono: "phone" } });
    const [fila] = await filas(e, otra.body.lote.id);
    assert.equal(fila.plan.tipo, "UPDATE");
    await confirmarYPromover(e, otra.body.lote.id);
    assert.equal(await prisma.company.count({ where: { organizationId: e.organizationId } }), 2);
    const ejemplo = await prisma.company.findFirstOrThrow({
      where: { organizationId: e.organizationId, name: "Compañía Ejemplo" },
    });
    assert.equal(ejemplo.phone, "2900 0000");
  } finally {
    await desmontar(e);
  }
});

test("seguridad: solo platform admin, un lote de otra organización es 404, y los pasos fuera de orden son 409", async () => {
  const e = await montar("seguridad");
  const otra = await montar("seguridad-otra");
  try {
    identidad = { ...identidad!, userId: e.platformAdminId };
    const subida = await subir(otra, await fixture("contactos.csv"), {
      entityType: "CONTACT",
      sourceName: "Planilla",
    });
    const deOtra = subida.body.lote.id as string;

    // El lote de `otra` pedido con la organización de `e` en el path: 404.
    for (const [metodo, resto] of [
      ["GET", `/${deOtra}`],
      ["GET", `/${deOtra}/rows`],
      ["POST", `/${deOtra}/confirm`],
      ["POST", `/${deOtra}/cancel`],
      ["GET", `/${deOtra}/failed.csv`],
    ] as const) {
      const r = await enviar(e, metodo, resto);
      assert.equal(r.status, 404, `${metodo} ${resto}`);
    }
    const r = await enviar(e, "PUT", `/${deOtra}/config`, AJUSTES_DE_CONTACTOS);
    assert.equal(r.status, 404);

    // Confirmar sin vista previa: 409.
    assert.equal((await enviar(otra, "POST", `/${deOtra}/confirm`)).status, 409);
    // Cancelar borra las filas sin confirmar.
    assert.equal((await enviar(otra, "POST", `/${deOtra}/cancel`)).status, 200);
    assert.equal(await prisma.ingestionEvent.count({ where: { batchId: deOtra } }), 0);

    // Un usuario que no es platform admin: 403.
    identidad = { ...identidad!, userId: randomUUID() };
    assert.equal((await enviar(e, "GET", "/options")).status, 403);
  } finally {
    await desmontar(otra);
    await desmontar(e).catch(() => undefined);
  }
});

test("un XLS y una celda de más de 10.000 caracteres se rechazan al subir, sin dejar nada", async () => {
  const e = await montar("rechazos");
  try {
    const xls = await subir(e, "x", { entityType: "CONTACT", sourceName: "Vieja" }, "clientes.xls");
    assert.equal(xls.status, 415);
    assert.match(xls.body.error.message, /Guardalo como \.xlsx o \.csv y volvé a subirlo/);
    const gigante = await subir(e, `Nombre;Notas\r\nAna;${"x".repeat(10_001)}\r\n`, {
      entityType: "CONTACT",
      sourceName: "Gigante",
    });
    assert.equal(gigante.status, 400);
    assert.equal(await prisma.source.count({ where: { organizationId: e.organizationId } }), 0);
    assert.equal(
      await prisma.importBatch.count({ where: { organizationId: e.organizationId } }),
      0,
    );
  } finally {
    await desmontar(e);
  }
});

test("CHURNED (decisión 24): un contacto nuevo toma la etapa del archivo; uno existente pasa de Cliente a Perdido con «pisar», y de Interesado a Perdido no", async () => {
  const e = await montar("churned");
  try {
    const mapeo = { Id: "externalId", Nombre: "fullName", Etapa: "lifecycleStage" };
    const etapas = { Cliente: "CUSTOMER", Interesado: "LEAD", Perdido: "CHURNED" };
    const primera = await importarContactos(
      e,
      "Id;Nombre;Etapa\r\nK-1;Ana Pérez;Perdido\r\nK-2;Beto Gómez;Cliente\r\nK-3;Carla Díaz;Interesado\r\n",
      { sourceName: "Planilla" },
      { mapeo, etapas },
    );
    await confirmarYPromover(e, primera.batchId);
    const etapa = async (firstName: string) =>
      (
        await prisma.contact.findFirstOrThrow({
          where: { organizationId: e.organizationId, firstName },
        })
      ).lifecycleStage;
    assert.equal(await etapa("Ana"), "CHURNED", "en un contacto nuevo, el valor del archivo");

    const segunda = await importarContactos(
      e,
      "Id;Nombre;Etapa\r\nK-2;Beto Gómez;Perdido\r\nK-3;Carla Díaz;Perdido\r\n",
      { sourceId: primera.subida.body.lote.sourceId },
      { mapeo, etapas, duplicados: "OVERWRITE" },
    );
    const [beto, carla] = await filas(e, segunda.batchId);
    const etapaDe = (f: FilaJson) =>
      f.plan.cambios?.find((c) => c.campo === "lifecycleStage")?.accion;
    assert.equal(etapaDe(beto), "difiere");
    assert.equal(etapaDe(carla), "difiere_bloqueado");
    await confirmarYPromover(e, segunda.batchId);
    assert.equal(await etapa("Beto"), "CHURNED", "de Cliente a Perdido, sí");
    assert.equal(await etapa("Carla"), "LEAD", "de Interesado a Perdido, no: se omite");
    const notas = await prisma.ingestionEvent.findFirstOrThrow({
      where: { organizationId: e.organizationId, batchId: segunda.batchId, rowNumber: 2 },
      select: { promotionNotes: true },
    });
    assert.match(JSON.stringify(notas.promotionNotes), /lifecycleStage/);
  } finally {
    await desmontar(e);
  }
});

// ---------------------------------------------------------------------------
// Deshacer un lote (§8.3, decisión 17)
// ---------------------------------------------------------------------------

async function deshacer(e: Escenario, batchId: string) {
  const r = await enviar(e, "POST", `/${batchId}/undo`);
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  await procesarLotes();
  return (await (await enviar(e, "GET", `/${batchId}`)).json()) as DetalleJson & {
    lote: {
      counters: {
        deshacer: { borrados: Record<string, number>; omitidos: { id: string; motivo: string }[] };
      };
    };
  };
}

test("deshacer: da de baja lo creado y sus vínculos, deja lo que tuvo uso propio, y reimportar después crea de nuevo", async () => {
  const e = await montar("deshacer");
  try {
    const contenido = await fixture("contactos.csv", e.vendedorEmail);
    const { batchId, subida } = await importarContactos(e, contenido, { sourceName: "Planilla" });
    await confirmarYPromover(e, batchId);
    const beto = await prisma.contact.findFirstOrThrow({
      where: { organizationId: e.organizationId, firstName: "Beto" },
    });
    // Una nota cargada a mano en el CRM: Beto ya tuvo uso propio.
    await prisma.activity.create({
      data: {
        organizationId: e.organizationId,
        authorId: e.vendedorId,
        contactId: beto.id,
        type: "NOTE",
        subject: "Lo llamé",
      },
    });

    // Antes de terminar, no se deshace.
    const pendiente = await subir(e, contenido, { entityType: "CONTACT", sourceName: "Otra" });
    assert.equal((await enviar(e, "POST", `/${pendiente.body.lote.id}/undo`)).status, 409);

    const detalle = await deshacer(e, batchId);
    assert.equal(detalle.lote.status, "UNDONE");
    assert.deepEqual(detalle.lote.counters.deshacer.borrados, { CONTACT: 2, COMPANY: 1 });
    const omitido = detalle.lote.counters.deshacer.omitidos.find((o) => o.id === beto.id);
    assert.match(omitido?.motivo ?? "", /uso propio en el CRM \(activities\)/);

    const vivos = await prisma.contact.findMany({
      where: { organizationId: e.organizationId, deletedAt: null },
      select: { firstName: true },
    });
    assert.deepEqual(
      vivos.map((c) => c.firstName),
      ["Beto"],
    );
    assert.equal(
      await prisma.company.count({ where: { organizationId: e.organizationId, deletedAt: null } }),
      0,
      "la empresa la usaban solo los contactos que se borraron",
    );
    // Los vínculos de lo borrado se fueron; los de Beto quedan.
    const vinculos = await prisma.externalRecordLink.findMany({
      where: { organizationId: e.organizationId },
      select: { entityId: true },
    });
    assert.ok(vinculos.length > 0);
    assert.ok(vinculos.every((v) => v.entityId === beto.id));

    // Deshacer dos veces, no.
    assert.equal((await enviar(e, "POST", `/${batchId}/undo`)).status, 409);

    // Reimportar crea de nuevo lo que se deshizo, y no duplica a Beto.
    const otra = await importarContactos(e, contenido, { sourceId: subida.body.lote.sourceId });
    await confirmarYPromover(e, otra.batchId);
    const despues = await prisma.contact.findMany({
      where: { organizationId: e.organizationId, deletedAt: null },
      orderBy: { firstName: "asc" },
      select: { firstName: true },
    });
    assert.deepEqual(
      despues.map((c) => c.firstName),
      ["Ana", "Beto", "Diego"],
    );
  } finally {
    await desmontar(e);
  }
});

test("deshacer: lo que el lote solo actualizó no se revierte ni se borra", async () => {
  const e = await montar("deshacer-actualizado");
  try {
    const previo = await prisma.contact.create({
      data: {
        organizationId: e.organizationId,
        firstName: "Eva",
        lastName: "Ruiz",
        email: "eva@example.com",
      },
    });
    const { batchId } = await importarContactos(
      e,
      "Nombre;Mail;Puesto\r\nEva Ruiz;eva@example.com;Gerente\r\n",
      { sourceName: "Planilla" },
      { mapeo: { Nombre: "fullName", Mail: "email", Puesto: "jobTitle" } },
    );
    await confirmarYPromover(e, batchId);
    const detalle = await deshacer(e, batchId);
    assert.deepEqual(detalle.lote.counters.deshacer.borrados, {});
    const eva = await prisma.contact.findUniqueOrThrow({ where: { id: previo.id } });
    assert.equal(eva.deletedAt, null);
    assert.equal(
      eva.jobTitle,
      "Gerente",
      "lo actualizado queda: se corrige a mano con el CSV de cambios",
    );
  } finally {
    await desmontar(e);
  }
});

// ---------------------------------------------------------------------------
// Historial (§5.3, decisiones 5, 7, 23 y 25)
// ---------------------------------------------------------------------------

const MAPEO_DE_HISTORIAL = {
  ID: "externalId",
  "ID Cliente": "contactExternalId",
  "Mail cliente": "contactEmail",
  Tipo: "type",
  Fecha: "occurredAt",
  Asunto: "subject",
  Texto: "body",
  Hecha: "done",
  Vence: "dueDate",
  Autor: "authorName",
};

test("historial: notas, llamadas y tareas ligadas por id del origen o email, con fecha original, autor elegido, «Autor original» y tareas hechas confirmadas", async () => {
  const e = await montar("historial");
  try {
    // Primero los contactos (otra fuente: el historial los encuentra igual).
    const contactos = await importarContactos(e, await fixture("contactos.csv", e.vendedorEmail), {
      sourceName: "Planilla de clientes",
    });
    await confirmarYPromover(e, contactos.batchId);

    const subida = await subir(
      e,
      await fixture("historial.csv"),
      {
        entityType: "ACTIVITY",
        sourceName: "Historial anterior",
      },
      "historial.csv",
    );
    assert.equal(subida.status, 201, JSON.stringify(subida.body));
    const batchId = subida.body.lote.id;
    const ajustes = {
      mapeo: MAPEO_DE_HISTORIAL,
      historial: {
        autorId: e.vendedorId,
        tipos: { Nota: "NOTE", Llamada: "CALL", Tarea: "TASK" },
      },
    };
    await analizar(e, batchId, ajustes);
    const planes = (await filas(e, batchId)).map((f) => f.plan.tipo);
    assert.deepEqual(planes, ["CREATE", "CREATE", "CREATE", "CREATE", "FAIL"]);

    // Mientras un lote de contactos corre, el historial no se confirma.
    const otraTanda = await importarContactos(
      e,
      "Nombre;Mail\r\nZoe Ficticia;zoe@example.com\r\n",
      {
        sourceName: "Otra planilla",
      },
      { mapeo: { Nombre: "fullName", Mail: "email" } },
    );
    assert.equal((await enviar(e, "POST", `/${otraTanda.batchId}/confirm`)).status, 200);
    assert.equal((await enviar(e, "POST", `/${batchId}/confirm`)).status, 409);
    for (;;) {
      const d = await drenarPendientes({ organizationId: e.organizationId });
      if (d.procesados + d.fallidos + d.pospuestos + d.muertos === 0) break;
    }
    await procesarLotes();

    const final = await confirmarYPromover(e, batchId);
    assert.deepEqual(final.resumen.porResultado, { CREATED: 4 });
    assert.equal(final.resumen.porEstado.FAILED, 1);

    const actividades = await prisma.activity.findMany({
      where: { organizationId: e.organizationId },
      include: { contact: { select: { firstName: true } } },
    });
    const por = (asunto: RegExp) => {
      const a = actividades.find((x) => asunto.test(x.subject));
      assert.ok(a, `falta la actividad ${asunto}`);
      return a;
    };
    const nota = por(/^Nota del 10\/01\/2021$/);
    assert.equal(nota.type, "NOTE");
    assert.equal(nota.contact?.firstName, "Ana");
    assert.equal(nota.authorId, e.vendedorId);
    assert.equal(nota.occurredAt.toISOString(), "2021-01-10T12:00:00.000Z");
    assert.ok(
      nota.createdAt.getTime() > nota.occurredAt.getTime(),
      "createdAt es la fecha de importación",
    );
    assert.equal(nota.body, "Pidió presupuesto del auto\n\nAutor original: Vendedora Anterior");

    const llamada = por(/^Llamada de seguimiento$/);
    assert.equal(llamada.type, "CALL");
    assert.equal(llamada.contact?.firstName, "Beto", "por email");

    const hecha = por(/^Enviar contrato$/);
    assert.equal(hecha.contact?.firstName, "Diego");
    assert.equal(hecha.completedAt?.toISOString(), "2021-01-15T12:00:00.000Z");
    assert.equal(
      hecha.confirmedAt?.toISOString(),
      "2021-01-15T12:00:00.000Z",
      "hecha = completada y confirmada",
    );
    assert.equal(hecha.confirmedById, e.vendedorId);

    const abierta = por(/^Llamar para renovar$/);
    assert.equal(abierta.completedAt, null, "no hecha y vencida: queda abierta");
    assert.equal(abierta.dueDate?.toISOString(), "2021-02-20T12:00:00.000Z");
    assert.equal(abierta.assigneeId, e.vendedorId, "asignada al autor elegido");

    // Reimportar no duplica.
    const otra = await subir(
      e,
      await fixture("historial.csv"),
      {
        entityType: "ACTIVITY",
        sourceId: subida.body.lote.sourceId,
      },
      "historial.csv",
    );
    await analizar(e, otra.body.lote.id, ajustes);
    const segunda = await confirmarYPromover(e, otra.body.lote.id);
    assert.deepEqual(segunda.resumen.porResultado, { UNCHANGED: 4 });
    assert.equal(await prisma.activity.count({ where: { organizationId: e.organizationId } }), 4);

    // Deshacer el historial da de baja sus actividades.
    const deshecho = await deshacer(e, batchId);
    assert.deepEqual(deshecho.lote.counters.deshacer.borrados, { ACTIVITY: 4 });
    assert.equal(
      await prisma.activity.count({ where: { organizationId: e.organizationId, deletedAt: null } }),
      0,
    );
  } finally {
    await desmontar(e);
  }
});

test("historial: el autor tiene que ser un usuario activo de la organización, y sin columna de tipo hace falta un tipo por defecto", async () => {
  const e = await montar("historial-autor");
  const otra = await montar("historial-autor-otra");
  try {
    identidad = { ...identidad!, userId: e.platformAdminId };
    const subida = await subir(
      e,
      await fixture("historial.csv"),
      {
        entityType: "ACTIVITY",
        sourceName: "Historial",
      },
      "historial.csv",
    );
    const batchId = subida.body.lote.id;
    const ajeno = await enviar(e, "PUT", `/${batchId}/config`, {
      mapeo: MAPEO_DE_HISTORIAL,
      historial: { autorId: otra.vendedorId, tipos: {} },
    });
    assert.equal(ajeno.status, 400);
    const sinTipo = Object.fromEntries(
      Object.entries(MAPEO_DE_HISTORIAL).filter(([columna]) => columna !== "Tipo"),
    );
    const sinTipoNiDefecto = await enviar(e, "PUT", `/${batchId}/config`, {
      mapeo: sinTipo,
      historial: { autorId: e.vendedorId, tipos: {} },
    });
    assert.equal(sinTipoNiDefecto.status, 400);
  } finally {
    await desmontar(otra);
    await desmontar(e).catch(() => undefined);
  }
});
