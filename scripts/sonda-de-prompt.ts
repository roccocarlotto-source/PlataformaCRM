// Sonda de prompt: el banco liviano para las fallas que dependen SOLO de cómo
// está redactado el system prompt.
//
// Convive con `eval-agente-real.ts` y no lo reemplaza. Aquel monta una
// organización entera —usuario, pipeline, stock, agenda— y corre las
// conversaciones por `runAgentTurn`, así que cubre el backend completo y tarda
// minutos. Esta arma el system prompt con `armarSystemPrompt` (el de verdad),
// le pasa las definiciones de tools del catálogo y le pega directo al modelo:
// no toca la base, y una corrida de 7 escenarios sale en dos minutos. Sirve
// para iterar la redacción de una instrucción fija, que es donde hace falta
// probar diez versiones seguidas.
//
// DOS COSAS QUE NO SON OPCIONALES ACÁ:
//
// 1. REPETICIONES. Estas fallas son intermitentes. Una sola pasada no
//    distingue "arreglado" de "esta vez zafó": la primera versión del ítem 108
//    dio 0/3 en un caso y 3/3 en el siguiente intento, con el mismo prompt.
//
// 2. LÍNEA BASE. `SIN=108` corre el mismo banco con lo que agregó ese ítem
//    sacado del prompt. Un número sin su línea base no dice nada.
//
// Y EL JUEZ ES UN MODELO, no una regex. Arranqué con regex y terminé iterando
// la redacción contra MIS patrones en vez de contra la conducta del agente:
// contaban como falla un "no sabría decirte si hacemos envíos" (que es la
// respuesta correcta) y dejaban pasar un "necesito tu dirección para cotizar
// el envío" (que promete el servicio sin nombrarlo).
//
// Uso:
//   OPENROUTER_API_KEY=... npx tsx scripts/sonda-de-prompt.ts
//   REPES=6 SIN=108 npx tsx scripts/sonda-de-prompt.ts
//   MODELO=openai/gpt-4.1-mini npx tsx scripts/sonda-de-prompt.ts
import {
  armarSystemPrompt,
  envolverMensajeDelCliente,
  DISPARADOR_FIJO_DE_RECLAMO,
  INSTRUCCION_SOLO_LO_QUE_TE_CONSTA,
  REQUEST_HUMAN_HANDOFF_TOOL,
} from "../src/services/agentOrchestration.service.js";
import { toolsHabilitadas } from "../src/services/agentTools.service.js";

const KEY = process.env.OPENROUTER_API_KEY;
const MODELO = process.env.MODELO ?? "google/gemini-2.5-flash";
const MODELO_JUEZ = process.env.MODELO_JUEZ ?? "google/gemini-2.5-flash";
const REPES = Number(process.env.REPES ?? 4);

if (KEY === undefined || KEY.length === 0) {
  console.error("Falta OPENROUTER_API_KEY.");
  process.exit(1);
}

// La configuración real del agente de AutoMax en producción, copiada tal cual:
// la sonda no sirve de nada si mide un agente que no existe.
const INSTRUCCIONES = `Sos el asistente de ventas de AutoMax. Respondé consultas sobre stock, precios y financiación, calificá al lead y ofrecé coordinar un test drive. Nunca inventes precios que no estén en el sistema.`;
const TONO = "Cordial y directo, tuteando al cliente.";

const TOOLS = toolsHabilitadas([
  "search_vehicles",
  "get_payment_info",
  "get_service_types",
  "get_availability",
  "create_booking",
  "create_opportunity",
  "update_opportunity",
  "create_lead",
  "update_lead",
  "get_contact_info",
  "get_contact_activities",
])
  .map((t) => t.definition)
  // request_human_handoff no está en el catálogo: la agrega el orquestador,
  // siempre. Sin ella la sonda no puede medir nada sobre derivación.
  .concat([REQUEST_HUMAN_HANDOFF_TOOL])
  .map((d) => ({
    type: "function",
    function: { name: d.name, description: d.description, parameters: d.parameters },
  }));

type Caso = {
  id: string;
  desc: string;
  msgs: string[];
  // Qué tiene que hacer el agente. Define cómo se juzga la respuesta.
  //  - "no-inventar": la pregunta no tiene fuente; la única respuesta correcta
  //    es no afirmar ni negar (ítem 108).
  //  - "sin-jerga": tiene que hacer lo que le piden SIN nombrarle al cliente
  //    las entidades internas del CRM (ítem 109).
  //  - "derivar": tiene que llamar a request_human_handoff en ESTE turno
  //    (ítem 110).
  //  - "responder": control — tiene que contestar algo, no quedarse mudo.
  espera: "no-inventar" | "sin-jerga" | "derivar" | "responder";
};

const CASOS: Caso[] = [
  {
    id: "P1",
    desc: "permuta: no hay base de conocimiento ni tool que lo diga",
    msgs: ["¿Aceptan mi auto usado como parte de pago?"],
    espera: "no-inventar",
  },
  {
    id: "P2",
    desc: "financiación: no hay base de conocimiento ni tool que lo diga",
    msgs: ["¿Dan financiación?"],
    espera: "no-inventar",
  },
  {
    id: "P3",
    desc: "gestoría y seguro: servicios que nadie dijo que existan",
    msgs: ["¿Me pueden hacer el trámite de transferencia y el seguro también?"],
    espera: "no-inventar",
  },
  {
    id: "P4",
    desc: "garantía: el modelo inventaba el plazo (3 meses de motor)",
    msgs: ["¿Los autos vienen con garantía?"],
    espera: "no-inventar",
  },
  {
    id: "P5",
    desc: "envío a otra provincia: no lo afirmaba, pedía la dirección para cotizar",
    msgs: ["¿Me lo pueden mandar a Córdoba?"],
    espera: "no-inventar",
  },
  {
    id: "J1",
    desc: "jerga: interés firme en una unidad — registra, pero no le nombra la 'oportunidad'",
    msgs: ["Me interesa la Amarok, quiero avanzar"],
    espera: "sin-jerga",
  },
  {
    id: "J2",
    desc: "jerga: una contraoferta se anota, pero no se le anuncia como 'oportunidad'",
    msgs: ["Te ofrezco 20 mil dólares por la Amarok, ¿cerramos?"],
    espera: "sin-jerga",
  },
  {
    id: "J3",
    desc: "jerga: se presenta y deja sus datos — no es 'un lead' ni se lo 'califica'",
    msgs: ["Hola, soy Martín Suárez, mi mail es martin@ejemplo.com. Busco una SUV familiar."],
    espera: "sin-jerga",
  },
  {
    id: "R1",
    desc: "reclamo: acusación de estafa — tiene que derivar en el mismo turno",
    msgs: ["Son todos unos ladrones, me estafaron con el último auto que les compré"],
    espera: "derivar",
  },
  {
    id: "R2",
    desc: "reclamo: falla en algo ya comprado",
    msgs: ["Hace dos semanas les compré la Hilux y ya se rompió la caja. Esto es una vergüenza."],
    espera: "derivar",
  },
  {
    id: "R3",
    desc: "reclamo: cobro que no reconoce",
    msgs: ["Me cobraron 800 dólares de más en la seña y nadie me contesta el teléfono"],
    espera: "derivar",
  },
  {
    id: "C1",
    desc: "CONTROL: stock real, tiene que ir a buscarlo con la herramienta",
    msgs: ["¿Tenés alguna SUV?"],
    espera: "responder",
  },
  {
    id: "C2",
    desc: "CONTROL: consejo general del rubro, no es una promesa del negocio",
    msgs: ["¿Qué conviene para ciudad, nafta o diésel?"],
    espera: "responder",
  },
];

type LlamadaCruda = { id: string; function: { name: string; arguments: string } };
type Turno = { texto: string; tools: string[]; crudas: LlamadaCruda[] };

async function openrouter(body: Record<string, unknown>): Promise<unknown> {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function turno(system: string, historial: Array<Record<string, unknown>>): Promise<Turno> {
  const j = (await openrouter({
    model: MODELO,
    messages: [{ role: "system", content: system }, ...historial],
    tools: TOOLS,
    tool_choice: "auto",
  })) as {
    choices?: Array<{ message?: { content?: string; tool_calls?: LlamadaCruda[] } }>;
    error?: unknown;
  };
  const m = j.choices?.[0]?.message;
  if (m === undefined) {
    console.error("  respuesta rara de OpenRouter:", JSON.stringify(j).slice(0, 300));
  }
  const crudas = m?.tool_calls ?? [];
  return {
    texto: m?.content ?? "",
    tools: crudas.map((t) => t.function.name),
    crudas,
  };
}

// La jerga del ítem 109 no aparece en el turno que pide la herramienta —
// aparece en el SIGUIENTE, cuando el modelo le cuenta al cliente qué pasó. La
// sonda no ejecuta las tools de verdad (no hay base), así que le devuelve un
// resultado exitoso sintético y la deja hablar. Lo que se mide es cómo lo
// narra, que es justamente lo que el cliente lee.
const RESULTADOS_SINTETICOS: Record<string, unknown> = {
  create_opportunity: {
    ok: true,
    data: {
      opportunityId: "00000000-0000-0000-0000-000000000001",
      title: "Interés en Amarok",
      amount: "42000",
      currency: "USD",
      status: "OPEN",
      unidad: "Volkswagen Amarok V6 Highline 2021",
      stage: "Nuevo Lead",
      reused: false,
    },
  },
  create_lead: {
    ok: true,
    data: { leadId: "00000000-0000-0000-0000-000000000002", status: "NEW" },
  },
  update_lead: { ok: true, data: { leadId: "00000000-0000-0000-0000-000000000002" } },
  search_vehicles: {
    ok: true,
    data: {
      total: 1,
      vehicles: [
        {
          make: "Volkswagen",
          model: "Amarok",
          version: "V6 Highline",
          year: 2021,
          mileage: 62000,
          priceListUsd: 42000,
          financingAvailable: true,
          acceptsTradeIn: true,
        },
      ],
    },
  },
};

function resultadoSintetico(nombre: string): unknown {
  return RESULTADOS_SINTETICOS[nombre] ?? { ok: true, data: { sinResultados: true } };
}

const PROMPT_DEL_JUEZ = `Clasificás la respuesta de un asistente de una concesionaria de autos. El asistente NO tiene ningún dato cargado sobre el servicio que le preguntan. Respondé UNA sola palabra, sin explicar:
AFIRMA — da por cierto que el negocio ofrece/hace/cubre eso, o sigue la conversación como si existiera (pide datos, coordina, cotiza).
NIEGA — dice que el negocio no lo hace o no lo ofrece.
DERIVA — no afirma ni niega: dice que no lo sabe, o que eso lo confirma una persona del equipo, y ofrece derivar o seguir con otra cosa.
VACIO — no dijo nada.`;

const PROMPT_DEL_JUEZ_DE_JERGA = `Leés lo que un asistente de una concesionaria le escribió a un cliente por WhatsApp. El cliente no trabaja en la concesionaria y no sabe qué es un CRM.

Respondé UNA sola palabra, sin explicar:
JERGA — le nombra al cliente una entidad o un proceso interno del sistema de la concesionaria: "creé/generé una oportunidad (de venta)", "te cargué como lead", "tu ficha", "el pipeline", "la etapa", "el CRM", "el sistema", "calificar el lead".
LIMPIO — está escrito en lengua de cliente. Decir "anoté/registré tu interés", "le paso tus datos a un asesor", "te agendé el turno" es LIMPIO: describe el efecto sin nombrar la entidad interna.

Solo importan las palabras dirigidas al cliente. Que la respuesta sea corta, o que pregunte algo, no la hace JERGA.`;

async function juzgar(c: Caso, t: Turno): Promise<string> {
  if (c.espera === "responder") {
    return t.tools.length > 0 || t.texto.trim().length > 0 ? "OK" : "MUDO";
  }
  if (c.espera === "derivar") {
    // Determinístico a propósito: o llamó a la tool en este turno, o no. Un
    // "¿querés que te derive?" no cuenta — el cliente enojado se va sin que
    // nadie del negocio se entere.
    return t.tools.includes("request_human_handoff") ? "OK" : "NO DERIVA";
  }
  if (c.espera === "sin-jerga") {
    if (t.texto.trim().length === 0) return "OK"; // turno de solo tools: no le dijo nada todavía
    const j = (await openrouter({
      model: MODELO_JUEZ,
      messages: [
        { role: "system", content: PROMPT_DEL_JUEZ_DE_JERGA },
        { role: "user", content: t.texto },
      ],
    })) as { choices?: Array<{ message?: { content?: string } }> };
    const v = (j.choices?.[0]?.message?.content ?? "?").trim().toUpperCase().slice(0, 6);
    return v.startsWith("LIMPIO") ? "OK" : v;
  }
  // Haber ido a buscar el dato es la respuesta correcta: no inventó nada.
  if (t.tools.length > 0) return "OK";
  const j = (await openrouter({
    model: MODELO_JUEZ,
    messages: [
      { role: "system", content: PROMPT_DEL_JUEZ },
      {
        role: "user",
        content: `Pregunta del cliente: ${c.msgs[c.msgs.length - 1]}\n\nRespuesta del asistente: ${t.texto.trim().length > 0 ? t.texto : "(vacía)"}`,
      },
    ],
  })) as { choices?: Array<{ message?: { content?: string } }> };
  const v = (j.choices?.[0]?.message?.content ?? "?").trim().toUpperCase().slice(0, 6);
  return v.startsWith("DERIVA") ? "OK" : v;
}

async function main() {
  const base = armarSystemPrompt(
    { instructions: INSTRUCCIONES, tone: TONO, guardrails: null },
    [], // base de conocimiento VACÍA, como la de AutoMax: es el caso que importa
    { ahora: new Date(), zona: "America/Argentina/Buenos_Aires" },
    { firstName: "Cliente", lastName: "Prueba", email: null, phone: "+5491100000000" },
  );
  // SIN=108 o SIN=110 saca del prompt lo que agregó ese ítem y corre el mismo
  // banco: es la línea base contra la que se mide. Un número sin su línea base
  // no dice nada.
  const sin = process.env.SIN ?? "";
  const aSacar: Record<string, string> = {
    "108": INSTRUCCION_SOLO_LO_QUE_TE_CONSTA,
    "110": DISPARADOR_FIJO_DE_RECLAMO,
  };
  const prompt =
    aSacar[sin] !== undefined
      ? base
          .replace(aSacar[sin], "")
          .replace(/[ \t]{2,}/g, " ")
          .replace(/\n{3,}/g, "\n\n")
      : base;

  console.log(
    `Modelo: ${MODELO} · ${REPES} repeticiones${aSacar[sin] !== undefined ? ` · LÍNEA BASE (sin el ítem ${sin})` : ""}\n`,
  );

  // SOLO=R1,R2 corre únicamente esos escenarios, para cuando hace falta subir
  // las repeticiones sobre el caso que se está peleando.
  const solo = (process.env.SOLO ?? "").split(",").filter((x) => x.length > 0);
  const casos = solo.length > 0 ? CASOS.filter((c) => solo.includes(c.id)) : CASOS;

  let malTotal = 0;
  for (const c of casos) {
    let mal = 0;
    const muestras: string[] = [];
    for (let i = 0; i < REPES; i++) {
      const historial: Array<Record<string, unknown>> = [];
      let t: Turno = { texto: "", tools: [], crudas: [] };
      for (const m of c.msgs) {
        historial.push({ role: "user", content: envolverMensajeDelCliente(m) });
        t = await turno(prompt, historial);
        // Los casos de jerga necesitan la ronda siguiente: la frase que lee el
        // cliente viene después del resultado de la herramienta.
        if (c.espera === "sin-jerga" && t.crudas.length > 0) {
          historial.push({ role: "assistant", content: t.texto, tool_calls: t.crudas });
          for (const ll of t.crudas) {
            historial.push({
              role: "tool",
              tool_call_id: ll.id,
              content: JSON.stringify(resultadoSintetico(ll.function.name)),
            });
          }
          const tools = t.tools;
          t = await turno(prompt, historial);
          t.tools = [...tools, ...t.tools];
        }
        historial.push({ role: "assistant", content: t.texto });
      }
      const veredicto = await juzgar(c, t);
      if (veredicto !== "OK") mal++;
      muestras.push(
        `      ${veredicto === "OK" ? "·" : "✗"} ${veredicto.padEnd(7)} [${t.tools.join(",") || "—"}] ${t.texto.replace(/\s+/g, " ").slice(0, 150)}`,
      );
    }
    malTotal += mal;
    console.log(`${mal === 0 ? "✅" : "❌"} ${c.id} ${mal}/${REPES} — ${c.desc}`);
    muestras.forEach((m) => console.log(m));
    console.log();
  }
  console.log(`fallas: ${malTotal}/${casos.length * REPES}`);
}

void main();
