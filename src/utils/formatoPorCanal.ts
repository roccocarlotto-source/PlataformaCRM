import type { ConversationChannel } from "@prisma/client";

// ---------------------------------------------------------------------------
// El texto del agente, en el formato que entiende cada canal.
//
// El modelo escribe en Markdown: negritas con **x** o *x*, cursivas con _x_,
// títulos con #, viñetas con "- " o "* ". Ningún canal lo renderiza igual:
//   - WhatsApp tiene su propia negrita, *x* (un solo asterisco), y "- " ya se
//     ve como viñeta. "**x**" se muestra con los asteriscos.
//   - Messenger e Instagram no renderizan NADA: "*Renault Kwid Zen (2021)*" se
//     ve con los asteriscos tal cual (visto en producción el 05/10/2026).
//   - El widget web mete el texto por textContent, sin markup: también muestra
//     los asteriscos tal cual, y el CRM (la bandeja) igual.
//
// Por eso el saliente del agente pasa por acá ANTES de guardarse: lo que
// queda en la base es lo que el cliente ve, lo que la bandeja muestra, lo que
// compara el reconocimiento de ecos de Meta (conversationReply.service.ts) y
// lo que se parte por largo al mandar (utils/partirMensaje.ts). Solo el texto
// del agente: lo que escribe una persona sale como lo escribió.
//
// LOS LINKS NO SE TOCAN: una URL puede llevar "_" y "*" (/catalogo/kwid_zen),
// así que el texto se recorre por tramos y las URLs se dejan pasar enteras.
// Los "_" dentro de una palabra (snake_case, un mail) tampoco son formato: la
// cursiva exige el guion bajo pegado al texto y despegado de lo de alrededor.
// ---------------------------------------------------------------------------

const URL = /https?:\/\/[^\s<>()]+/g;

// `**x**` → `*x*` (la negrita de WhatsApp). Lo demás WhatsApp lo muestra bien:
// *x* ya es negrita, _x_ cursiva y "- " viñeta. Un "#" de título se saca, que
// WhatsApp no tiene títulos.
function paraWhatsapp(tramo: string): string {
  return sacarTitulos(tramo.replace(/\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/g, "*$1*"));
}

// Texto plano: sin marcas de negrita, cursiva ni título, y las viñetas con "• ".
function aTextoPlano(tramo: string): string {
  let texto = tramo;
  // Negrita doble, primero: si se sacara el simple antes, "**x**" quedaría "*x*".
  texto = texto.replace(/\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/g, "$1");
  texto = texto.replace(/__(?!\s)([^_\n]+?)(?<!\s)__/g, "$1");
  // Simple: el asterisco pegado al texto y sin otro asterisco al lado. "2 * 3"
  // o "5*" (una nota al pie) no son formato y quedan como están.
  texto = texto.replace(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, "$1");
  texto = texto.replace(/(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])/g, "$1");
  texto = sacarTitulos(texto);
  // Viñetas al principio de un renglón, con la sangría que tengan.
  texto = texto.replace(/^([ \t]*)[-*•][ \t]+/gm, "$1• ");
  return texto;
}

function sacarTitulos(tramo: string): string {
  return tramo.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
}

// Aplica `transformar` a todo lo que NO es una URL, y deja las URLs enteras.
function porTramos(texto: string, transformar: (tramo: string) => string): string {
  let resultado = "";
  let desde = 0;
  for (const m of texto.matchAll(URL)) {
    resultado += transformar(texto.slice(desde, m.index)) + m[0];
    desde = m.index + m[0].length;
  }
  return resultado + transformar(texto.slice(desde));
}

// El texto del agente tal como tiene que salir por `canal`.
export function formatearParaElCanal(texto: string, canal: ConversationChannel): string {
  switch (canal) {
    case "WHATSAPP":
      return porTramos(texto, paraWhatsapp);
    case "MESSENGER":
    case "INSTAGRAM":
    case "WEB":
      return porTramos(texto, aTextoPlano);
  }
}
