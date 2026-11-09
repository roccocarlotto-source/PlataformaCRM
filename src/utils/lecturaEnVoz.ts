// ---------------------------------------------------------------------------
// TELÉFONOS Y MAILS, COMO SE DICEN. El modelo los escribe tal cual (cifras y
// arroba) y esto los pasa a cómo se leen por teléfono. Lo hace el código y no
// el modelo: en una llamada de prueba el modelo leyó "cuatro seis cuatro"
// donde el cliente había dicho "cuatro seis ocho" (2026-11-08).
//
//   - Teléfono: "096 468 788" → "cero noventa y seis, cuatro seis ocho, siete
//     ocho ocho". De a grupos de tres (los que escribió el modelo, si los
//     separó), cifra por cifra; un primer grupo "09x" se dice "cero noventa y
//     x", como lo dice la gente en Uruguay.
//   - Mail: "persona@gmail.com" → "pe, e, erre, ese, o, ene, a, arroba, gmail,
//     punto, com". Letra por letra con su nombre; los dominios conocidos, como
//     palabra.
//
// QUÉ ES UN TELÉFONO, a propósito estrecho: un monto sin separadores
// ("1500000 pesos") o el número de una patente no se tienen que leer como
// teléfono. Es teléfono si:
//   - empieza con "+" (8 a 15 cifras), o
//   - empieza con "0" (8 a 11 cifras), o
//   - viene en grupos separados por espacio o guion (8 a 11 cifras en total).
// Y en ningún caso si está pegado a una moneda o a una unidad ("$", "US$",
// "pesos", "dólares", "km"...). Un número de 7 u 8 cifras seguidas sin 0
// adelante, sin "+" y sin grupos queda como está.
// ---------------------------------------------------------------------------

const DIGITOS = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];

const DE_DIEZ_A_VEINTINUEVE = [
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciséis",
  "diecisiete",
  "dieciocho",
  "diecinueve",
  "veinte",
  "veintiuno",
  "veintidós",
  "veintitrés",
  "veinticuatro",
  "veinticinco",
  "veintiséis",
  "veintisiete",
  "veintiocho",
  "veintinueve",
];

const DECENAS = [
  "",
  "",
  "",
  "treinta",
  "cuarenta",
  "cincuenta",
  "sesenta",
  "setenta",
  "ochenta",
  "noventa",
];

// 10 a 99, como se dice.
function dosCifras(n: number): string {
  if (n < 30) {
    return DE_DIEZ_A_VEINTINUEVE[n - 10];
  }
  const decena = DECENAS[Math.floor(n / 10)];
  const unidad = n % 10;
  return unidad === 0 ? decena : `${decena} y ${DIGITOS[unidad]}`;
}

function cifraPorCifra(grupo: string): string {
  return [...grupo].map((c) => DIGITOS[Number(c)]).join(" ");
}

// Sin grupos escritos: de a tres desde la izquierda; si sobra una cifra, el
// último grupo queda de cuatro ("099 123 4567").
function enGruposDeTres(cifras: string): string[] {
  const grupos: string[] = [];
  let i = 0;
  while (cifras.length - i > 4) {
    grupos.push(cifras.slice(i, i + 3));
    i += 3;
  }
  grupos.push(cifras.slice(i));
  return grupos;
}

function leerGrupos(grupos: string[]): string {
  return grupos
    .map((grupo, i) =>
      i === 0 && grupo.length === 3 && grupo[0] === "0" && grupo[1] !== "0"
        ? `cero ${dosCifras(Number(grupo.slice(1)))}`
        : cifraPorCifra(grupo),
    )
    .join(", ");
}

// Un uruguayo en formato internacional se lee como lo dice la gente: con el 0.
const PREFIJO_URUGUAY = "598";

export function leerTelefono(escrito: string): string {
  const internacional = escrito.trim().startsWith("+");
  const cifras = escrito.replace(/\D/g, "");
  if (internacional) {
    if (cifras.startsWith(PREFIJO_URUGUAY) && cifras.length === 11) {
      return leerGrupos(enGruposDeTres(`0${cifras.slice(PREFIJO_URUGUAY.length)}`));
    }
    return `más ${enGruposDeTres(cifras).map(cifraPorCifra).join(", ")}`;
  }
  const escritos = escrito.trim().split(/[\s-]+/);
  return leerGrupos(escritos.length > 1 ? escritos : enGruposDeTres(cifras));
}

const LETRAS: Readonly<Record<string, string>> = {
  a: "a",
  b: "be",
  c: "ce",
  d: "de",
  e: "e",
  f: "efe",
  g: "ge",
  h: "hache",
  i: "i",
  j: "jota",
  k: "ka",
  l: "ele",
  m: "eme",
  n: "ene",
  ñ: "eñe",
  o: "o",
  p: "pe",
  q: "cu",
  r: "erre",
  s: "ese",
  t: "te",
  u: "u",
  v: "ve",
  w: "doble ve",
  x: "equis",
  y: "i griega",
  z: "zeta",
  ".": "punto",
  _: "guion bajo",
  "-": "guion",
  "+": "más",
};

// Se dicen como palabra: nadie deletrea "gmail" ni "com".
const PALABRAS_DE_DOMINIO = new Set([
  "gmail",
  "hotmail",
  "outlook",
  "yahoo",
  "icloud",
  "live",
  "com",
  "net",
  "org",
]);

function deletrear(texto: string): string[] {
  return [...texto.toLowerCase()].map((c) =>
    /\d/.test(c) ? DIGITOS[Number(c)] : (LETRAS[c] ?? c),
  );
}

export function leerMail(mail: string): string {
  const [usuario, dominio] = mail.split("@");
  const partes = dominio
    .toLowerCase()
    .split(".")
    .flatMap((parte, i) => [
      ...(i > 0 ? ["punto"] : []),
      ...(PALABRAS_DE_DOMINIO.has(parte) ? [parte] : deletrear(parte)),
    ]);
  return [...deletrear(usuario), "arroba", ...partes].join(", ");
}

const MAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// Un candidato: "+" o cifras, con espacios o guiones sueltos entre grupos.
// Termina antes del punto o la coma de la frase, pero no corta "1.500".
const CANDIDATO = /(?<![\w.,$])\+?\d(?:\d|[ -](?=\d))*\d(?!\w|[.,]\d)/g;

const MONEDA_ANTES = /(?:\$|US\$|U\$S|USD|UYU|precio|sale|cuesta|valor)\s*$/i;
const UNIDAD_DESPUES =
  /^\s*(?:\$|pesos|peso|dólares|dolares|dólar|dolar|usd|uyu|u\$s|km|kms|kilómetros|kilometros|mil|millones)\b/i;

function esTelefono(candidato: string, antes: string, despues: string): boolean {
  if (MONEDA_ANTES.test(antes) || UNIDAD_DESPUES.test(despues)) {
    return false;
  }
  const cifras = candidato.replace(/\D/g, "");
  if (candidato.startsWith("+")) {
    return cifras.length >= 8 && cifras.length <= 15;
  }
  if (cifras.length < 8 || cifras.length > 11) {
    return false;
  }
  return cifras.startsWith("0") || /[ -]/.test(candidato);
}

// El texto con los mails y los teléfonos como se dicen; lo demás, igual.
export function leerDatosEnVoz(texto: string): string {
  const conMails = texto.replace(MAIL, (mail) => leerMail(mail));
  return conMails.replace(CANDIDATO, (candidato, indice: number, todo: string) =>
    esTelefono(candidato, todo.slice(0, indice), todo.slice(indice + candidato.length))
      ? leerTelefono(candidato)
      : candidato,
  );
}
