import { Prisma, type ConversationChannel } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import {
  META_CONTACT_FIRST_NAMES,
  PREFIJO_DEL_APELLIDO_DE_META,
  PREFIJO_DEL_USUARIO_DE_INSTAGRAM,
  WHATSAPP_CONTACT_FALLBACK_FIRST_NAME,
  WIDGET_CONTACT_FIRST_NAME,
} from "../utils/nombreProvisorio";

// ---------------------------------------------------------------------------
// "Consultas sin identificar" (ítem 184 de docs/frontend-cambios-pendientes
// .md): los contactos que escribieron por un canal y de los que todavía no se
// sabe quiénes son. Es un FILTRO CALCULADO, sin columna nueva: un contacto
// pasa solo a "Clientes" cuando la persona dice su nombre o se le crea una
// oportunidad.
//
// LA REGLA ES LA DEL ÍTEM 183 (utils/nombreProvisorio.ts), escrita en SQL:
//   sin identificar = (nombre provisorio, o nombre o apellido sin letras)
//                     y ninguna oportunidad no borrada.
// Las dos escrituras de la regla —TS y SQL— tienen que decir lo mismo: por
// eso el SQL interpola las MISMAS constantes de nombreProvisorio.ts y un test
// de integración (consultasSinIdentificar.integration-test.ts) pasa una lista
// de nombres por las dos y exige que coincidan. Si alguien cambia una
// escritura y no la otra, ese test lo ve.
//
// "Con letras" es `~ '[[:alpha:]]'`: en una base UTF-8 la clase POSIX de
// Postgres cubre las letras con acento y la ñ, como \p{L} del lado de TS.
// ---------------------------------------------------------------------------

const SUFIJO_DEL_VISITANTE_SQL = "^[0-9a-f]{8}$";
const CON_LETRAS_SQL = "[[:alpha:]]";

// El predicado sobre un alias `c` de contacts. Fragmento, no función SQL: se
// compone en las consultas de abajo y en el chequeo puntual de descartar.
export function predicadoSinIdentificar(): Prisma.Sql {
  const nombresDeMeta = Object.values(META_CONTACT_FIRST_NAMES);
  return Prisma.sql`(
    (
      btrim(c.first_name) = ''
      OR btrim(c.first_name) = ${WHATSAPP_CONTACT_FALLBACK_FIRST_NAME}
      OR (
        btrim(c.first_name) IN (${Prisma.join(nombresDeMeta)})
        AND c.last_name LIKE ${`${PREFIJO_DEL_APELLIDO_DE_META}%`}
      )
      OR (
        btrim(c.first_name) LIKE ${`${PREFIJO_DEL_USUARIO_DE_INSTAGRAM}%`}
        AND btrim(c.last_name) = ''
      )
      OR (
        btrim(c.first_name) = ${WIDGET_CONTACT_FIRST_NAME}
        AND c.last_name ~ ${SUFIJO_DEL_VISITANTE_SQL}
      )
      OR c.first_name !~ ${CON_LETRAS_SQL}
      OR c.last_name !~ ${CON_LETRAS_SQL}
    )
    AND NOT EXISTS (
      SELECT 1 FROM opportunities o
      WHERE o.organization_id = c.organization_id
        AND o.contact_id = c.id
        AND o.deleted_at IS NULL
    )
  )`;
}

// Los ids de las consultas sin identificar de la organización: lo que la
// vista "Clientes" EXCLUYE (`id NOT IN`). Prisma no puede expresar el
// predicado en un `where`, y la lista es chica y transitoria (las consultas
// se identifican, se descartan o las purga widgetVisitorsPurge).
export async function findUnidentifiedContactIds(
  organizationId: string,
  db: Db = prisma,
): Promise<string[]> {
  const filas = await db.$queryRaw<{ id: string }[]>`
    SELECT c.id FROM contacts c
    WHERE c.organization_id = ${organizationId}::uuid
      AND c.deleted_at IS NULL
      AND ${predicadoSinIdentificar()}`;
  return filas.map((f) => f.id);
}

// ¿Este contacto (vivo) es hoy una consulta sin identificar? El chequeo de
// descartar: solo se descarta lo que se ve en esa pestaña.
export async function isUnidentifiedContact(
  id: string,
  organizationId: string,
  db: Db = prisma,
): Promise<boolean> {
  const filas = await db.$queryRaw<{ id: string }[]>`
    SELECT c.id FROM contacts c
    WHERE c.id = ${id}::uuid
      AND c.organization_id = ${organizationId}::uuid
      AND c.deleted_at IS NULL
      AND ${predicadoSinIdentificar()}
    LIMIT 1`;
  return filas.length > 0;
}

export interface ConsultasFilters {
  // Nombre, apellido, email o teléfono (el nombre de una consulta suele ser
  // el número o el usuario del canal).
  search?: string;
  channel?: ConversationChannel;
  ownerId?: string;
}

// Lo que la pestaña muestra de cada consulta además del contacto: por dónde
// escribió, qué dijo por última vez y cuándo.
export interface UltimaConsulta {
  conversationId: string;
  channel: ConversationChannel;
  // El último mensaje del CLIENTE, recortado; null si la conversación no
  // tiene ninguno (la abrió una plantilla de una automatización).
  ultimoMensaje: string | null;
  // Cuándo escribió por última vez: el último entrante, o si no hay, el
  // último movimiento de la conversación.
  ultimoMensajeAt: Date;
}

export interface FilaDeConsulta {
  contactId: string;
  ultimaConsulta: UltimaConsulta | null;
}

// Hasta dónde se recorta el último mensaje: la pestaña lo muestra en una
// celda, no entero. Lo que importa es poder reconocer la consulta.
export const LARGO_DEL_ULTIMO_MENSAJE = 160;

interface FilaCruda {
  contact_id: string;
  conversation_id: string | null;
  channel: ConversationChannel | null;
  ultimo_mensaje: string | null;
  escribio_at: Date | null;
}

// La conversación más reciente del contacto (por último mensaje) y, de ella,
// el último entrante. Un LATERAL por cada uno, sobre los índices que ya
// existen (conversations(contact_id), messages(conversation_id, created_at)).
// Una consulta sin conversación (cargada por la ingesta con un nombre vacío)
// también es una consulta: LEFT JOIN, y va al final (NULLS LAST), por su alta.
function consultasDesde(organizationId: string, filters: ConsultasFilters): Prisma.Sql {
  const busqueda = filters.search ? `%${filters.search}%` : null;
  return Prisma.sql`
    FROM contacts c
    LEFT JOIN LATERAL (
      SELECT cv.id, cv.channel, cv.last_message_at, cv.created_at
      FROM conversations cv
      WHERE cv.organization_id = c.organization_id AND cv.contact_id = c.id
      ORDER BY cv.last_message_at DESC NULLS LAST, cv.created_at DESC, cv.id DESC
      LIMIT 1
    ) cv ON true
    LEFT JOIN LATERAL (
      SELECT m.content, m.created_at
      FROM messages m
      WHERE m.organization_id = c.organization_id
        AND m.conversation_id = cv.id
        AND m.direction = 'INBOUND'
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) m ON true
    WHERE c.organization_id = ${organizationId}::uuid
      AND c.deleted_at IS NULL
      AND ${predicadoSinIdentificar()}
      ${
        busqueda
          ? Prisma.sql`AND (
              c.first_name ILIKE ${busqueda} OR c.last_name ILIKE ${busqueda}
              OR c.email ILIKE ${busqueda} OR c.phone ILIKE ${busqueda}
            )`
          : Prisma.empty
      }
      ${filters.channel ? Prisma.sql`AND cv.channel = ${filters.channel}::"ConversationChannel"` : Prisma.empty}
      ${filters.ownerId ? Prisma.sql`AND c.owner_id = ${filters.ownerId}::uuid` : Prisma.empty}
  `;
}

// Una página de consultas, de la que escribió más recientemente a la más
// vieja. Devuelve solo los ids y lo de la conversación: la fila del contacto
// la trae findManyContacts con su include de siempre.
export async function findUnidentifiedInquiries(
  organizationId: string,
  filters: ConsultasFilters,
  pagination: { skip: number; take: number },
  db: Db = prisma,
): Promise<FilaDeConsulta[]> {
  const filas = await db.$queryRaw<FilaCruda[]>`
    SELECT c.id AS contact_id,
      cv.id AS conversation_id,
      cv.channel,
      left(m.content, ${LARGO_DEL_ULTIMO_MENSAJE}::int) AS ultimo_mensaje,
      COALESCE(m.created_at, cv.last_message_at, cv.created_at) AS escribio_at
    ${consultasDesde(organizationId, filters)}
    ORDER BY COALESCE(m.created_at, cv.last_message_at, cv.created_at) DESC NULLS LAST,
      c.created_at DESC, c.id DESC
    LIMIT ${pagination.take} OFFSET ${pagination.skip}`;
  return filas.map((fila) => ({
    contactId: fila.contact_id,
    ultimaConsulta:
      fila.conversation_id && fila.channel && fila.escribio_at
        ? {
            conversationId: fila.conversation_id,
            channel: fila.channel,
            ultimoMensaje: fila.ultimo_mensaje,
            ultimoMensajeAt: fila.escribio_at,
          }
        : null,
  }));
}

export async function countUnidentifiedInquiries(
  organizationId: string,
  filters: ConsultasFilters,
  db: Db = prisma,
): Promise<number> {
  const filas = await db.$queryRaw<{ total: number }[]>`
    SELECT count(*)::int AS total ${consultasDesde(organizationId, filters)}`;
  return filas[0]?.total ?? 0;
}

// Las conversaciones abiertas de un contacto: lo que descartar cierra.
export function findOpenConversationIdsOf(
  contactId: string,
  organizationId: string,
  db: Db = prisma,
) {
  return db.conversation.findMany({
    where: { organizationId, contactId, status: { in: ["ACTIVE", "TRANSFERRED_TO_HUMAN"] } },
    select: { id: true },
  });
}
