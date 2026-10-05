import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CUPO_DE_TURNOS_SIN_CONNECTION_LIMIT,
  crearLimitadorDeTurnos,
  cupoDeTurnosPorDefecto,
  maximoPorGrupoPorDefecto,
} from "./limitadorDeTurnos";

// C-12 de docs-privados/auditoria-2026-09-30-corta.md (local): los turnos que
// esperan no ocupan una conexión, y nunca hay más de `maximo` con el lock.

function diferido() {
  let resolver!: () => void;
  const promesa = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return { promesa, resolver };
}

const unTick = () => new Promise((resolve) => setImmediate(resolve));

test("C-12: la misma clave corre en serie, en el orden de llegada", async () => {
  const limitador = crearLimitadorDeTurnos(5);
  const orden: string[] = [];
  const primero = diferido();

  const a = limitador.correr("k", async () => {
    orden.push("a:empieza");
    await primero.promesa;
    orden.push("a:termina");
  });
  const b = limitador.correr("k", async () => {
    orden.push("b:empieza");
  });

  await unTick();
  assert.deepEqual(orden, ["a:empieza"], "b no arranca mientras a sigue");
  // b espera la clave, no el cupo: no ocupa un lugar.
  assert.equal(limitador.enCurso(), 1);
  assert.equal(limitador.esperandoCupo(), 0);

  primero.resolver();
  await Promise.all([a, b]);
  assert.deepEqual(orden, ["a:empieza", "a:termina", "b:empieza"]);
});

test("C-12: claves distintas corren a la vez hasta el cupo, y el resto espera en memoria", async () => {
  const limitador = crearLimitadorDeTurnos(2);
  const liberar = [diferido(), diferido(), diferido()];
  const empezaron: number[] = [];

  const turnos = liberar.map((d, i) =>
    limitador.correr(`k${i}`, async () => {
      empezaron.push(i);
      await d.promesa;
    }),
  );

  await unTick();
  assert.deepEqual(empezaron, [0, 1]);
  assert.equal(limitador.enCurso(), 2);
  assert.equal(limitador.esperandoCupo(), 1);

  liberar[0].resolver();
  await unTick();
  await unTick();
  assert.deepEqual(empezaron, [0, 1, 2], "el tercero toma el lugar que se liberó");
  assert.equal(limitador.enCurso(), 2);
  assert.equal(limitador.esperandoCupo(), 0);

  liberar[1].resolver();
  liberar[2].resolver();
  await Promise.all(turnos);
  assert.equal(limitador.enCurso(), 0);
});

test("C-12: un turno que falla suelta la clave y el cupo, y el error llega a quien lo llamó", async () => {
  const limitador = crearLimitadorDeTurnos(1);

  await assert.rejects(
    limitador.correr("k", async () => {
      throw new Error("falló el turno");
    }),
    /falló el turno/,
  );
  assert.equal(limitador.enCurso(), 0);

  const valor = await limitador.correr("k", async () => "sigue andando");
  assert.equal(valor, "sigue andando");
});

test("C-12: diez turnos seguidos de la misma sesión nunca tienen más de uno adentro", async () => {
  const limitador = crearLimitadorDeTurnos(3);
  let adentro = 0;
  let maximoVisto = 0;

  await Promise.all(
    Array.from({ length: 10 }, () =>
      limitador.correr("misma-sesion", async () => {
        adentro++;
        maximoVisto = Math.max(maximoVisto, adentro);
        await unTick();
        adentro--;
      }),
    ),
  );

  assert.equal(maximoVisto, 1);
});

test("C-12: el cupo tiene que ser un entero positivo", () => {
  assert.throws(() => crearLimitadorDeTurnos(0));
  assert.throws(() => crearLimitadorDeTurnos(1.5));
});

test("C-12: cupo por defecto = la mitad de connection_limit, o 2 si no está", () => {
  const base = "postgresql://u:p@host:6543/postgres?pgbouncer=true";
  assert.equal(cupoDeTurnosPorDefecto(`${base}&connection_limit=10`), 5);
  assert.equal(cupoDeTurnosPorDefecto(`${base}&connection_limit=3`), 1);
  assert.equal(cupoDeTurnosPorDefecto(`${base}&connection_limit=1`), 1);
  assert.equal(cupoDeTurnosPorDefecto(base), CUPO_DE_TURNOS_SIN_CONNECTION_LIMIT);
  assert.equal(cupoDeTurnosPorDefecto(`${base}&connection_limit=abc`), 2);
  assert.equal(cupoDeTurnosPorDefecto(undefined), 2);
  assert.equal(cupoDeTurnosPorDefecto("no es una url"), 2);
});

// ---------------------------------------------------------------------------
// FABLE-G-03 (docs-privados/auditoria-2026-10-05-FABLE.md, local): un tope por
// organización dentro del cupo global.
// ---------------------------------------------------------------------------

// Un turno que queda corriendo hasta que el test lo suelta.
function turnoControlado() {
  let soltar!: () => void;
  const espera = new Promise<void>((resolve) => {
    soltar = resolve;
  });
  return { fn: () => espera, soltar };
}
const unInstante = () => new Promise((resolve) => setImmediate(resolve));

test("FABLE-G-03: tope por defecto = el cupo menos uno, y nunca menos de uno", () => {
  assert.equal(maximoPorGrupoPorDefecto(1), 1);
  assert.equal(maximoPorGrupoPorDefecto(2), 1);
  assert.equal(maximoPorGrupoPorDefecto(5), 4);
  assert.throws(() => crearLimitadorDeTurnos(2, 0), /por organización/);
});

test("FABLE-G-03: una organización con turnos lentos no ocupa todo el cupo: el turno de otra entra igual", async () => {
  const limitador = crearLimitadorDeTurnos(2);
  const lentoA1 = turnoControlado();
  const lentoA2 = turnoControlado();
  const orden: string[] = [];

  const a1 = limitador.correr("conv-a1", lentoA1.fn, "org-a");
  const a2 = limitador.correr("conv-a2", () => (orden.push("a2"), lentoA2.fn()), "org-a");
  await unInstante();
  // Hay un lugar libre, pero org-a ya tiene su tope: su segundo turno espera.
  assert.equal(limitador.enCurso(), 1);
  assert.equal(limitador.esperandoCupo(), 1);

  // El turno de OTRA organización no espera detrás del de org-a.
  await limitador.correr("conv-b1", async () => void orden.push("b1"), "org-b");
  assert.deepEqual(orden, ["b1"]);

  // Cuando org-a libera su lugar, entra su turno pendiente.
  lentoA1.soltar();
  await a1;
  await unInstante();
  assert.deepEqual(orden, ["b1", "a2"]);
  lentoA2.soltar();
  await a2;
  assert.equal(limitador.enCurso(), 0);
  assert.equal(limitador.esperandoCupo(), 0);
});

test("FABLE-G-03: con el cupo lleno, al liberarse entra el primero de la fila que PUEDE entrar", async () => {
  const limitador = crearLimitadorDeTurnos(2);
  const a1 = turnoControlado();
  const b1 = turnoControlado();
  const entraron: string[] = [];
  const pA1 = limitador.correr("a1", a1.fn, "org-a");
  const pB1 = limitador.correr("b1", b1.fn, "org-b");
  await unInstante();
  assert.equal(limitador.enCurso(), 2);

  // En la fila: primero otro de org-a (que va a seguir en su tope), después
  // uno de org-c.
  const a2 = turnoControlado();
  const pA2 = limitador.correr("a2", () => (entraron.push("a2"), a2.fn()), "org-a");
  const pC1 = limitador.correr("c1", async () => void entraron.push("c1"), "org-c");
  await unInstante();
  assert.equal(limitador.esperandoCupo(), 2);

  // Se libera el lugar de org-b: org-a sigue con uno en curso, así que pasa c1.
  b1.soltar();
  await pB1;
  await pC1;
  assert.deepEqual(entraron, ["c1"]);

  a1.soltar();
  await pA1;
  await unInstante();
  assert.deepEqual(entraron, ["c1", "a2"]);
  a2.soltar();
  await pA2;
});

test("FABLE-G-03: sin grupo solo cuenta el cupo global, como antes; y nunca se pasa del cupo", async () => {
  const limitador = crearLimitadorDeTurnos(2);
  let adentro = 0;
  let maximoVisto = 0;
  const turno = async () => {
    adentro++;
    maximoVisto = Math.max(maximoVisto, adentro);
    await unInstante();
    adentro--;
  };
  await Promise.all([
    ...Array.from({ length: 6 }, (_, i) => limitador.correr(`sin-${String(i)}`, turno)),
    ...Array.from({ length: 6 }, (_, i) => limitador.correr(`a-${String(i)}`, turno, "org-a")),
    ...Array.from({ length: 6 }, (_, i) => limitador.correr(`b-${String(i)}`, turno, "org-b")),
  ]);
  assert.equal(maximoVisto, 2);
  assert.equal(limitador.enCurso(), 0);
  assert.equal(limitador.esperandoCupo(), 0);
});
