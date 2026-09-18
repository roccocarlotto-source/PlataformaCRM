import { CATALOGO_DE_TOOLS } from "./agentTools.service";
import { nombreDeCampo } from "./agentPermissions.service";
import { LlmProviderError, getLlmProvider, type LlmProvider } from "./llmProvider.service";

// ---------------------------------------------------------------------------
// Traducción de guardrails escritos en LENGUAJE NATURAL al objeto JSON de
// docs/ai-agent-architecture.md §6 (ítem 56 de
// docs/frontend-cambios-pendientes.md).
//
// POR QUÉ EXISTE. Hasta el §55 el ADMIN escribía ese objeto a mano en un
// textarea. Rocco pidió que toda la interfaz sea en lenguaje natural: "si
// luego el programa tiene que traducir a JSON para que el agente trabaje
// mejor, bueno, pero el usuario debe manejarse en lenguaje natural". Este
// archivo es esa traducción, y NADA MÁS: no guarda nada, no toca Postgres, no
// conoce Prisma ni el modelo Agent.
//
// LO QUE NO CAMBIA, Y ES EL PUNTO DEL ÍTEM: el objeto que sale de acá es
// EXACTAMENTE el mismo que puedeEjecutarTool() (agentPermissions.service.ts) y
// armarSystemPrompt() (agentOrchestration.service.ts) ya consumen, en forma y
// en semántica. El enforcement no se movió ni un milímetro; lo que cambió es
// cómo un ADMIN llega hasta ese objeto.
//
// EL CATÁLOGO SE LEE DEL CATÁLOGO, NUNCA SE COPIA. Tanto el prompt que se le
// manda al modelo como la sanitización de su respuesta salen de
// CATALOGO_DE_TOOLS y de los `properties` de cada tool. features/agent/tools.ts
// del frontend sí duplica esa lista a mano —y lo documenta— porque el
// frontend no puede importar código del backend; acá se puede, así que
// copiarla sería el mismo error evitable que aquel archivo paga por
// obligación.
//
// LA SANITIZACIÓN ES LA MITAD DEL TRABAJO, no un detalle. Un modelo puede
// devolver una tool que no existe o un campo que ninguna acción toca: eso no
// bloquearía nada en tiempo de ejecución, quedaría como una entrada muerta en
// el guardrail y el ADMIN creería que declaró algo que en realidad no rige.
// Se saca del objeto que va a regir Y se reporta en `descartado`, para que la
// pantalla se lo muestre como advertencia — nada se descarta en silencio.
// ---------------------------------------------------------------------------

export interface DescarteDeGuardrail {
  clave: string;
  valor: string;
  motivo: string;
}

export interface ResultadoDeTraduccion {
  guardrails: Record<string, unknown>;
  descartado: DescarteDeGuardrail[];
}

// Las seis claves de §6, y nada más. Una clave que el modelo invente se
// descarta igual que un valor inventado: la forma de §6 está documentada y es
// la que las dos piezas de enforcement saben leer.
const CLAVES_DE_FRASES = [
  "temasProhibidos",
  "promesasProhibidas",
  "condicionesDeDerivacion",
] as const;

// Topes de cordura para las listas de frases libres (las únicas tres claves
// que no tienen un catálogo contra el que validar). No son reglas de negocio:
// son el límite entre "un guardrail" y "un modelo que se fue de tema y
// devolvió media conversación".
const MAX_ENTRADAS_POR_LISTA = 20;
const MAX_LARGO_DE_FRASE = 300;

// ---------------------------------------------------------------------------
// (a) Los valores válidos, armados desde el catálogo real
// ---------------------------------------------------------------------------

// Lo que la conversación YA SABE cuando puedeEjecutarTool evalúa la
// comprobación (4): las mismas diez claves que arma
// datosDisponiblesDeLaConversacion() en agentOrchestration.service.ts. Un
// `datosRequeridosAntesDeAccion` que pida algo de acá es satisfacible sin que
// el modelo lo pase como argumento, así que son valores válidos tanto como los
// argumentos de las tools.
export const CLAVES_DE_AMBIENTE = [
  "conversationId",
  "contactId",
  "branchId",
  "agentId",
  "channel",
  "firstName",
  "lastName",
  "email",
  "phone",
  "companyId",
] as const;

export function nombresDeToolsValidos(): string[] {
  return Array.from(CATALOGO_DE_TOOLS.keys());
}

// Los nombres de argumento que una tool declara en su JSON Schema. `parameters`
// es un Record<string, unknown> (LlmToolDefinition no tipa el schema), así que
// la lectura es defensiva: una tool sin `properties` aporta cero campos en vez
// de romper.
export function camposDeTool(toolName: string): string[] {
  const tool = CATALOGO_DE_TOOLS.get(toolName);
  if (!tool) {
    return [];
  }
  const properties = (tool.definition.parameters as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return [];
  }
  return Object.keys(properties as Record<string, unknown>);
}

// Todos los nombres de campo que un guardrail puede nombrar con sentido: los
// argumentos de cualquier tool más las claves de ambiente.
export function camposValidos(): string[] {
  const todos = new Set<string>(CLAVES_DE_AMBIENTE);
  for (const toolName of nombresDeToolsValidos()) {
    for (const campo of camposDeTool(toolName)) {
      todos.add(campo);
    }
  }
  return Array.from(todos);
}

// OJO CON infoNoModificable: puedeEjecutarTool compara por NOMBRE DE CAMPO
// PELADO, sin importar la tool ni el prefijo de entidad (nombreDeCampo() corta
// todo antes del último punto y compara en minúsculas). O sea que si el ADMIN
// escribe "no dejes que toque el email del contacto", lo que rige es
// simplemente "email" — y "email" hoy NO es argumento de ninguna de las seis
// tools: es una clave de ambiente, así que pasa el filtro pero no puede
// bloquear nada, exactamente igual que el ejemplo `Contact.email` del propio
// §6. Filtrar contra los campos reales + el ambiente es lo que evita que un
// pedido sobre un dato que ninguna tool toca se convierta en una entrada
// muerta del guardrail.
function conjuntoDeCamposValidos(): Set<string> {
  return new Set(camposValidos().map((campo) => campo.toLowerCase()));
}

// ---------------------------------------------------------------------------
// (b) El system prompt de traducción
// ---------------------------------------------------------------------------

export function armarPromptDeTraduccion(): string {
  const tools = nombresDeToolsValidos();

  const catalogo = tools
    .map((nombre) => {
      const tool = CATALOGO_DE_TOOLS.get(nombre);
      const campos = camposDeTool(nombre);
      const listaDeCampos = campos.length > 0 ? campos.join(", ") : "(sin argumentos)";
      return `- ${nombre}: ${tool?.definition.description ?? ""}\n  Campos de esta acción: ${listaDeCampos}`;
    })
    .join("\n");

  return [
    "Sos un traductor. Convertís la descripción en lenguaje natural que un administrador escribió sobre los límites de su agente de IA en un objeto JSON con una forma fija. No conversás, no opinás, no pedís aclaraciones: devolvés el objeto y nada más.",

    "El objeto tiene exactamente estas seis claves, TODAS OPCIONALES (omitir la que no aplique; nunca inventar una clave que no esté en esta lista):",
    [
      '- "temasProhibidos": lista de frases. Temas sobre los que el agente no puede responder ni opinar (ej. "diagnósticos médicos", "asesoramiento legal").',
      '- "accionesProhibidas": lista de NOMBRES DE ACCIÓN. Acciones que el agente no puede ejecutar nunca, aunque estén habilitadas.',
      '- "infoNoModificable": lista de NOMBRES DE CAMPO. Datos que ninguna acción del agente puede modificar.',
      '- "condicionesDeDerivacion": lista de frases. Situaciones en las que el agente tiene que derivar la conversación a una persona (ej. "el cliente pide hablar con una persona", "reclamo o queja").',
      '- "promesasProhibidas": lista de frases. Cosas que el agente nunca puede prometer ni confirmar (ej. "descuentos no publicados", "plazos de entrega no confirmados").',
      '- "datosRequeridosAntesDeAccion": objeto donde cada clave es un NOMBRE DE ACCIÓN y su valor es una lista de NOMBRES DE CAMPO que tienen que conocerse antes de ejecutarla.',
    ].join("\n"),

    `Las acciones que existen son SOLO estas, con la descripción que el propio agente lee y los campos de cada una:\n${catalogo}`,

    `Además de los campos de cada acción, estos nombres de campo son válidos porque la conversación ya los conoce: ${CLAVES_DE_AMBIENTE.join(", ")}.`,

    "Reglas:",
    [
      '1. Si el administrador menciona una acción, un campo o un dato que no corresponde exactamente a un nombre de la lista, elegí el más cercano que SÍ esté en la lista (ej. "no cambies el monto" → el campo amount de update_opportunity). NUNCA inventes un nombre que no esté listado.',
      "2. Si no encontrás ninguno razonablemente cercano, omití esa parte en vez de inventar.",
      "3. Las frases de temasProhibidos, promesasProhibidas y condicionesDeDerivacion van cortas y en español, una idea por entrada.",
      "4. Si el texto no declara ningún límite, devolvé {}.",
    ].join("\n"),

    "Respondé ÚNICAMENTE con el objeto JSON. Sin texto antes ni después, sin explicaciones y sin bloques de código de markdown.",
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// (d) Parseo de la respuesta
// ---------------------------------------------------------------------------

const MENSAJE_RESPUESTA_ININTELIGIBLE =
  "No se pudo interpretar la traducción del modelo, probá de nuevo";

// Un modelo envuelve la respuesta en ```json ... ``` a pesar de la instrucción
// más seguido de lo que uno querría. Sacar la cerca es más barato que fallar y
// pedirle al ADMIN que reintente por algo que no es culpa suya.
function sinCercaDeCodigo(texto: string): string {
  const match = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/i.exec(texto);
  return match ? match[1] : texto;
}

function parsearRespuesta(texto: string | null): Record<string, unknown> {
  if (texto === null || texto.trim() === "") {
    throw new LlmProviderError(MENSAJE_RESPUESTA_ININTELIGIBLE);
  }

  let parseado: unknown;
  try {
    parseado = JSON.parse(sinCercaDeCodigo(texto));
  } catch {
    throw new LlmProviderError(MENSAJE_RESPUESTA_ININTELIGIBLE);
  }

  if (!parseado || typeof parseado !== "object" || Array.isArray(parseado)) {
    throw new LlmProviderError(MENSAJE_RESPUESTA_ININTELIGIBLE);
  }

  return parseado as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// (e) Sanitización contra el catálogo real
// ---------------------------------------------------------------------------

function sinDuplicados<T>(valores: T[]): T[] {
  return Array.from(new Set(valores));
}

// Un valor que no es una lista de strings no se puede sanitizar entrada por
// entrada: se descarta entero, con el motivo. Devuelve los strings y anota en
// `descartado` lo que no lo era.
function comoListaDeStrings(
  clave: string,
  valor: unknown,
  descartado: DescarteDeGuardrail[],
): string[] | null {
  if (!Array.isArray(valor)) {
    descartado.push({
      clave,
      valor: JSON.stringify(valor),
      motivo: "no es una lista",
    });
    return null;
  }

  const strings: string[] = [];
  for (const entrada of valor) {
    if (typeof entrada === "string") {
      strings.push(entrada);
    } else {
      descartado.push({ clave, valor: JSON.stringify(entrada), motivo: "no es un texto" });
    }
  }
  return strings;
}

function sanitizarAcciones(valor: unknown, descartado: DescarteDeGuardrail[]): string[] {
  const entradas = comoListaDeStrings("accionesProhibidas", valor, descartado);
  if (entradas === null) {
    return [];
  }
  const validas = new Set(nombresDeToolsValidos());

  return sinDuplicados(
    entradas.filter((entrada) => {
      if (validas.has(entrada)) {
        return true;
      }
      descartado.push({
        clave: "accionesProhibidas",
        valor: entrada,
        motivo: `"${entrada}" no es ninguna de las acciones del agente`,
      });
      return false;
    }),
  );
}

function sanitizarCampos(valor: unknown, descartado: DescarteDeGuardrail[]): string[] {
  const entradas = comoListaDeStrings("infoNoModificable", valor, descartado);
  if (entradas === null) {
    return [];
  }
  const validos = conjuntoDeCamposValidos();

  return sinDuplicados(
    entradas.filter((entrada) => {
      if (validos.has(nombreDeCampo(entrada))) {
        return true;
      }
      descartado.push({
        clave: "infoNoModificable",
        valor: entrada,
        motivo: `"${entrada}" no es un dato que ninguna acción del agente pueda tocar`,
      });
      return false;
    }),
  );
}

function sanitizarDatosRequeridos(
  valor: unknown,
  descartado: DescarteDeGuardrail[],
): Record<string, string[]> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    descartado.push({
      clave: "datosRequeridosAntesDeAccion",
      valor: JSON.stringify(valor),
      motivo: "no es un objeto de acción → datos requeridos",
    });
    return {};
  }

  const validas = new Set(nombresDeToolsValidos());
  const salida: Record<string, string[]> = {};

  for (const [toolName, requeridos] of Object.entries(valor as Record<string, unknown>)) {
    if (!validas.has(toolName)) {
      descartado.push({
        clave: "datosRequeridosAntesDeAccion",
        valor: toolName,
        motivo: `"${toolName}" no es ninguna de las acciones del agente`,
      });
      continue;
    }

    const entradas = comoListaDeStrings(
      `datosRequeridosAntesDeAccion.${toolName}`,
      requeridos,
      descartado,
    );
    if (entradas === null) {
      continue;
    }

    // Los campos de ESA tool más el ambiente: pedir un argumento de otra tool
    // antes de ejecutar esta no significaría nada — puedeEjecutarTool lo
    // buscaría en `args` (donde nunca va a estar) y en los datos de la
    // conversación (donde tampoco), así que la tool quedaría bloqueada para
    // siempre.
    const validos = new Set(
      [...camposDeTool(toolName), ...CLAVES_DE_AMBIENTE].map((campo) => campo.toLowerCase()),
    );

    const campos = sinDuplicados(
      entradas.filter((entrada) => {
        if (validos.has(nombreDeCampo(entrada))) {
          return true;
        }
        descartado.push({
          clave: `datosRequeridosAntesDeAccion.${toolName}`,
          valor: entrada,
          motivo: `"${entrada}" no es un dato de la acción "${toolName}"`,
        });
        return false;
      }),
    );

    if (campos.length > 0) {
      salida[toolName] = campos;
    }
  }

  return salida;
}

function sanitizarFrases(
  clave: string,
  valor: unknown,
  descartado: DescarteDeGuardrail[],
): string[] {
  const entradas = comoListaDeStrings(clave, valor, descartado);
  if (entradas === null) {
    return [];
  }

  const aceptadas: string[] = [];
  for (const entrada of entradas) {
    const frase = entrada.trim();
    if (frase === "") {
      continue;
    }
    // Se descarta ENTERA y se reporta, no se trunca: media instrucción es peor
    // que ninguna, porque parece completa.
    if (frase.length > MAX_LARGO_DE_FRASE) {
      descartado.push({
        clave,
        valor: `${frase.slice(0, 60)}…`,
        motivo: `supera los ${MAX_LARGO_DE_FRASE} caracteres`,
      });
      continue;
    }
    aceptadas.push(frase);
  }

  const unicas = sinDuplicados(aceptadas);
  if (unicas.length > MAX_ENTRADAS_POR_LISTA) {
    for (const sobrante of unicas.slice(MAX_ENTRADAS_POR_LISTA)) {
      descartado.push({
        clave,
        valor: sobrante,
        motivo: `la lista no puede tener más de ${MAX_ENTRADAS_POR_LISTA} entradas`,
      });
    }
    return unicas.slice(0, MAX_ENTRADAS_POR_LISTA);
  }
  return unicas;
}

export function sanitizarGuardrails(crudo: Record<string, unknown>): ResultadoDeTraduccion {
  const descartado: DescarteDeGuardrail[] = [];
  const guardrails: Record<string, unknown> = {};

  const claves = new Set<string>([
    ...CLAVES_DE_FRASES,
    "accionesProhibidas",
    "infoNoModificable",
    "datosRequeridosAntesDeAccion",
  ]);

  for (const clave of Object.keys(crudo)) {
    if (!claves.has(clave)) {
      // Una clave que el modelo inventó no rige nada: puedeEjecutarTool y
      // armarSystemPrompt leen las seis de §6 y ninguna otra. Se descarta y se
      // reporta — es exactamente el caso que dejó viva una clave muerta antes
      // de que existiera esta sanitización.
      descartado.push({
        clave,
        valor: JSON.stringify(crudo[clave]),
        motivo: `"${clave}" no es uno de los límites que el agente sabe hacer cumplir`,
      });
    }
  }

  if (crudo.accionesProhibidas !== undefined) {
    const acciones = sanitizarAcciones(crudo.accionesProhibidas, descartado);
    if (acciones.length > 0) {
      guardrails.accionesProhibidas = acciones;
    }
  }

  if (crudo.infoNoModificable !== undefined) {
    const campos = sanitizarCampos(crudo.infoNoModificable, descartado);
    if (campos.length > 0) {
      guardrails.infoNoModificable = campos;
    }
  }

  if (crudo.datosRequeridosAntesDeAccion !== undefined) {
    const datos = sanitizarDatosRequeridos(crudo.datosRequeridosAntesDeAccion, descartado);
    if (Object.keys(datos).length > 0) {
      guardrails.datosRequeridosAntesDeAccion = datos;
    }
  }

  for (const clave of CLAVES_DE_FRASES) {
    if (crudo[clave] === undefined) {
      continue;
    }
    const frases = sanitizarFrases(clave, crudo[clave], descartado);
    if (frases.length > 0) {
      guardrails[clave] = frases;
    }
  }

  return { guardrails, descartado };
}

// ---------------------------------------------------------------------------
// (c) La llamada al proveedor — el punto de entrada del endpoint
// ---------------------------------------------------------------------------

// `llmProvider` inyectable por la MISMA razón que en runAgentTurn: es lo que
// permite que agentGuardrailsTranslation.service.test.ts sea un test unitario,
// sin red y sin base.
export async function translateGuardrailsText(
  text: string,
  llmProvider?: LlmProvider,
): Promise<ResultadoDeTraduccion> {
  // Texto vacío ⇒ {} directo, sin gastar una llamada al proveedor. Mismo
  // criterio que tenía el textarea de JSON vacío del §55: la intención es
  // evidente y no hay nada que traducir.
  if (text.trim() === "") {
    return { guardrails: {}, descartado: [] };
  }

  const llm = llmProvider ?? getLlmProvider();

  // SIN tools: esto es una traducción, no una conversación con tool-calling. Y
  // sin `model`: el adaptador usa el default de OPENROUTER_MODEL. No depende
  // del modelName del agente que se está creando — traducir es una tarea de
  // criterio fijo, no parte del comportamiento configurable del agente.
  const resultado = await llm.complete({
    systemPrompt: armarPromptDeTraduccion(),
    messages: [{ role: "user", content: text }],
    tools: [],
  });

  return sanitizarGuardrails(parsearRespuesta(resultado.text));
}
