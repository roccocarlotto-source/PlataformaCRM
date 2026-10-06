// ---------------------------------------------------------------------------
// Las opciones de un campo de lista como FILAS editables (OptionListEditor):
// la lógica pura, fuera de los componentes para que esos archivos exporten
// solo el componente (react-refresh) y para probarla sin render.
//
// Las reglas y los mensajes son LOS MISMOS que aplica el backend
// (src/utils/camposPersonalizados.ts → limpiarOpcionesDeLista): acá se
// repiten para avisar antes de mandar, la validación real sigue siendo la de
// cada request.
// ---------------------------------------------------------------------------

// Los mismos topes que el backend.
export const MAX_OPCIONES = 50;
export const MAX_LARGO_DE_OPCION = 100;

export const MENSAJE_LISTA_SIN_OPCIONES = "Un campo de lista necesita al menos una opción";
export const MENSAJE_DEMASIADAS_OPCIONES = `Una lista no puede tener más de ${MAX_OPCIONES} opciones`;
export const MENSAJE_OPCION_MUY_LARGA = `Una opción no puede superar los ${MAX_LARGO_DE_OPCION} caracteres`;

export function mensajeDeOpcionRepetida(opcion: string): string {
  return `La opción «${opcion}» está repetida (no se distinguen mayúsculas ni acentos)`;
}

export interface FilaDeOpcion {
  // Estable mientras la fila exista: es la key de React y lo que permite
  // moverla o editarla sin perder el foco.
  id: string;
  texto: string;
  // El texto con el que esta opción está GUARDADA, si la fila viene de una
  // opción que ya existía. Es lo que distingue renombrar una opción (la fila
  // sigue, el texto cambia) de borrarla y agregar otra.
  original?: string;
}

let filasCreadas = 0;

export function nuevaFila(texto = ""): FilaDeOpcion {
  filasCreadas += 1;
  return { id: `nueva-${filasCreadas}`, texto };
}

// Las filas de las opciones guardadas. El id sale de la posición para que sea
// el mismo en cada render mientras nadie editó (ver lib/useFormDraft.ts).
export function filasDesdeOpciones(opciones: string[]): FilaDeOpcion[] {
  return opciones.map((opcion, index) => ({
    id: `guardada-${index}`,
    texto: opcion,
    original: opcion,
  }));
}

// Cómo se compara una opción con otra: sin distinguir mayúsculas, acentos ni
// espacios de más. La misma función que el backend (claveDeOpcion).
export function claveDeOpcion(opcion: string): string {
  return opcion.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

// Un texto pegado con comas o saltos de línea son varias opciones:
// "Contado, financiado, permuta" -> tres. Sin separadores devuelve una sola
// (o ninguna, si era solo espacios).
export function partirTextoPegado(texto: string): string[] {
  return texto
    .split(/[,\n\r]+/)
    .map((parte) => parte.trim())
    .filter((parte) => parte.length > 0);
}

export function tieneSeparadores(texto: string): boolean {
  return /[,\n\r]/.test(texto);
}

export type ValidacionDeFilas =
  | { ok: true; opciones: string[] }
  // `filas`: los ids de las filas que hay que corregir (para marcarlas).
  | { ok: false; mensaje: string; filas: string[] };

// Lo que se va a guardar, o por qué no se puede. Las filas vacías no cuentan
// (no se mandan), igual que en el backend; una repetida o una de más sí
// frenan el guardado, con el mensaje del backend.
export function validarFilas(filas: FilaDeOpcion[]): ValidacionDeFilas {
  const conTexto = filas.filter((fila) => fila.texto.trim().length > 0);
  if (conTexto.length === 0) {
    return { ok: false, mensaje: MENSAJE_LISTA_SIN_OPCIONES, filas: filas.map((f) => f.id) };
  }

  const largas = conTexto.filter((fila) => fila.texto.trim().length > MAX_LARGO_DE_OPCION);
  if (largas.length > 0) {
    return { ok: false, mensaje: MENSAJE_OPCION_MUY_LARGA, filas: largas.map((f) => f.id) };
  }

  const primeraPorClave = new Map<string, FilaDeOpcion>();
  for (const fila of conTexto) {
    const clave = claveDeOpcion(fila.texto);
    const anterior = primeraPorClave.get(clave);
    if (anterior) {
      return {
        ok: false,
        mensaje: mensajeDeOpcionRepetida(fila.texto.trim()),
        filas: [anterior.id, fila.id],
      };
    }
    primeraPorClave.set(clave, fila);
  }

  if (conTexto.length > MAX_OPCIONES) {
    return {
      ok: false,
      mensaje: MENSAJE_DEMASIADAS_OPCIONES,
      filas: conTexto.slice(MAX_OPCIONES).map((f) => f.id),
    };
  }

  return { ok: true, opciones: conTexto.map((fila) => fila.texto.trim()) };
}

export interface CambiosDeOpciones {
  // Opciones guardadas que cambiaron de texto: los contactos que las tenían
  // elegidas pasan al texto nuevo.
  renombradas: { from: string; to: string }[];
  // Opciones guardadas que ya no están: los contactos que las tenían
  // conservan el texto viejo como "opción eliminada".
  eliminadas: string[];
}

// Qué les pasa a las opciones GUARDADAS con lo que quedó en las filas.
export function cambiosDeOpciones(guardadas: string[], filas: FilaDeOpcion[]): CambiosDeOpciones {
  const vivas = filas
    .map((fila) => ({ ...fila, texto: fila.texto.trim() }))
    .filter((fila) => fila.texto.length > 0);
  const textos = new Set(vivas.map((fila) => fila.texto));
  // Una opción que se volvió a escribir en una fila NUEVA sigue existiendo:
  // sus contactos no se mueven aunque la fila original haya cambiado de texto.
  const reescritas = new Set(
    vivas.filter((fila) => fila.original === undefined).map((fila) => fila.texto),
  );

  const renombradas = vivas
    .filter(
      (fila): fila is typeof fila & { original: string } =>
        fila.original !== undefined &&
        fila.original !== fila.texto &&
        !reescritas.has(fila.original),
    )
    .map((fila) => ({ from: fila.original, to: fila.texto }));

  const conFila = new Set(vivas.map((fila) => fila.original));
  const eliminadas = guardadas.filter((opcion) => !conFila.has(opcion) && !textos.has(opcion));

  return { renombradas, eliminadas };
}

// La pregunta antes de guardar un cambio que toca opciones que ya usan
// contactos, o null si no toca a ninguno. `uso` es { opción: contactos }.
export function mensajeDeConfirmacion(
  cambios: CambiosDeOpciones,
  uso: Record<string, number>,
): string | null {
  const lineas: string[] = [];
  for (const { from, to } of cambios.renombradas) {
    const cantidad = uso[from] ?? 0;
    if (cantidad === 0) continue;
    lineas.push(
      cantidad === 1
        ? `«${from}» pasa a llamarse «${to}»: se actualiza en el contacto que la tiene elegida.`
        : `«${from}» pasa a llamarse «${to}»: se actualiza en los ${cantidad} contactos que la tienen elegida.`,
    );
  }
  for (const opcion of cambios.eliminadas) {
    const cantidad = uso[opcion] ?? 0;
    if (cantidad === 0) continue;
    lineas.push(
      cantidad === 1
        ? `«${opcion}» se elimina de la lista: el contacto que la tiene elegida conserva ese valor, marcado como opción eliminada.`
        : `«${opcion}» se elimina de la lista: los ${cantidad} contactos que la tienen elegida conservan ese valor, marcado como opción eliminada.`,
    );
  }
  return lineas.length > 0 ? `¿Guardar los cambios en las opciones? ${lineas.join(" ")}` : null;
}
