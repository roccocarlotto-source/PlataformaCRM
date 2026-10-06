import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { AppError } from "../utils/AppError";
import {
  MAX_CAMPOS_POR_ORGANIZACION,
  mensajeDeOpcionRepetida,
} from "../utils/camposPersonalizados";
import { CATALOGO_DE_TOOLS, type ContextoDeEjecucionDeTool } from "./agentTools.service";
import { createContact, getContactById, updateContact } from "./contact.service";
import {
  MENSAJE_CAMPO_DUPLICADO,
  MENSAJE_CAMPO_NO_ENCONTRADO,
  MENSAJE_RENOMBRES_SIN_OPCIONES,
  MENSAJE_TIPO_INMUTABLE,
  MENSAJE_TOPE_DE_CAMPOS,
  actualizarDefinicion,
  borrarDefinicion,
  crearDefinicion,
  listarDefiniciones,
  usoDeOpciones,
} from "./contactCustomFieldDefinition.service";

// ---------------------------------------------------------------------------
// Campos personalizados de contactos, v1 (B6), contra Postgres real:
//   1. Las definiciones: crear (key desde la etiqueta, opciones de un SELECT),
//      duplicado, tope de 30, tipo inmutable, borrar y restaurar al recrear.
//   2. Los valores: crear y editar un contacto valida contra las definiciones
//      (tipo, opciones, key desconocida → 400) y MEZCLA con lo que ya tenía.
//   3. El agente: update_contact_custom_fields escribe solo los editables,
//      valida igual, y no toca nada más del contacto.
//   4. Dos organizaciones: las definiciones de una no valen en la otra.
//   5. Opciones de una lista que ya usan contactos: cuántos la usan,
//      renombrar mueve el valor de esos contactos (solo los de la
//      organización), eliminar los deja con el valor viejo, y ese valor viejo
//      no impide guardar el contacto.
// ---------------------------------------------------------------------------

interface Escenario {
  organizationId: string;
  userId: string;
  authUserId: string;
  branchId: string;
}

async function crearOrganizacion(etiqueta: string) {
  return prisma.organization.create({
    data: {
      name: `Campos ${etiqueta} ${randomUUID().slice(0, 8)}`,
      slug: `campos-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
}

// Con un usuario REAL de Supabase Auth: el email de public.users lo sincroniza
// un trigger desde auth.users (mismo criterio que vehicle.test-helper.ts).
async function montar(etiqueta: string): Promise<Escenario> {
  const org = await crearOrganizacion(etiqueta);
  const email = `campos-${etiqueta}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear el usuario de Supabase Auth: ${error?.message}`);
  }
  const rol = await prisma.role.findFirstOrThrow({ where: { name: "ADMIN" } });
  const user = await prisma.user.create({
    data: {
      id: data.user.id,
      organizationId: org.id,
      roleId: rol.id,
      email,
      fullName: "Admin de campos",
    },
  });
  const branch = await prisma.branch.create({
    data: { organizationId: org.id, name: "Centro", timezone: "America/Montevideo" },
  });
  return { organizationId: org.id, userId: user.id, authUserId: data.user.id, branchId: branch.id };
}

let a: Escenario;
let b: Escenario;

before(async () => {
  a = await montar("a");
  b = await montar("b");
});

after(async () => {
  const escenarios = [a, b].filter(Boolean);
  const ids = escenarios.map((e) => e.organizationId);
  const where = { organizationId: { in: ids } };
  await prisma.contact.deleteMany({ where });
  await prisma.contactCustomFieldDefinition.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  for (const e of escenarios) {
    await getSupabaseAdmin().auth.admin.deleteUser(e.authUserId);
  }
});

async function capturar(fn: () => Promise<unknown>): Promise<AppError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error("Se esperaba un AppError");
}

function contextoDe(contactId: string): ContextoDeEjecucionDeTool {
  return {
    organizationId: a.organizationId,
    conversation: {
      id: "00000000-0000-4000-8000-000000000002",
      contactId,
      branchId: a.branchId,
      agentId: "00000000-0000-4000-8000-000000000005",
      channel: "WHATSAPP",
    },
  };
}

test("definiciones: la key sale de la etiqueta, un SELECT limpia sus opciones, y el listado va en orden", async () => {
  const patente = await crearDefinicion(a.organizationId, {
    label: "  Patente del  auto ",
    type: "TEXT",
  });
  assert.equal(patente.key, "patente_del_auto");
  assert.equal(patente.label, "Patente del auto");
  assert.equal(patente.agentEditable, false);
  const combustible = await crearDefinicion(a.organizationId, {
    label: "Combustible",
    type: "SELECT",
    options: [" Nafta", "Diésel", "", "GNC"],
    agentEditable: true,
  });
  assert.deepEqual(combustible.options, ["Nafta", "Diésel", "GNC"]);
  // Una opción repetida —igual, o distinta solo en mayúsculas o acentos— es
  // un 400 que la nombra, no un descarte silencioso.
  const repetida = await capturar(() =>
    actualizarDefinicion(a.organizationId, combustible.id, {
      options: ["Nafta", "Diésel", "GNC", "diesel"],
    }),
  );
  assert.equal(repetida.statusCode, 400);
  assert.equal(repetida.message, mensajeDeOpcionRepetida("diesel"));
  assert.deepEqual(
    (await listarDefiniciones(a.organizationId)).find((d) => d.id === combustible.id)?.options,
    ["Nafta", "Diésel", "GNC"],
    "el rechazo no cambió nada",
  );
  const lista = await listarDefiniciones(a.organizationId);
  assert.deepEqual(
    lista.map((d) => d.key),
    ["patente_del_auto", "combustible"],
  );
  // Un SELECT sin opciones, no.
  const sinOpciones = await capturar(() =>
    crearDefinicion(a.organizationId, { label: "Color", type: "SELECT", options: [] }),
  );
  assert.equal(sinOpciones.statusCode, 400);
});

test("definiciones: misma etiqueta → 409; el tipo no se cambia; borrar y recrear restaura la misma fila", async () => {
  const dup = await capturar(() =>
    crearDefinicion(a.organizationId, { label: "patente del auto", type: "NUMBER" }),
  );
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.message, MENSAJE_CAMPO_DUPLICADO);

  const [patente] = await listarDefiniciones(a.organizationId);
  const tipo = await capturar(() =>
    actualizarDefinicion(a.organizationId, patente.id, { type: "NUMBER" }),
  );
  assert.equal(tipo.message, MENSAJE_TIPO_INMUTABLE);
  const renombrada = await actualizarDefinicion(a.organizationId, patente.id, {
    label: "Patente",
    agentEditable: true,
  });
  assert.equal(renombrada.key, "patente_del_auto", "la key no cambia con la etiqueta");
  assert.equal(renombrada.agentEditable, true);

  await borrarDefinicion(a.organizationId, patente.id);
  assert.equal(
    (await listarDefiniciones(a.organizationId)).some((d) => d.id === patente.id),
    false,
  );
  const restaurada = await crearDefinicion(a.organizationId, {
    label: "Patente del auto",
    type: "TEXT",
  });
  assert.equal(restaurada.id, patente.id, "misma fila, restaurada");
  assert.equal(restaurada.deletedAt, null);
  assert.equal(restaurada.agentEditable, false, "con los datos nuevos");
});

test(`definiciones: no más de ${String(MAX_CAMPOS_POR_ORGANIZACION)} vigentes por organización`, async () => {
  const org = (await crearOrganizacion("tope")).id;
  try {
    for (let i = 0; i < MAX_CAMPOS_POR_ORGANIZACION; i++) {
      await crearDefinicion(org, { label: `Campo ${String(i)}`, type: "TEXT" });
    }
    const tope = await capturar(() => crearDefinicion(org, { label: "Uno más", type: "TEXT" }));
    assert.equal(tope.statusCode, 409);
    assert.equal(tope.message, MENSAJE_TOPE_DE_CAMPOS);
  } finally {
    await prisma.contactCustomFieldDefinition.deleteMany({ where: { organizationId: org } });
    await prisma.organization.delete({ where: { id: org } });
  }
});

test("valores: crear y editar un contacto valida contra las definiciones y mezcla con lo que ya tenía", async () => {
  await crearDefinicion(a.organizationId, {
    label: "Kilómetros",
    type: "NUMBER",
    agentEditable: true,
  });
  await crearDefinicion(a.organizationId, { label: "Tiene usado", type: "BOOLEAN" });

  const contacto = await createContact(a.organizationId, a.userId, {
    firstName: "Ana",
    lastName: "Pérez",
    customFields: { patente_del_auto: "AB123CD", kilometros: 45000 },
  });
  assert.deepEqual(contacto.customFields, { patente_del_auto: "AB123CD", kilometros: 45000 });

  // Un valor del tipo equivocado y una key desconocida: 400 con el nombre.
  const invalido = await capturar(() =>
    updateContact(a.organizationId, a.userId, contacto.id, {
      customFields: { kilometros: "muchos", otro: 1 },
    }),
  );
  assert.equal(invalido.statusCode, 400);
  assert.match(invalido.message, /Kilómetros/);
  assert.match(invalido.message, /«otro»/);

  // Mezcla: cambia uno, borra otro con null, el resto queda.
  const editado = await updateContact(a.organizationId, a.userId, contacto.id, {
    customFields: { kilometros: null, combustible: "GNC", tiene_usado: true },
  });
  assert.deepEqual(editado.customFields, {
    patente_del_auto: "AB123CD",
    combustible: "GNC",
    tiene_usado: true,
  });
  // Una opción que no existe en la lista.
  const opcion = await capturar(() =>
    updateContact(a.organizationId, a.userId, contacto.id, {
      customFields: { combustible: "Eléctrico" },
    }),
  );
  assert.match(opcion.message, /Nafta, Diésel, GNC/);
});

test("agente: update_contact_custom_fields escribe solo los editables, valida igual y no toca nada más", async () => {
  const contacto = await createContact(a.organizationId, a.userId, {
    firstName: "Beto",
    lastName: "Gómez",
    lifecycleStage: "LEAD",
    customFields: { tiene_usado: false },
  });
  const tool = CATALOGO_DE_TOOLS.get("update_contact_custom_fields")!;

  // Editable (kilometros, combustible): se guarda y se mezcla.
  const ok = await tool.ejecutar(
    { campos: { kilometros: 12000, combustible: "Nafta" } },
    contextoDe(contacto.id),
  );
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const guardado = await getContactById(a.organizationId, contacto.id);
  assert.deepEqual(guardado.customFields, {
    tiene_usado: false,
    kilometros: 12000,
    combustible: "Nafta",
  });
  assert.equal(guardado.lifecycleStage, "LEAD");
  assert.equal(guardado.firstName, "Beto");

  // No editable (tiene_usado): rechazo entero, con el nombre; nada cambia.
  const noEditable = await tool.ejecutar(
    { campos: { kilometros: 1, tiene_usado: true } },
    contextoDe(contacto.id),
  );
  assert.equal(noEditable.ok, false);
  assert.match(
    (noEditable as { error: string }).error,
    /Tiene usado.*no lo puede modificar el agente/,
  );
  assert.equal(
    ((await getContactById(a.organizationId, contacto.id)).customFields as { kilometros: number })
      .kilometros,
    12000,
  );

  // Tipo equivocado y key desconocida.
  const invalido = await tool.ejecutar(
    { campos: { kilometros: "12 mil" } },
    contextoDe(contacto.id),
  );
  assert.equal(invalido.ok, false);
  assert.match((invalido as { error: string }).error, /Kilómetros.*número/);
  const desconocido = await tool.ejecutar({ campos: { color: "rojo" } }, contextoDe(contacto.id));
  assert.match((desconocido as { error: string }).error, /«color» no es un campo/);

  // Argumentos: sin campos, o con algo que no es campos.
  assert.equal((await tool.ejecutar({ campos: {} }, contextoDe(contacto.id))).ok, false);
  assert.equal((await tool.ejecutar({ firstName: "x" }, contextoDe(contacto.id))).ok, false);
});

test("dos organizaciones: las definiciones de A no valen en B", async () => {
  const deB = await capturar(() =>
    createContact(b.organizationId, b.userId, {
      firstName: "Caro",
      lastName: "Díaz",
      customFields: { patente_del_auto: "ZZ999ZZ" },
    }),
  );
  assert.equal(deB.statusCode, 400);
  assert.match(deB.message, /«patente_del_auto» no es un campo/);
  assert.equal((await listarDefiniciones(b.organizationId)).length, 0);
});

test("opciones en uso: se cuentan, renombrar mueve a los contactos de ESA organización, y eliminar los deja con el valor viejo sin trabar su ficha", async () => {
  const formaDePago = await crearDefinicion(b.organizationId, {
    label: "Forma de pago",
    type: "SELECT",
    options: ["Contado", "Financiado", "Permuta"],
  });
  const alta = (firstName: string, opcion: string) =>
    createContact(b.organizationId, b.userId, {
      firstName,
      lastName: "De prueba",
      customFields: { forma_de_pago: opcion },
    });
  const uno = await alta("Uno", "Contado");
  const dos = await alta("Dos", "Contado");
  const tres = await alta("Tres", "Permuta");
  const cuatro = await alta("Cuatro", "Financiado");
  // Uno dado de baja: no se cuenta, pero sí se renombra (por si se restaura).
  const deBaja = await alta("De baja", "Contado");
  await prisma.contact.update({ where: { id: deBaja.id }, data: { deletedAt: new Date() } });
  // Otra organización con la misma key y el mismo valor: no se toca ni se cuenta.
  const ajeno = await prisma.contact.create({
    data: {
      organizationId: a.organizationId,
      firstName: "Ajeno",
      lastName: "De prueba",
      customFields: { forma_de_pago: "Contado" },
    },
  });
  const valorDe = async (id: string) =>
    (
      (await prisma.contact.findUniqueOrThrow({ where: { id } })).customFields as {
        forma_de_pago?: string;
      }
    ).forma_de_pago;

  assert.deepEqual(await usoDeOpciones(b.organizationId, formaDePago.id), {
    Contado: 2,
    Permuta: 1,
    Financiado: 1,
  });
  // Un campo que no es lista no tiene opciones; el de otra organización, 404.
  const texto = await crearDefinicion(b.organizationId, { label: "Observaciones", type: "TEXT" });
  assert.deepEqual(await usoDeOpciones(b.organizationId, texto.id), {});
  const ajena = await capturar(() => usoDeOpciones(a.organizationId, formaDePago.id));
  assert.equal(ajena.statusCode, 404);
  assert.equal(ajena.message, MENSAJE_CAMPO_NO_ENCONTRADO);

  // Renombrar "Contado" y eliminar "Permuta" en el mismo guardado.
  const actualizada = await actualizarDefinicion(b.organizationId, formaDePago.id, {
    options: ["Efectivo", "Financiado"],
    renamedOptions: [{ from: "Contado", to: "Efectivo" }],
  });
  assert.deepEqual(actualizada.options, ["Efectivo", "Financiado"]);
  assert.equal(await valorDe(uno.id), "Efectivo");
  assert.equal(await valorDe(dos.id), "Efectivo");
  assert.equal(await valorDe(deBaja.id), "Efectivo", "el dado de baja también se renombra");
  assert.equal(await valorDe(cuatro.id), "Financiado");
  assert.equal(await valorDe(tres.id), "Permuta", "la eliminada queda como estaba");
  assert.equal(await valorDe(ajeno.id), "Contado", "otra organización no se toca");
  assert.deepEqual(await usoDeOpciones(b.organizationId, formaDePago.id), {
    Efectivo: 2,
    Permuta: 1,
    Financiado: 1,
  });

  // El contacto con la opción eliminada se puede guardar: la ficha manda su
  // valor viejo junto con lo que cambió, y lo que no cambió no se valida.
  const guardado = await updateContact(b.organizationId, b.userId, tres.id, {
    firstName: "Tres editado",
    customFields: { forma_de_pago: "Permuta", observaciones: "Llamar de tarde" },
  });
  assert.equal(guardado.firstName, "Tres editado");
  assert.deepEqual(guardado.customFields, {
    forma_de_pago: "Permuta",
    observaciones: "Llamar de tarde",
  });
  // Pero ya no se puede ELEGIR: no es una opción de la lista.
  const yaNoExiste = await capturar(() =>
    updateContact(b.organizationId, b.userId, cuatro.id, {
      customFields: { forma_de_pago: "Permuta" },
    }),
  );
  assert.equal(yaNoExiste.statusCode, 400);
  assert.match(yaNoExiste.message, /Efectivo, Financiado/);

  // Un intercambio (A → B y B → A) en un solo guardado no se pisa.
  await actualizarDefinicion(b.organizationId, formaDePago.id, {
    options: ["Financiado", "Efectivo"],
    renamedOptions: [
      { from: "Efectivo", to: "Financiado" },
      { from: "Financiado", to: "Efectivo" },
    ],
  });
  assert.equal(await valorDe(uno.id), "Financiado");
  assert.equal(await valorDe(cuatro.id), "Efectivo");

  // Renombres inválidos: nada cambia.
  const sinOpciones = await capturar(() =>
    actualizarDefinicion(b.organizationId, formaDePago.id, {
      renamedOptions: [{ from: "Efectivo", to: "Cheque" }],
    }),
  );
  assert.equal(sinOpciones.statusCode, 400);
  assert.equal(sinOpciones.message, MENSAJE_RENOMBRES_SIN_OPCIONES);
  const origenInexistente = await capturar(() =>
    actualizarDefinicion(b.organizationId, formaDePago.id, {
      options: ["Cheque", "Efectivo"],
      renamedOptions: [{ from: "Permuta", to: "Cheque" }],
    }),
  );
  assert.equal(origenInexistente.statusCode, 400);
  assert.equal(await valorDe(tres.id), "Permuta");
  assert.deepEqual(
    (await listarDefiniciones(b.organizationId)).find((d) => d.id === formaDePago.id)?.options,
    ["Financiado", "Efectivo"],
  );
});
