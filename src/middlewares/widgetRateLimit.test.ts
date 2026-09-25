import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, mock, test } from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import type { WidgetAuthContext } from "../types/widgetAuth";
import { errorHandler } from "./errorHandler";
import { createWidgetRateLimiter, createWidgetSessionRateLimiter } from "./rateLimit";

// ---------------------------------------------------------------------------
// Ítem 138 (B-10/F-05): los DOS cupos del widget en la misma cadena, en el
// orden de publicWidget.routes.ts — primero el de sesión, después el de token.
//
// Unitario, sin base: authenticateEmbedToken se reemplaza por un middleware
// que pone el WidgetAuthContext a partir de un header de prueba. Lo que se
// prueba es la interacción de los dos limiters (qué keyea cada uno, y que uno
// no reemplaza al otro), no la autenticación: eso lo cubre
// publicWidget.controller.integration-test.ts.
//
// Topes chicos (sesión 2, token 3) para no mandar 30 requests por caso.
// ---------------------------------------------------------------------------

const MAX_SESION = 2;
const MAX_TOKEN = 3;

let url: string;
let cerrar: () => Promise<void>;
// Contadores frescos por test: cada uno arma su propia app.
async function levantar() {
  const app = express();
  app.use(express.json());
  app.post(
    "/mensajes",
    (req: Request, _res: Response, next: NextFunction) => {
      const widgetAuth: WidgetAuthContext = {
        organizationId: "org",
        agentId: "agente",
        branchId: "sucursal",
        embedTokenId: String(req.headers["x-token-de-prueba"]),
      };
      (req as Request & { widgetAuth: WidgetAuthContext }).widgetAuth = widgetAuth;
      next();
    },
    createWidgetSessionRateLimiter({ windowMs: 60_000, max: MAX_SESION }),
    createWidgetRateLimiter({ windowMs: 60_000, max: MAX_TOKEN }),
    (_req: Request, res: Response) => {
      res.status(200).json({ ok: true });
    },
  );
  app.use(errorHandler);

  await new Promise<void>((resolve) => {
    const server = app.listen(0, () => {
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      cerrar = () => new Promise((r) => server.close(() => r()));
      resolve();
    });
  });
}

function enviar(token: string, body: Record<string, unknown>) {
  return fetch(`${url}/mensajes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-token-de-prueba": token },
    body: JSON.stringify(body),
  });
}

// errorHandler loguea cada 429 como warn: acá son el resultado esperado.
before(async () => {
  mock.method(logger, "warn", () => undefined);
  await levantar();
});
after(async () => {
  mock.restoreAll();
  await cerrar();
});

test("una sesión llega a SU tope sin agotar el del sitio: otra sesión del mismo token sigue pasando", async () => {
  for (let i = 0; i < MAX_SESION; i++) {
    assert.equal((await enviar("tok-a", { sessionId: "s1" })).status, 200);
  }
  const bloqueado = await enviar("tok-a", { sessionId: "s1" });
  assert.equal(bloqueado.status, 429);
  const retryAfter = bloqueado.headers.get("retry-after");
  assert.ok(retryAfter && Number(retryAfter) > 0, "429 tiene que traer Retry-After");

  // Más intentos de la sesión cortada: el de sesión los frena ANTES de que
  // sumen en el cupo del sitio. Si sumaran, la sesión s2 de abajo no tendría
  // lugar (2 de s1 + 1 de s2 = el tope de 3 del token).
  assert.equal((await enviar("tok-a", { sessionId: "s1" })).status, 429);
  assert.equal((await enviar("tok-a", { sessionId: "s1" })).status, 429);

  // El mismo sessionId con espacios es la misma sesión (el controller trimea).
  assert.equal((await enviar("tok-a", { sessionId: "  s1 " })).status, 429);

  assert.equal((await enviar("tok-a", { sessionId: "s2" })).status, 200);
});

test("el tope del sitio (token) corta aunque cada sesión esté dentro del suyo", async () => {
  await cerrar();
  await levantar();

  // Tres sesiones distintas, una vez cada una: ninguna toca su tope de 2,
  // pero el token llega a 3.
  for (const sessionId of ["a", "b", "c"]) {
    assert.equal((await enviar("tok-b", { sessionId })).status, 200);
  }
  assert.equal((await enviar("tok-b", { sessionId: "d" })).status, 429, "techo global del sitio");

  // Otro token, mismo sessionId: su propio cupo. El sessionId lo elige el
  // navegador, y dos sitios no pueden compartir contador por coincidir.
  assert.equal((await enviar("tok-c", { sessionId: "a" })).status, 200);
});

test("sin sessionId válido el de sesión no cuenta (el 400 lo da el controller), pero el de token sí", async () => {
  await cerrar();
  await levantar();

  // Sin sessionId, o con uno que no es string: pasan el de sesión sin sumar.
  // Acá el handler de prueba responde 200; en la ruta real el controller los
  // rechaza con 400 antes de llegar al LLM.
  assert.equal((await enviar("tok-d", {})).status, 200);
  assert.equal((await enviar("tok-d", { sessionId: 123 })).status, 200);
  assert.equal((await enviar("tok-d", { sessionId: "   " })).status, 200);
  // Los tres sumaron en el de token.
  assert.equal((await enviar("tok-d", {})).status, 429);
});
