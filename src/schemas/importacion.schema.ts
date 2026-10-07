import { z } from "zod";
import {
  DESTINOS_DE_CONTACTO,
  DESTINOS_DE_EMPRESA,
  DESTINOS_DE_HISTORIAL,
  DESTINOS_DE_STOCK,
  COMBUSTIBLES,
  CONDICIONES,
  ESTADOS_DE_STOCK,
  TRANSMISIONES,
  LIFECYCLE_STAGES,
  TIPOS_DE_HISTORIAL,
  PREFIJO_CAMPO_PERSONALIZADO,
  type AjustesDeImportacion,
  type TipoImportable,
} from "../utils/importacionMapeo";
import {
  FORMATOS_DE_FECHA,
  SEPARADORES_DE_OPCIONES,
  SI_NO_POR_DEFECTO,
} from "../utils/importacionValores";
import { CODIFICACIONES, SEPARADORES } from "../utils/spreadsheet";

// ---------------------------------------------------------------------------
// Bordes HTTP del asistente de importación (docs/importacion-de-datos.md §8).
// ---------------------------------------------------------------------------

export const TIPOS_IMPORTABLES = [
  "COMPANY",
  "CONTACT",
  "ACTIVITY",
  "VEHICLE",
] as const satisfies readonly TipoImportable[];

// Los campos de texto del multipart de POST .../imports. El archivo va aparte
// (multer). lectura: la forma de leer el CSV o el XLSX, para volver a leerlo
// con otro separador, otra codificación u otra hoja (el archivo original no se
// guarda, decisión 19: se vuelve a subir).
export const subirImportacionSchema = z
  .object({
    entityType: z.enum(TIPOS_IMPORTABLES),
    sourceId: z.string().uuid("sourceId inválido").optional(),
    sourceName: z.string().trim().min(1).max(255).optional(),
    separador: z.enum(SEPARADORES).optional(),
    codificacion: z.enum(CODIFICACIONES).optional(),
    hoja: z.string().trim().min(1).max(100).optional(),
  })
  .refine((v) => (v.sourceId === undefined) !== (v.sourceName === undefined), {
    message:
      "Mandá sourceId (un sistema de origen existente) o sourceName (uno nuevo), uno de los dos",
  });

// POST .../imports/sheets: un link de Google Sheets en vez de un archivo.
export const subirSheetsSchema = z
  .object({
    entityType: z.enum(TIPOS_IMPORTABLES),
    sourceId: z.string().uuid("sourceId inválido").optional(),
    sourceName: z.string().trim().min(1).max(255).optional(),
    sheetUrl: z.string().trim().min(1).max(2048),
  })
  .refine((v) => (v.sourceId === undefined) !== (v.sourceName === undefined), {
    message:
      "Mandá sourceId (un sistema de origen existente) o sourceName (uno nuevo), uno de los dos",
  });

const MAX_COLUMNAS_MAPEADAS = 200;

function destinosDe(tipo: TipoImportable): readonly string[] {
  if (tipo === "CONTACT") return DESTINOS_DE_CONTACTO;
  if (tipo === "ACTIVITY") return DESTINOS_DE_HISTORIAL;
  if (tipo === "VEHICLE") return DESTINOS_DE_STOCK;
  return DESTINOS_DE_EMPRESA;
}

const NOMBRE_DEL_TIPO: Record<TipoImportable, string> = {
  CONTACT: "contactos",
  COMPANY: "empresas",
  ACTIVITY: "historial",
  VEHICLE: "stock",
};

// Lo propio de un lote de stock (§5.4): la sucursal de las unidades nuevas,
// quién firma los cambios en el historial de la ficha (la sucursal y el
// usuario los valida el service contra la organización), los valores por
// defecto y qué es cada valor del origen.
const valoresDe = <T extends readonly [string, ...string[]]>(permitidos: T) =>
  z.record(z.string().min(1).max(100), z.enum(permitidos)).default({});
const stockSchema = z.object({
  branchId: z.string().uuid("branchId inválido"),
  responsableId: z.string().uuid("responsableId inválido"),
  condicionPorDefecto: z.enum(CONDICIONES).default("USED"),
  monedaPorDefecto: z.enum(["USD", "LOCAL"]).default("USD"),
  importarVendidas: z.boolean().default(false),
  estados: valoresDe(ESTADOS_DE_STOCK),
  condiciones: valoresDe(CONDICIONES),
  combustibles: valoresDe(COMBUSTIBLES),
  transmisiones: valoresDe(TRANSMISIONES),
});

// Lo propio de un lote de historial (§5.3): quién figura como autor
// (decisión 5; que sea un usuario de la organización lo valida el service),
// el tipo por defecto y qué tipo es cada valor del origen.
const historialSchema = z.object({
  autorId: z.string().uuid("autorId inválido"),
  tipoPorDefecto: z.enum(TIPOS_DE_HISTORIAL).optional(),
  tipos: z.record(z.string().min(1).max(100), z.enum(TIPOS_DE_HISTORIAL)).default({}),
});

// PUT .../imports/:batchId/config. El mapeo se valida acá contra el catálogo de
// destinos; contra los encabezados del archivo y los campos personalizados de la
// organización lo valida el service, que los tiene.
export function crearAjustesSchema(tipo: TipoImportable) {
  const destinos = destinosDe(tipo);
  return z
    .object({
      mapeo: z
        .record(z.string().min(1).max(255), z.string().min(1).max(100))
        .refine((m) => Object.keys(m).length <= MAX_COLUMNAS_MAPEADAS, {
          message: `Se pueden mapear hasta ${MAX_COLUMNAS_MAPEADAS} columnas`,
        }),
      formato: z
        .object({
          fecha: z.enum(FORMATOS_DE_FECHA).default("DD/MM/AAAA"),
          separadorDecimal: z.enum([",", "."]).default(","),
          si: z
            .array(z.string().trim().min(1).max(30))
            .max(20)
            .default([...SI_NO_POR_DEFECTO.si]),
          no: z
            .array(z.string().trim().min(1).max(30))
            .max(20)
            .default([...SI_NO_POR_DEFECTO.no]),
          separadorDeOpciones: z.enum(SEPARADORES_DE_OPCIONES).default(";"),
        })
        .default({}),
      etapas: z.record(z.string().min(1).max(100), z.enum(LIFECYCLE_STAGES)).default({}),
      duplicados: z.enum(["FILL_EMPTY", "OVERWRITE", "SKIP"]).default("FILL_EMPTY"),
      crearEmpresas: z.boolean().default(true),
      historial: tipo === "ACTIVITY" ? historialSchema : historialSchema.optional(),
      stock: tipo === "VEHICLE" ? stockSchema : stockSchema.optional(),
    })
    .superRefine((ajustes, ctx) => {
      const vistos = new Set<string>();
      for (const [encabezado, destino] of Object.entries(ajustes.mapeo)) {
        const esPersonalizado =
          tipo === "CONTACT" && destino.startsWith(PREFIJO_CAMPO_PERSONALIZADO);
        if (!esPersonalizado && !destinos.includes(destino)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["mapeo", encabezado],
            message: `«${destino}» no es un destino de ${NOMBRE_DEL_TIPO[tipo]}`,
          });
        }
        if (vistos.has(destino)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["mapeo", encabezado],
            message: `Dos columnas apuntan a «${destino}»`,
          });
        }
        vistos.add(destino);
      }
      if (tipo === "CONTACT") {
        const conNombre =
          vistos.has("fullName") || (vistos.has("firstName") && vistos.has("lastName"));
        if (!conNombre) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["mapeo"],
            message: "Falta mapear el nombre: nombre y apellido, o nombre completo",
          });
        }
        if (vistos.has("fullName") && (vistos.has("firstName") || vistos.has("lastName"))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["mapeo"],
            message: "Mapeá nombre completo, o nombre y apellido por separado, no los dos",
          });
        }
      } else if (tipo === "ACTIVITY") {
        if (!["contactExternalId", "contactEmail", "contactPhone"].some((d) => vistos.has(d))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["mapeo"],
            message: "Falta mapear a qué contacto va: el id del origen, el email o el teléfono",
          });
        }
        if (!vistos.has("type") && !ajustes.historial?.tipoPorDefecto) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["historial", "tipoPorDefecto"],
            message: "Mapeá la columna del tipo o elegí un tipo para todo el archivo",
          });
        }
      } else if (tipo === "VEHICLE") {
        for (const [destino, nombre] of [
          ["make", "la marca"],
          ["model", "el modelo"],
          ["year", "el año"],
        ] as const) {
          if (!vistos.has(destino)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["mapeo"],
              message: `Falta mapear ${nombre}`,
            });
          }
        }
      } else if (!vistos.has("name")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mapeo"],
          message: "Falta mapear el nombre de la empresa",
        });
      }
    }) satisfies z.ZodType<AjustesDeImportacion, z.ZodTypeDef, unknown>;
}

export const decidirFilasSchema = z.object({
  rowIds: z.array(z.string().uuid()).min(1).max(500),
  // null: volver a la política general del lote.
  decision: z.enum(["FILL_EMPTY", "OVERWRITE", "SKIP"]).nullable(),
});

export const TIPOS_DE_PLAN = ["CREATE", "UPDATE", "CONFLICT", "UNCHANGED", "SKIP", "FAIL"] as const;

export const listarFilasSchema = z.object({
  tipo: z.enum(TIPOS_DE_PLAN).optional(),
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

export const listarLotesSchema = z.object({
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
