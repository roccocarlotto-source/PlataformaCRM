import assert from "node:assert/strict";
import { test } from "node:test";
import { contarConsulta, medirHerramienta, medirModelo, medirTurno } from "./medicionDelTurno";

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("fuera de un turno, contar y cronometrar no hacen nada (y devuelven lo de siempre)", async () => {
  contarConsulta();
  assert.equal(await medirModelo(() => Promise.resolve(7)), 7);
  assert.equal(await medirHerramienta(() => Promise.resolve("x")), "x");
});

test("separa el modelo, las herramientas y las consultas de cada una", async () => {
  const { resultado, medicion } = await medirTurno(async () => {
    contarConsulta(); // el gate, antes del modelo
    await medirModelo(async () => {
      await esperar(20);
    });
    await medirHerramienta(async () => {
      contarConsulta();
      contarConsulta();
      await esperar(20);
    });
    await medirModelo(() => Promise.resolve());
    return "listo";
  });
  assert.equal(resultado, "listo");
  assert.equal(medicion.llamadasAlModelo, 2);
  assert.equal(medicion.llamadasAHerramientas, 1);
  assert.equal(medicion.consultas, 3);
  assert.equal(medicion.consultasEnHerramientas, 2);
  // setTimeout en Windows no baja de ~15 ms: solo se pide que se haya medido.
  assert.ok(medicion.modeloMs >= 10, `modeloMs ${String(medicion.modeloMs)}`);
  assert.ok(medicion.herramientasMs >= 10, `herramientasMs ${String(medicion.herramientasMs)}`);
});

test("dos turnos a la vez no se mezclan", async () => {
  const turno = (consultas: number) =>
    medirTurno(async () => {
      for (let i = 0; i < consultas; i++) {
        contarConsulta();
        await esperar(1);
      }
    });
  const [a, b] = await Promise.all([turno(3), turno(5)]);
  assert.equal(a.medicion.consultas, 3);
  assert.equal(b.medicion.consultas, 5);
});

test("una herramienta que falla igual queda medida, y el error sube", async () => {
  const { medicion } = await medirTurno(async () => {
    await assert.rejects(
      medirHerramienta(async () => {
        contarConsulta();
        throw new Error("falló");
      }),
      /falló/,
    );
    contarConsulta(); // ya fuera de la herramienta
  });
  assert.equal(medicion.llamadasAHerramientas, 1);
  assert.equal(medicion.consultas, 2);
  assert.equal(medicion.consultasEnHerramientas, 1);
});
