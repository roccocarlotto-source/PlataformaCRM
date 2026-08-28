import { describe, expect, it, vi, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw/server";
import { env } from "../config/env";
import { ApiError, registerUnauthorizedHandler, request, uploadFile } from "./api";

// Tests del wrapper de red. request() ya estaba ejercitado indirectamente por
// los tests de cada feature; lo que se prueba acá es lo que uploadFile agregó y
// la garantía de que las dos funciones comparten el mismo manejo de respuesta
// (handleResponse) en vez de tener dos copias que puedan divergir.

const url = `${env.apiUrl}/api/cosa`;

afterEach(() => {
  // El handler de 401 es un singleton del módulo: se limpia para no filtrarlo
  // entre tests.
  registerUnauthorizedHandler(() => undefined);
});

function formDataDePrueba(): FormData {
  const form = new FormData();
  form.append("file", new Blob(["Nombre\nAna"]), "leads.csv");
  return form;
}

describe("uploadFile", () => {
  it("NO fija Content-Type — el boundary del multipart lo pone fetch solo", async () => {
    // Es la razón de ser de la función. Fijar el header a mano, aunque sea con
    // "multipart/form-data", deja al backend sin boundary que buscar y multer
    // rechaza el cuerpo entero.
    let contentType: string | null = "sin capturar";
    server.use(
      http.post(url, ({ request: req }) => {
        contentType = req.headers.get("content-type");
        return HttpResponse.json({ ok: true });
      }),
    );

    await uploadFile("/cosa", formDataDePrueba());

    expect(contentType).not.toBeNull();
    // fetch lo generó: incluye el boundary, que es justo lo que se perdería si
    // lo fijáramos nosotros.
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
  });

  it("manda Authorization cuando hay token, y no lo manda cuando no", async () => {
    const capturados: (string | null)[] = [];
    server.use(
      http.post(url, ({ request: req }) => {
        capturados.push(req.headers.get("authorization"));
        return HttpResponse.json({ ok: true });
      }),
    );

    await uploadFile("/cosa", formDataDePrueba(), {
      getAccessToken: async () => "token-de-prueba",
    });
    await uploadFile("/cosa", formDataDePrueba());

    expect(capturados[0]).toBe("Bearer token-de-prueba");
    expect(capturados[1]).toBeNull();
  });

  it("usa el mismo buildUrl que request: prefija /api", async () => {
    let path: string | undefined;
    server.use(
      http.post(url, ({ request: req }) => {
        path = new URL(req.url).pathname;
        return HttpResponse.json({ ok: true });
      }),
    );

    await uploadFile("/cosa", formDataDePrueba());
    expect(path).toBe("/api/cosa");
  });

  it("devuelve el JSON parseado", async () => {
    server.use(http.post(url, () => HttpResponse.json({ encabezados: ["Nombre", "Mail"] })));

    const body = await uploadFile<{ encabezados: string[] }>("/cosa", formDataDePrueba());
    expect(body.encabezados).toEqual(["Nombre", "Mail"]);
  });
});

describe("handleResponse — compartido por request() y uploadFile()", () => {
  // El refactor extrajo el manejo de la respuesta a una función común. Estos
  // tests corren la MISMA aserción sobre las dos funciones: si alguna vez
  // divergieran, acá se vería.
  const llamadas = {
    request: () => request("/cosa", { method: "POST", body: {} }),
    uploadFile: () => uploadFile("/cosa", formDataDePrueba()),
  } as const;

  for (const [nombre, llamar] of Object.entries(llamadas)) {
    it(`${nombre}: un error del backend se convierte en ApiError con status y mensaje`, async () => {
      server.use(
        http.post(url, () =>
          HttpResponse.json({ error: { message: "Fuente no encontrada" } }, { status: 404 }),
        ),
      );

      await expect(llamar()).rejects.toThrow(ApiError);
      await expect(llamar()).rejects.toMatchObject({
        status: 404,
        message: "Fuente no encontrada",
      });
    });

    it(`${nombre}: un 401 dispara el unauthorizedHandler global`, async () => {
      const onUnauthorized = vi.fn();
      registerUnauthorizedHandler(onUnauthorized);
      server.use(http.post(url, () => new HttpResponse(null, { status: 401 })));

      await expect(llamar()).rejects.toThrow(ApiError);
      expect(onUnauthorized).toHaveBeenCalled();
    });

    it(`${nombre}: un 204 devuelve undefined en vez de romper al parsear`, async () => {
      server.use(http.post(url, () => new HttpResponse(null, { status: 204 })));
      await expect(llamar()).resolves.toBeUndefined();
    });

    it(`${nombre}: un body de error no-JSON degrada al statusText, sin perder el ApiError`, async () => {
      server.use(
        http.post(
          url,
          () =>
            new HttpResponse("<html>gateway</html>", { status: 502, statusText: "Bad Gateway" }),
        ),
      );

      await expect(llamar()).rejects.toMatchObject({ status: 502 });
    });
  }
});
