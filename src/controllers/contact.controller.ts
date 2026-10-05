import {
  CAMPOS_DE_LA_UNION,
  contactoDespuesDeUnir,
  unirContactos,
  vistaPreviaDeLaUnion,
  type CampoDeLaUnion,
} from "../services/contactMerge.service";
import type { Response } from "express";
import { z } from "zod";
import { logAccesoADatosPersonales } from "../lib/accessLog";
import {
  createContact,
  deleteContact,
  erasePersonalData,
  getContactById,
  listContacts,
  updateContact,
} from "../services/contact.service";
import { assertPuedeEditar, ownerAlCrear } from "../services/permisosDelVendedor";
import type { AuthenticatedRequest } from "../types/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseOrThrow } from "../utils/validation";

const idParamSchema = z.string().uuid("id inválido");

const lifecycleStageSchema = z.enum(["LEAD", "MQL", "SQL", "CUSTOMER", "CHURNED"]);

// Campos compartidos entre create (firstName/lastName requeridos) y update
// (todos opcionales vía .partial() más abajo). Solo los que NO cambian de
// nulabilidad entre uno y otro; los que sí, van definidos dos veces más abajo.
const contactFields = {
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
  lifecycleStage: lifecycleStageSchema.optional(),
  ownerId: z.string().uuid("ownerId inválido").optional(),
};

// Exportados para testear la frontera del schema sin base ni HTTP
// (contact.controller.test.ts), mismo criterio que opportunity y stage.
export const createContactSchema = z.object({
  ...contactFields,
  email: z
    .string()
    .trim()
    .email("email inválido")
    .max(255, "email no puede superar los 255 caracteres")
    .optional(),
  phone: z.string().trim().max(30, "phone no puede superar los 30 caracteres").optional(),
  jobTitle: z.string().trim().max(100, "jobTitle no puede superar los 100 caracteres").optional(),
  source: z.string().trim().max(100, "source no puede superar los 100 caracteres").optional(),
  companyId: z.string().uuid("companyId inválido").optional(),
});

// M-10 (auditoría 2026-08-29): email/phone/jobTitle/source/companyId son
// .nullable() acá (a diferencia de create): permiten limpiarse
// explícitamente con un `null` en PATCH — `companyId: null` desvincula al
// contacto de su empresa. Sin .nullable(), rebotaban con 400 de Zod antes de
// llegar al service. Mismo patrón que opportunity y activity. El resto del
// camino para `email` y `companyId` está en updateContact (contact.service.ts).
export const updateContactSchema = z
  .object({
    ...contactFields,
    email: z
      .string()
      .trim()
      .email("email inválido")
      .max(255, "email no puede superar los 255 caracteres")
      .nullable()
      .optional(),
    phone: z
      .string()
      .trim()
      .max(30, "phone no puede superar los 30 caracteres")
      .nullable()
      .optional(),
    jobTitle: z
      .string()
      .trim()
      .max(100, "jobTitle no puede superar los 100 caracteres")
      .nullable()
      .optional(),
    source: z
      .string()
      .trim()
      .max(100, "source no puede superar los 100 caracteres")
      .nullable()
      .optional(),
    companyId: z.string().uuid("companyId inválido").nullable().optional(),
    // El vehículo de interés, desde la ficha. null lo quita.
    vehicleOfInterestId: z.string().uuid("vehicleOfInterestId inválido").nullable().optional(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

// Exportado para probar su frontera sin base ni HTTP (B-21), mismo criterio
// que createContactSchema/updateContactSchema con M-10.
export const listContactsQuerySchema = z.object({
  // Tope de cordura, el mismo que ingestionEvent (S2-5) — B-21 de
  // docs-privados/auditoria-2026-08-29.md (local, no está en GitHub): sin él, ?page=999999999 llega a Postgres
  // como un OFFSET gigante que igual hay que recorrer.
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).optional(),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  email: z.string().trim().min(1).optional(),
  companyId: z.string().uuid("companyId inválido").optional(),
  ownerId: z.string().uuid("ownerId inválido").optional(),
  lifecycleStage: lifecycleStageSchema.optional(),
  source: z.string().trim().min(1).optional(),
  sortBy: z.enum(["firstName", "lastName", "createdAt", "lifecycleStage"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const createContactHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const input = parseOrThrow(createContactSchema, req.body);
    // D2: un USER crea contactos, y quedan a su nombre (permisosDelVendedor.ts).
    const contact = await createContact(req.auth.organizationId, req.auth.userId, {
      ...input,
      ownerId: ownerAlCrear(req.auth, input.ownerId),
    });
    res.status(201).json(contact);
  },
);

export const listContactsHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const query = parseOrThrow(listContactsQuerySchema, req.query);
    const result = await listContacts(req.auth.organizationId, query);
    res.status(200).json(result);
  },
);

export const getContactHandler = asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
  const id = parseOrThrow(idParamSchema, req.params.id);
  const contact = await getContactById(req.auth.organizationId, id);
  res.status(200).json(contact);
});

export const updateContactHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(updateContactSchema, req.body);
    // D2: un USER edita solo los contactos que tiene asignados, y no los
    // reasigna. La lectura extra es solo para un USER; el 404 de un contacto
    // que no existe sale de acá igual que antes salía del service.
    if (req.auth.role !== "ADMIN") {
      const actual = await getContactById(req.auth.organizationId, id);
      assertPuedeEditar(req.auth, actual, input.ownerId);
    }
    const contact = await updateContact(req.auth.organizationId, req.auth.userId, id, input);
    res.status(200).json(contact);
  },
);

export const deleteContactHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    await deleteContact(req.auth.organizationId, id);
    res.status(204).send();
  },
);

// ---------------------------------------------------------------------------
// Borrado de datos personales a pedido — D2-4 de
// docs-privados/review-fase2-2026-08-28.md (local, no está en GitHub).
//
// POST y no DELETE, y no es un detalle de gusto: DELETE /api/contacts/:id ya
// existe y significa otra cosa (soft delete, reversible). Dos verbos distintos
// sobre el mismo recurso para dos operaciones que no se parecen es exactamente
// lo que evita que alguien invoque la irreversible creyendo que invoca la otra.
// El sufijo del path la nombra en vez de dejarla implícita en el método.
//
// 200 con un resumen, no 204: la operación es irreversible y quien la pide
// tiene que poder decir qué se borró. `ingestionEventsAnonimizados` es lo que
// el estándar llama borrado verificable.
//
// SE REGISTRA EL ACCESO igual que las lecturas de la capa de ingesta (D2-5).
// Acá pesa más todavía: es la única operación del sistema que destruye datos
// personales sin vuelta atrás, así que quién la pidió y sobre quién es
// justamente lo que hay que poder reconstruir después.
export const erasePersonalDataHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);

    logAccesoADatosPersonales({
      auth: req.auth,
      recurso: "POST /api/contacts/:id/erase-personal-data",
      clase: "Sensitive",
      detalle: { contactId: id, operacion: "borrado_irreversible" },
    });

    const resultado = await erasePersonalData(req.auth.organizationId, id);
    res.status(200).json(resultado);
  },
);

// ---------------------------------------------------------------------------
// Unir contactos duplicados (contactMerge.service.ts). ADMIN-only en la ruta.
// :id es el contacto que QUEDA; el otro es el que se une a él.
// ---------------------------------------------------------------------------

const ladoSchema = z.enum(["kept", "absorbed"]);

const mergePreviewQuerySchema = z.object({
  with: z.string().uuid("with inválido"),
});

const mergeContactSchema = z.object({
  absorbedId: z.string().uuid("absorbedId inválido"),
  // Qué valor queda en cada campo. Lo que no venga, el default: el más
  // reciente no vacío.
  fields: z
    .object(
      Object.fromEntries(
        CAMPOS_DE_LA_UNION.map((campo) => [campo, ladoSchema.optional()]),
      ) as Record<CampoDeLaUnion, z.ZodOptional<typeof ladoSchema>>,
    )
    .strict()
    .default({}),
});

// GET /api/contacts/:id/merge-preview?with=<otro> — los dos lado a lado, la
// elección por defecto de cada campo y cuánto se mueve.
export const mergePreviewHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const { with: otro } = parseOrThrow(mergePreviewQuerySchema, req.query);
    res.status(200).json(await vistaPreviaDeLaUnion(req.auth.organizationId, id, otro));
  },
);

// POST /api/contacts/:id/merge — la unión, en una transacción. 200 con el
// contacto que queda y lo que se movió.
export const mergeContactHandler = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const id = parseOrThrow(idParamSchema, req.params.id);
    const input = parseOrThrow(mergeContactSchema, req.body);
    const resultado = await unirContactos(
      req.auth.userId,
      req.auth.organizationId,
      id,
      input.absorbedId,
      input.fields,
    );
    res.status(200).json({
      ...resultado,
      contact: await contactoDespuesDeUnir(req.auth.organizationId, id),
    });
  },
);
