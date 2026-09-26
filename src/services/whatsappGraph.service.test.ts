import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  buildDeleteTemplateUrl,
  buildMessageTemplatesUrl,
  buildSendMessageUrl,
  buildTemplateStatusUrl,
  createWhatsappTemplateReal,
  cuerpoDePlantilla,
  deleteWhatsappTemplateReal,
  getWhatsappTemplateStatusReal,
  mensajeDeMeta,
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
  assert.deepEqual(cuerpo.template.components?.[0].parameters, [
    { type: "text", text: "Ana María" },
    { type: "text", text: "https://x.test" },
  ]);
});

test("cuerpoDePlantilla sin parámetros no manda `components`: una plantilla sin variables (hello_world) va con nombre e idioma a secas", () => {
  const cuerpo = cuerpoDePlantilla({
    to: "549",
    templateName: "hello_world",
    languageCode: "en_US",
    bodyParameters: [],
  });
  assert.deepEqual(cuerpo, {
    to: "549",
    type: "template",
    template: { name: "hello_world", language: { code: "en_US" } },
  });
  assert.equal("components" in cuerpo.template, false);
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

// ---------------------------------------------------------------------------
// La plantilla de cada negocio (ítem 160): alta, estado y baja en el WABA
// ---------------------------------------------------------------------------

const ALTA = {
  wabaId: "waba-123",
  accessToken: "token-secreto",
  name: "seguimiento_postventa",
  language: "es_AR",
  bodyText: "Hola {{1}}, gracias. Tu opinión: {{2}} ¡Gracias!",
  bodyExamples: ["Ana", "https://g.page/r/ejemplo/review"],
};

test("createWhatsappTemplateReal: POST al WABA, categoría UTILITY fija, cuerpo con ejemplos; devuelve id y estado", async () => {
  const llamadas = doblarFetch(
    new Response(JSON.stringify({ id: 987654321, status: "PENDING", category: "UTILITY" }), {
      status: 200,
    }),
  );

  const creada = await createWhatsappTemplateReal(ALTA);

  assert.deepEqual(creada, { id: "987654321", status: "PENDING" });
  const [{ url, init }] = llamadas;
  assert.equal(url, buildMessageTemplatesUrl("waba-123"));
  assert.equal(url, "https://graph.facebook.com/v25.0/waba-123/message_templates");
  assert.equal(init.method, "POST");
  assert.deepEqual(JSON.parse(init.body as string), {
    name: "seguimiento_postventa",
    language: "es_AR",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Hola {{1}}, gracias. Tu opinión: {{2}} ¡Gracias!",
        example: { body_text: [["Ana", "https://g.page/r/ejemplo/review"]] },
      },
    ],
  });
});

test("createWhatsappTemplateReal: un 400 de Meta llega como WhatsappGraphError y mensajeDeMeta saca el motivo legible", async () => {
  const cuerpo = {
    error: {
      message: "Invalid parameter",
      error_user_msg: "Ya existe una plantilla con ese nombre en este idioma",
      code: 100,
    },
  };
  doblarFetch(new Response(JSON.stringify(cuerpo), { status: 400 }));

  await assert.rejects(createWhatsappTemplateReal(ALTA), (err: unknown) => {
    assert.ok(err instanceof WhatsappGraphError);
    assert.equal(err.status, 400);
    assert.equal(mensajeDeMeta(err), "Ya existe una plantilla con ese nombre en este idioma");
    return true;
  });
});

test("mensajeDeMeta: error.message si no hay error_user_msg, y null si el cuerpo no es el JSON de Meta", () => {
  assert.equal(
    mensajeDeMeta(new WhatsappGraphError(400, JSON.stringify({ error: { message: "Bad" } }))),
    "Bad",
  );
  assert.equal(mensajeDeMeta(new WhatsappGraphError(502, "<html>Bad Gateway</html>")), null);
});

test("createWhatsappTemplateReal: un 2xx sin id es una respuesta rota de Meta (502), no un rechazo", async () => {
  doblarFetch(new Response("{}", { status: 200 }));

  await assert.rejects(
    createWhatsappTemplateReal(ALTA),
    (err: unknown) => err instanceof WhatsappGraphError && err.status === 502,
  );
});

test("getWhatsappTemplateStatusReal: GET al id con los campos status y rejected_reason", async () => {
  const llamadas = doblarFetch(
    new Response(
      JSON.stringify({ status: "REJECTED", rejected_reason: "INVALID_FORMAT", id: "9" }),
      {
        status: 200,
      },
    ),
  );

  const estado = await getWhatsappTemplateStatusReal({
    metaTemplateId: "987654321",
    accessToken: "token-secreto",
  });

  assert.deepEqual(estado, { status: "REJECTED", rejectedReason: "INVALID_FORMAT" });
  const [{ url, init }] = llamadas;
  assert.equal(url, buildTemplateStatusUrl("987654321"));
  assert.equal(url, "https://graph.facebook.com/v25.0/987654321?fields=status,rejected_reason");
  assert.equal(init.method, "GET");
  assert.equal(init.body, undefined);
  assert.deepEqual(init.headers, { Authorization: "Bearer token-secreto" });
});

test("deleteWhatsappTemplateReal: DELETE por nombre, y con hsm_id cuando se conoce el id", async () => {
  const llamadas = doblarFetch(new Response(JSON.stringify({ success: true }), { status: 200 }));

  await deleteWhatsappTemplateReal({
    wabaId: "waba-123",
    accessToken: "token-secreto",
    name: "seguimiento_postventa",
    metaTemplateId: "987654321",
  });

  const [{ url, init }] = llamadas;
  assert.equal(init.method, "DELETE");
  assert.equal(
    url,
    "https://graph.facebook.com/v25.0/waba-123/message_templates?name=seguimiento_postventa&hsm_id=987654321",
  );
  // Sin id (una reserva cuyo alta no llegó a guardarlo): solo por nombre.
  assert.equal(
    buildDeleteTemplateUrl({
      wabaId: "waba-123",
      name: "seguimiento_postventa",
      metaTemplateId: null,
    }),
    "https://graph.facebook.com/v25.0/waba-123/message_templates?name=seguimiento_postventa",
  );
});
