import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  buildSendMessageUrl,
  cuerpoDePlantilla,
  normalizarParametroDePlantilla,
  sendWhatsappTemplateReal,
  sendWhatsappTextReal,
  WhatsappGraphError,
} from "./whatsappGraph.service";

// ---------------------------------------------------------------------------
// El contrato con la Graph API de Meta, sin salir a la red: fetch se reemplaza
// por un doble que registra el request y contesta lo que el caso necesita.
// Lo que se afirma es lo que Meta recibe —URL, headers, cuerpo exacto— y cómo
// se clasifica una respuesta que no es 2xx, que es lo que el worker de
// seguimientos con QR (ítem 159) usa para decidir si reintenta.
// ---------------------------------------------------------------------------

const fetchOriginal = globalThis.fetch;

interface RequestRegistrado {
  url: string;
  init: RequestInit;
}

function doblarFetch(respuesta: Response): RequestRegistrado[] {
  const llamadas: RequestRegistrado[] = [];
  globalThis.fetch = ((url: string, init: RequestInit) => {
    llamadas.push({ url, init });
    return Promise.resolve(respuesta);
  }) as typeof fetch;
  return llamadas;
}

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

const PLANTILLA = {
  phoneNumberId: "1234567890",
  to: "5491155550000",
  templateName: "seguimiento_resena",
  languageCode: "es_AR",
  bodyParameters: ["Ana", "https://g.page/r/abc/review"],
  accessToken: "token-secreto",
};

test("sendWhatsappTemplateReal manda la plantilla con parámetros posicionales del cuerpo", async () => {
  const llamadas = doblarFetch(new Response("{}", { status: 200 }));

  await sendWhatsappTemplateReal(PLANTILLA);

  assert.equal(llamadas.length, 1);
  const [{ url, init }] = llamadas;
  assert.equal(url, buildSendMessageUrl("1234567890"));
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, {
    Authorization: "Bearer token-secreto",
    "Content-Type": "application/json",
  });
  assert.deepEqual(JSON.parse(init.body as string), {
    messaging_product: "whatsapp",
    to: "5491155550000",
    type: "template",
    template: {
      name: "seguimiento_resena",
      language: { code: "es_AR" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Ana" },
            { type: "text", text: "https://g.page/r/abc/review" },
          ],
        },
      ],
    },
  });
});

test("un 4xx de Meta es un WhatsappGraphError con el status y el motivo, sin el token", async () => {
  doblarFetch(
    new Response(
      JSON.stringify({ error: { message: "Template name does not exist", code: 132001 } }),
      {
        status: 404,
      },
    ),
  );

  await assert.rejects(sendWhatsappTemplateReal(PLANTILLA), (err: unknown) => {
    assert.ok(err instanceof WhatsappGraphError);
    assert.equal(err.status, 404);
    assert.match(err.message, /Template name does not exist/);
    assert.doesNotMatch(err.message, /token-secreto/);
    return true;
  });
});

test("un 5xx de Meta también llega como WhatsappGraphError, con su status para clasificarlo", async () => {
  doblarFetch(new Response("Service Unavailable", { status: 503 }));

  await assert.rejects(
    sendWhatsappTemplateReal(PLANTILLA),
    (err: unknown) => err instanceof WhatsappGraphError && err.status === 503,
  );
});

test("normalizarParametroDePlantilla deja una sola línea sin espacios de más (Meta rechaza saltos y tabs)", () => {
  assert.equal(normalizarParametroDePlantilla("  Ana\n María\t  López     "), "Ana María López");
  assert.equal(normalizarParametroDePlantilla("https://x.test/a"), "https://x.test/a");
});

test("cuerpoDePlantilla normaliza cada parámetro y respeta el orden ({{1}}, {{2}})", () => {
  const cuerpo = cuerpoDePlantilla({
    to: "549",
    templateName: "t",
    languageCode: "es",
    bodyParameters: ["Ana\nMaría", "https://x.test"],
  });
  assert.deepEqual(cuerpo.template.components[0].parameters, [
    { type: "text", text: "Ana María" },
    { type: "text", text: "https://x.test" },
  ]);
});

test("sendWhatsappTextReal sigue mandando texto libre con la misma forma de siempre", async () => {
  const llamadas = doblarFetch(new Response("{}", { status: 200 }));

  await sendWhatsappTextReal({
    phoneNumberId: "1234567890",
    to: "5491155550000",
    body: "Hola",
    accessToken: "token-secreto",
  });

  assert.deepEqual(JSON.parse(llamadas[0].init.body as string), {
    messaging_product: "whatsapp",
    to: "5491155550000",
    type: "text",
    text: { body: "Hola" },
  });
});
