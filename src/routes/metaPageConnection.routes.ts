import { Router } from "express";
import { createMetaPageConnectionHandlers } from "../controllers/metaPageConnection.controller";
import { authenticate } from "../middlewares/authenticate";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";
import { requirePlatformAdmin } from "../middlewares/requirePlatformAdmin";
import type { ClienteMetaOAuth } from "../services/metaOAuth.service";

// ---------------------------------------------------------------------------
// Conexión de la página de Facebook de una organización (ítem 170). Calco de
// googleCalendarConnection.routes.ts en la forma: rutas autenticadas y el
// callback SIN authenticate, en el mismo archivo porque son un solo flujo.
//
// DESDE EL 02/10/2026 CONECTAR, COMPLETAR Y DESCONECTAR SON DE PLATFORM ADMIN,
// sobre una organización elegida, y ya no existen las rutas del ADMIN del
// tenant (POST /integrations/meta/connect, POST /integrations/meta/complete,
// DELETE /integrations/meta). Motivo: el diálogo de Meta le muestra a quien
// conecta los portfolios y negocios de su cuenta de Facebook; para un cliente
// es confuso y riesgoso, así que la plataforma lo configura por él (ver
// docs/meta-alta-de-cliente.md). Mismo criterio que el número de WhatsApp, el
// modelo de IA y la página del agente (agentAdmin.routes.ts).
//
// Cadena de las rutas de plataforma: authenticate + businessWriteRateLimiter +
// requirePlatformAdmin, la misma de agentAdmin.routes.ts y
// organizationAdmin.routes.ts — NO authorize("ADMIN"): un PlatformAdmin es
// global, no un rol dentro de la organización que está configurando.
//
// Factory con el cliente de Meta inyectable para el test de integración;
// producción monta metaPageConnectionRouter, con el real.
// ---------------------------------------------------------------------------

export function createMetaPageConnectionRouter(cliente?: ClienteMetaOAuth) {
  const handlers = createMetaPageConnectionHandlers(cliente);
  const router = Router();

  // Estado de la conexión de la organización PROPIA: cualquier usuario
  // autenticado, para el aviso informativo de Configuración → Organización.
  // Nunca devuelve el token.
  router.get("/integrations/meta", authenticate, handlers.obtener);

  const ADMIN = "/admin/organizations/:organizationId/integrations/meta";

  // El estado de la conexión de la organización elegida.
  router.get(
    ADMIN,
    authenticate,
    businessWriteRateLimiter,
    requirePlatformAdmin,
    handlers.obtenerDeOrganizacion,
  );

  // Devuelve la URL de autorización en el cuerpo, no un 302 (ver
  // iniciarConexion). POST porque firma un state que habilita a escribir.
  router.post(
    `${ADMIN}/connect`,
    authenticate,
    businessWriteRateLimiter,
    requirePlatformAdmin,
    handlers.conectar,
  );

  // El segundo tramo del flujo (A-07 de docs-privados/auditoria-2026-09-30-corta.md,
  // local): el CRM manda el code y el state que le rebotó el callback. El
  // service exige además que el usuario y la organización sean los que firmó
  // el state.
  router.post(
    `${ADMIN}/complete`,
    authenticate,
    businessWriteRateLimiter,
    requirePlatformAdmin,
    handlers.completar,
  );

  // Desconectar: la fila queda REVOKED y sin token.
  router.delete(
    ADMIN,
    authenticate,
    businessWriteRateLimiter,
    requirePlatformAdmin,
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
  // carácter por carácter con META_REDIRECT_URI. Por eso NO se mudó bajo
  // /admin con el resto.
  // -------------------------------------------------------------------------
  router.get("/integrations/meta/callback", handlers.callback);

  return router;
}

export const metaPageConnectionRouter = createMetaPageConnectionRouter();
