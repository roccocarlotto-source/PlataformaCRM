// ---------------------------------------------------------------------------
// Guardrails de salud de una clínica (docs/rubros.md §5.3, D11). PURO: sin
// red, sin base y sin modelo. Lo usan los puntos de extensión del loop del
// agente a través de las reglas del rubro (src/services/reglasDelRubro.ts).
//
//   - Capa 1, entrante: clasificarMensajeDeSalud → URGENCIA / CLINICA /
//     NINGUNO. URGENCIA y CLINICA se contestan con un mensaje fijo y derivan
//     sin llamar al modelo.
//   - Capa 2, prompt: INSTRUCCION_SALUD. No es la garantía.
//   - Capa 3, saliente: daIndicacionClinica, sobre la respuesta del modelo.
//
// UN FALSO POSITIVO ES ACEPTABLE; UN FALSO NEGATIVO NO. Por eso las listas son
// amplias y la comparación tolera tildes, signos, letras repetidas y un error
// de tipeo en las palabras largas. Derivar de más a una persona es un costo;
// que el agente conteste una consulta clínica, no.
//
// La lista la revisa una persona del área de salud antes del primer cliente
// (docs/rubros.md §10). Cambiarla es un PR con tests: un caso por término en
// src/clinicas/guardrailsDeSalud.test.ts.
// ---------------------------------------------------------------------------

export type ClasificacionDeSalud = "URGENCIA" | "CLINICA" | "NINGUNO";

/** Minúsculas, sin tildes, sin signos, espacios colapsados y letras repetidas
 *  reducidas a una ("ardeeee" → "arde"). Se aplica igual a los términos y al
 *  mensaje, así que "ll" o "rr" quedan como una sola letra en los dos lados. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/(.)\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Cómo se escribe un término
//
//   "no puedo respirar"   frase: palabras seguidas.
//   "hinch*"              el asterisco es "cualquier final": hinchó,
//                         hinchada, hinchazón.
//   ["hinch*", "cara"]    todas las partes en cualquier lugar del mensaje
//                         (cada parte es a su vez una frase).
//
// Tolerancia a un error de tipeo (ya normalizado): una palabra completa de 7
// letras o más, o una raíz con asterisco de 6 o más ("desmay*" agarra
// "desmallé"), acepta una letra de más, de menos o cambiada. Las cortas son
// exactas: con tolerancia, "dolor" confundiría "color", y "medico", "medio".
// Dos letras invertidas ("nromal") cuentan como dos errores.
// ---------------------------------------------------------------------------

export type Termino = string | readonly string[];

const LARGO_MINIMO_CON_TOLERANCIA = 7;
const LARGO_MINIMO_DE_RAIZ_CON_TOLERANCIA = 6;

function distanciaDeEdicion(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previa[0];
    previa[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const arriba = previa[j];
      previa[j] = Math.min(
        previa[j] + 1,
        previa[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = arriba;
    }
  }
  return previa[b.length];
}

function coincidePalabra(patron: string, palabra: string): boolean {
  if (patron.endsWith("*")) {
    const raiz = patron.slice(0, -1);
    if (palabra.startsWith(raiz)) return true;
    if (raiz.length < LARGO_MINIMO_DE_RAIZ_CON_TOLERANCIA) return false;
    return [raiz.length - 1, raiz.length, raiz.length + 1].some(
      (largo) => distanciaDeEdicion(raiz, palabra.slice(0, largo)) <= 1,
    );
  }
  if (patron === palabra) return true;
  return patron.length >= LARGO_MINIMO_CON_TOLERANCIA && distanciaDeEdicion(patron, palabra) <= 1;
}

function contieneFrase(palabras: readonly string[], frase: string): boolean {
  const patron = normalizar(frase.replace(/\*/g, " ASTERISCO "))
    .replace(/ asterisco/g, "*")
    .split(" ")
    .filter((p) => p.length > 0);
  if (patron.length === 0) return false;
  for (let inicio = 0; inicio + patron.length <= palabras.length; inicio++) {
    if (patron.every((p, k) => coincidePalabra(p, palabras[inicio + k]))) return true;
  }
  return false;
}

function contieneTermino(palabras: readonly string[], termino: Termino): boolean {
  return typeof termino === "string"
    ? contieneFrase(palabras, termino)
    : termino.every((parte) => contieneFrase(palabras, parte));
}

function palabrasDe(texto: string): string[] {
  const normalizado = normalizar(texto);
  return normalizado.length > 0 ? normalizado.split(" ") : [];
}

// ---------------------------------------------------------------------------
// Capa 1: URGENCIA. Gana sobre todo (docs/rubros.md §5.3): sobre una persona
// atendiendo, sobre el horario, sobre el nivel de IA y sobre el agente
// apagado.
// ---------------------------------------------------------------------------

const PARTES_DE_LA_CARA = ["cara", "lengua", "labio*", "boca", "garganta", "ojo*", "parpado*"];

export const TERMINOS_DE_URGENCIA: readonly Termino[] = [
  // Respiración.
  "no puedo respirar",
  "no puede respirar",
  "no respira",
  "me cuesta respirar",
  "le cuesta respirar",
  "dificultad para respirar",
  "me falta el aire",
  "le falta el aire",
  "me ahogo",
  "se ahoga",
  "ahogando",
  "asfixi*",
  "se me cierra la garganta",
  "se me cerro la garganta",
  // Hinchazón de la cara o la vía aérea (reacción alérgica grave).
  ...PARTES_DE_LA_CARA.map((parte) => ["hinch*", parte] as const),
  ...PARTES_DE_LA_CARA.map((parte) => ["inflam*", parte] as const),
  "anafila*",
  "shock",
  "reaccion alergica grave",
  // Pecho y corazón.
  ["dolor*", "pecho"],
  ["duele*", "pecho"],
  ["presion", "pecho"],
  ["aprieta*", "pecho"],
  "infarto",
  "taquicardia",
  "el corazon me late muy rapido",
  "palpitaciones",
  // Conciencia, convulsiones, ACV.
  "desmay*",
  "me desvaneci",
  "perdi el conocimiento",
  "perdio el conocimiento",
  "inconsciente",
  "no reacciona",
  "convulsi*",
  "ataque de epilepsia",
  "acv",
  "derrame cerebral",
  "no puedo mover",
  "no puede mover",
  "no siento el brazo",
  "no siento la pierna",
  "se me duerme la mitad",
  "cara torcida",
  "boca torcida",
  "no puedo hablar",
  "habla raro",
  // Sangrado.
  "hemorragi*",
  "no para de sangrar",
  "no deja de sangrar",
  ["sangr*", "mucho"],
  ["sangr*", "sin parar"],
  ["sangr*", "abundante"],
  ["sangr*", "a chorros"],
  // Daño a uno mismo.
  "suicid*",
  "matarme",
  "me quiero matar",
  "quitarme la vida",
  "no quiero vivir",
  "no quiero seguir viviendo",
  "hacerme dano",
  "lastimarme",
  "autolesi*",
  "cortarme",
  // Intoxicación.
  "sobredosis",
  "envenen*",
  "intoxic*",
  "me tome todas las pastillas",
  // Otros.
  "emergencia",
  "ambulancia",
  "911",
  "fiebre muy alta",
  "fiebre de 40",
  "quemadura grave",
];

// ---------------------------------------------------------------------------
// Capa 1: CLINICA. Síntomas o reacciones, medicación, "¿es normal?",
// embarazo o lactancia, diagnóstico, condiciones previas.
// ---------------------------------------------------------------------------

export const TERMINOS_CLINICOS: readonly Termino[] = [
  // Síntomas y reacciones.
  "me salio",
  "me salieron",
  "le salio",
  "me aparecio",
  "me aparecieron",
  "me arde",
  "arde",
  "ardor",
  "me pica",
  "pica mucho",
  "picazon",
  "comezon",
  "rojiz*",
  "enrojec*",
  "me quedo rojo",
  "me quedo roja",
  "quedo rojo",
  "quedo roja",
  "esta rojo",
  "esta roja",
  "irritad*",
  "irritacion",
  "inflamad*",
  "inflamacion",
  "hinch*",
  "infect*",
  "infeccion",
  "pus",
  "supura*",
  "dolor*",
  "duele*",
  "doli*",
  "molestia*",
  "ampolla*",
  "costra*",
  "cicatriz*",
  "moreton*",
  "hematoma*",
  "sangr*",
  "fiebre",
  "alergi*",
  "reaccion",
  "sintoma*",
  "mareo*",
  "mareada",
  "mareado",
  "nausea*",
  "vomit*",
  "herida*",
  "quemadura*",
  "me queme",
  "me quemo",
  "descam*",
  "se me pela",
  "mancha*",
  "grano*",
  "roncha*",
  "sarpullido",
  "eczema",
  "eccema",
  "dermatitis",
  "acne",
  "hongo*",
  "verruga*",
  "lunar",
  "bulto",
  "quiste",
  "se me cae el pelo",
  "caida del pelo",
  // Medicación. Sin "puedo tomar" ni "puedo usar": son "¿puedo tomar el turno
  // de las 10?" y "¿puedo usar tarjeta?". La medicación se reconoce por su
  // nombre.
  "tomar algo para",
  "tomo algo",
  "medicamento*",
  "medicacion",
  "medico",
  "remedio*",
  "pastilla*",
  "comprimido*",
  "antibiotic*",
  "antiinflamatori*",
  "anti inflamatori*",
  "ibuprofeno",
  "paracetamol",
  "aspirina",
  "diclofenac*",
  "isotretinoina",
  "roacutan",
  "anticoagul*",
  "corticoid*",
  "cortisona",
  "antihistamini*",
  "pomada",
  "dosis",
  "miligramos",
  "receta",
  // ¿Es normal? Diagnóstico.
  "es normal",
  "sera normal",
  "es grave",
  "sera grave",
  // Sin "que tengo" ni "sera que": son "¿qué tengo que llevar?" y "¿será que
  // tienen lugar?".
  "que me pasa",
  "que me paso",
  "que puede ser",
  "que sera esto",
  "que es esto",
  "diagnostic*",
  "tengo que preocuparme",
  "me tengo que preocupar",
  "deberia ir al medico",
  "contraindic*",
  ["efecto*", "secundario*"],
  "efecto adverso",
  "riesgo*",
  "complicacion*",
  // Embarazo y lactancia.
  "embaraz*",
  "lactancia",
  "amamant*",
  "dando la teta",
  "dando el pecho",
  "estoy de semanas",
  // Condiciones previas y operaciones.
  "diabet*",
  "hipertens*",
  "presion alta",
  "cancer",
  "oncolog*",
  "quimio*",
  "radioterapia",
  "marcapaso*",
  "epilep*",
  "herpes",
  "hepatitis",
  "vih",
  "tiroides",
  "me opere",
  "me operaron",
  "postoperatori*",
  "post operatorio",
  // Pedido de atención que no se puede evaluar por chat.
  "urgente",
  // El motivo con el que INSTRUCCION_SALUD le pide al modelo derivar: así una
  // derivación del modelo también lleva el aviso fijo, sin su resumen.
  "consulta clinica",
];

export function clasificarMensajeDeSalud(texto: string): ClasificacionDeSalud {
  const palabras = palabrasDe(texto);
  if (palabras.length === 0) return "NINGUNO";
  if (TERMINOS_DE_URGENCIA.some((t) => contieneTermino(palabras, t))) return "URGENCIA";
  if (TERMINOS_CLINICOS.some((t) => contieneTermino(palabras, t))) return "CLINICA";
  return "NINGUNO";
}

// ---------------------------------------------------------------------------
// Capa 3: la respuesta del modelo. Dosis, indicaciones sobre el cuerpo y
// frases diagnósticas. Sobre el texto NORMALIZADO: por eso las palabras van
// escritas como quedan después de normalizar ("pastila", "reacion",
// "infecion"), con las letras dobles reducidas.
// ---------------------------------------------------------------------------

const UNIDADES = "(mg|ml|mcg|miligramos|mililitros|gotas|comprimidos|capsulas|pastilas|grageas)";
const NUMEROS = "(\\d+|una|dos|tres|cuatro|seis|ocho|doce|veinticuatro)";

const PATRONES_DE_INDICACION_CLINICA: readonly RegExp[] = [
  // Dosis.
  new RegExp(`\\b\\d+([.,]\\d+)? ?${UNIDADES}\\b`),
  new RegExp(`\\bcada ${NUMEROS} horas\\b`),
  new RegExp(`\\b${NUMEROS} veces (al|por) dia\\b`),
  /\bdosis\b/,
  // Medicación nombrada en la respuesta.
  /\b(ibuprofeno|paracetamol|aspirina|diclofenac\w*|antibiotic\w*|antinflamatori\w*|antihistamini\w*|corticoid\w*|cortisona|isotretinoina)\b/,
  // Indicaciones sobre el cuerpo.
  /\b(aplicate|untate|frotate|lavate|tomate (una|un|el|la|los|las|dos|tres))\b/,
  // Sin "pasate" ni "ponete" solos: "pasate por la clínica", "ponete en
  // contacto".
  /\b(ponete|pasate) (crema|hielo|frio|calor|pomada|una|un|el|la)\b/,
  /\btoma (una|un|el|la) (pastila|comprimido|capsula|remedio|medicamento|ibuprofeno|paracetamol|aspirina)\b/,
  /\b(suspende|suspendas|deja de tomar|deja de usar|deja de aplicar|no dejes de tomar)\b/,
  /\b(pone|pone te|aplica|aplicale) (hielo|frio|calor|crema|pomada|compresas?)\b/,
  /\bno te (rasques|toques|laves|expongas)\b/,
  /\bhace reposo\b/,
  // Frases diagnósticas.
  /\bparece (ser|una|un)\b/,
  /\bes normal\b/,
  /\b(no )?es grave\b/,
  /\bprobablemente (sea|es|tengas|se trate)\b/,
  /\bpuede ser (una|un) (alergia|infecion|reacion|iritacion|dermatitis|hongo|quemadura)\b/,
  /\b(tenes|tendrias|seguro tenes) (una|un) (alergia|infecion|reacion|iritacion|dermatitis|hongo)\b/,
  /\bse trata de (una|un)\b/,
  /\bes (una|un) (alergia|infecion|reacion|iritacion|dermatitis|hongo|quemadura)\b/,
  /\bsintomas? de\b/,
];

/** Si la respuesta del modelo da una indicación clínica: una dosis, una
 *  indicación sobre el cuerpo o una frase diagnóstica. Si da positivo, la
 *  respuesta no sale (docs/rubros.md §5.3, capa 3). */
export function daIndicacionClinica(texto: string): boolean {
  const normalizado = normalizar(texto);
  return PATRONES_DE_INDICACION_CLINICA.some((patron) => patron.test(normalizado));
}

// ---------------------------------------------------------------------------
// Capa 2: la instrucción fija del rubro en el system prompt.
// ---------------------------------------------------------------------------

export const INSTRUCCION_SALUD =
  'Atendés a pacientes de un centro de salud o estética. No sos un profesional de la salud y no podés actuar como uno: no diagnostiques, no interpretes síntomas ni fotos, no indiques tratamientos, cuidados, medicación ni dosis, y no digas si algo es normal o grave. Si el paciente cuenta un síntoma, una reacción o un malestar, pregunta por medicación, embarazo o lactancia, o hace cualquier consulta clínica, no la respondas: derivá con request_human_handoff con el motivo "consulta clínica", sin resumir lo que contó. Si describe una urgencia, decile que llame a emergencias y derivá. Podés ayudar con turnos, horarios, precios y lo que esté en la información del negocio.';
