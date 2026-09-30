import { Router } from "express";
import { createMetaPageConnectionHandlers } from "../controllers/metaPageConnection.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";
import type { ClienteMetaOAuth } from "../services/metaOAuth.service";

// ---------------------------------------------------------------------------
// Conexión de la página de Facebook de la organización (ítem 170). Calco de
// googleCalendarConnection.routes.ts: tres rutas administrativas con el
// esquema de siempre y el callback SIN authenticate ni authorize, en el mismo
// archivo porque son un solo flujo.
//
// Es ADMIN DEL TENANT, no requirePlatformAdmin: el negocio conecta SU página.
// (Lo que sí es de la plataforma es Agent.facebookPageId, ítem 169.)
//
// Factory con el cliente de Meta inyectable para el test de integración;
// producción monta metaPageConnectionRouter, con el real.
// ---------------------------------------------------------------------------

export function createMetaPageConnectionRouter(cliente?: ClienteMetaOAuth) {
  const handlers = createMetaPageConnectionHandlers(cliente);
  const router = Router();

  // Estado de la conexión: cualquier usuario autenticado de la organización,
  // mismo criterio que el GET de Google Calendar. Nunca devuelve el token.
  router.get("/integrations/meta", authenticate, handlers.obtener);

  // Devuelve la URL de autorización en el cuerpo, no un 302 (ver
  // iniciarConexion). POST y con ADMIN + rate limiter porque firma un state
  // que habilita a escribir en el callback. businessWriteRateLimiter va
  // después de authenticate (necesita req.auth.userId) y antes de authorize.
  router.post(
    "/integrations/meta/connect",
    authenticate,
    businessWriteRateLimiter,
    authorize("ADMIN"),
    handlers.conectar,
  );

  // El segundo tramo del flujo (A-07 de docs-privados/auditoria-2026-09-30-corta.md,
  // local): el CRM manda el code y el state que le rebotó el callback. Mismo
  // esquema que conectar, porque es lo que escribe la conexión; el service
  // exige además que el usuario sea el que firmó el state.
  router.post(
    "/integrations/meta/complete",
    authenticate,
    businessWriteRateLimiter,
    authorize("ADMIN"),
    handlers.completar,
  );

  // Desconectar: la fila queda REVOKED y sin token.
  router.delete(
    "/integrations/meta",
    authenticate,
    businessWriteRateLimiter,
    authorize("ADMIN"),
    handlers.desconectar,
  );

  // -------------------------------------------------------------------------
  // EL CALLBACK — SIN authenticate, SIN authorize Y SIN RATE LIMITER: Meta
  // redirige el navegador y no hay JWT, y no hay identidad verificada por la
  // cual keyear un limiter (por IP está descartado: el proyecto no configura
  // trust proxy). Desde A-07 no hace falta: no toca la base ni habla con Meta,
  // solo rebota el code y el state al CRM. Lo que escribe es /complete, que
  // tiene el esquema de siempre.
  //
  // URL fija, sin parámetros en el path: es la que se carga en el panel de
  // Meta como "URI de redireccionamiento de OAuth válida" y tiene que coincidir
  // carácter por carácter con META_REDIRECT_URI.
  // -------------------------------------------------------------------------
  router.get("/integrations/meta/callback", handlers.callback);

  return router;
}

export const metaPageConnectionRouter = createMetaPageConnectionRouter();
