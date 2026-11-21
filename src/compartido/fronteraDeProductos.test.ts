import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

// ---------------------------------------------------------------------------
// La lista de excepciones de la frontera de productos solo se achica
// (docs/ordenamiento-productos.md §0.2 y P2, decisión D7).
//
// La regla vive en eslint.config.js y frontend/eslint.config.js: el núcleo no
// importa de las carpetas de producto, y un producto no importa del otro. Las
// dependencias que había al crearla están en frontera-de-productos.json (y su
// par en frontend/). Este test hace que la lista no mienta:
//
//   - cada archivo de la lista existe y TODAVÍA importa de un producto. Si un
//     PR saca la dependencia, también saca el archivo de la lista;
//   - el largo de cada lista es el TOPE de abajo. Agregar una excepción obliga
//     a subir el tope en este archivo, a la vista en el diff; sacar una, a
//     bajarlo.
// ---------------------------------------------------------------------------

const RAIZ = path.join(__dirname, "..", "..");

const TOPE = {
  backendNucleo: 40,
  backendCruces: 2,
  frontendNucleo: 9,
} as const;

interface Lista {
  nucleoQueImportaProductos: string[];
  crucesEntreProductos?: string[];
}

function leerLista(archivo: string): Lista {
  return JSON.parse(fs.readFileSync(path.join(RAIZ, archivo), "utf8")) as Lista;
}

// Los specifiers de import/export estáticos, import() y require().
function importsDe(archivo: string): string[] {
  const codigo = fs.readFileSync(archivo, "utf8");
  return [...codigo.matchAll(/(?:from|import\(|require\()\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

// Lo mismo que prohíbe la regla de ESLint para ese archivo.
function prohibidoPara(archivo: string): RegExp {
  if (archivo.startsWith("frontend/")) return /(^|\/)clinica\//;
  if (archivo.startsWith("src/clinicas/")) return /(^|\/)(automotora|servicios)\//;
  if (archivo.startsWith("src/automotora/") || archivo.startsWith("src/servicios/")) {
    return /(^|\/)clinicas\//;
  }
  return /(^|\/)(automotora|clinicas|servicios)\//;
}

function sinNecesidad(archivos: readonly string[]): string[] {
  return archivos.filter((archivo) => {
    const ruta = path.join(RAIZ, archivo);
    if (!fs.existsSync(ruta)) return true;
    const prohibido = prohibidoPara(archivo);
    return !importsDe(ruta).some((specifier) => prohibido.test(specifier));
  });
}

const backend = leerLista("frontera-de-productos.json");
const frontend = leerLista("frontend/frontera-de-productos.json");
const backendCruces = backend.crucesEntreProductos ?? [];
const frontendNucleo = frontend.nucleoQueImportaProductos.map((f) => `frontend/${f}`);

test("cada archivo de la lista de la frontera existe y todavía importa de un producto", () => {
  assert.deepEqual(
    sinNecesidad([...backend.nucleoQueImportaProductos, ...backendCruces, ...frontendNucleo]),
    [],
    "ya no necesitan la excepción: sacarlos de frontera-de-productos.json y bajar el TOPE",
  );
});

test("la lista de la frontera no crece: su largo es el TOPE", () => {
  assert.equal(backend.nucleoQueImportaProductos.length, TOPE.backendNucleo, "backend, núcleo");
  assert.equal(backendCruces.length, TOPE.backendCruces, "backend, cruces entre productos");
  assert.equal(frontend.nucleoQueImportaProductos.length, TOPE.frontendNucleo, "frontend, núcleo");
});
