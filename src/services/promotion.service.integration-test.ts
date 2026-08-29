import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/prisma";
import type { EventoReclamado } from "../repositories/ingestionEvent.repository";
import type { PromotionNote } from "../types/promotion";
import { filasParaStaging, parsearArchivo } from "../utils/spreadsheet";
import { drenarPendientes } from "../workers/ingestionWorker";
import { promoverEvento } from "./promotion.service";

// ---------------------------------------------------------------------------
// Promoción staging -> Contact y worker (ítem 4 de
// docs/ingestion-architecture.md §4 y §5), contra Postgres real.
//
// LE PREGUNTA A LA BASE, NO AL SERVICE. Cada afirmación sobre "qué quedó
// guardado" se lee de vuelta de `contacts` o de `ingestion_events`, nunca del
// objeto que devolvió la promoción — que es justamente el objeto que un bug
// podría estar construyendo bien mientras escribe mal.
//
// El drenado se ejecuta SIEMPRE acotado a la organización del fixture
// (drenarPendientes({ organizationId })): sin eso, un test dependería de que
// nadie más tenga eventos pendientes en la base compartida de desarrollo.
// ---------------------------------------------------------------------------

let orgId: string;
let sourceId: string;
let sourceName: string;
let fileSourceId: string;

async function crearEvento(rawPayload: unknown): Promise<string> {
  const evento = await prisma.ingestionEvent.create({
    data: {
      organizationId: orgId,
      sourceId,
      externalId: `promo-${randomUUID()}`,
      rawPayload: rawPayload as never,
    },
    select: { id: true },
  });
  return evento.id;
}

function leerEvento(id: string) {
  return prisma.ingestionEvent.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      errorMessage: true,
      promotedContactId: true,
      promotionNotes: true,
      rawPayload: true,
    },
  });
}

function notasDe(promotionNotes: unknown): PromotionNote[] {
  return (promotionNotes ?? []) as PromotionNote[];
}

// Promueve un único evento y devuelve la fila del evento ya actualizada.
async function promoverUno(rawPayload: unknown) {
  const id = await crearEvento(rawPayload);
  const resumen = await drenarPendientes({ organizationId: orgId, limite: 1 });
  return { id, resumen, evento: await leerEvento(id) };
}

before(async () => {
  const org = await prisma.organization.create({
    data: {
      name: `Promo test org ${randomUUID()}`,
      slug: `promo-test-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });
  orgId = org.id;

  sourceName = "Landing de precios";
  const source = await prisma.source.create({
    data: { organizationId: orgId, name: sourceName, type: "WEBHOOK" },
  });
  sourceId = source.id;

  // La fuente de archivo, con un mapeo de encabezados "humanos" a campos de
  // Contact: es el camino que A-6 necesita ejercitar (parser -> staging ->
  // traducción con mapeo -> schema).
  const archivo = await prisma.source.create({
    data: {
      organizationId: orgId,
      name: "Planilla de la feria",
      type: "FILE_IMPORT",
      fieldMapping: { Nombre: "firstName", Apellido: "lastName", Mail: "email" },
    },
  });
  fileSourceId = archivo.id;
});

after(async () => {
  if (!orgId) return;
  // ingestion_events antes que contacts: promoted_contact_id referencia
  // contacts, y contacts -> sources es RESTRICT.
  await prisma.ingestionEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.contact.deleteMany({ where: { organizationId: orgId } });
  await prisma.source.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

// ---------------------------------------------------------------------------
// Contacto nuevo
// ---------------------------------------------------------------------------

test("un contacto que no existe se INSERTA, y el evento queda PROCESSED apuntándolo", async () => {
  const email = `nuevo-${randomUUID()}@ejemplo.test`;
  const { evento } = await promoverUno({
    firstName: "Ana",
    lastName: "Gómez",
    email,
    phone: "+5411000000",
    jobTitle: "CTO",
  });

  assert.equal(evento.status, "PROCESSED");
  assert.equal(evento.errorMessage, null);
  assert.ok(evento.promotedContactId, "el evento tiene que apuntar al contacto");
  assert.equal(
    evento.promotionNotes,
    null,
    "sin conflictos ni marcas no se escribe nada: NULL, no un array vacío",
  );

  const contacto = await prisma.contact.findUniqueOrThrow({
    where: { id: evento.promotedContactId! },
  });

  assert.equal(contacto.firstName, "Ana");
  assert.equal(contacto.lastName, "Gómez");
  assert.equal(contacto.email, email);
  assert.equal(contacto.phone, "+5411000000");
  assert.equal(contacto.jobTitle, "CTO");
  assert.equal(contacto.organizationId, orgId);
  // La decisión sobre Contact.source: el NOMBRE de la fuente, legible.
  assert.equal(contacto.source, sourceName);
  // La ingesta no escribe lifecycleStage: queda el default de la columna.
  assert.equal(contacto.lifecycleStage, "LEAD");
});

// ---------------------------------------------------------------------------
// Contacto existente — el upsert por email
// ---------------------------------------------------------------------------

test("un contacto existente por email se ACTUALIZA, no se duplica", async () => {
  const email = `existente-${randomUUID()}@ejemplo.test`;
  const primero = await promoverUno({ firstName: "Ana", lastName: "Gómez", email });
  const segundo = await promoverUno({
    firstName: "Ana",
    lastName: "Gómez",
    email,
    phone: "+5411999999",
  });

  assert.equal(segundo.evento.status, "PROCESSED");
  assert.equal(
    segundo.evento.promotedContactId,
    primero.evento.promotedContactId,
    "el segundo evento tiene que apuntar al MISMO contacto",
  );

  // La afirmación que importa: se cuenta en la tabla.
  assert.equal(
    await prisma.contact.count({ where: { organizationId: orgId, email } }),
    1,
    "no puede haber dos contactos con el mismo email en la organización",
  );

  // El campo que estaba nulo SÍ se completó (§4: "un campo entrante con valor
  // sí actualiza si el existente es nulo").
  const contacto = await prisma.contact.findUniqueOrThrow({
    where: { id: primero.evento.promotedContactId! },
  });
  assert.equal(contacto.phone, "+5411999999");
});

test("el upsert dedupea por lower(email): distinta capitalización es el MISMO contacto", async () => {
  const base = `Case-${randomUUID()}@Ejemplo.test`;
  const primero = await promoverUno({ firstName: "Ana", lastName: "Gómez", email: base });
  const segundo = await promoverUno({
    firstName: "Ana",
    lastName: "Gómez",
    email: base.toLowerCase(),
  });

  assert.equal(segundo.evento.promotedContactId, primero.evento.promotedContactId);

  const contacto = await prisma.contact.findUniqueOrThrow({
    where: { id: primero.evento.promotedContactId! },
  });
  // §9.6: se conserva la grafía con la que se escribió, no la del reingreso.
  assert.equal(contacto.email, base);

  // Y no se anota como conflicto: diferir solo en mayúsculas no es un dato
  // descartado, sería ruido en cada reingreso del mismo lead.
  assert.deepEqual(notasDe(segundo.evento.promotionNotes), []);
});

// ---------------------------------------------------------------------------
// La política de merge de §4
// ---------------------------------------------------------------------------

test("un campo entrante VACÍO nunca pisa un valor existente en el CRM", async () => {
  const email = `vacio-${randomUUID()}@ejemplo.test`;
  const primero = await promoverUno({
    firstName: "Ana",
    lastName: "Gómez",
    email,
    phone: "+5411111111",
    jobTitle: "CTO",
  });

  await promoverUno({
    firstName: "Ana",
    lastName: "Gómez",
    email,
    phone: "",
    jobTitle: "   ",
  });

  const contacto = await prisma.contact.findUniqueOrThrow({
    where: { id: primero.evento.promotedContactId! },
  });

  assert.equal(contacto.phone, "+5411111111");
  assert.equal(contacto.jobTitle, "CTO");
});

test("valores distintos en ambos lados: gana el CRM y queda REGISTRO — nunca en silencio", async () => {
  const email = `conflicto-${randomUUID()}@ejemplo.test`;
  const primero = await promoverUno({
    firstName: "Ana",
    lastName: "Gómez",
    email,
    phone: "+5411111111",
  });

  const segundo = await promoverUno({
    firstName: "Anita",
    lastName: "Gomez",
    email,
    phone: "+5499999999",
  });

  // 1. El dato del CRM se conservó, leído de la tabla.
  const contacto = await prisma.contact.findUniqueOrThrow({
    where: { id: primero.evento.promotedContactId! },
  });
  assert.equal(contacto.firstName, "Ana");
  assert.equal(contacto.lastName, "Gómez");
  assert.equal(contacto.phone, "+5411111111");

  // 2. Y quedó registro de lo que se descartó. Esta es la mitad que "nunca
  //    sobrescribir en silencio" exige y que sin promotionNotes se perdería.
  const notas = notasDe(segundo.evento.promotionNotes);
  const conflictos = notas.filter((n) => n.tipo === "conflicto");

  assert.deepEqual(conflictos.map((n) => (n.tipo === "conflicto" ? n.campo : "")).sort(), [
    "firstName",
    "lastName",
    "phone",
  ]);

  const phone = conflictos.find((n) => n.tipo === "conflicto" && n.campo === "phone");
  assert.deepEqual(phone, {
    tipo: "conflicto",
    campo: "phone",
    crm: "+5411111111",
    entrante: "+5499999999",
  });

  // 3. Y el evento se procesó CON ÉXITO: el conflicto no es un fallo.
  assert.equal(segundo.evento.status, "PROCESSED");
  assert.equal(
    segundo.evento.errorMessage,
    null,
    "errorMessage significa una sola cosa —por qué falló— y esta fila no falló",
  );
});

test("lifecycleStage no se degrada porque la ingesta no lo escribe nunca, y queda anotado", async () => {
  const email = `lifecycle-${randomUUID()}@ejemplo.test`;
  const primero = await promoverUno({ firstName: "Ana", lastName: "Gómez", email });

  await prisma.contact.update({
    where: { id: primero.evento.promotedContactId! },
    data: { lifecycleStage: "CUSTOMER" },
  });

  // Un formulario que intenta mandar a un CUSTOMER de vuelta a LEAD.
  const segundo = await promoverUno({
    firstName: "Ana",
    lastName: "Gómez",
    email,
    lifecycleStage: "LEAD",
  });

  const contacto = await prisma.contact.findUniqueOrThrow({
    where: { id: primero.evento.promotedContactId! },
  });
  assert.equal(
    contacto.lifecycleStage,
    "CUSTOMER",
    "un CUSTOMER no vuelve a LEAD porque alguien llenó un formulario",
  );

  const ignorados = notasDe(segundo.evento.promotionNotes).filter((n) => n.tipo === "ignorado");
  assert.equal(ignorados.length, 1);
  assert.equal(ignorados[0].tipo === "ignorado" ? ignorados[0].campo : "", "lifecycleStage");
});

test("un contacto SIN email no se dedupea: se crea nuevo y queda marcado para revisión manual", async () => {
  const primero = await promoverUno({ firstName: "Sin", lastName: "Email" });
  const segundo = await promoverUno({ firstName: "Sin", lastName: "Email" });

  assert.equal(primero.evento.status, "PROCESSED");
  assert.equal(segundo.evento.status, "PROCESSED");

  // DOS contactos, no uno: sin email no hay criterio de deduplicación (§4).
  assert.notEqual(segundo.evento.promotedContactId, primero.evento.promotedContactId);
  assert.equal(
    await prisma.contact.count({
      where: { organizationId: orgId, firstName: "Sin", lastName: "Email" },
    }),
    2,
  );

  // Y los dos quedan marcados, que es lo que hace recuperable el duplicado.
  for (const evento of [primero.evento, segundo.evento]) {
    const marcas = notasDe(evento.promotionNotes).filter((n) => n.tipo === "revision_manual");
    assert.equal(marcas.length, 1, "tiene que quedar la marca de revisión manual");
  }
});

// ---------------------------------------------------------------------------
// A-6 (docs/auditoria-2026-08-29.md) — el camino CSV entero, con la celda de
// email vacía.
//
// Es el escenario 2 del hallazgo: csv-parse entrega "" para una celda vacía, el
// parser la conserva, la traducción con mapeo la deja pasar, y
// ingestContactSchema la rechazaba con "email inválido" — toda fila CSV sin
// email terminaba FAILED. Acá se recorre ese camino con las piezas reales
// (parsearArchivo -> filasParaStaging -> ingestion_events -> drenarPendientes)
// en vez de fabricar el rawPayload a mano, para que el test dependa de la forma
// que el parser produce de verdad y no de una suposición sobre ella.
// ---------------------------------------------------------------------------

test("A-6: una fila de CSV con la celda de email VACÍA se promueve como contacto sin email, no queda FAILED", async () => {
  const parseado = await parsearArchivo(
    Buffer.from(
      "Nombre,Apellido,Mail\nSinMail,Feria,\nConMail,Feria,conmail@ejemplo.test\n",
      "utf8",
    ),
    "csv",
  );
  const filas = filasParaStaging(parseado.filas);
  assert.equal(filas[0].rawPayload.Mail, "", "la premisa: la celda vacía llega como cadena vacía");

  const ids: string[] = [];
  for (const fila of filas) {
    const evento = await prisma.ingestionEvent.create({
      data: {
        organizationId: orgId,
        sourceId: fileSourceId,
        externalId: `a6-${randomUUID()}`,
        rawPayload: fila.rawPayload as never,
      },
      select: { id: true },
    });
    ids.push(evento.id);
  }

  const resumen = await drenarPendientes({ organizationId: orgId, limite: filas.length });
  assert.equal(resumen.procesados, 2, "las dos filas tienen que promoverse");

  const sinMail = await leerEvento(ids[0]);
  assert.equal(sinMail.status, "PROCESSED", `antes quedaba FAILED con: ${sinMail.errorMessage}`);
  assert.ok(sinMail.promotedContactId, "y con un contacto promovido");

  const contacto = await prisma.contact.findUniqueOrThrow({
    where: { id: sinMail.promotedContactId! },
    select: { firstName: true, lastName: true, email: true },
  });
  assert.deepEqual(contacto, { firstName: "SinMail", lastName: "Feria", email: null });

  // Sin email no hay criterio de deduplicación: queda la marca de revisión
  // manual, igual que en el webhook (§4).
  const marcas = notasDe(sinMail.promotionNotes).filter((n) => n.tipo === "revision_manual");
  assert.equal(marcas.length, 1);

  // La fila CON email, en el mismo lote, entra con su email.
  const conMail = await leerEvento(ids[1]);
  assert.equal(conMail.status, "PROCESSED");
  const otro = await prisma.contact.findUniqueOrThrow({
    where: { id: conMail.promotedContactId! },
    select: { email: true },
  });
  assert.equal(otro.email, "conmail@ejemplo.test");
});

// ---------------------------------------------------------------------------
// El worker (§5)
// ---------------------------------------------------------------------------

test("una fila inválida se marca FAILED y NO aborta el drenado del resto", async () => {
  const emailBueno1 = `cola-1-${randomUUID()}@ejemplo.test`;
  const emailBueno2 = `cola-2-${randomUUID()}@ejemplo.test`;

  // La mala va PRIMERA a propósito: es la más vieja, así que el worker la toma
  // antes que las otras. Si una fila mala abortara el lote, las dos siguientes
  // se quedarían en PENDING y este test lo vería.
  const mala = await crearEvento({ email: "solo-email@ejemplo.test" });
  const buena1 = await crearEvento({
    firstName: "Uno",
    lastName: "Cola",
    email: emailBueno1,
  });
  const buena2 = await crearEvento({
    firstName: "Dos",
    lastName: "Cola",
    email: emailBueno2,
  });

  const resumen = await drenarPendientes({ organizationId: orgId });

  assert.equal(resumen.fallidos, 1);
  assert.equal(resumen.procesados, 2);
  assert.equal(resumen.pospuestos, 0);

  const eventoMalo = await leerEvento(mala);
  assert.equal(eventoMalo.status, "FAILED");
  assert.ok(
    eventoMalo.errorMessage?.includes("firstName"),
    `errorMessage tiene que decir qué faltó: ${eventoMalo.errorMessage}`,
  );
  assert.equal(eventoMalo.promotedContactId, null, "una fila fallida no promueve ningún contacto");
  // El payload crudo sobrevive intacto al fallo: es lo que permite reprocesar
  // (§1) una vez corregido el mapeo o el emisor.
  assert.deepEqual(eventoMalo.rawPayload, { email: "solo-email@ejemplo.test" });

  for (const id of [buena1, buena2]) {
    const evento = await leerEvento(id);
    assert.equal(evento.status, "PROCESSED", "la fila mala no puede frenar al resto");
    assert.ok(evento.promotedContactId);
  }
});

test("el drenado no vuelve a tocar lo que ya procesó", async () => {
  const email = `una-vez-${randomUUID()}@ejemplo.test`;
  const id = await crearEvento({ firstName: "Una", lastName: "Vez", email });

  const primera = await drenarPendientes({ organizationId: orgId });
  assert.equal(primera.procesados, 1);

  // Segunda pasada: no queda nada PENDING, así que no hace nada.
  const segunda = await drenarPendientes({ organizationId: orgId });
  assert.equal(segunda.procesados, 0);
  assert.equal(segunda.fallidos, 0);

  const evento = await leerEvento(id);
  assert.equal(evento.status, "PROCESSED");
  assert.equal(await prisma.contact.count({ where: { organizationId: orgId, email } }), 1);
});

test("el límite por pasada se respeta y el resto queda para la siguiente", async () => {
  const ids = [];
  for (let i = 0; i < 3; i++) {
    ids.push(
      await crearEvento({
        firstName: `Lote${i}`,
        lastName: "Limite",
        email: `limite-${i}-${randomUUID()}@ejemplo.test`,
      }),
    );
  }

  const primera = await drenarPendientes({ organizationId: orgId, limite: 2 });
  assert.equal(primera.procesados, 2);

  const pendientes = await prisma.ingestionEvent.count({
    where: { organizationId: orgId, status: "PENDING" },
  });
  assert.equal(pendientes, 1);

  const segunda = await drenarPendientes({ organizationId: orgId });
  assert.equal(segunda.procesados, 1);
});

// ---------------------------------------------------------------------------
// Concurrencia
// ---------------------------------------------------------------------------

test("dos promociones simultáneas del mismo email no revientan contra el índice único", async () => {
  const email = `carrera-${randomUUID()}@ejemplo.test`;

  await crearEvento({ firstName: "Carrera", lastName: "Uno", email });
  await crearEvento({ firstName: "Carrera", lastName: "Dos", email });

  // Dos drenados EN PARALELO, cada uno con su propia transacción y su propio
  // reclamo. Es el escenario que un SELECT-y-después-INSERT perdería: los dos
  // verían "no existe" y el segundo INSERT chocaría contra
  // contacts_org_email_unique con un 23505 sin traducir.
  //
  // SKIP LOCKED hace que no se peleen por el mismo evento, y el ON CONFLICT
  // hace que el segundo encuentre el contacto que el primero acaba de crear.
  const [a, b] = await Promise.all([
    drenarPendientes({ organizationId: orgId, limite: 1 }),
    drenarPendientes({ organizationId: orgId, limite: 1 }),
  ]);

  // Uno cada uno, no la suma: sobre la suma este test pasaría igual si un
  // drenado se llevara los dos eventos y el otro ninguno, que es precisamente
  // el escenario SIN carrera. Exigiendo 1 y 1 se garantiza que los dos
  // reclamaron y escribieron.
  assert.equal(a.procesados, 1, "cada drenado tiene que haber reclamado un evento");
  assert.equal(b.procesados, 1, "cada drenado tiene que haber reclamado un evento");
  assert.equal(a.pospuestos + b.pospuestos, 0, "ninguno puede haber fallado");

  assert.equal(
    await prisma.contact.count({ where: { organizationId: orgId, email } }),
    1,
    "un solo contacto: el segundo evento actualizó, no insertó",
  );
});

// ---------------------------------------------------------------------------
// Aislamiento
// ---------------------------------------------------------------------------

test("el contacto promovido pertenece a la organización del evento", async () => {
  const otraOrg = await prisma.organization.create({
    data: {
      name: `Promo otra org ${randomUUID()}`,
      slug: `promo-otra-${Date.now()}-${randomUUID().slice(0, 8)}`,
    },
  });

  try {
    const email = `aislado-${randomUUID()}@ejemplo.test`;
    const { evento } = await promoverUno({
      firstName: "Aislado",
      lastName: "Contacto",
      email,
    });

    const contacto = await prisma.contact.findUniqueOrThrow({
      where: { id: evento.promotedContactId! },
    });
    assert.equal(contacto.organizationId, orgId);

    // Y la otra organización no ve nada de esto.
    assert.equal(await prisma.contact.count({ where: { organizationId: otraOrg.id } }), 0);

    // El mismo email en OTRA organización es un contacto distinto y legítimo:
    // el único es por (organization_id, lower(email)), no global.
    const ajeno = await prisma.contact.create({
      data: {
        organizationId: otraOrg.id,
        firstName: "Mismo",
        lastName: "Email",
        email,
      },
      select: { id: true },
    });
    assert.notEqual(ajeno.id, contacto.id);
  } finally {
    await prisma.contact.deleteMany({ where: { organizationId: otraOrg.id } });
    await prisma.organization.deleteMany({ where: { id: otraOrg.id } });
  }
});

// ---------------------------------------------------------------------------
// E-1 (docs/review-ingesta-2026-08-27.md) — el CAS de la transición de estado
// tiene que hacer fallar la transacción, no commitear en silencio.
//
// SE LLAMA A promoverEvento DIRECTO, SIN PASAR POR EL WORKER, y es el punto
// entero del test: por el flujo normal esto es INALCANZABLE, porque
// claimNextPendingEvent toma FOR UPDATE sobre la fila y filtra
// status = 'PENDING' dentro de la misma transacción. Para ejercitar el chequeo
// hay que armar el EventoReclamado a mano contra una fila que YA NO está en
// PENDING — que es exactamente la situación que el CAS dice cubrir y que el
// mecanismo de reclamo hoy impide.
// ---------------------------------------------------------------------------

function eventoReclamadoDe(id: string, rawPayload: unknown): EventoReclamado {
  return {
    id,
    organizationId: orgId,
    sourceId,
    sourceName,
    sourceType: "WEBHOOK",
    fieldMapping: null,
    rawPayload,
  };
}

test("si el evento ya no está en PENDING, la promoción REVIERTE en vez de dejar un contacto huérfano", async () => {
  // SIN EMAIL a propósito: es el caso más caro del hallazgo. promoteContact
  // hace un INSERT liso (sin ON CONFLICT, porque el índice único es parcial),
  // así que un commit acá habría creado un contacto nuevo en CADA pasada del
  // worker, indefinidamente.
  const marcador = `Huerfano${randomUUID().slice(0, 8)}`;
  const id = await crearEvento({ firstName: marcador, lastName: "SinEmail" });

  // Alguien más ya lo procesó: el CAS `status: PENDING` no va a matchear.
  await prisma.ingestionEvent.update({
    where: { id },
    data: { status: "PROCESSED" },
  });

  await assert.rejects(
    () =>
      prisma.$transaction((tx) =>
        promoverEvento(eventoReclamadoDe(id, { firstName: marcador, lastName: "SinEmail" }), tx),
      ),
    /no afectó ninguna fila/,
    "la transición fallida tiene que lanzar, no devolver un resultado",
  );

  // LO QUE EL HALLAZGO REALMENTE PROTEGE: el INSERT del contacto se revirtió
  // con la transacción. Se le pregunta a la base, no al service.
  assert.equal(
    await prisma.contact.count({ where: { organizationId: orgId, firstName: marcador } }),
    0,
    "el contacto no puede sobrevivir a una transición de estado fallida",
  );

  // Y el evento quedó como estaba: la reversión no lo pisó.
  assert.equal((await leerEvento(id)).status, "PROCESSED");
});

test("lo mismo en el camino FAILED: una fila inválida sobre un evento que ya no está en PENDING también revierte", async () => {
  // Payload inválido (sin lastName): el camino que llama a markEventFailed.
  const payload = { firstName: "Invalido" };
  const id = await crearEvento(payload);

  await prisma.ingestionEvent.update({
    where: { id },
    data: { status: "FAILED", errorMessage: "marcado por otro actor" },
  });

  await assert.rejects(
    () => prisma.$transaction((tx) => promoverEvento(eventoReclamadoDe(id, payload), tx)),
    /no afectó ninguna fila/,
  );

  // El errorMessage del otro actor sigue intacto: nada se sobrescribió.
  const evento = await leerEvento(id);
  assert.equal(evento.status, "FAILED");
  assert.equal(evento.errorMessage, "marcado por otro actor");
});
