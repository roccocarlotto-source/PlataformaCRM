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
  // opción que ya existía. Es lo que distingue renombrar una opción (se edita
  // el texto de ESA fila) de borrarla y agregar otra. Una fila conserva su
  // identidad solo así: partirla al pegar la convierte en filas nuevas, y
  // moverla de lugar no la cambia. Nunca depende de la posición.
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

// Las opciones que se agregaron en esta edición: filas sin opción guardada
// detrás (escritas, o salidas de partir un pegado). Son el destino de "Pasar
// a todas las nuevas".
export function opcionesAgregadas(filas: FilaDeOpcion[]): string[] {
  return filas
    .filter((fila) => fila.original === undefined && fila.texto.trim().length > 0)
    .map((fila) => fila.texto.trim());
}

// Qué les pasa a las opciones GUARDADAS con lo que quedó en las filas. Por
// identidad de fila (`original`), nunca por posición: reordenar no cambia
// nada; editar el texto de una fila guardada es un renombre; borrar una fila
// guardada y escribir otra es una eliminada y una nueva.
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

// Los cambios que tocan a algún contacto, con cuántos: lo que muestra el
// diálogo antes de guardar (OptionChangesDialog). `uso` es
// { opción: contactos }. Sin ninguno, no hay nada que preguntar.
export function cambiosEnUso(cambios: CambiosDeOpciones, uso: Record<string, number>) {
  return {
    renombradas: cambios.renombradas
      .filter(({ from }) => (uso[from] ?? 0) > 0)
      .map(({ from, to }) => ({ from, to, contactos: uso[from] })),
    eliminadas: cambios.eliminadas
      .filter((opcion) => (uso[opcion] ?? 0) > 0)
      .map((opcion) => ({ opcion, contactos: uso[opcion] })),
  };
}
