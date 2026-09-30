import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { authenticate } from "../middlewares/authenticate";
import { businessWriteRateLimiter } from "../middlewares/rateLimit";
import { AppError } from "../utils/AppError";
import { branchRouter } from "./branch.routes";

// ---------------------------------------------------------------------------
// G-07 de docs-privados/auditoria-2026-09-30-corta.md (local, no está en
// GitHub): el horario de atención de la sucursal es solo para ADMIN, también
// la lectura. Sin base ni HTTP: se recorre la pila de capas del router real
// con un USER ya autenticado (se saltea `authenticate` y el rate limiter) y
// tiene que cortar con 403 antes del handler, que es la última capa.
// ---------------------------------------------------------------------------

type Handle = (req: Request, res: Response, next: NextFunction) => unknown;

interface Capa {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: Handle }[];
  };
}

function capasDe(metodo: string, path: string): Handle[] {
  const stack = (branchRouter as unknown as { stack: Capa[] }).stack;
  const capa = stack.find((c) => c.route?.path === path && c.route.methods[metodo]);
  assert.ok(capa?.route, `${metodo.toUpperCase()} ${path} no está montada`);
  return capa.route.stack.map((s) => s.handle);
}

async function primerErrorComoUser(handles: Handle[]): Promise<{ error: unknown; indice: number }> {
  const req = {
    auth: { userId: "u", organizationId: "o", role: "USER" },
    params: { id: "00000000-0000-4000-8000-000000000001" },
    body: {},
  } as unknown as Request;
  for (const [indice, handle] of handles.entries()) {
    if (handle === (authenticate as Handle) || handle === (businessWriteRateLimiter as Handle)) {
      continue;
    }
    const error = await new Promise<unknown>((resolve) => {
      void handle(req, {} as Response, (err?: unknown) => resolve(err ?? null));
    });
    if (error) {
      return { error, indice };
    }
  }
  return { error: null, indice: -1 };
}

for (const metodo of ["get", "patch"]) {
  test(`G-07: ${metodo.toUpperCase()} /branches/:id/business-hours exige authenticate y corta a un USER con 403 antes del handler`, async () => {
    const handles = capasDe(metodo, "/branches/:id/business-hours");
    assert.equal(handles[0], authenticate, "la primera capa es authenticate");

    const { error, indice } = await primerErrorComoUser(handles);
    assert.ok(error instanceof AppError, "un USER no pasa");
    assert.equal(error.statusCode, 403);
    assert.ok(indice < handles.length - 1, "el 403 sale antes del handler");
  });
}
