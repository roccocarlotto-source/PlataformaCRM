import { AsyncLocalStorage } from "node:async_hooks";

// ---------------------------------------------------------------------------
// En qué se va el tiempo de un turno del agente (2026-10-18).
//
// Un turno en producción tardaba ~27 s contra ~11 s del mismo turno en local,
// y el log solo decía el total. Medido en local con un proxy: ~12 s son el
// modelo y el resto son ~400 idas y vueltas a la base. Esto deja el desglose
// en el log de cada turno, para medir en producción en vez de estimar (la
// mudanza a São Paulo, el pooler en modo sesión):
//
//   - modeloMs / llamadasAlModelo: las llamadas al LLM del turno;
//   - herramientasMs / llamadasAHerramientas: lo que tardaron las tools;
//   - consultas: operaciones de Prisma durante el turno (el middleware de
//     lib/prisma.ts), y consultasEnHerramientas, las que hicieron las tools.
//     Son OPERACIONES, no idas y vueltas: con pgbouncer=true cada una son
//     varias (docs-privados/latencia-y-mudanza-2026-10-15.md, local).
//
// El turno se marca con AsyncLocalStorage: no cambia ninguna firma, y fuera
// de un turno contar no hace nada.
// ---------------------------------------------------------------------------

export interface MedicionDelTurno {
  modeloMs: number;
  llamadasAlModelo: number;
  herramientasMs: number;
  llamadasAHerramientas: number;
  consultas: number;
  consultasEnHerramientas: number;
}

interface Estado extends MedicionDelTurno {
  // > 0 mientras corre una tool (las de una ronda corren en serie, pero una
  // tool podría llamar a otra).
  enHerramienta: number;
}

const turnoEnCurso = new AsyncLocalStorage<Estado>();

/** Corre `fn` como un turno medido; devuelve su resultado y la medición. */
export async function medirTurno<T>(
  fn: () => Promise<T>,
): Promise<{ resultado: T; medicion: MedicionDelTurno }> {
  const estado: Estado = {
    modeloMs: 0,
    llamadasAlModelo: 0,
    herramientasMs: 0,
    llamadasAHerramientas: 0,
    consultas: 0,
    consultasEnHerramientas: 0,
    enHerramienta: 0,
  };
  const resultado = await turnoEnCurso.run(estado, fn);
  return {
    resultado,
    medicion: {
      modeloMs: Math.round(estado.modeloMs),
      llamadasAlModelo: estado.llamadasAlModelo,
      herramientasMs: Math.round(estado.herramientasMs),
      llamadasAHerramientas: estado.llamadasAHerramientas,
      consultas: estado.consultas,
      consultasEnHerramientas: estado.consultasEnHerramientas,
    },
  };
}

/** Una operación de Prisma (lo llama el middleware de lib/prisma.ts). */
export function contarConsulta(): void {
  const estado = turnoEnCurso.getStore();
  if (!estado) return;
  estado.consultas += 1;
  if (estado.enHerramienta > 0) estado.consultasEnHerramientas += 1;
}

/** Cronometra una llamada al modelo del turno en curso. */
export async function medirModelo<T>(fn: () => Promise<T>): Promise<T> {
  const estado = turnoEnCurso.getStore();
  if (!estado) return fn();
  const inicio = performance.now();
  try {
    return await fn();
  } finally {
    estado.modeloMs += performance.now() - inicio;
    estado.llamadasAlModelo += 1;
  }
}

/** Cronometra una tool del turno en curso. */
export async function medirHerramienta<T>(fn: () => Promise<T>): Promise<T> {
  const estado = turnoEnCurso.getStore();
  if (!estado) return fn();
  const inicio = performance.now();
  estado.enHerramienta += 1;
  try {
    return await fn();
  } finally {
    estado.enHerramienta -= 1;
    estado.herramientasMs += performance.now() - inicio;
    estado.llamadasAHerramientas += 1;
  }
}
