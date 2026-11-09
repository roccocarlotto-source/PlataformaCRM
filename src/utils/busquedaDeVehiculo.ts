// ---------------------------------------------------------------------------
// La búsqueda de una unidad por cómo la nombra un cliente (FABLE-B-09 de
// docs-privados/auditoria-2026-10-05-FABLE.md, local).
//
// search_vehicles filtraba `make` y `model` por igualdad exacta contra la
// columna. El modelo de lenguaje no sabe dónde corta cada columna: para una
// "Volkswagen T-Cross Comfortline 2023" mandaba model: "T-Cross Comfortline
// 2023", la columna dice "T-Cross", la búsqueda daba 0 y el agente le decía al
// cliente que la unidad que acababa de elegir no estaba disponible.
//
// Ahora lo que el modelo mande en marca y modelo se compara por PALABRAS, sin
// mayúsculas ni acentos ni guiones, contra marca + modelo + versión + año de
// cada unidad. Dos niveles:
//   - "exacta": todas las palabras aparecen en la unidad. "T-Cross Comfortline
//     2023" encuentra esa; "t cross" o "TCROSS" encuentran todas las T-Cross.
//   - "mismo-modelo": ninguna unidad tiene todas las palabras, pero el modelo
//     de la unidad sí está en lo que se pidió. "T-Cross Highline 2024" sin esa
//     versión en stock devuelve las T-Cross que hay. La versión y el año
//     afinan la búsqueda; no pueden convertir "hay T-Cross" en "no hay".
//
// Pura y en memoria a propósito: la lista de unidades publicadas de un negocio
// son decenas o cientos de filas de cinco columnas, y una sola normalización
// en un solo lugar es lo que se puede probar caso por caso.
// ---------------------------------------------------------------------------

export interface VehiculoBuscable {
  id: string;
  make: string;
  model: string;
  trim: string | null;
  year: number;
}

export type NivelDeCoincidencia = "exacta" | "mismo-modelo" | "ninguna";

// Sin acentos, en minúsculas, y todo lo que no sea letra o número como
// separador: "T-Cross" y "t cross" son las mismas dos palabras, "Citroën" es
// "citroen".
export function palabrasDeBusqueda(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((palabra) => palabra.length > 0);
}

// Todas las palabras del pedido aparecen en la unidad. Cada palabra se busca
// en el texto con espacios y en el texto pegado: "tcross" no está en
// "volkswagen t cross", pero sí en "volkswagentcross".
function tieneTodasLasPalabras(vehiculo: VehiculoBuscable, palabras: string[]): boolean {
  const propias = palabrasDeBusqueda(
    `${vehiculo.make} ${vehiculo.model} ${vehiculo.trim ?? ""} ${String(vehiculo.year)}`,
  );
  const conEspacios = propias.join(" ");
  const pegado = propias.join("");
  return palabras.every((palabra) => conEspacios.includes(palabra) || pegado.includes(palabra));
}

// El modelo de la unidad está nombrado en el pedido, como palabras enteras
// ("t cross" dentro de "t cross highline 2024") o pegado en una sola
// ("tcross"). Palabras enteras y no un `includes` suelto: si no, un "Up"
// aparecería en cualquier pedido que diga "coupé".
function nombraElModelo(vehiculo: VehiculoBuscable, palabras: string[]): boolean {
  const delModelo = palabrasDeBusqueda(vehiculo.model);
  if (delModelo.length === 0) {
    return false;
  }
  const pedido = ` ${palabras.join(" ")} `;
  return pedido.includes(` ${delModelo.join(" ")} `) || palabras.includes(delModelo.join(""));
}

// Qué unidades corresponden a la marca y el modelo que mandó el modelo de
// lenguaje. Sin marca ni modelo (o con texto sin ninguna palabra) no hay nada
// que filtrar: `ids` es null y quien llama no restringe por esto.
export function buscarPorMarcaYModelo(
  vehiculos: VehiculoBuscable[],
  pedido: { make?: string; model?: string },
): { nivel: NivelDeCoincidencia; ids: string[] } | null {
  const palabras = palabrasDeBusqueda(`${pedido.make ?? ""} ${pedido.model ?? ""}`);
  if (palabras.length === 0) {
    return null;
  }
  const exactas = vehiculos.filter((v) => tieneTodasLasPalabras(v, palabras));
  if (exactas.length > 0) {
    return { nivel: "exacta", ids: exactas.map((v) => v.id) };
  }
  const delMismoModelo = vehiculos.filter((v) => nombraElModelo(v, palabras));
  if (delMismoModelo.length > 0) {
    return { nivel: "mismo-modelo", ids: delMismoModelo.map((v) => v.id) };
  }
  return { nivel: "ninguna", ids: [] };
}

// Las unidades del mismo modelo que una coincidencia exacta: para volver a
// buscar sin la versión ni el año cuando los demás filtros la dejaron en cero.
export function idsDelMismoModelo(
  vehiculos: VehiculoBuscable[],
  pedido: { make?: string; model?: string },
): string[] {
  const palabras = palabrasDeBusqueda(`${pedido.make ?? ""} ${pedido.model ?? ""}`);
  return vehiculos.filter((v) => nombraElModelo(v, palabras)).map((v) => v.id);
}

// ---------------------------------------------------------------------------
// Nombres parecidos (2026-11-09).
//
// En una llamada el cliente pidió un "Gol", el modelo de lenguaje buscó
// "Golf", la búsqueda dio "ninguna" y el agente dijo que no había, con un Gol
// Trend en stock. Lo mismo pasa por escrito ("Corola", "Onyx") o con un número
// mal dicho o mal entendido ("208" con un 308 en stock).
//
// Cuando la búsqueda por nombre no encuentra nada, esto devuelve las unidades
// cuyo modelo (o versión) se escribe casi igual que alguna palabra del pedido:
// una letra o un número de diferencia, dos en palabras de 6 o más letras.
// No reemplaza al resultado: quien llama se las ofrece al modelo para que le
// PREGUNTE al cliente si se refiere a esa, en vez de decir que no hay.
//
// Para no sugerir cualquier cosa:
//   - Palabras de menos de 3 caracteres no cuentan ("C3" y "C4", "Up").
//   - Si el pedido trae marca, la unidad tiene que ser de esa marca (o una
//     escrita casi igual): "Toyota Golf" no sugiere un Volkswagen Gol.
//   - Un año ("2018") solo cuenta si es lo único que nombró además de la
//     marca: "Corolla 2018" no sugiere un Peugeot 2008, "Peugeot 2008" sí
//     sugiere un Peugeot 208.
// ---------------------------------------------------------------------------

const PARECIDA_LARGO_MINIMO = 3;

function pareceAnio(palabra: string): boolean {
  return /^(19|20)\d\d$/.test(palabra);
}

// Distancia de edición (Levenshtein): cuántas letras hay que agregar, quitar o
// cambiar para pasar de una palabra a la otra. Palabras cortas: alcanza con
// la versión de dos filas.
export function distanciaDeEdicion(a: string, b: string): number {
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    for (let j = 1; j <= b.length; j++) {
      const cambio = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min(anterior[j] + 1, actual[j - 1] + 1, anterior[j - 1] + cambio);
    }
    anterior = actual;
  }
  return anterior[b.length];
}

// Distintas pero casi iguales: 1 de diferencia, 2 si la más corta tiene 6 o más.
function seParecen(a: string, b: string): boolean {
  if (a === b || Math.min(a.length, b.length) < PARECIDA_LARGO_MINIMO) {
    return false;
  }
  const tope = Math.min(a.length, b.length) >= 6 ? 2 : 1;
  return distanciaDeEdicion(a, b) <= tope;
}

function igualOParecida(a: string, b: string): boolean {
  return a === b || seParecen(a, b);
}

/** Las unidades con un modelo o versión de nombre parecido al pedido. Vacío si el pedido no nombra nada. */
export function idsConNombreParecido(
  vehiculos: VehiculoBuscable[],
  pedido: { make?: string; model?: string },
): string[] {
  const deLaMarca = palabrasDeBusqueda(pedido.make ?? "");
  const todas = palabrasDeBusqueda(`${pedido.make ?? ""} ${pedido.model ?? ""}`);
  if (todas.length === 0) {
    return [];
  }
  return vehiculos
    .filter((v) => {
      const marca = palabrasDeBusqueda(v.make);
      const esDeLaMarca = (p: string) => marca.some((m) => igualOParecida(p, m));
      if (deLaMarca.length > 0 && !deLaMarca.every(esDeLaMarca)) {
        return false;
      }
      // Lo que nombra al modelo: el pedido sin las palabras de la marca.
      const delModelo = todas.filter((p) => !esDeLaMarca(p));
      const sinAnios = delModelo.filter((p) => !pareceAnio(p));
      const candidatas = sinAnios.length > 0 ? sinAnios : delModelo;
      const propias = palabrasDeBusqueda(`${v.model} ${v.trim ?? ""}`);
      return candidatas.some((p) => propias.some((m) => seParecen(p, m)));
    })
    .map((v) => v.id);
}
