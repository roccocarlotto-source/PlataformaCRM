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
//     lib/prisma.ts), y consultasEnHerramientas, las que hicieron las tools;
//   - porHerramienta: cada tool del turno, en orden, con su nombre, lo que
//     tardó y sus consultas (2026-11-08: una reserva por teléfono se fue a
//     39 consultas en tres tools y no se sabía cuál). Solo el nombre de la
//     tool: nada de lo que dijo el cliente.
//     Son OPERACIONES, no idas y vueltas: con pgbouncer=true cada una son
//     varias (docs-privados/latencia-y-mudanza-2026-10-15.md, local).
//
// El turno se marca con AsyncLocalStorage: no cambia ninguna firma, y fuera
// de un turno contar no hace nada.
// ---------------------------------------------------------------------------

export interface MedicionDeUnaHerramienta {
  nombre: string;
  ms: number;
  consultas: number;
}

export interface MedicionDelTurno {
  modeloMs: number;
  llamadasAlModelo: number;
  herramientasMs: number;
  llamadasAHerramientas: number;
  consultas: number;
  consultasEnHerramientas: number;
  porHerramienta: MedicionDeUnaHerramienta[];
}

interface Estado extends MedicionDelTurno {
  // Las tools que están corriendo, la de más adentro al final (las de una
  // ronda corren en serie, pero una tool podría llamar a otra). Una consulta
  // se le cuenta a la de más adentro.
  enCurso: MedicionDeUnaHerramienta[];
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
    porHerramienta: [],
    enCurso: [],
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
      porHerramienta: estado.porHerramienta.map((h) => ({ ...h, ms: Math.round(h.ms) })),
    },
  };
}

/** Una operación de Prisma (lo llama el middleware de lib/prisma.ts). */
export function contarConsulta(): void {
  const estado = turnoEnCurso.getStore();
  if (!estado) return;
  estado.consultas += 1;
  const herramienta = estado.enCurso.at(-1);
  if (herramienta) {
    estado.consultasEnHerramientas += 1;
    herramienta.consultas += 1;
  }
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

/** Cronometra una tool del turno en curso. `nombre`: el de la tool, nunca datos del cliente. */
export async function medirHerramienta<T>(nombre: string, fn: () => Promise<T>): Promise<T> {
  const estado = turnoEnCurso.getStore();
  if (!estado) return fn();
  const inicio = performance.now();
  const herramienta: MedicionDeUnaHerramienta = { nombre, ms: 0, consultas: 0 };
  estado.porHerramienta.push(herramienta);
  estado.enCurso.push(herramienta);
  try {
    return await fn();
  } finally {
    estado.enCurso.splice(estado.enCurso.lastIndexOf(herramienta), 1);
    herramienta.ms = performance.now() - inicio;
    estado.herramientasMs += herramienta.ms;
    estado.llamadasAHerramientas += 1;
  }
}
