import { Router } from "express";
import {
  importarArchivoHandler,
  resumenDeLoteHandler,
} from "../controllers/import.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { importUpload } from "../middlewares/importUpload";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";

export const importRouter = Router();

// ---------------------------------------------------------------------------
// Importación de archivos (ítem 5 de docs/ingestion-architecture.md §6).
//
// CAMINO DE AUTENTICACIÓN EXISTENTE: authenticate + authorize("ADMIN"), igual
// que source.routes.ts y apiKey.routes.ts. NO usa authenticateApiKey ni
// IngestContext, y la distinción no es un detalle: ese es el camino SIN usuario
// de §3, para una landing page que no tiene a nadie del otro lado. Acá hay una
// persona autenticada subiendo un archivo, así que hay userId, hay rol y hay
// membresía que chequear — que es exactamente lo que ese otro camino no puede
// ofrecer. Una Source de tipo FILE_IMPORT no necesita tener nunca una ApiKey.
//
// RUTAS PLANAS bajo /api/imports, no anidadas en /sources/:sourceId/imports —
// misma convención que documenta apiKey.routes.ts. sourceId viaja como campo
// del multipart en el POST, que en un formulario no cuesta nada.
//
// businessWriteRateLimiter en el POST, como toda escritura del proyecto: va
// después de authenticate (necesita req.auth.userId) y antes de authorize. El
// GET no lo lleva, mismo criterio que el resto de los routers.
//
// importUpload va DESPUÉS de authorize a propósito: parsear un multipart de
// 10 MB es el trabajo más caro de la cadena, y no hay ninguna razón para
// hacerlo por alguien que todavía no probó ser un ADMIN de la organización. Es
// la decisión inversa a la del webhook —donde el parser va antes de
// authenticateApiKey— y la diferencia es deliberada: allá el cuerpo son 64 KB y
// el objetivo era que un cuerpo enorme muriera antes de gastar un SELECT; acá
// el cuerpo es grande por diseño y quien lo manda ya tiene sesión.
// ---------------------------------------------------------------------------
importRouter.post(
  "/imports",
  authenticate,
  businessWriteRateLimiter,
  authorize("ADMIN"),
  importUpload,
  importarArchivoHandler,
);

importRouter.get(
  "/imports/:batchId",
  authenticate,
  authorize("ADMIN"),
  resumenDeLoteHandler,
);
