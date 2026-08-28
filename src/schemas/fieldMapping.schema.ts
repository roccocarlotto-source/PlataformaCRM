import { z } from "zod";
import { CAMPOS_DE_CONTACTO } from "./ingestContact.schema";

// ---------------------------------------------------------------------------
// LA FORMA DE Source.fieldMapping (ítem 5 de docs/ingestion-architecture.md).
//
// Un mapa plano: ENCABEZADO DEL ARCHIVO -> CAMPO DE Contact.
//
//   { "Nombre": "firstName", "Apellido": "lastName", "Mail": "email" }
//
// Se eligió la forma más chica que resuelve el problema del ítem 5 —"lo nuevo
// es parseo, mapeo de columnas y volumen" (§6.5)— y nada más. Un objeto por
// columna con transformaciones, valores por defecto o tipos habría sido
// inventar un lenguaje de mapeo para necesidades que todavía no existen, que es
// exactamente lo que el ítem 3 evitó al no definir esta columna sin un archivo
// real enfrente.
//
// La dirección es archivo -> Contact y no al revés, y no es indistinto: un
// archivo puede traer 40 columnas de las que nos interesan 4, así que las
// claves son el conjunto grande y variable. Al revés obligaría a enumerar
// siempre los 5 campos aunque el archivo solo tenga 2.
//
// LOS DESTINOS SON EXACTAMENTE LOS 5 CAMPOS QUE ingestContactSchema RECONOCE.
// No se agrega ningún campo de Contact nuevo por esta puerta: cambia cómo se
// llega al contrato, nunca el contrato.
// ---------------------------------------------------------------------------

// Tope de columnas mapeadas. No es una regla de negocio: es el límite que
// impide que alguien guarde un JSONB arbitrariamente grande en una columna que
// después se lee en CADA promoción de CADA fila de esa fuente.
export const MAX_COLUMNAS_MAPEADAS = 50;

// Un encabezado de planilla no debería ser más largo que esto. El tope existe
// por la misma razón que el de arriba.
const MAX_LARGO_ENCABEZADO = 255;

// MISMA REGLA QUE ingestContactSchema: todo mensaje de acá tiene que ser
// custom, nunca el default de zod (D2-7 de docs/review-fase2-2026-08-28.md).
//
// Aplica aunque este schema valide configuración y no datos de una persona:
// promotion.service.ts lo REVALIDA en cada promoción (traducirConMapeo) y
// concatena sus issue.message en el mismo IngestionEvent.errorMessage que
// viaja al navegador. El `errorMap` del z.enum de abajo no es cosmético — sin
// él, el default de zod diría "received '<el valor real>'".
export const fieldMappingSchema = z
  .record(
    z
      .string()
      .trim()
      .min(1, "el encabezado de origen no puede estar vacío")
      .max(
        MAX_LARGO_ENCABEZADO,
        `el encabezado de origen no puede superar los ${MAX_LARGO_ENCABEZADO} caracteres`,
      ),
    z.enum(CAMPOS_DE_CONTACTO, {
      errorMap: () => ({
        message: `el destino de un mapeo debe ser uno de: ${CAMPOS_DE_CONTACTO.join(", ")}`,
      }),
    }),
  )
  .superRefine((mapa, ctx) => {
    const entradas = Object.entries(mapa);

    if (entradas.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "fieldMapping no puede ser un objeto vacío: para no mapear nada, omitilo o mandá null",
      });
      return;
    }

    if (entradas.length > MAX_COLUMNAS_MAPEADAS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `fieldMapping no puede tener más de ${MAX_COLUMNAS_MAPEADAS} columnas`,
      });
    }

    // DOS COLUMNAS AL MISMO DESTINO SE RECHAZAN. No hay forma correcta de
    // resolverlo: cuál gana dependería del orden de las claves de un objeto
    // JSON, que no es un criterio que nadie haya elegido. Es mejor un 400 al
    // configurar que una regla arbitraria aplicada en silencio a cada fila.
    const destinos = entradas.map(([, destino]) => destino);
    const repetidos = [...new Set(destinos.filter((d, i) => destinos.indexOf(d) !== i))];

    if (repetidos.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `dos columnas no pueden mapear al mismo campo: ${repetidos.join(", ")}`,
      });
    }
  });

export type FieldMapping = z.infer<typeof fieldMappingSchema>;
