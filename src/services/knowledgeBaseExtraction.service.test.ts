import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AppError } from "../utils/AppError";
import {
  MAX_CARACTERES_EXTRAIDOS,
  MENSAJE_FORMATO_NO_SOPORTADO,
  MIMETYPE_DOCX,
  MIMETYPE_PDF,
  MIMETYPE_TXT,
  extraerTextoDeArchivo,
} from "./knowledgeBaseExtraction.service";
import { construirDocx, construirPdf, construirTxt } from "./knowledgeBaseExtraction.test-helper";

// ---------------------------------------------------------------------------
// Unitario de la extracción de texto (ítem 60). SIN base y SIN HTTP: el
// servicio no toca Postgres ni conoce KnowledgeBaseEntry, así que todo lo que
// puede salir mal —los tres formatos, la corrupción, el documento sin texto, el
// recorte— se prueba acá, con archivos de verdad que arma
// knowledgeBaseExtraction.test-helper.ts.
// ---------------------------------------------------------------------------

async function esperarAppError(fn: () => Promise<unknown>, statusCode: number): Promise<AppError> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof AppError, `se esperaba un AppError y llegó ${String(err)}`);
    assert.equal(err.statusCode, statusCode, `mensaje: ${err.message}`);
    return err;
  }
  assert.fail(`se esperaba un AppError ${statusCode} y no se lanzó nada`);
}

describe("extraerTextoDeArchivo", () => {
  describe(".txt", () => {
    test("devuelve el texto tal cual, sin truncar", async () => {
      const resultado = await extraerTextoDeArchivo({
        contenido: construirTxt("Atendemos de lunes a viernes de 9 a 18."),
        mimetype: MIMETYPE_TXT,
      });

      assert.equal(resultado.text, "Atendemos de lunes a viernes de 9 a 18.");
      assert.equal(resultado.truncated, false);
    });

    test("conserva los acentos de un archivo UTF-8", async () => {
      const resultado = await extraerTextoDeArchivo({
        contenido: construirTxt("Política de cancelación: hasta 24 h antes."),
        mimetype: MIMETYPE_TXT,
      });

      assert.equal(resultado.text, "Política de cancelación: hasta 24 h antes.");
    });

    // El caso real del Bloc de notas / Word viejo de por acá. Sin el respaldo a
    // latin1 el texto entraría con U+FFFD donde van las tildes, y eso termina
    // textual en el prompt del agente.
    test("cae a latin1 cuando el archivo no es UTF-8 válido", async () => {
      const resultado = await extraerTextoDeArchivo({
        contenido: construirTxt("Política de cancelación", "latin1"),
        mimetype: MIMETYPE_TXT,
      });

      assert.equal(resultado.text, "Política de cancelación");
    });

    test("un archivo binario disfrazado de texto plano es 400", async () => {
      const err = await esperarAppError(
        () =>
          extraerTextoDeArchivo({
            contenido: Buffer.from([0x48, 0x6f, 0x6c, 0x61, 0x00, 0x01, 0x02]),
            mimetype: MIMETYPE_TXT,
          }),
        400,
      );

      assert.match(err.message, /no parece ser texto plano/);
    });

    test("un .txt vacío es 422, no 500", async () => {
      const err = await esperarAppError(
        () =>
          extraerTextoDeArchivo({ contenido: construirTxt("   \n\t  "), mimetype: MIMETYPE_TXT }),
        422,
      );

      assert.match(err.message, /no tiene texto/);
    });
  });

  describe(".docx", () => {
    test("extrae los párrafos de un documento de Word", async () => {
      const resultado = await extraerTextoDeArchivo({
        contenido: construirDocx(["Horarios de atención", "Lunes a viernes de 9 a 18."]),
        mimetype: MIMETYPE_DOCX,
      });

      assert.match(resultado.text, /Horarios de atención/);
      assert.match(resultado.text, /Lunes a viernes de 9 a 18\./);
      assert.equal(resultado.truncated, false);
    });

    test("un archivo corrupto es 400 con el motivo adentro, no 500", async () => {
      const err = await esperarAppError(
        () =>
          extraerTextoDeArchivo({
            contenido: Buffer.from("esto no es un docx"),
            mimetype: MIMETYPE_DOCX,
          }),
        400,
      );

      assert.match(err.message, /No se pudo leer el archivo Word/);
    });

    test("un documento sin ningún párrafo es 422", async () => {
      const err = await esperarAppError(
        () => extraerTextoDeArchivo({ contenido: construirDocx([]), mimetype: MIMETYPE_DOCX }),
        422,
      );

      assert.match(err.message, /no tiene texto/);
    });
  });

  describe(".pdf", () => {
    test("extrae el texto de un PDF con texto seleccionable", async () => {
      const resultado = await extraerTextoDeArchivo({
        contenido: construirPdf("Formas de pago aceptadas"),
        mimetype: MIMETYPE_PDF,
      });

      assert.match(resultado.text, /Formas de pago aceptadas/);
      assert.equal(resultado.truncated, false);
    });

    // La razón por la que el servicio concatena `pages[].text` en vez de usar
    // `resultado.text`: ese último intercala separadores de página ("-- 1 of
    // 1 --") y haría que este PDF devolviera un string no vacío.
    test("un PDF sin texto (el caso del escaneado) es 422 y lo dice", async () => {
      const err = await esperarAppError(
        () => extraerTextoDeArchivo({ contenido: construirPdf(null), mimetype: MIMETYPE_PDF }),
        422,
      );

      assert.match(err.message, /PDF escaneado/);
      assert.match(err.message, /copiarlo y pegarlo a mano/);
    });

    test("un archivo corrupto es 400, no 500", async () => {
      const err = await esperarAppError(
        () =>
          extraerTextoDeArchivo({
            contenido: Buffer.from("%PDF-1.4 y nada más"),
            mimetype: MIMETYPE_PDF,
          }),
        400,
      );

      assert.match(err.message, /No se pudo leer el PDF/);
    });
  });

  describe("formato no soportado", () => {
    // Defensa en profundidad: el middleware de subida ya lo corta antes, pero
    // el servicio tiene que ser correcto por su cuenta.
    test("un mimetype fuera de la lista es 400 antes de parsear nada", async () => {
      const err = await esperarAppError(
        () =>
          extraerTextoDeArchivo({
            contenido: construirTxt("da igual"),
            mimetype: "application/msword",
          }),
        400,
      );

      assert.equal(err.message, MENSAJE_FORMATO_NO_SOPORTADO);
    });
  });

  describe("recorte", () => {
    test("no recorta un texto de exactamente el máximo", async () => {
      const resultado = await extraerTextoDeArchivo({
        contenido: construirTxt("a".repeat(MAX_CARACTERES_EXTRAIDOS)),
        mimetype: MIMETYPE_TXT,
      });

      assert.equal(resultado.text.length, MAX_CARACTERES_EXTRAIDOS);
      assert.equal(resultado.truncated, false);
    });

    test("recorta al máximo y avisa cuando se pasa por uno", async () => {
      const resultado = await extraerTextoDeArchivo({
        contenido: construirTxt("a".repeat(MAX_CARACTERES_EXTRAIDOS + 1)),
        mimetype: MIMETYPE_TXT,
      });

      assert.equal(resultado.text.length, MAX_CARACTERES_EXTRAIDOS);
      assert.equal(resultado.truncated, true);
    });

    test("el recorte también aplica a un .docx", async () => {
      const resultado = await extraerTextoDeArchivo({
        contenido: construirDocx(["b".repeat(MAX_CARACTERES_EXTRAIDOS + 500)]),
        mimetype: MIMETYPE_DOCX,
      });

      assert.equal(resultado.text.length, MAX_CARACTERES_EXTRAIDOS);
      assert.equal(resultado.truncated, true);
    });
  });
});
