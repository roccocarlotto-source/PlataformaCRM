import { z } from "zod";

// ---------------------------------------------------------------------------
// EL CONTRATO DE PAYLOAD DEL WEBHOOK DE LANDING PAGE (ítem 4 de
// docs/ingestion-architecture.md §6).
//
// La forma es FIJA: las claves del payload son los nombres de campo de
// `Contact`. No se consulta `Source.fieldMapping`, y esa columna sigue en null
// y sin exponer.
//
// POR QUÉ, porque el documento y la bitácora decían cosas distintas y esto se
// preguntó antes de implementar:
//
//   §6.5 describe el ítem 5 (Excel/CSV) como "reusa staging y promoción; LO
//   NUEVO es parseo, MAPEO DE COLUMNAS y volumen". La misma frase enumera qué
//   se reusa y qué es nuevo, y pone el mapeo del lado nuevo. Un Excel trae
//   columnas arbitrarias que alguien tituló a mano; un webhook es una
//   integración cuyo contrato definimos nosotros, así que no necesita mapa.
//
//   §6.4, además, describe este ítem como "el caso más simple: un payload, un
//   contacto".
//
// La bitácora del 2026-08-24 §13 dice en cambio que `fieldMapping` la escribe
// el ítem 4. Se resolvió a favor del documento, que es la autoridad declarada
// (§0), y con un argumento práctico que no admite vuelta: el ítem 3 excluyó
// `fieldMapping` del POST y del PATCH de /api/sources a propósito, así que hoy
// NO HAY FORMA DE POBLARLA. Consumirla desde acá sería una rama que ningún test
// puede ejercitar de punta a punta.
//
// CONSECUENCIA QUE HAY QUE TENER PRESENTE: una landing page tiene que emitir
// `firstName` y `lastName`. Un formulario que mande un solo campo "nombre"
// produce filas FAILED, no contactos. Es el comportamiento correcto para esta
// etapa (§5: la fila mala se marca y el lote sigue), pero es una restricción
// real sobre el emisor y no un detalle de implementación.
//
// LAS CLAVES DESCONOCIDAS NO SON UN ERROR: se ignoran. El payload completo
// queda igual en `rawPayload`, intacto, así que nada se pierde y el ítem 5
// puede reprocesar con otro criterio. Rechazar por un campo de más convertiría
// cualquier agregado del emisor en una caída de la integración.
// ---------------------------------------------------------------------------

// Un string opcional que trata "" y "   " como AUSENTE, no como valor.
//
// Es la mitad de "un campo entrante nulo o VACÍO nunca pisa un valor existente"
// (§4) que tiene que resolverse antes del SQL: si un formulario manda
// `"phone": ""` —lo que hace cualquier form con un input no completado— y eso
// llegara como cadena vacía, el COALESCE del upsert la trataría como un valor y
// pisaría el teléfono que una persona cargó a mano. Se normaliza acá, una sola
// vez, y no en cada rama del merge.
function opcional(max: number, campo: string) {
  return z
    .string()
    .trim()
    .max(max, `${campo} no puede superar los ${max} caracteres`)
    .optional()
    .transform((valor) => (valor === undefined || valor === "" ? undefined : valor));
}

export const ingestContactSchema = z.object({
  // Requeridos porque las columnas son NOT NULL. Los largos replican los
  // VarChar de `contacts` para que un valor excedido se marque FAILED con un
  // mensaje legible en vez de reventar contra Postgres.
  firstName: z
    .string()
    .trim()
    .min(1, "firstName es requerido")
    .max(100, "firstName no puede superar los 100 caracteres"),
  lastName: z
    .string()
    .trim()
    .min(1, "lastName es requerido")
    .max(100, "lastName no puede superar los 100 caracteres"),

  // .trim() y NO .toLowerCase(), igual que normalizeEmail en contact.service.ts
  // y por la razón de §9.6: el case lo garantiza el índice sobre lower(email),
  // los espacios no —lower(' x ') no es lower('x')— y encima hay un CHECK
  // (contacts_email_trimmed_check) que rechaza el email sin recortar. Si esta
  // promoción no recortara, la fila fallaría contra el CHECK en vez de entrar.
  //
  // El formato se valida igual que en el camino HTTP: un email con typo se
  // marca FAILED y queda consultable (§5), que es mejor que guardarlo y
  // deduplicar mal para siempre.
  email: z
    .string()
    .trim()
    .email("email inválido")
    .max(255, "email no puede superar los 255 caracteres")
    .optional()
    .transform((valor) => (valor === undefined || valor === "" ? undefined : valor)),

  phone: opcional(30, "phone"),
  jobTitle: opcional(100, "jobTitle"),
});

export type IngestContactPayload = z.infer<typeof ingestContactSchema>;

// Campos que la ingesta reconoce pero NUNCA escribe. Se listan para poder
// dejar constancia en promotionNotes de que llegaron y se ignoraron: "nunca en
// silencio" (§4) aplica también cuando no hay un valor previo que conservar.
//
// lifecycleStage: decisión de esta etapa — la ingesta no lo escribe en ningún
// caso. Al crear queda el default LEAD de la columna; sobre un contacto
// existente no se toca nunca. §4 solo dice que no puede DEGRADARSE, y para
// implementar eso haría falta un orden total entre los cinco estados que el
// documento no define. No escribirlo cumple la regla sin inventar ese orden.
export const CAMPOS_IGNORADOS = ["lifecycleStage"] as const;
