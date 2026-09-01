import { IngestionStatus, SourceType } from "@prisma/client";
import { promoteContact, type PromotedContact } from "../repositories/contact.repository";
import {
  markEventFailed,
  markEventProcessed,
  type EventoReclamado,
} from "../repositories/ingestionEvent.repository";
import type { Db } from "../lib/prisma";
import { fieldMappingSchema } from "../schemas/fieldMapping.schema";
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

// ---------------------------------------------------------------------------
// TRADUCCIÓN POR fieldMapping (ítem 5) — OCURRE ACÁ, NO AL PARSEAR EL ARCHIVO.
//
// Es la mitad que hace válido el principio rector de §1. En staging la fila
// quedó guardada con sus encabezados ORIGINALES ("Nombre", "Mail"), sin
// traducir; la traducción se aplica recién al promover, contra el fieldMapping
// que la Source tiene AHORA.
//
// Consecuencia buscada: si el mapeo estaba mal, se corrige el mapeo y se vuelve
// a promover el mismo evento — que es literalmente lo que §1 promete, "corregir
// un mapeo y volver a correrlo". Si la traducción hubiera ocurrido al parsear,
// el dato original ya no existiría y habría que pedir el archivo de nuevo.
//
// El WEBHOOK no pasa por acá: su payload ya viene con los nombres del contrato
// fijo, así que se valida directo, exactamente igual que antes del ítem 5.
// ---------------------------------------------------------------------------

type ResultadoTraduccion =
  { ok: true; datos: Record<string, unknown> } | { ok: false; motivo: string };

// Los valores de una planilla no son siempre texto: una columna de teléfonos
// llega como number si Excel decidió que parecía un número, y una fecha como
// ISO. ingestContactSchema espera strings, así que los primitivos se convierten.
// null y undefined se dejan caer: el schema ya trata lo ausente como ausente,
// que es la mitad de "un campo entrante vacío nunca pisa" (§4).
function comoTextoDeCelda(valor: unknown): unknown {
  if (valor === null || valor === undefined) return undefined;
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  return valor;
}

// Exportada para probar su frontera sin base ni worker (B-28), mismo criterio
// que listContactsQuerySchema en contact.controller.ts (B-21). Producción la
// llama solo desde prepararCandidato.
export function traducirConMapeo(rawPayload: unknown, fieldMapping: unknown): ResultadoTraduccion {
  // EL MAPEO SE REVALIDA ACÁ AUNQUE EL PATCH YA LO HAYA VALIDADO, y no es
  // paranoia: field_mapping es una columna JSONB, y cualquier escritura directa
  // a la base —una migración de datos, un arreglo manual en producción— puede
  // dejar ahí algo que el endpoint jamás habría aceptado. Sin esta
  // revalidación, un destino no reconocido intentaría escribir una columna
  // inexistente de Contact y el error saldría como un fallo de SQL sin relación
  // aparente con la configuración que lo causó.
  const mapeo = fieldMappingSchema.safeParse(fieldMapping);

  if (!mapeo.success) {
    const detalle = mapeo.error.issues.map((issue) => issue.message).join(", ");
    return { ok: false, motivo: `el fieldMapping de la fuente es inválido: ${detalle}` };
  }

  if (typeof rawPayload !== "object" || rawPayload === null || Array.isArray(rawPayload)) {
    return { ok: false, motivo: "la fila guardada no es un objeto" };
  }

  const fila = rawPayload as Record<string, unknown>;
  const datos: Record<string, unknown> = {};
  const columnasAusentes: string[] = [];

  for (const [encabezado, destino] of Object.entries(mapeo.data)) {
    // Object.hasOwn y NO `in` — B-28 de docs/auditoria-2026-08-29.md. `in`
    // recorre toda la cadena de prototipos: con una columna origen llamada
    // "constructor" (o "toString", "hasOwnProperty"…) en el mapeo, `"constructor"
    // in fila` daba true aunque la fila no la tuviera, y fila["constructor"]
    // —la función Object heredada— seguía de largo por comoTextoDeCelda hasta
    // datos[destino]. La fila viene de JSON.parse (el rawPayload guardado), así
    // que lo que hay que corregir es la pregunta, no el objeto.
    if (!(encabezado in fila)) {
      // MUTACIÓN — NO MERGEAR
      columnasAusentes.push(encabezado);
      continue;
    }
    const valor = comoTextoDeCelda(fila[encabezado]);
    if (valor !== undefined) {
      datos[destino] = valor;
    }
  }

  // Un mapeo cuyas columnas NO EXISTEN en el archivo es el error de
  // configuración más probable de todo el ítem: una tilde, una mayúscula, un
  // espacio invisible. Sin este mensaje se manifestaría como "firstName es
  // requerido", que manda a mirar el archivo cuando el problema está en el
  // mapeo. Solo se reporta si NINGUNA columna matcheó — que sobre una columna
  // mapeada en un archivo que no la trae es normal y no es un error.
  if (Object.keys(datos).length === 0 && columnasAusentes.length > 0) {
    return {
      ok: false,
      motivo:
        `ninguna columna del fieldMapping existe en esta fila (se buscaban: ` +
        `${columnasAusentes.join(", ")}); revisá que los encabezados del archivo coincidan exactamente`,
    };
  }

  return { ok: true, datos };
}

// Decide qué recibe ingestContactSchema para validar.
//
//   FILE_IMPORT CON mapeo  -> la fila traducida.
//   FILE_IMPORT SIN mapeo  -> la fila tal cual. No es un caso de error: un
//     archivo cuyos encabezados YA son firstName/lastName/email/... no necesita
//     mapa, y exigir uno igual sería burocracia. Que funcione sin configurar
//     nada es además el camino más corto para probar una importación.
//   WEBHOOK / EXTERNAL_DB  -> la fila tal cual, sin ningún cambio de
//     comportamiento respecto del ítem 4.
function prepararCandidato(evento: EventoReclamado): ResultadoTraduccion {
  const usaMapeo =
    evento.sourceType === SourceType.FILE_IMPORT &&
    evento.fieldMapping !== null &&
    evento.fieldMapping !== undefined;

  if (!usaMapeo) {
    return { ok: true, datos: evento.rawPayload as Record<string, unknown> };
  }

  return traducirConMapeo(evento.rawPayload, evento.fieldMapping);
}

// ---------------------------------------------------------------------------
// EL COMPARE-AND-SWAP DE LA TRANSICIÓN SOLO PROTEGE SI ALGUIEN MIRA SU
// RESULTADO. Hallazgo E-1 de docs/review-ingesta-2026-08-27.md.
//
// markEventProcessed y markEventFailed son `updateMany` con `status: PENDING`
// en el WHERE — un CAS deliberado (ver ingestionEvent.repository.ts). Un
// `updateMany` que no matchea ninguna fila NO LANZA: devuelve `count: 0` y la
// ejecución sigue. Mientras ese count se descartaba, la red de seguridad estaba
// inerte: la transacción commiteaba con el Contact ya escrito y el evento
// seguía en PENDING. En el camino SIN EMAIL eso era lo más caro que podía
// pasar — promoteContact hace un INSERT liso (sin ON CONFLICT, porque el índice
// es parcial), así que cada pasada del worker habría creado OTRO contacto,
// indefinidamente.
//
// Hoy el CAS no puede fallar: claimNextPendingEvent toma FOR UPDATE sobre la
// fila dentro de ESTA misma transacción y filtra `status = 'PENDING'`, así que
// nadie puede cambiarla entremedio. Este chequeo no arregla un bug alcanzable;
// hace que el invariante siga valiendo el día que alguien cambie el mecanismo
// de reclamo, que es exactamente lo que el CAS decía cubrir.
//
// SE LANZA UN Error PELADO, NO UN AppError: esto corre en el worker, no en un
// request, así que no hay status HTTP que asignar. drenarPendientes lo atrapa
// como error de SISTEMA (no como fila mala): revierte la transacción —el
// Contact no queda huérfano— y pospone el evento para la próxima pasada. Ver el
// catch de workers/ingestionWorker.ts.
//
// No hay riesgo de bucle: si el CAS no matcheó es porque la fila ya no está en
// PENDING, así que el siguiente claimNextPendingEvent no la vuelve a elegir.
// ---------------------------------------------------------------------------
function exigirTransicion(count: number, evento: EventoReclamado, destino: IngestionStatus): void {
  if (count === 0) {
    throw new Error(
      `promoverEvento: la transición a ${destino} del evento ${evento.id} no afectó ninguna fila ` +
        "— ya no estaba en PENDING al momento de escribir. Se revierte la transacción para no " +
        "dejar un Contact promovido sin su IngestionEvent actualizado (E-1, " +
        "docs/review-ingesta-2026-08-27.md).",
    );
  }
}

export async function promoverEvento(evento: EventoReclamado, db: Db): Promise<ResultadoPromocion> {
  // La traducción por fieldMapping ocurre ANTES de validar y DESPUÉS de
  // staging — ver el bloque de arriba. Para el webhook es un paso transparente:
  // devuelve el rawPayload tal cual, con el contrato fijo del ítem 4.
  const preparado = prepararCandidato(evento);

  if (!preparado.ok) {
    // Un mapeo roto es una FILA MALA, no un error de sistema: se marca y el
    // lote sigue (§5). Si se tratara como error de sistema, el evento quedaría
    // en PENDING reintentándose contra una configuración que no se arregla
    // sola.
    const marcado = await markEventFailed(evento.id, evento.organizationId, preparado.motivo, db);
    exigirTransicion(marcado.count, evento, IngestionStatus.FAILED);
    return { estado: "FAILED", errorMessage: preparado.motivo };
  }

  const parseado = ingestContactSchema.safeParse(preparado.datos);

  if (!parseado.success) {
    // LA FILA MALA SE MARCA Y EL LOTE SIGUE (§5). No se lanza: un throw acá
    // abortaría la transacción y dejaría el evento en PENDING para reintentarlo
    // eternamente contra un payload que nunca va a mejorar solo.
    const errorMessage = parseado.error.issues
      .map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`)
      .join(", ");

    const marcado = await markEventFailed(evento.id, evento.organizationId, errorMessage, db);
    exigirTransicion(marcado.count, evento, IngestionStatus.FAILED);
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

  const marcado = await markEventProcessed(
    evento.id,
    evento.organizationId,
    contacto.id,
    notas,
    db,
  );
  exigirTransicion(marcado.count, evento, IngestionStatus.PROCESSED);

  return { estado: "PROCESSED", contactId: contacto.id, notas };
}
