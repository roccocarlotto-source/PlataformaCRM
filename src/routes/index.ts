import { Router } from "express";
import { activityRouter } from "./activity.routes";
import { apiKeyRouter } from "./apiKey.routes";

import { branchRouter } from "./branch.routes";
import { companyRouter } from "./company.routes";
import { contactRouter } from "./contact.routes";
import { healthRouter } from "./health.routes";
import { importRouter } from "./import.routes";
import { ingestionEventRouter } from "./ingestionEvent.routes";
import { invitationRouter } from "./invitation.routes";
import { meRouter } from "./me.routes";
import { onboardingRouter } from "./onboarding.routes";
import { opportunityRouter } from "./opportunity.routes";

import { resourceRouter } from "./resource.routes";

import { serviceTypeRouter } from "./serviceType.routes";
import { pipelineRouter } from "./pipeline.routes";
import { sourceRouter } from "./source.routes";
import { stageRouter } from "./stage.routes";
import { userRouter } from "./user.routes";

// Agrega acá cada router nuevo a medida que se implementen entidades del CRM.
// /health queda sin prefijo (convención de health checks); las rutas de
// negocio van bajo /api.
export const routes = Router();

routes.use(healthRouter);
routes.use("/api", onboardingRouter);
routes.use("/api", meRouter);
routes.use("/api", companyRouter);
routes.use("/api", contactRouter);
routes.use("/api", pipelineRouter);
routes.use("/api", stageRouter);
routes.use("/api", opportunityRouter);
routes.use("/api", activityRouter);
routes.use("/api", invitationRouter);
routes.use("/api", userRouter);

// Capa de ingesta (docs/ingestion-architecture.md). Todo lo que se monta acá
// va por el camino de auth EXISTENTE —authenticate + authorize("ADMIN")— y por
// eso vive junto al resto de las rutas administrativas:
//
//   - sourceRouter / apiKeyRouter: administración de las fuentes y de sus
//     claves de ingesta.
//   - importRouter: la subida de Excel/CSV del ítem 5. Es la SEGUNDA vía de
//     entrada de datos y no usa API key en ningún momento: del otro lado hay
//     una persona autenticada, así que hay userId, rol y membresía que
//     chequear. Su cuerpo es multipart/form-data y lo lee multer, el único que
//     lo toca —express.json() solo mira application/json y express.urlencoded()
//     solo application/x-www-form-urlencoded—, así que no tiene ninguna
//     dependencia de orden que resolver y le corresponde estar acá con las
//     demás.
//
// LA VÍA QUE NO ESTÁ ACÁ es ingestRouter (el webhook del ítem 4: API key, sin
// usuario detrás). Se monta a mano en app.ts, ANTES del express.json() global,
// y esa posición no es cosmética: body-parser marca el request al parsearlo, así
// que montado después su propio express.json() de 64 KB nunca correría. Ver el
// comentario de app.ts.
routes.use("/api", sourceRouter);
routes.use("/api", apiKeyRouter);
routes.use("/api", importRouter);

// Módulo de Agenda/Booking (docs/booking-architecture.md), primer tramo: las

// entidades de configuración. Van acá, con el resto de las rutas

// administrativas, porque comparten exactamente su forma — authenticate para

// leer, authorize("ADMIN") para escribir. Booking y la disponibilidad todavía

// no existen.

routes.use("/api", branchRouter);

routes.use("/api", resourceRouter);

routes.use("/api", serviceTypeRouter);
// ingestionEventRouter: lectura de la cola y reproceso de una fila fallida
// (G-1/G-2/G-7 de docs/research-frontend-ingesta-2026-08-27.md). Va acá, con las
// demás rutas administrativas, por la misma razón que importRouter: del otro
// lado hay una persona autenticada, no una API key. Su cuerpo es JSON (de hecho
// vacío en el retry), así que no tiene ninguna dependencia de orden con el
// express.json() global.
routes.use("/api", ingestionEventRouter);
