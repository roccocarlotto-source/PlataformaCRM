import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLAVES_DE_AMBIENTE,
  armarPromptDeTraduccion,
  camposDeTool,
  nombresDeToolsValidos,
  translateGuardrailsText,
} from "./agentGuardrailsTranslation.service";
import {
  LlmProviderError,
  type LlmCompletionRequest,
  type LlmProvider,
} from "./llmProvider.service";

// Unitarios, SIN RED Y SIN BASE: el proveedor se inyecta, igual que en
// llmProvider.service.test.ts (que inyecta un fetch) y que en las pruebas del
// loop de orquestación. Ningún caso de este archivo necesita
// OPENROUTER_API_KEY ni Postgres.

interface ProveedorFalso {
  provider: LlmProvider;
  llamadas: LlmCompletionRequest[];
}

// Devuelve `texto` como respuesta del modelo y registra con qué lo llamaron. El
// registro importa: la mitad de lo que hay que verificar es QUÉ se le manda
// (el prompt con el catálogo real, sin tools).
function proveedorQueResponde(texto: string | null): ProveedorFalso {
  const llamadas: LlmCompletionRequest[] = [];
  return {
    llamadas,
    provider: {
      name: "falso",
      complete(request) {
        llamadas.push(request);
        return Promise.resolve({ text: texto, toolCalls: [] });
      },
    },
  };
}

function respuesta(objeto: unknown): string {
  return JSON.stringify(objeto);
}

// ---------------------------------------------------------------------------
// El catálogo que alimenta la traducción
// ---------------------------------------------------------------------------

test("el prompt se arma desde CATALOGO_DE_TOOLS, no desde una lista copiada a mano", () => {
  const prompt = armarPromptDeTraduccion();

  // Las seis tools reales, con el nombre exacto que el guardrail va a usar.
  for (const nombre of nombresDeToolsValidos()) {
    assert.ok(prompt.includes(nombre), `el prompt debería nombrar la tool ${nombre}`);
    // Y los campos de cada una, que son los valores válidos de
    // infoNoModificable / datosRequeridosAntesDeAccion.
    for (const campo of camposDeTool(nombre)) {
      assert.ok(prompt.includes(campo), `el prompt debería nombrar el campo ${campo}`);
    }
  }

  // Las claves de ambiente de datosDisponiblesDeLaConversacion().
  for (const clave of CLAVES_DE_AMBIENTE) {
    assert.ok(prompt.includes(clave), `el prompt debería nombrar la clave de ambiente ${clave}`);
  }

  // Y las TRES claves que esta traducción produce — las tres que
  // puedeEjecutarTool hace cumplir con código.
  for (const clave of ["accionesProhibidas", "infoNoModificable", "datosRequeridosAntesDeAccion"]) {
    assert.ok(prompt.includes(clave), `el prompt debería explicar la clave ${clave}`);
  }
});

test("el prompt ya no pide las tres claves que se mudaron a Instrucciones (ítem 72)", () => {
  const prompt = armarPromptDeTraduccion();

  // No alcanza con que sanitizarGuardrails las descarte: si el prompt las
  // sigue pidiendo, el modelo las va a devolver y el ADMIN va a ver una
  // advertencia por algo que la pantalla le pidió escribir.
  for (const clave of ["temasProhibidos", "promesasProhibidas", "condicionesDeDerivacion"]) {
    assert.ok(!prompt.includes(clave), `el prompt no debería pedir ${clave}`);
  }

  assert.ok(prompt.includes("estas tres claves"), "el prompt debería declarar que son tres");
});

// ---------------------------------------------------------------------------
// Camino feliz
// ---------------------------------------------------------------------------

test("traducción feliz: las tres claves de código pasan enteras", async () => {
  const esperado = {
    accionesProhibidas: ["update_opportunity"],
    infoNoModificable: ["Contact.email"],
    datosRequeridosAntesDeAccion: { create_booking: ["serviceTypeId", "contactId"] },
  };
  const falso = proveedorQueResponde(respuesta(esperado));

  const resultado = await translateGuardrailsText(
    "No cambies oportunidades. No toques el mail del contacto. Antes de reservar pedí el servicio.",
    falso.provider,
  );

  assert.deepEqual(resultado.guardrails, esperado);
  assert.deepEqual(resultado.descartado, []);

  // Sin tools: es una traducción, no una conversación con tool-calling. Y el
  // texto del ADMIN viaja como el único mensaje de usuario.
  assert.equal(falso.llamadas.length, 1);
  assert.deepEqual(falso.llamadas[0].tools, []);
  assert.equal(falso.llamadas[0].messages.length, 1);
  assert.equal(falso.llamadas[0].model, undefined);
});

test("texto vacío devuelve {} sin llamar al proveedor", async () => {
  const falso = proveedorQueResponde(respuesta({ accionesProhibidas: ["update_opportunity"] }));

  for (const texto of ["", "   \n  "]) {
    const resultado = await translateGuardrailsText(texto, falso.provider);
    assert.deepEqual(resultado, { guardrails: {}, descartado: [] });
  }

  assert.equal(falso.llamadas.length, 0, "no se gasta una llamada por un campo vacío");
});

test("la respuesta envuelta en un bloque ```json se interpreta igual", async () => {
  const falso = proveedorQueResponde(
    '```json\n{"accionesProhibidas": ["update_opportunity"]}\n```',
  );

  const resultado = await translateGuardrailsText("No modifiques oportunidades.", falso.provider);

  assert.deepEqual(resultado.guardrails, { accionesProhibidas: ["update_opportunity"] });
});

// ---------------------------------------------------------------------------
// Fallas del modelo — sin fallback silencioso a {}
// ---------------------------------------------------------------------------

test("una respuesta que no es JSON corta el guardado, no cae a {}", async () => {
  for (const texto of ["No entendí tu pedido", "[1, 2, 3]", "null", "", null]) {
    const falso = proveedorQueResponde(texto);
    await assert.rejects(
      () => translateGuardrailsText("No hables de política.", falso.provider),
      (err: unknown) => {
        assert.ok(err instanceof LlmProviderError);
        assert.equal(err.statusCode, 502);
        assert.match(err.message, /No se pudo interpretar la traducción del modelo/);
        return true;
      },
      `debería fallar para ${JSON.stringify(texto)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Sanitización contra el catálogo real
// ---------------------------------------------------------------------------

test("una acción inventada se saca del guardrail y se reporta en descartado", async () => {
  const falso = proveedorQueResponde(
    respuesta({ accionesProhibidas: ["enviar_email", "update_opportunity"] }),
  );

  const resultado = await translateGuardrailsText(
    "No mandes mails ni cambies nada.",
    falso.provider,
  );

  // Lo que sí existe sigue rigiendo; lo que no, no queda como entrada muerta.
  assert.deepEqual(resultado.guardrails, { accionesProhibidas: ["update_opportunity"] });
  assert.deepEqual(resultado.descartado, [
    {
      clave: "accionesProhibidas",
      valor: "enviar_email",
      motivo: '"enviar_email" no es ninguna de las acciones del agente',
    },
  ]);
});

test("una acción prohibida inexistente deja la clave FUERA del guardrail, no en []", async () => {
  const falso = proveedorQueResponde(respuesta({ accionesProhibidas: ["enviar_email"] }));

  const resultado = await translateGuardrailsText("No mandes mails.", falso.provider);

  assert.deepEqual(resultado.guardrails, {});
  assert.equal(resultado.descartado.length, 1);
});

test("un campo inventado en infoNoModificable se descarta; uno real pasa", async () => {
  const falso = proveedorQueResponde(
    // `amount` es argumento real de create_opportunity/update_opportunity;
    // `numeroDeSocio` no es argumento de ninguna tool ni clave de ambiente.
    respuesta({ infoNoModificable: ["numeroDeSocio", "amount"] }),
  );

  const resultado = await translateGuardrailsText("No toques el número de socio.", falso.provider);

  assert.deepEqual(resultado.guardrails, { infoNoModificable: ["amount"] });
  assert.equal(resultado.descartado.length, 1);
  assert.equal(resultado.descartado[0].clave, "infoNoModificable");
  assert.equal(resultado.descartado[0].valor, "numeroDeSocio");
});

test("infoNoModificable compara por nombre PELADO, igual que puedeEjecutarTool", async () => {
  // "Opportunity.amount" → "amount": el prefijo de entidad se descarta, que es
  // exactamente lo que hace nombreDeCampo() cuando el guardrail se evalúa. El
  // valor se guarda TAL CUAL lo escribió el modelo.
  const falso = proveedorQueResponde(respuesta({ infoNoModificable: ["Opportunity.amount"] }));

  const resultado = await translateGuardrailsText("No toques el monto.", falso.provider);

  assert.deepEqual(resultado.guardrails, { infoNoModificable: ["Opportunity.amount"] });
  assert.deepEqual(resultado.descartado, []);
});

test("datosRequeridosAntesDeAccion: una acción que no existe se descarta completa", async () => {
  const falso = proveedorQueResponde(
    respuesta({
      datosRequeridosAntesDeAccion: {
        enviar_email: ["email"],
        create_booking: ["serviceTypeId"],
      },
    }),
  );

  const resultado = await translateGuardrailsText("Pedí datos antes de reservar.", falso.provider);

  assert.deepEqual(resultado.guardrails, {
    datosRequeridosAntesDeAccion: { create_booking: ["serviceTypeId"] },
  });
  assert.deepEqual(resultado.descartado, [
    {
      clave: "datosRequeridosAntesDeAccion",
      valor: "enviar_email",
      motivo: '"enviar_email" no es ninguna de las acciones del agente',
    },
  ]);
});

test("datosRequeridosAntesDeAccion: un dato que no es de esa acción se descarta", async () => {
  // `startsAt` es de create_booking, no de create_opportunity: pedirlo antes de
  // crear una oportunidad bloquearía la tool para siempre, porque
  // puedeEjecutarTool no lo encontraría ni en los args ni en la conversación.
  const falso = proveedorQueResponde(
    respuesta({ datosRequeridosAntesDeAccion: { create_opportunity: ["startsAt", "title"] } }),
  );

  const resultado = await translateGuardrailsText("Pedí el título antes.", falso.provider);

  assert.deepEqual(resultado.guardrails, {
    datosRequeridosAntesDeAccion: { create_opportunity: ["title"] },
  });
  assert.equal(resultado.descartado.length, 1);
  assert.equal(resultado.descartado[0].clave, "datosRequeridosAntesDeAccion.create_opportunity");
  assert.equal(resultado.descartado[0].valor, "startsAt");
});

test("datosRequeridosAntesDeAccion admite las claves de ambiente de la conversación", async () => {
  const falso = proveedorQueResponde(
    respuesta({ datosRequeridosAntesDeAccion: { create_booking: ["contactId", "serviceTypeId"] } }),
  );

  const resultado = await translateGuardrailsText(
    "Pedí el contacto y el servicio.",
    falso.provider,
  );

  assert.deepEqual(resultado.guardrails, {
    datosRequeridosAntesDeAccion: { create_booking: ["contactId", "serviceTypeId"] },
  });
  assert.deepEqual(resultado.descartado, []);
});

// ---------------------------------------------------------------------------
// Lo que dejó de traducirse (ítem 72)
// ---------------------------------------------------------------------------

test("las tres claves que se mudaron a Instrucciones se descartan, con un motivo que lo dice", async () => {
  // El prompt ya no se las pide, pero un modelo puede devolverlas igual. Si
  // pasaran, la pantalla estaría escribiendo por la puerta de atrás justo lo
  // que se sacó de esta pantalla.
  const falso = proveedorQueResponde(
    respuesta({
      temasProhibidos: ["diagnósticos médicos"],
      promesasProhibidas: ["descuentos no publicados"],
      condicionesDeDerivacion: ["reclamo o queja"],
      accionesProhibidas: ["update_opportunity"],
    }),
  );

  const resultado = await translateGuardrailsText(
    "No hables de medicina, no prometas descuentos, derivá los reclamos y no modifiques oportunidades.",
    falso.provider,
  );

  assert.deepEqual(resultado.guardrails, { accionesProhibidas: ["update_opportunity"] });
  assert.equal(resultado.descartado.length, 3);
  for (const clave of ["temasProhibidos", "promesasProhibidas", "condicionesDeDerivacion"]) {
    const descarte = resultado.descartado.find((d) => d.clave === clave);
    assert.ok(descarte, `debería reportar ${clave}`);
    // El motivo es el específico, no el genérico de "clave inventada": la
    // clave existe y el agente la sigue leyendo — lo que cambió es dónde se
    // escribe.
    assert.match(descarte.motivo, /ya no se traduce acá — escribilo directamente en Instrucciones/);
  }
});

// ---------------------------------------------------------------------------
// Listas: duplicados
// ---------------------------------------------------------------------------

test("los duplicados se deduplican en todas las listas", async () => {
  const falso = proveedorQueResponde(
    respuesta({
      accionesProhibidas: ["create_booking", "create_booking"],
      infoNoModificable: ["amount", "amount"],
      datosRequeridosAntesDeAccion: { create_booking: ["serviceTypeId", "serviceTypeId"] },
    }),
  );

  const resultado = await translateGuardrailsText("Sin repetir.", falso.provider);

  assert.deepEqual(resultado.guardrails, {
    accionesProhibidas: ["create_booking"],
    infoNoModificable: ["amount"],
    datosRequeridosAntesDeAccion: { create_booking: ["serviceTypeId"] },
  });
  assert.deepEqual(resultado.descartado, []);
});

// ---------------------------------------------------------------------------
// Formas equivocadas
// ---------------------------------------------------------------------------

test("una clave inventada no rige nada: se descarta y se reporta", async () => {
  const falso = proveedorQueResponde(
    respuesta({ maxTurns: 3, accionesProhibidas: ["update_opportunity"] }),
  );

  const resultado = await translateGuardrailsText("Máximo tres vueltas.", falso.provider);

  assert.deepEqual(resultado.guardrails, { accionesProhibidas: ["update_opportunity"] });
  assert.equal(resultado.descartado.length, 1);
  assert.equal(resultado.descartado[0].clave, "maxTurns");
  assert.match(resultado.descartado[0].motivo, /no es uno de los límites/);
});

test("una clave válida con el tipo equivocado se descarta entera, con su motivo", async () => {
  const falso = proveedorQueResponde(
    respuesta({ infoNoModificable: "amount", accionesProhibidas: [42, "create_booking"] }),
  );

  const resultado = await translateGuardrailsText("Cualquiera.", falso.provider);

  assert.deepEqual(resultado.guardrails, { accionesProhibidas: ["create_booking"] });
  assert.equal(resultado.descartado.length, 2);
  assert.ok(
    resultado.descartado.some(
      (d) => d.clave === "infoNoModificable" && d.motivo === "no es una lista",
    ),
  );
  assert.ok(
    resultado.descartado.some(
      (d) => d.clave === "accionesProhibidas" && d.motivo === "no es un texto",
    ),
  );
});

test("un objeto vacío del modelo es un resultado válido: sin guardrails declarados", async () => {
  const falso = proveedorQueResponde(respuesta({}));

  const resultado = await translateGuardrailsText("Nada en particular.", falso.provider);

  assert.deepEqual(resultado, { guardrails: {}, descartado: [] });
});
