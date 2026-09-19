// ---------------------------------------------------------------------------
// Fábricas de archivos .txt, .docx y .pdf DE VERDAD para los tests del ítem 60.
//
// POR QUÉ SE GENERAN Y NO SE VERSIONAN COMO BINARIOS. Un .docx y un .pdf de
// ejemplo en el repositorio son dos archivos opacos que nadie puede revisar en
// un diff, que hay que regenerar a mano el día que se quiera probar otro caso
// —un documento vacío, uno con acentos, uno gigante— y que invitan a subir
// muestras reales con datos de alguien. Generados, el caso de prueba se lee en
// el propio test: `construirDocx(["Horarios"])`.
//
// Y SON ARCHIVOS REALES, no mocks: el .docx es un ZIP válido con su
// [Content_Types].xml y su word/document.xml, y el .pdf tiene su tabla xref con
// los offsets bien calculados. Los parsea mammoth y pdfjs de verdad. Un mock de
// la librería probaría el mock; lo que puede salir mal acá es justamente el
// trato con esas librerías.
//
// Vive en services/ y no en un directorio de tests porque el consumidor
// principal es el unitario de knowledgeBaseExtraction.service.ts; el test de
// integración del controller lo importa desde acá en vez de tener su propia
// copia. El sufijo .test-helper.ts lo deja fuera del build de producción
// (ver el `exclude` de tsconfig.json), igual que automation.test-helper.ts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// .txt
// ---------------------------------------------------------------------------

export function construirTxt(texto: string, encoding: BufferEncoding = "utf-8"): Buffer {
  return Buffer.from(texto, encoding);
}

// ---------------------------------------------------------------------------
// ZIP mínimo, para el .docx
// ---------------------------------------------------------------------------

// CRC-32 a mano en vez de `zlib.crc32`. La función nativa existe recién desde
// Node 22.2 y este helper no tiene ninguna razón para atarse a una versión
// puntual del runtime: son ocho líneas y una tabla.
function crc32(datos: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of datos) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface EntradaZip {
  nombre: string;
  contenido: string;
}

// ZIP con entradas ALMACENADAS (método 0, sin comprimir). Un .docx no exige
// compresión —el formato OPC acepta las dos— y almacenar evita tener que
// manejar los tamaños comprimido/descomprimido por separado. jszip, que es lo
// que mammoth usa por dentro, lo lee sin problema.
function zipAlmacenado(entradas: EntradaZip[]): Buffer {
  const locales: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const { nombre, contenido } of entradas) {
    const datos = Buffer.from(contenido, "utf-8");
    const nombreBuf = Buffer.from(nombre, "utf-8");
    const crc = crc32(datos);

    const encabezadoLocal = Buffer.alloc(30);
    encabezadoLocal.writeUInt32LE(0x04034b50, 0); // firma
    encabezadoLocal.writeUInt16LE(20, 4); // versión necesaria
    encabezadoLocal.writeUInt32LE(crc, 14);
    encabezadoLocal.writeUInt32LE(datos.length, 18); // tamaño comprimido
    encabezadoLocal.writeUInt32LE(datos.length, 22); // tamaño sin comprimir
    encabezadoLocal.writeUInt16LE(nombreBuf.length, 26);
    locales.push(encabezadoLocal, nombreBuf, datos);

    const entradaCentral = Buffer.alloc(46);
    entradaCentral.writeUInt32LE(0x02014b50, 0); // firma
    entradaCentral.writeUInt16LE(20, 4); // versión con la que se creó
    entradaCentral.writeUInt16LE(20, 6); // versión necesaria
    entradaCentral.writeUInt32LE(crc, 16);
    entradaCentral.writeUInt32LE(datos.length, 20);
    entradaCentral.writeUInt32LE(datos.length, 24);
    entradaCentral.writeUInt16LE(nombreBuf.length, 28);
    entradaCentral.writeUInt32LE(offset, 42); // offset del encabezado local
    central.push(entradaCentral, nombreBuf);

    offset += encabezadoLocal.length + nombreBuf.length + datos.length;
  }

  const directorioCentral = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); // firma del end of central directory
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(directorioCentral.length, 12);
  fin.writeUInt32LE(offset, 16);

  return Buffer.concat([...locales, directorioCentral, fin]);
}

// ---------------------------------------------------------------------------
// .docx
// ---------------------------------------------------------------------------

const NS_RELACIONES = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const TIPO_DOCUMENTO =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Un .docx válido con un párrafo por elemento del array. Sin párrafos, un documento vacío. */
export function construirDocx(parrafos: string[]): Buffer {
  const cuerpo = parrafos
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${escaparXml(p)}</w:t></w:r></w:p>`)
    .join("");

  return zipAlmacenado([
    {
      nombre: "[Content_Types].xml",
      contenido:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="${TIPO_DOCUMENTO}"/>` +
        `</Types>`,
    },
    {
      nombre: "_rels/.rels",
      contenido:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="${NS_RELACIONES}">` +
        `<Relationship Id="rId1" Type="${NS_RELACIONES}/officeDocument" Target="word/document.xml"/>` +
        `</Relationships>`,
    },
    {
      nombre: "word/document.xml",
      contenido:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="${NS_WORD}"><w:body>${cuerpo}</w:body></w:document>`,
    },
  ]);
}

// ---------------------------------------------------------------------------
// .pdf
// ---------------------------------------------------------------------------

/**
 * Un PDF de una página con el texto indicado. Con `null`, una página en blanco
 * sin ningún operador de texto — que es lo que pdfjs ve en un PDF escaneado:
 * un documento perfectamente válido del que no sale una sola letra.
 */
export function construirPdf(texto: string | null): Buffer {
  // Los paréntesis y la contrabarra delimitan un string literal en PDF, así que
  // van escapados o el objeto queda roto.
  const contenido =
    texto === null ? "" : `BT /F1 24 Tf 72 700 Td (${texto.replace(/([\\()])/g, "\\$1")}) Tj ET\n`;

  const objetos = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R" +
      "/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${Buffer.byteLength(contenido, "latin1")}>>\nstream\n${contenido}endstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];

  // La tabla xref lleva el offset en bytes de cada objeto desde el principio
  // del archivo, así que se va midiendo a medida que se arma. Todo el PDF se
  // escribe en latin1 (un byte por caracter) justamente para que la longitud
  // del string coincida con la del buffer.
  let salida = "%PDF-1.4\n";
  const offsets: number[] = [];
  objetos.forEach((cuerpo, indice) => {
    offsets.push(Buffer.byteLength(salida, "latin1"));
    salida += `${indice + 1} 0 obj\n${cuerpo}\nendobj\n`;
  });

  const inicioXref = Buffer.byteLength(salida, "latin1");
  salida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    salida += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  salida +=
    `trailer\n<</Size ${objetos.length + 1}/Root 1 0 R>>\n` + `startxref\n${inicioXref}\n%%EOF\n`;

  return Buffer.from(salida, "latin1");
}
