import { z } from "zod";
import type {
  EntradaDeKnowledgeBase,
  ToolCallDelTurno,
} from "../services/agentOrchestration.service";
import {
  exito,
  fallo,
  normalizarNombre,
  validarArgs,
  type ToolDelAgente,
} from "../services/agentTools.service";
import { SUFIJO_ERROR_DE_ARGUMENTOS_DE_CLINICA } from "./config/textosDelAgente";

// ---------------------------------------------------------------------------
// LAS INDICACIONES SALEN TAL CUAL, SIN PASAR POR EL MODELO (docs/rubros.md
// §5.4; hallazgo de la prueba de la Clínica Demo, 2026-10-11).
//
// Con R18 el texto de cada indicación iba en el prompt con la instrucción
// "transcribila tal cual", y el modelo la parafraseaba igual. Ahora:
//
//   1. El prompt lista solo los TÍTULOS de las indicaciones de la sede
//      (ENCABEZADO_INDICACIONES, armarSystemPrompt): el texto no está, así
//      que el modelo no tiene qué parafrasear.
//   2. Cuando el paciente pide una, el modelo llama a esta tool con el título.
//      Es una tool DEL SISTEMA del rubro (ReglasDelRubro.toolsDelSistema):
//      como request_human_handoff, se ofrece sin estar en enabledTools, en
//      cualquier nivel que converse, y solo si la sede tiene indicaciones.
//   3. Después de esa ronda el turno termina sin volver al modelo
//      (desenlaceDeLasTools, reglasDeClinica.ts): lo que recibe el paciente
//      es el texto que cargó la clínica, tal cual (con el formato del canal,
//      como todo saliente). No pasa por las guardas de salida del modelo: no
//      es texto del modelo, y la capa 3 lo bloquearía justamente por lo que
//      la clínica autorizó a decir ("aplicate protector solar").
//
// Las consultas de salud siguen yendo antes al detector (capa 1, §5.3): un
// "¿es normal que me arda después del láser?" se deriva sin llegar al modelo,
// así que nunca llega a esta tool.
// ---------------------------------------------------------------------------

export const TOOL_DE_INDICACIONES = "send_care_instructions";

/** La regla con la que el turno queda en la auditoría. */
export const REGLA_INDICACIONES_TEXTUALES = "indicaciones_textuales";

const argumentos = z.object({ titulo: z.string().trim().min(1, "titulo no puede estar vacío") });

function laIndicacion(
  indicaciones: readonly EntradaDeKnowledgeBase[],
  titulo: string,
): EntradaDeKnowledgeBase | null {
  const buscado = normalizarNombre(titulo);
  const exacta = indicaciones.find((e) => normalizarNombre(e.title) === buscado);
  if (exacta) return exacta;
  // Un modelo chico recorta o completa el título ("depilación láser" por
  // "Antes de la depilación láser"): vale si hay UNA sola que lo contiene.
  const parecidas = indicaciones.filter((e) => {
    const t = normalizarNombre(e.title);
    return t.includes(buscado) || buscado.includes(t);
  });
  return parecidas.length === 1 ? parecidas[0] : null;
}

/** La tool, si la sede tiene indicaciones; si no, ninguna. */
export function toolsDeIndicaciones(entradas: readonly EntradaDeKnowledgeBase[]): ToolDelAgente[] {
  const indicaciones = entradas.filter((e) => e.kind === "INDICACIONES");
  if (indicaciones.length === 0) return [];
  return [
    {
      definition: {
        name: TOOL_DE_INDICACIONES,
        description:
          "Le manda al paciente, tal cual, el texto de una de las indicaciones de la clínica (antes o después de una prestación). Usala cuando el paciente pide una indicación o pregunta qué tiene que hacer antes o después de una prestación de la lista de indicaciones. El sistema le manda el texto exacto que cargó la clínica: no lo escribas ni lo resumas vos.",
        parameters: {
          type: "object",
          properties: {
            titulo: {
              type: "string",
              description: "El título de la indicación, tal cual figura en la lista.",
            },
          },
          required: ["titulo"],
          additionalProperties: false,
        },
      },
      ejecutar(args) {
        const validacion = validarArgs(argumentos, args, SUFIJO_ERROR_DE_ARGUMENTOS_DE_CLINICA);
        if (!validacion.ok) return Promise.resolve(validacion.resultado);
        const entrada = laIndicacion(indicaciones, validacion.value.titulo);
        if (!entrada) {
          const titulos = indicaciones.map((e) => `"${e.title.trim()}"`).join(", ");
          return Promise.resolve(
            fallo(
              `No hay ninguna indicación con el título "${validacion.value.titulo}". Las cargadas son: ${titulos}. Usá uno de esos títulos tal cual. Si ninguna corresponde a lo que pidió el paciente, no la escribas vos: decile que esa indicación se la da una persona del equipo y derivá.`,
            ),
          );
        }
        return Promise.resolve(
          exito({ titulo: entrada.title.trim(), enviada: true, texto: entrada.content.trim() }),
        );
      },
    },
  ];
}

/** El texto que sale al paciente después de una ronda en la que se pidieron
 *  indicaciones: el de cada una que se encontró, en orden y sin repetir.
 *  null = ninguna. */
export function textoDeLasIndicaciones(entradas: readonly ToolCallDelTurno[]): string | null {
  const textos: string[] = [];
  for (const entrada of entradas) {
    if (entrada.name !== TOOL_DE_INDICACIONES || entrada.result?.ok !== true) continue;
    const { texto } = entrada.result.data as { texto?: unknown };
    if (typeof texto === "string" && texto.length > 0 && !textos.includes(texto)) {
      textos.push(texto);
    }
  }
  return textos.length > 0 ? textos.join("\n\n") : null;
}
