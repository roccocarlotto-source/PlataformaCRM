import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CUPO_DE_TURNOS_SIN_CONNECTION_LIMIT,
  crearLimitadorDeTurnos,
  cupoDeTurnosPorDefecto,
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
