import type { MultiSelectOption } from "../../design-system/MultiSelect";
import type { GuardrailsTranslation } from "./types";

// ---------------------------------------------------------------------------
// LO QUE ESTE ARCHIVO ERA, Y POR QUÉ CAMBIÓ. En el §55 los guardrails se
// editaban como JSON crudo en un textarea, y acá vivía la frontera entre ese
// texto y el objeto que viaja al backend (parseGuardrails / formatGuardrails /
// EMPTY_GUARDRAILS_TEXT). Era una decisión explícita de Rocco para arrancar
// rápido, con el mini-formulario por clave anotado como el paso siguiente.
//
// Al ver el campo en uso, Rocco pidió otra cosa, y es la del ítem 56: "quiero
// que todo en la interfaz sea en lenguaje natural. Si luego el programa tiene
// que traducir a JSON para que el agente trabaje mejor, bueno, pero el usuario
// debe manejarse en lenguaje natural". Así que no hubo mini-formulario: el
// ADMIN escribe en sus palabras, el backend traduce, y la pantalla le muestra
// lo que se entendió para que lo confirme ANTES de guardar.
//
// QUÉ QUEDA ACÁ ENTONCES: la lógica pura del RESUMEN — del objeto de
// docs/ai-agent-architecture.md §6 a las líneas en español que el panel de
// confirmación muestra. Sigue viviendo aparte del formulario por la misma
// razón de siempre (es lógica pura con casos borde que conviene probar sin
// montar una pantalla), y `formatGuardrails` sobrevive intacta porque el panel
// ofrece un "Ver JSON" de solo lectura para quien lo quiera revisar en crudo.
//
// LO QUE NO ESTÁ ACÁ, Y NO ES UN OLVIDO: ninguna validación del contenido. El
// objeto que se resume no lo escribió una persona — lo devolvió el backend, ya
// sanitizado contra el catálogo real de tools
// (src/services/agentGuardrailsTranslation.service.ts). Validarlo de nuevo acá
// sería desconfiar de la única pieza que puede saber qué es válido.
// ---------------------------------------------------------------------------

// Con indentación, no en una línea: lo lee una persona en el colapsable "Ver
// JSON" del panel de confirmación, y un objeto de §6 en una sola línea es
// ilegible.
export function formatGuardrails(guardrails: Record<string, unknown>): string {
  return JSON.stringify(guardrails, null, 2);
}

// Lecturas tolerantes, mismo criterio que puedeEjecutarTool en el backend: una
// clave ausente o con el tipo equivocado es "no configurada", nunca un error
// que rompa la pantalla. Acá importa incluso más, porque el resumen es lo
// único que el ADMIN ve antes de confirmar: preferimos mostrar de menos a
// mostrar una excepción.
function listaDeStrings(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string") : [];
}

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

// El nombre corto en castellano de una tool, o el nombre crudo si no está en
// el catálogo del frontend. Es el mismo criterio que agentToolOptions() usa
// con una tool desconocida: se muestra tal cual en vez de esconderla.
function etiquetaDeTool(nombre: string, tools: MultiSelectOption<string>[]): string {
  return tools.find((tool) => tool.value === nombre)?.label ?? nombre;
}

function enumerar(valores: string[]): string {
  return valores.join(", ");
}

export const SIN_GUARDRAILS =
  "Sin reglas: el agente no tiene ninguna restricción adicional más allá de los permisos generales.";

// Las líneas del resumen, una por cada clave de §6 presente y no vacía, en un
// orden fijo: primero lo que se hace cumplir CON CÓDIGO (las tres que
// puedeEjecutarTool evalúa) y después lo que va al prompt del modelo. No es
// cosmético: lo primero que el ADMIN lee es lo que de verdad bloquea una
// acción.
//
// Devuelve strings y no JSX a propósito — es lo que permite probar el resumen
// entero sin renderizar nada.
export function resumirGuardrails(
  guardrails: Record<string, unknown>,
  tools: MultiSelectOption<string>[],
): string[] {
  const lineas: string[] = [];

  const acciones = listaDeStrings(guardrails.accionesProhibidas);
  if (acciones.length > 0) {
    lineas.push(
      `No puede ejecutar estas acciones: ${enumerar(acciones.map((tool) => etiquetaDeTool(tool, tools)))}.`,
    );
  }

  const campos = listaDeStrings(guardrails.infoNoModificable);
  if (campos.length > 0) {
    // Los nombres de campo van TAL CUAL: no hay un catálogo de etiquetas para
    // ellos, y traducirlos a mano sería inventar un diccionario que envejece
    // aparte del backend.
    lineas.push(`No puede modificar estos datos: ${enumerar(campos)}.`);
  }

  const requeridos = objeto(guardrails.datosRequeridosAntesDeAccion);
  for (const [tool, datos] of Object.entries(requeridos)) {
    const lista = listaDeStrings(datos);
    if (lista.length > 0) {
      lineas.push(
        `Antes de "${etiquetaDeTool(tool, tools)}" tiene que conocer: ${enumerar(lista)}.`,
      );
    }
  }

  // Las tres listas de frases libres van frase por frase, tal cual las devolvió
  // el backend: son las palabras del ADMIN (o lo más parecido que el traductor
  // produjo) y reescribirlas sería traicionar justamente lo que este ítem vino
  // a dar.
  for (const frase of listaDeStrings(guardrails.temasProhibidos)) {
    lineas.push(`No habla de: ${frase}.`);
  }
  for (const frase of listaDeStrings(guardrails.promesasProhibidas)) {
    lineas.push(`No promete: ${frase}.`);
  }
  for (const frase of listaDeStrings(guardrails.condicionesDeDerivacion)) {
    lineas.push(`Deriva a una persona si: ${frase}.`);
  }

  // Nunca una lista vacía sin explicación: "no hay nada" y "no se entendió
  // nada" se ven igual, y son cosas muy distintas para quien está por guardar.
  return lineas.length > 0 ? lineas : [SIN_GUARDRAILS];
}

// Una línea por descarte. El backend manda clave/valor/motivo; el español
// final se arma acá, que es donde vive el idioma de la pantalla.
export function resumirDescartes(descartado: GuardrailsTranslation["descartado"]): string[] {
  return descartado.map((descarte) => `"${descarte.valor}": ${descarte.motivo}.`);
}
