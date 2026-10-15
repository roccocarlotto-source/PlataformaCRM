import assert from "node:assert/strict";
import { test } from "node:test";
import { configDelProximoServiceSchema } from "../../services/automationTriggers";
import {
  VARIABLES_DE_PROXIMO_SERVICE,
  ejemplosDelCuerpo,
  textoParaMeta,
  validarTextoDePlantilla,
} from "../../utils/whatsappTemplateText";
import { configDelRecordatorioDelServiceSchema } from "./accion";
import {
  TEXTO_POR_DEFECTO_DEL_PROXIMO_SERVICE,
  asuntoDeLaTarea,
  textoDeLaFecha,
  textoDelLugar,
  textoDelVehiculo,
  ventanaDeFechas,
  yaEsHoraDelBarrido,
} from "./config";

// S7 (docs/servicios.md §6.2–§6.4): las funciones puras del recordatorio del
// próximo service.

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

test("ventana: la fecha de service corrida offsetDays cae en [hoy − 7, hoy]", () => {
  // 7 días antes: hoy 14/10 avisa los services del 14/10+7−7 al 21/10.
  assert.deepEqual(ventanaDeFechas(dia("2026-10-14"), -7), {
    desde: dia("2026-10-14"),
    hasta: dia("2026-10-21"),
  });
  // 15 días después de vencido: los vencidos entre el 22/09 y el 29/09.
  assert.deepEqual(ventanaDeFechas(dia("2026-10-14"), 15), {
    desde: dia("2026-09-22"),
    hasta: dia("2026-09-29"),
  });
  // El mismo día: los de los últimos 7 días, incluido hoy.
  assert.deepEqual(ventanaDeFechas(dia("2026-10-14"), 0), {
    desde: dia("2026-10-07"),
    hasta: dia("2026-10-14"),
  });
  // Cruza fin de mes y de año sin correrse.
  assert.deepEqual(ventanaDeFechas(dia("2027-01-02"), 0), {
    desde: dia("2026-12-26"),
    hasta: dia("2027-01-02"),
  });
});

test("el barrido corre desde las 10:00 de la zona de la organización", () => {
  // 12:59 UTC = 09:59 en Montevideo (UTC−3): todavía no.
  assert.equal(yaEsHoraDelBarrido(new Date("2026-10-14T12:59:00Z"), "America/Montevideo"), false);
  assert.equal(yaEsHoraDelBarrido(new Date("2026-10-14T13:00:00Z"), "America/Montevideo"), true);
  // 01:00 UTC del 15 = 22:00 del 14 en Montevideo: sigue siendo "después de las 10".
  assert.equal(yaEsHoraDelBarrido(new Date("2026-10-15T01:00:00Z"), "America/Montevideo"), true);
  // Otra zona, otra hora.
  assert.equal(yaEsHoraDelBarrido(new Date("2026-10-14T13:00:00Z"), "America/Bogota"), false);
});

test("los textos de las variables: nunca vacíos (Meta no acepta un parámetro vacío)", () => {
  assert.equal(textoDeLaFecha(dia("2026-11-15")), "el 15 de noviembre");
  assert.equal(textoDeLaFecha(dia("2027-01-01")), "el 1 de enero");
  assert.equal(
    textoDelVehiculo({ make: "Volkswagen", model: "Gol", licensePlate: "ABC 1234" }),
    "Volkswagen Gol (ABC 1234)",
  );
  assert.equal(
    textoDelVehiculo({ make: "Volkswagen", model: "Gol", licensePlate: null }),
    "Volkswagen Gol",
  );
  assert.equal(textoDelVehiculo({ make: "Fiat", model: "Uno", licensePlate: "  " }), "Fiat Uno");
  assert.equal(textoDelLugar("Automotores del Sur", "Centro", 1), "Automotores del Sur");
  assert.equal(
    textoDelLugar("Automotores del Sur", "Centro", 2),
    "Automotores del Sur (sucursal Centro)",
  );
  assert.equal(textoDelLugar("Automotores del Sur", null, 3), "Automotores del Sur");
  assert.equal(
    asuntoDeLaTarea("Laura Gómez", "Volkswagen Gol (ABC 1234)"),
    "Llamar a Laura Gómez por el service de su Volkswagen Gol (ABC 1234)",
  );
});

test("la plantilla por defecto pasa las reglas de Meta y va a aprobar con este texto y estos ejemplos", () => {
  assert.equal(
    validarTextoDePlantilla(TEXTO_POR_DEFECTO_DEL_PROXIMO_SERVICE, {
      variables: VARIABLES_DE_PROXIMO_SERVICE,
    }),
    null,
  );
  assert.equal(
    textoParaMeta(TEXTO_POR_DEFECTO_DEL_PROXIMO_SERVICE),
    "Hola {{1}}, te escribimos de {{2}}. El próximo service de tu {{3}} está previsto para {{4}}. Si querés agendarlo, respondé este mensaje y te damos un turno.",
  );
  assert.deepEqual(
    ejemplosDelCuerpo(TEXTO_POR_DEFECTO_DEL_PROXIMO_SERVICE, VARIABLES_DE_PROXIMO_SERVICE),
    ["Laura", "Automotores del Sur", "Volkswagen Gol (ABC 1234)", "el 15 de noviembre"],
  );
});

test("la plantilla exige {nombre}, {vehiculo} y {fecha}, y no empezar ni terminar con una variable", () => {
  const v = { variables: VARIABLES_DE_PROXIMO_SERVICE };
  assert.match(
    validarTextoDePlantilla("Hola, tu {vehiculo} tiene service {fecha}.", v) ?? "",
    /\{nombre\}/,
  );
  assert.match(
    validarTextoDePlantilla("{nombre}, tu {vehiculo} tiene service {fecha}.", v) ?? "",
    /empezar ni terminar/,
  );
  assert.equal(
    validarTextoDePlantilla("Hola {nombre}, tu {vehiculo} vence {fecha}. Saludos", v),
    null,
  );
});

test("el trigger pide offsetDays entre −60 y +90", () => {
  assert.deepEqual(configDelProximoServiceSchema.parse({ offsetDays: -7 }), { offsetDays: -7 });
  for (const malo of [{}, { offsetDays: -61 }, { offsetDays: 91 }, { offsetDays: 1.5 }]) {
    assert.equal(
      configDelProximoServiceSchema.safeParse(malo).success,
      false,
      JSON.stringify(malo),
    );
  }
});

test("la acción: la casilla de la tarea viene activada por defecto", () => {
  const config = configDelRecordatorioDelServiceSchema.parse({
    messageText: TEXTO_POR_DEFECTO_DEL_PROXIMO_SERVICE,
  });
  assert.equal(config.tareaSiNoTieneWhatsapp, true);
  assert.equal(
    configDelRecordatorioDelServiceSchema.parse({
      messageText: TEXTO_POR_DEFECTO_DEL_PROXIMO_SERVICE,
      tareaSiNoTieneWhatsapp: false,
    }).tareaSiNoTieneWhatsapp,
    false,
  );
  assert.equal(
    configDelRecordatorioDelServiceSchema.safeParse({ messageText: "Hola {nombre}" }).success,
    false,
  );
});
