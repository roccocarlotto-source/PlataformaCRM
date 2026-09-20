import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countConversations,
  findConversationWithMessages,
  findManyConversations,
  type ConversationFilters,
  type ConversationSortBy,
  type SortOrder,
} from "./conversation.repository";
import type { Db } from "../lib/prisma";

// ---------------------------------------------------------------------------
// Las consultas de la bandeja de conversaciones (ítem 66 de
// docs/frontend-cambios-pendientes.md), sin base.
//
// Lo que se verifica acá es lo que buildWhere/buildOrderBy ARMAN: el filtro
// multi-tenant, cada filtro por separado, la forma exacta de la búsqueda por
// contacto, el desempate del orden y que findMany y count usen el MISMO
// where. Son funciones privadas del módulo y siguen siéndolo: se las observa
// por lo que le llega a Prisma, con un `db` falso que captura sus argumentos
// —mismo patrón que baseEnMemoria en opportunity.service.test.ts—, no
// exportándolas solo para el test.
//
// Lo que este archivo NO puede probar, y por eso existe también
// conversation.controller.integration-test.ts: que Postgres devuelva esas
// filas y no otras.
// ---------------------------------------------------------------------------

interface Captura {
  where?: unknown;
  orderBy?: unknown;
  include?: unknown;
  skip?: number;
  take?: number;
}

function espia() {
  const llamadas: Record<"findMany" | "count" | "findFirst", Captura[]> = {
    findMany: [],
    count: [],
    findFirst: [],
  };
  const db = {
    conversation: {
      findMany: async (args: Captura) => {
        llamadas.findMany.push(args);
        return [];
      },
      count: async (args: Captura) => {
        llamadas.count.push(args);
        return 0;
      },
      findFirst: async (args: Captura) => {
        llamadas.findFirst.push(args);
        return null;
      },
    },
  } as unknown as Db;
  return { db, llamadas };
}

const ORG = "org-a";

const SIN_FILTROS: ConversationFilters = {};
const ORDEN_POR_DEFECTO = {
  sortBy: "lastMessageAt" as ConversationSortBy,
  sortOrder: "desc" as SortOrder,
};
const PRIMERA_PAGINA = { skip: 0, take: 20 };

async function whereDeLaLista(filters: ConversationFilters): Promise<Record<string, unknown>> {
  const { db, llamadas } = espia();
  await findManyConversations(ORG, filters, PRIMERA_PAGINA, ORDEN_POR_DEFECTO, db);
  return llamadas.findMany[0].where as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// El filtro
// ---------------------------------------------------------------------------

test("sin filtros, el where es SOLO la organización — Conversation no tiene soft delete", async () => {
  const where = await whereDeLaLista(SIN_FILTROS);

  // deepEqual y no un chequeo de la clave: la ausencia de `deletedAt: null`
  // es el punto. Una conversación CLOSED es historia que se conserva y se
  // lista, no una fila borrada (ver el comentario del modelo en
  // prisma/schema.prisma).
  assert.deepEqual(where, { organizationId: ORG });
});

test("search busca por el CONTACTO —nombre, apellido o email—, no dentro de los mensajes", async () => {
  const where = await whereDeLaLista({ search: "pérez" });

  assert.deepEqual(where, {
    organizationId: ORG,
    contact: {
      is: {
        OR: [
          { firstName: { contains: "pérez", mode: "insensitive" } },
          { lastName: { contains: "pérez", mode: "insensitive" } },
          { email: { contains: "pérez", mode: "insensitive" } },
        ],
      },
    },
  });
  // Lo que NO está: ningún filtro sobre `messages`. Si alguien lo agrega sin
  // pensar el índice, este assert lo frena.
  assert.equal("messages" in where, false);
});

test("cada filtro por separado entra tal cual, sin pisar la organización", async () => {
  const casos: [ConversationFilters, Record<string, unknown>][] = [
    [{ branchId: "b1" }, { branchId: "b1" }],
    [{ agentId: "ag1" }, { agentId: "ag1" }],
    [{ contactId: "c1" }, { contactId: "c1" }],
    [{ status: "TRANSFERRED_TO_HUMAN" }, { status: "TRANSFERRED_TO_HUMAN" }],
    [{ channel: "WHATSAPP" }, { channel: "WHATSAPP" }],
  ];

  for (const [filtro, esperado] of casos) {
    const where = await whereDeLaLista(filtro);
    assert.deepEqual(where, { organizationId: ORG, ...esperado });
  }
});

test("varios filtros a la vez se combinan (AND implícito de Prisma), búsqueda incluida", async () => {
  const where = await whereDeLaLista({
    search: "ana",
    branchId: "b1",
    agentId: "ag1",
    status: "ACTIVE",
    channel: "WEB",
  });

  assert.equal(where.branchId, "b1");
  assert.equal(where.agentId, "ag1");
  assert.equal(where.status, "ACTIVE");
  assert.equal(where.channel, "WEB");
  assert.ok(where.contact, "la búsqueda por contacto convive con los demás filtros");
});

test("un filtro vacío no filtra: '' se ignora, no se convierte en un contains vacío", async () => {
  const where = await whereDeLaLista({ search: "", branchId: "", agentId: "" });
  assert.deepEqual(where, { organizationId: ORG });
});

test("count usa EXACTAMENTE el mismo where que findMany", async () => {
  const filtros: ConversationFilters = { search: "ana", branchId: "b1", status: "CLOSED" };
  const { db, llamadas } = espia();

  await findManyConversations(ORG, filtros, PRIMERA_PAGINA, ORDEN_POR_DEFECTO, db);
  await countConversations(ORG, filtros, db);

  // El motivo de que buildWhere sea una función y no dos objetos escritos a
  // mano: si divergen, el total de la paginación deja de corresponder con
  // las filas.
  assert.deepEqual(llamadas.count[0].where, llamadas.findMany[0].where);
});

// ---------------------------------------------------------------------------
// El orden y la paginación
// ---------------------------------------------------------------------------

test("por defecto ordena por último mensaje, con los NULL al final y `id` de desempate", async () => {
  const { db, llamadas } = espia();
  await findManyConversations(ORG, SIN_FILTROS, PRIMERA_PAGINA, ORDEN_POR_DEFECTO, db);

  assert.deepEqual(llamadas.findMany[0].orderBy, [
    { lastMessageAt: { sort: "desc", nulls: "last" } },
    { id: "desc" },
  ]);
});

test("ordenar por fecha de creación también lleva el desempate por `id`", async () => {
  const { db, llamadas } = espia();
  await findManyConversations(
    ORG,
    SIN_FILTROS,
    PRIMERA_PAGINA,
    { sortBy: "createdAt", sortOrder: "asc" },
    db,
  );

  // Sin el segundo criterio, dos filas con el mismo createdAt pueden salir en
  // orden distinto entre dos consultas y la paginación repetiría o saltearía
  // filas — el bug abierto de qrCode.repository.ts.
  assert.deepEqual(llamadas.findMany[0].orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
});

test("el sentido del orden se respeta en los dos campos ordenables", async () => {
  const { db, llamadas } = espia();
  await findManyConversations(
    ORG,
    SIN_FILTROS,
    PRIMERA_PAGINA,
    { sortBy: "lastMessageAt", sortOrder: "asc" },
    db,
  );

  assert.deepEqual(llamadas.findMany[0].orderBy, [
    { lastMessageAt: { sort: "asc", nulls: "last" } },
    { id: "asc" },
  ]);
});

test("la paginación viaja como skip/take, y el listado trae contacto, agente y sucursal", async () => {
  const { db, llamadas } = espia();
  await findManyConversations(ORG, SIN_FILTROS, { skip: 40, take: 20 }, ORDEN_POR_DEFECTO, db);

  const [args] = llamadas.findMany;
  assert.equal(args.skip, 40);
  assert.equal(args.take, 20);
  // Los nombres que muestra la tabla vienen de la misma consulta: sin esto,
  // la pantalla tendría que resolver un contacto por fila.
  assert.deepEqual(args.include, {
    contact: { select: { id: true, firstName: true, lastName: true } },
    agent: { select: { id: true, name: true } },
    branch: { select: { id: true, name: true } },
  });
});

// ---------------------------------------------------------------------------
// El hilo
// ---------------------------------------------------------------------------

test("el detalle exige organizationId en el WHERE y trae los mensajes en orden cronológico", async () => {
  const { db, llamadas } = espia();
  await findConversationWithMessages("conv-1", ORG, db);

  const [args] = llamadas.findFirst;
  // El aislamiento no depende de un pre-check del service: está en la
  // consulta (M4). Un id de otra organización no devuelve fila, y eso es el
  // 404.
  assert.deepEqual(args.where, { id: "conv-1", organizationId: ORG });

  const include = args.include as {
    messages: { orderBy: unknown; include: unknown };
  };
  assert.deepEqual(include.messages.orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
  // Quién de la organización contestó después de una derivación: solo los
  // mensajes HUMAN lo tienen (lo garantiza el CHECK de la migración
  // 20260912130000).
  assert.deepEqual(include.messages.include, {
    senderUser: { select: { id: true, fullName: true } },
  });
});

test("el detalle trae las mismas relaciones de exhibición que el listado", async () => {
  const { db, llamadas } = espia();
  await findConversationWithMessages("conv-1", ORG, db);

  const include = llamadas.findFirst[0].include as Record<string, unknown>;
  assert.deepEqual(include.contact, { select: { id: true, firstName: true, lastName: true } });
  assert.deepEqual(include.agent, { select: { id: true, name: true } });
  assert.deepEqual(include.branch, { select: { id: true, name: true } });
});
