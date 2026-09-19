import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { AppError } from "../utils/AppError";

// ---------------------------------------------------------------------------
// Extracción de texto de un archivo subido (ítem 60 de
// docs/frontend-cambios-pendientes.md).
//
// AISLADO A PROPÓSITO, igual que llmProvider.service.ts o
// googleCalendar.service.ts: recibe un buffer y un mimetype y devuelve texto.
// No toca Postgres, no conoce KnowledgeBaseEntry y no sabe qué se va a hacer
// con lo que devuelve. Eso lo hace testeable como unitario con archivos de
// verdad, sin base y sin HTTP, que es donde vive el 90% de lo que puede salir
// mal acá (formatos, corrupción, documentos sin texto).
//
// EL ARCHIVO NO SE GUARDA EN NINGÚN LADO, ni acá ni en el llamador. Mismo
// criterio que import.controller.ts/utils/spreadsheet.ts: llega en memoria
// (multer.memoryStorage), se extrae el texto y el buffer se va con el request.
// Es DISTINTO del patrón de vehiclePhotoUpload.ts + supabaseStorage.ts, que sí
// persiste el archivo, y la diferencia es deliberada: una foto de una unidad ES
// el dato —hay que poder volver a mostrarla—, mientras que para una entrada de
// la base de conocimiento el dato es el texto y nada más. Un "archivo original"
// que nadie vuelve a leer sería un segundo lugar donde la misma información
// puede quedar desincronizada, con su ciclo de vida, su borrado y su costo.
// ---------------------------------------------------------------------------

export const MIMETYPE_TXT = "text/plain";
export const MIMETYPE_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MIMETYPE_PDF = "application/pdf";

// SOLO .docx MODERNO (Word 2007+), NO el .doc binario viejo, y es una decisión
// explícita de producto. El formato .doc es un contenedor OLE2 propietario que
// ninguna librería pura de Node lee bien; soportarlo significaría una
// dependencia con binarios externos (antiword, LibreOffice headless) instalados
// en el servidor. Un .doc se convierte a .docx desde el propio Word en dos
// clics, así que el costo recae una vez sobre quien tiene el archivo viejo y no
// sobre el despliegue de todas las organizaciones.
export const MIMETYPES_SOPORTADOS: readonly string[] = [MIMETYPE_TXT, MIMETYPE_DOCX, MIMETYPE_PDF];

export const MENSAJE_FORMATO_NO_SOPORTADO = "Formato no soportado: se aceptan .txt, .docx y .pdf";

// Tope del archivo subido: bastante más chico que los 10 MB de la importación
// de planillas (IMPORT_MAX_FILE_BYTES), y a propósito. Allá el cuerpo es un
// Excel de miles de filas de datos; acá es una política, un instructivo o un
// FAQ — un documento de texto. 5 MB cubre con holgura un PDF de decenas de
// páginas con imágenes, y lo que entre de verdad al campo está acotado por algo
// mucho más chico todavía (10.000 caracteres).
export const KNOWLEDGE_BASE_EXTRACT_MAX_FILE_BYTES = 5 * 1024 * 1024;

// TOPE DE CORDURA SOBRE EL TEXTO DEVUELTO, no sobre la entrada guardada.
//
// El doble de los 10.000 caracteres que acepta `content` en el borde HTTP
// (knowledgeBaseEntry.controller.ts). Existe por dos razones distintas:
//
//   1. Un PDF de 80 páginas son megabytes de texto que igual no iban a entrar
//      en el campo. Mandarlos de vuelta al cliente para que los tire es gastar
//      red y memoria por nada.
//   2. Se deja el DOBLE y no exactamente 10.000 para que quien sube un archivo
//      apenas más largo VEA que se pasó y pueda recortar a mano la parte que le
//      sobra, en vez de recibir un texto ya cortado justo en el límite sin
//      saber cuánto se perdió.
//
// Acá NO se valida el tope de 10.000: esa validación ya existe en el POST/PATCH
// real de la entrada y duplicarla sería dos fuentes de verdad para la misma
// regla. Este endpoint devuelve texto; lo que entra o no entra lo decide el que
// guarda.
export const MAX_CARACTERES_EXTRAIDOS = 20_000;

export interface ArchivoAExtraer {
  contenido: Buffer;
  mimetype: string;
}

export interface TextoExtraido {
  text: string;
  // true cuando el texto original superaba MAX_CARACTERES_EXTRAIDOS y se
  // recortó. El frontend lo usa para avisar que lo que se ve no es todo el
  // documento — un recorte silencioso es el modo de falla peligroso, el mismo
  // que utils/spreadsheet.ts evita rechazando en vez de truncar filas.
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// .txt
// ---------------------------------------------------------------------------

// UN .txt NO PUEDE ESTAR "CORRUPTO" en el sentido en que lo puede estar un docx
// o un pdf: no tiene estructura que validar. Lo que sí puede pasar es que lo
// que llegó no sea texto — alguien renombró un binario, o el navegador mandó
// text/plain por algo que no lo era. Un byte NUL es la señal de eso, y sin este
// chequeo el resultado sería una entrada de la base de conocimiento llena de
// basura que después se le manda al modelo en cada turno.
function extraerDeTxt(contenido: Buffer): string {
  if (contenido.includes(0)) {
    throw new AppError(
      "El archivo no parece ser texto plano: contiene bytes binarios. Guardalo como .txt y volvé a subirlo.",
      400,
    );
  }

  // UTF-8 estricto primero y latin1 como respaldo, en ese orden y no al revés.
  //
  // `buffer.toString("utf-8")` nunca falla: reemplaza cada byte inválido por
  // U+FFFD, así que un .txt guardado en Windows-1252 —lo normal en un Word o un
  // Bloc de notas viejo de por acá— entraría con "pol�tica" en vez de
  // "política", y eso termina textual en el prompt del agente. Decodificar en
  // modo fatal permite DARSE CUENTA de que no era UTF-8 y recién ahí probar con
  // latin1, que es lo que ese archivo realmente es.
  //
  // No se hace al revés porque latin1 tampoco falla nunca: leer un UTF-8 como
  // latin1 da mojibake ("polÃ­tica") sin ningún error que lo delate.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(contenido);
  } catch {
    return contenido.toString("latin1");
  }
}

// ---------------------------------------------------------------------------
// .docx
// ---------------------------------------------------------------------------

// extractRawText y NO convertToHtml: lo que se guarda es texto plano que se
// concatena al system prompt: negritas, títulos y tablas no aportan nada que el
// modelo pueda usar y sí agregarían etiquetas al conteo de caracteres.
//
// `messages` (los avisos de mammoth sobre estilos que no supo mapear) se
// ignoran a propósito: son sobre el FORMATO, y acá el formato no interesa.
async function extraerDeDocx(contenido: Buffer): Promise<string> {
  try {
    const resultado = await mammoth.extractRawText({ buffer: contenido });
    return resultado.value;
  } catch (err) {
    // Mismo tono que parsearXlsx en utils/spreadsheet.ts: 400 con el mensaje de
    // la librería adentro. Es 400 y no 500 porque el que rompió algo fue el
    // archivo que mandó el cliente, no el servidor.
    throw new AppError(
      `No se pudo leer el archivo Word: ${err instanceof Error ? err.message : "formato inválido"}`,
      400,
    );
  }
}

// ---------------------------------------------------------------------------
// .pdf
// ---------------------------------------------------------------------------

// SE USA pdf-parse 2.x (la clase PDFParse), NO la firma `pdfParse(buffer)` de
// la 1.x. La 1.x lleva años sin mantenimiento y arrastra un bloque de debug en
// su index.js que lee un PDF de ejemplo del propio paquete cuando
// `module.parent` es undefined —lo que revienta según cómo se cargue el
// módulo—, además de no traer tipos. La 2.x es dual ESM/CJS, trae sus .d.ts y
// no tiene ese bloque.
//
// SE CONCATENAN LAS PÁGINAS A MANO en vez de usar `resultado.text`, y no es un
// detalle: `text` intercala separadores de página ("-- 1 of 3 --") que son
// ruido para un prompt y, peor, harían que un PDF ESCANEADO —sin una sola letra
// extraíble— devolviera un string no vacío y se colara como contenido válido.
// Con las páginas sueltas, un PDF sin texto da "" y cae donde tiene que caer.
async function extraerDePdf(contenido: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(contenido) });
  try {
    const resultado = await parser.getText();
    return resultado.pages.map((pagina) => pagina.text).join("\n\n");
  } catch (err) {
    throw new AppError(
      `No se pudo leer el PDF: ${err instanceof Error ? err.message : "formato inválido"}`,
      400,
    );
  } finally {
    // pdfjs levanta estructuras por documento que no se liberan solas. Va en
    // finally y no después del getText porque también hay que soltarlas cuando
    // el parseo falló.
    await parser.destroy();
  }
}

// ---------------------------------------------------------------------------

function mensajeSinTexto(mimetype: string): string {
  if (mimetype === MIMETYPE_PDF) {
    // NO SE HACE OCR EN ESTE ÍTEM, y es una limitación conocida y declarada: un
    // PDF escaneado es una imagen adentro de un PDF, y sacarle texto necesita
    // un motor de OCR (tesseract y sus datos de idioma) que no es una librería
    // pura de Node. El mensaje dice el camino que sí funciona hoy en vez de
    // dejar a la persona adivinando por qué un archivo "que se ve bien" falla.
    return "No se pudo extraer texto de este archivo. Puede ser un PDF escaneado (imagen, sin texto seleccionable) — probá copiarlo y pegarlo a mano.";
  }
  return "No se pudo extraer texto de este archivo: el documento no tiene texto.";
}

/**
 * Extrae el texto de un .txt, .docx o .pdf recibido en memoria.
 *
 * Lanza AppError 400 si el formato no está soportado o el archivo está roto, y
 * AppError 422 si el archivo se procesó bien pero no tiene texto que extraer.
 */
export async function extraerTextoDeArchivo(archivo: ArchivoAExtraer): Promise<TextoExtraido> {
  // Defensa en profundidad: el middleware de subida ya rechaza los mimetypes
  // que no están en la lista, antes de leer un solo byte. Este chequeo existe
  // para que el servicio sea correcto por sí solo —se puede llamar desde un
  // test, un script o un endpoint futuro sin pasar por ese middleware— y no
  // caiga en un `default` silencioso.
  if (!MIMETYPES_SOPORTADOS.includes(archivo.mimetype)) {
    throw new AppError(MENSAJE_FORMATO_NO_SOPORTADO, 400);
  }

  let texto: string;
  if (archivo.mimetype === MIMETYPE_TXT) {
    texto = extraerDeTxt(archivo.contenido);
  } else if (archivo.mimetype === MIMETYPE_DOCX) {
    texto = await extraerDeDocx(archivo.contenido);
  } else {
    texto = await extraerDePdf(archivo.contenido);
  }

  // 422 Y NO 500: el archivo se procesó bien de punta a punta, simplemente no
  // había nada adentro. No es un error del servidor, y tampoco es un 400 —el
  // request estaba perfectamente formado—. Es el caso del PDF escaneado, que es
  // el más probable de los tres formatos.
  if (texto.trim() === "") {
    throw new AppError(mensajeSinTexto(archivo.mimetype), 422);
  }

  // El recorte se hace sobre el texto CRUDO (antes del trim final) para que
  // `truncated` signifique exactamente "el documento tenía más que esto".
  const truncated = texto.length > MAX_CARACTERES_EXTRAIDOS;
  return {
    text: truncated ? texto.slice(0, MAX_CARACTERES_EXTRAIDOS) : texto,
    truncated,
  };
}
