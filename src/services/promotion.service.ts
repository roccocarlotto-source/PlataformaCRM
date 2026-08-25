import {
  promoteContact,
  type PromotedContact,
} from "../repositories/contact.repository";
import {
  markEventFailed,
  markEventProcessed,
  type EventoReclamado,
} from "../repositories/ingestionEvent.repository";
import type { Db } from "../lib/prisma";
import {
  CAMPOS_IGNORADOS,
  ingestContactSchema,
  type IngestContactPayload,
} from "../schemas/ingestContact.schema";
import type { PromotionNote } from "../types/promotion";

// ---------------------------------------------------------------------------
// Promoción staging -> Contact (§4 de docs/ingestion-architecture.md).
//
// Procesa UN evento. El worker la llama en un bucle; que sea de a uno no es un
// detalle de implementación sino §5: "cada evento se procesa de forma
// independiente: UNA FILA MALA NO ABORTA EL LOTE".
//
// Toda la función corre dentro de la transacción que ya tiene reclamado el
// evento (claimNextPendingEvent con FOR UPDATE), así que la promoción y la
// transición de estado del evento son atómicas entre sí: no puede quedar un
// Contact creado con su IngestionEvent todavía en PENDING, que al siguiente
// poll lo promovería de nuevo.
// ---------------------------------------------------------------------------

export type ResultadoPromocion =
  | { estado: "PROCESSED"; contactId: string; notas: PromotionNote[] }
  | { estado: "FAILED"; errorMessage: string };

// QUÉ SE ESCRIBE EN Contact.source — decisión de esta etapa.
//
// La columna existe desde antes del modelo `Source` y es independiente de él:
// es texto libre de hasta 100 caracteres, con filtro propio en el listado
// (?source= en contact.repository.ts). No es una FK y no puede serlo sin
// romper los contactos cargados a mano, que ponen ahí lo que quieren.
//
// Se escribe el NOMBRE de la Source, recortado a 100. Razones:
//   - Es lo único que hace la columna útil para quien la lee: "Landing de
//     precios" contesta de dónde vino el contacto; un UUID no.
//   - Es coherente con lo que ya hay: los contactos cargados por HTTP tienen
//     ahí texto libre, no identificadores.
//   - La trazabilidad EXACTA no depende de esta columna y no debe:
//     IngestionEvent.promotedContactId ya une el contacto con el evento y con
//     su sourceId real. Esta columna es la versión legible, no la auditoría.
//
// Es una FOTO del nombre en el momento de promover: renombrar la Source después
// NO reescribe los contactos ya promovidos. Es lo que significa una columna de
// texto libre, y el registro estable sigue estando del lado del IngestionEvent.
const SOURCE_MAX = 100;

function nombreDeFuente(sourceName: string): string {
  return sourceName.slice(0, SOURCE_MAX);
}

// Los conflictos se calculan comparando la fila DEVUELTA por el upsert contra
// el candidato, no leyendo el contacto antes de escribir.
//
// Que sea posible es una propiedad del COALESCE, y conviene ver por qué es
// exacto: si el campo entrante tenía valor y el resultado final NO es ese
// valor, la única explicación posible es que el CRM ya tenía otro y ganó. Los
// tres casos restantes —el CRM estaba nulo, el CRM tenía lo mismo, o el
// entrante venía vacío— dan final === entrante o no generan nota.
//
// La ventaja sobre un SELECT previo no es de rendimiento sino de corrección:
// entre ese SELECT y el upsert podría colarse otra promoción del mismo email, y
// las notas describirían un estado que ya no existía. Acá se comparan el
// candidato y el resultado real de la escritura, sin ventana en el medio.
function detectarConflictos(
  candidato: IngestContactPayload,
  final: PromotedContact,
): PromotionNote[] {
  const notas: PromotionNote[] = [];

  const comparables: [string, string | undefined, string | null][] = [
    // firstName y lastName son NOT NULL en contacts, así que su COALESCE es
    // estructuralmente "gana el CRM": un contacto existente NUNCA cambia de
    // nombre por ingesta. Por eso son los campos donde más importa dejar
    // registro — es donde el dato entrante se descarta siempre.
    ["firstName", candidato.firstName, final.firstName],
    ["lastName", candidato.lastName, final.lastName],
    ["phone", candidato.phone, final.phone],
    ["jobTitle", candidato.jobTitle, final.jobTitle],
  ];

  for (const [campo, entrante, resultado] of comparables) {
    if (entrante !== undefined && resultado !== null && resultado !== entrante) {
      notas.push({ tipo: "conflicto", campo, crm: resultado, entrante });
    }
  }

  // `email` queda AFUERA de la comparación a propósito. El conflicto se arbitró
  // por lower(email), así que si hubo update los dos emails son iguales salvo
  // en mayúsculas — §9.6 decidió conservar la grafía que escribió la persona, y
  // reportar eso como conflicto sería ruido en cada reingreso del mismo lead.
  //
  // `source` también: no viene del payload, lo derivamos nosotros del nombre de
  // la fuente. Un contacto que ya tenía otro origen conserva el suyo (el
  // COALESCE lo garantiza) y anotarlo describiría una decisión nuestra, no un
  // dato que el emisor mandó y se descartó.

  return notas;
}

// Campos que la fuente mandó y la ingesta no escribe NUNCA. Se anotan aunque no
// haya un valor previo que conservar: "nunca sobrescribir en silencio" (§4) es
// una regla sobre lo que se descarta, y un lifecycleStage ignorado se descarta
// igual que un teléfono en conflicto.
function detectarIgnorados(rawPayload: unknown): PromotionNote[] {
  if (typeof rawPayload !== "object" || rawPayload === null) {
    return [];
  }

  const payload = rawPayload as Record<string, unknown>;
  const notas: PromotionNote[] = [];

  for (const campo of CAMPOS_IGNORADOS) {
    const valor = payload[campo];
    if (valor !== undefined && valor !== null && valor !== "") {
      notas.push({
        tipo: "ignorado",
        campo,
        entrante: String(valor),
        motivo:
          "la ingesta no escribe lifecycleStage: al crear queda el default LEAD y sobre un contacto existente no se toca",
      });
    }
  }

  return notas;
}

export async function promoverEvento(
  evento: EventoReclamado,
  db: Db,
): Promise<ResultadoPromocion> {
  // Contrato fijo, sin fieldMapping — ver el encabezado de
  // schemas/ingestContact.schema.ts para por qué, y para la contradicción del
  // documento que hubo que resolver antes de escribir esto.
  const parseado = ingestContactSchema.safeParse(evento.rawPayload);

  if (!parseado.success) {
    // LA FILA MALA SE MARCA Y EL LOTE SIGUE (§5). No se lanza: un throw acá
    // abortaría la transacción y dejaría el evento en PENDING para reintentarlo
    // eternamente contra un payload que nunca va a mejorar solo.
    const errorMessage = parseado.error.issues
      .map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`)
      .join(", ");

    await markEventFailed(evento.id, evento.organizationId, errorMessage, db);
    return { estado: "FAILED", errorMessage };
  }

  const candidato = parseado.data;

  const contacto = await promoteContact(
    {
      organizationId: evento.organizationId,
      firstName: candidato.firstName,
      lastName: candidato.lastName,
      email: candidato.email,
      phone: candidato.phone,
      jobTitle: candidato.jobTitle,
      source: nombreDeFuente(evento.sourceName),
    },
    db,
  );

  const notas: PromotionNote[] = [
    ...detectarIgnorados(evento.rawPayload),
    ...detectarConflictos(candidato, contacto),
  ];

  // §4: "Contactos sin email no se deduplican automáticamente. Se promueven
  // como nuevos y SE MARCAN PARA REVISIÓN MANUAL." La marca va acá y no en el
  // repositorio porque es una afirmación sobre el evento, no sobre el contacto.
  if (candidato.email === undefined) {
    notas.push({
      tipo: "revision_manual",
      motivo:
        "el payload no trae email: el contacto se promovió como nuevo sin deduplicar, puede ser un duplicado de uno existente",
    });
  }

  await markEventProcessed(
    evento.id,
    evento.organizationId,
    contacto.id,
    notas,
    db,
  );

  return { estado: "PROCESSED", contactId: contacto.id, notas };
}
