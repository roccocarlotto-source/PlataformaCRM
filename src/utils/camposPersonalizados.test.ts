import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_LARGO_DE_OPCION,
  MAX_OPCIONES,
  MENSAJE_DEMASIADAS_OPCIONES,
  MENSAJE_LISTA_SIN_OPCIONES,
  MENSAJE_OPCION_MUY_LARGA,
  aplicarCambiosDeCampos,
  claveDeOpcion,
  mapeoDeCambiosDeOpciones,
  describirValor,
  keyDesdeEtiqueta,
  limpiarOpcionesDeLista,
  mensajeDeOpcionRepetida,
  soloLosQueCambian,
  validarRenombresDeOpciones,
  validarValorDeCampo,
  validarValoresDeCampos,
  type DefinicionDeCampo,
} from "./camposPersonalizados";

const DEFS: DefinicionDeCampo[] = [
  { key: "patente", label: "Patente", type: "TEXT", options: [], agentEditable: true },
  { key: "km", label: "Kilómetros", type: "NUMBER", options: [], agentEditable: true },
  { key: "vence_vtv", label: "Vence VTV", type: "DATE", options: [], agentEditable: false },
  { key: "tiene_usado", label: "Tiene usado", type: "BOOLEAN", options: [], agentEditable: true },
  {
    key: "combustible",
    label: "Combustible",
    type: "SELECT",
    options: ["Nafta", "Diésel", "GNC"],
    agentEditable: true,
  },
  {
    key: "intereses",
    label: "Intereses",
    type: "MULTI_SELECT",
    options: ["0 km", "Usados", "Financiación"],
    agentEditable: true,
  },
];
const def = (key: string) => DEFS.find((d) => d.key === key)!;

test("validarValorDeCampo: cada tipo acepta lo suyo y rechaza lo demás con el nombre del campo", () => {
  assert.deepEqual(validarValorDeCampo(def("patente"), " AB 123 CD "), {
    ok: true,
    valor: "AB 123 CD",
  });
  assert.equal(validarValorDeCampo(def("patente"), 123).ok, false);
  assert.deepEqual(validarValorDeCampo(def("km"), 45000), { ok: true, valor: 45000 });
  assert.match((validarValorDeCampo(def("km"), "45000") as { error: string }).error, /Kilómetros/);
  assert.equal(validarValorDeCampo(def("km"), Number.NaN).ok, false);
  assert.deepEqual(validarValorDeCampo(def("vence_vtv"), "2027-02-28"), {
    ok: true,
    valor: "2027-02-28",
  });
  assert.equal(validarValorDeCampo(def("vence_vtv"), "2027-02-30").ok, false, "fecha inexistente");
  assert.equal(validarValorDeCampo(def("vence_vtv"), "28/02/2027").ok, false);
  assert.deepEqual(validarValorDeCampo(def("tiene_usado"), false), { ok: true, valor: false });
  assert.equal(validarValorDeCampo(def("tiene_usado"), "sí").ok, false);
  assert.deepEqual(validarValorDeCampo(def("combustible"), "GNC"), { ok: true, valor: "GNC" });
  const mal = validarValorDeCampo(def("combustible"), "Eléctrico");
  assert.equal(mal.ok, false);
  assert.match((mal as { error: string }).error, /Nafta, Diésel, GNC/);
});

test("validarValorDeCampo: null, y el texto vacío, borran el valor", () => {
  for (const key of ["patente", "km", "vence_vtv", "tiene_usado", "combustible"]) {
    assert.deepEqual(validarValorDeCampo(def(key), null), { ok: true, valor: null });
  }
  assert.deepEqual(validarValorDeCampo(def("patente"), "   "), { ok: true, valor: null });
  assert.deepEqual(validarValorDeCampo(def("combustible"), ""), { ok: true, valor: null });
});

test("validarValoresDeCampos: junta los errores, rechaza keys desconocidas y, para el agente, las no editables", () => {
  const todo = validarValoresDeCampos(DEFS, {
    patente: "AB123CD",
    km: 1000,
    otro: 1,
    tiene_usado: "x",
  });
  assert.equal(todo.ok, false);
  const errores = (todo as { errores: string[] }).errores;
  assert.equal(errores.length, 2);
  assert.match(errores[0], /«otro» no es un campo/);
  assert.match(errores[1], /Tiene usado/);

  const agente = validarValoresDeCampos(
    DEFS,
    { vence_vtv: "2027-01-01", km: 2000 },
    { soloEditablesPorElAgente: true },
  );
  assert.equal(agente.ok, false);
  assert.match(
    (agente as { errores: string[] }).errores[0],
    /Vence VTV.*no lo puede modificar el agente/,
  );

  const bien = validarValoresDeCampos(DEFS, { km: 2000, combustible: null });
  assert.deepEqual(bien, { ok: true, valores: { km: 2000, combustible: null } });
  assert.equal(validarValoresDeCampos(DEFS, [1]).ok, false);
});

test("aplicarCambiosDeCampos: pisa, borra con null y descarta keys sin definición", () => {
  const actuales = { patente: "AA111AA", km: 10, viejo_sin_definicion: "x" };
  assert.deepEqual(aplicarCambiosDeCampos(DEFS, actuales, { km: null, combustible: "GNC" }), {
    patente: "AA111AA",
    combustible: "GNC",
  });
  assert.deepEqual(aplicarCambiosDeCampos(DEFS, null, { patente: "B" }), { patente: "B" });
});

test("keyDesdeEtiqueta y describirValor", () => {
  assert.equal(keyDesdeEtiqueta("Vence VTV"), "vence_vtv");
  assert.equal(keyDesdeEtiqueta("  Año de compra (aprox.) "), "ano_de_compra_aprox");
  assert.equal(keyDesdeEtiqueta("¿Tiene usado?"), "tiene_usado");
  assert.equal(describirValor(def("tiene_usado"), true), "sí");
  assert.equal(describirValor(def("tiene_usado"), false), "no");
  assert.equal(describirValor(def("km"), 45000), "45000");
  assert.equal(describirValor(def("patente"), ""), null);
  assert.equal(describirValor(def("patente"), undefined), null);
});

test("soloLosQueCambian: lo que llega igual a lo guardado no se vuelve a validar", () => {
  const guardados = { combustible: "Eléctrico", km: 10, tiene_usado: false };
  // La ficha manda todo: solo km cambió.
  assert.deepEqual(
    soloLosQueCambian(guardados, { combustible: "Eléctrico", km: 20, tiene_usado: false }),
    { km: 20 },
  );
  // Vaciar un valor guardado (null) y cargar uno nuevo son cambios.
  assert.deepEqual(soloLosQueCambian(guardados, { combustible: null, patente: "AA111AA" }), {
    combustible: null,
    patente: "AA111AA",
  });
  // Sin nada guardado (alta, o un JSON raro) todo es un cambio.
  assert.deepEqual(soloLosQueCambian(null, { km: 1 }), { km: 1 });
  assert.deepEqual(soloLosQueCambian(["x"], { km: 1 }), { km: 1 });
});

test("una opción eliminada que el contacto conserva no impide guardar el resto", () => {
  // "Eléctrico" ya no es una opción de la lista, pero el contacto la tenía.
  const guardados = { combustible: "Eléctrico", km: 10 };
  const deLaFicha = { combustible: "Eléctrico", km: 20 };

  // Validado entero, como antes: falla por un valor que nadie tocó.
  assert.equal(validarValoresDeCampos(DEFS, deLaFicha).ok, false);

  const validacion = validarValoresDeCampos(DEFS, soloLosQueCambian(guardados, deLaFicha));
  assert.deepEqual(validacion, { ok: true, valores: { km: 20 } });
  // Y el valor viejo se conserva.
  assert.deepEqual(aplicarCambiosDeCampos(DEFS, guardados, { km: 20 }), {
    combustible: "Eléctrico",
    km: 20,
  });
  // Elegirla de nuevo desde otro valor sí se rechaza: ya no es una opción.
  assert.equal(
    validarValoresDeCampos(DEFS, soloLosQueCambian({ combustible: "Nafta" }, deLaFicha)).ok,
    false,
  );
});

test("claveDeOpcion: sin mayúsculas, acentos ni espacios de más", () => {
  assert.equal(claveDeOpcion("  Diésel  "), "diesel");
  assert.equal(claveDeOpcion("CONTADO"), claveDeOpcion("contado"));
  assert.equal(claveDeOpcion("Permuta   más  efectivo"), "permuta mas efectivo");
  assert.notEqual(claveDeOpcion("Contado"), claveDeOpcion("Contado 2"));
});

test("limpiarOpcionesDeLista: recorta, saltea las vacías y conserva el orden", () => {
  assert.deepEqual(limpiarOpcionesDeLista([" Nafta", "Diésel", "", "  ", "GNC"]), {
    ok: true,
    opciones: ["Nafta", "Diésel", "GNC"],
  });
});

test("limpiarOpcionesDeLista: una repetida —igual, o distinta solo en mayúsculas o acentos— es un error que la nombra", () => {
  assert.deepEqual(limpiarOpcionesDeLista(["Nafta", "Diésel", "Nafta"]), {
    ok: false,
    error: mensajeDeOpcionRepetida("Nafta"),
  });
  assert.deepEqual(limpiarOpcionesDeLista(["Contado", "contado"]), {
    ok: false,
    error: mensajeDeOpcionRepetida("contado"),
  });
  assert.deepEqual(limpiarOpcionesDeLista(["Diésel", "DIESEL"]), {
    ok: false,
    error: mensajeDeOpcionRepetida("DIESEL"),
  });
  assert.match(mensajeDeOpcionRepetida("x"), /«x» está repetida/);
});

test("limpiarOpcionesDeLista: sin opciones, con demasiadas o con una muy larga", () => {
  assert.deepEqual(limpiarOpcionesDeLista([]), { ok: false, error: MENSAJE_LISTA_SIN_OPCIONES });
  assert.deepEqual(limpiarOpcionesDeLista(["", " "]), {
    ok: false,
    error: MENSAJE_LISTA_SIN_OPCIONES,
  });
  const muchas = Array.from({ length: MAX_OPCIONES + 1 }, (_, i) => `Opción ${String(i)}`);
  assert.deepEqual(limpiarOpcionesDeLista(muchas), {
    ok: false,
    error: MENSAJE_DEMASIADAS_OPCIONES,
  });
  assert.equal(limpiarOpcionesDeLista(muchas.slice(0, MAX_OPCIONES)).ok, true);
  assert.deepEqual(limpiarOpcionesDeLista(["a".repeat(MAX_LARGO_DE_OPCION + 1)]), {
    ok: false,
    error: MENSAJE_OPCION_MUY_LARGA,
  });
});

test("validarRenombresDeOpciones: de una guardada a una nueva; los que no cambian nada se descartan", () => {
  const guardadas = ["Contado", "Financiado", "Permuta"];
  assert.deepEqual(
    validarRenombresDeOpciones(
      guardadas,
      ["Contado efectivo", "Financiado", "Permuta"],
      [
        { from: "Contado", to: " Contado efectivo " },
        { from: "Financiado", to: "Financiado" },
      ],
    ),
    { ok: true, renombres: [{ from: "Contado", to: "Contado efectivo" }] },
  );
  // Un intercambio es válido: las dos siguen existiendo.
  assert.deepEqual(
    validarRenombresDeOpciones(
      guardadas,
      ["Financiado", "Contado", "Permuta"],
      [
        { from: "Contado", to: "Financiado" },
        { from: "Financiado", to: "Contado" },
      ],
    ),
    {
      ok: true,
      renombres: [
        { from: "Contado", to: "Financiado" },
        { from: "Financiado", to: "Contado" },
      ],
    },
  );
});

test("validarRenombresDeOpciones: rechaza un origen que no estaba guardado, un destino que no queda y un origen repetido", () => {
  const guardadas = ["Contado", "Financiado"];
  const nuevas = ["Efectivo", "Financiado"];
  assert.equal(
    validarRenombresDeOpciones(guardadas, nuevas, [{ from: "Permuta", to: "Efectivo" }]).ok,
    false,
  );
  assert.equal(
    validarRenombresDeOpciones(guardadas, nuevas, [{ from: "Contado", to: "Cheque" }]).ok,
    false,
  );
  assert.equal(
    validarRenombresDeOpciones(guardadas, nuevas, [
      { from: "Contado", to: "Efectivo" },
      { from: "Contado", to: "Financiado" },
    ]).ok,
    false,
  );
});

test("MULTI_SELECT: un arreglo de opciones vigentes, sin repetidas; vacío borra; otra cosa es error con el nombre", () => {
  const intereses = def("intereses");
  assert.deepEqual(validarValorDeCampo(intereses, ["Usados", " Financiación ", "Usados"]), {
    ok: true,
    valor: ["Usados", "Financiación"],
  });
  assert.deepEqual(validarValorDeCampo(intereses, []), { ok: true, valor: null });
  assert.deepEqual(validarValorDeCampo(intereses, ["", "  "]), { ok: true, valor: null });
  const ajena = validarValorDeCampo(intereses, ["Usados", "Motos"]);
  assert.equal(ajena.ok, false);
  assert.match((ajena as { error: string }).error, /Intereses.*0 km, Usados, Financiación/);
  assert.equal(validarValorDeCampo(intereses, "Usados").ok, false, "un string no es un arreglo");
  assert.equal(validarValorDeCampo(intereses, [1]).ok, false);
  // En un SELECT, un arreglo no vale.
  assert.equal(validarValorDeCampo(def("combustible"), ["Nafta"]).ok, false);
  assert.equal(describirValor(intereses, ["Usados", "Financiación"]), "Usados, Financiación");
  assert.equal(describirValor(intereses, []), null);
});

test("MULTI_SELECT: el arreglo entero reemplaza al guardado; igual al guardado no se vuelve a validar", () => {
  const guardados = { intereses: ["Usados", "Vieja"] };
  // La ficha manda lo mismo que había (con la opción eliminada "Vieja"): no se valida.
  assert.deepEqual(soloLosQueCambian(guardados, { intereses: ["Usados", "Vieja"] }), {});
  // Agregar una: llega el arreglo completo y se valida entero.
  assert.deepEqual(soloLosQueCambian(guardados, { intereses: ["Usados", "0 km"] }), {
    intereses: ["Usados", "0 km"],
  });
  assert.deepEqual(aplicarCambiosDeCampos(DEFS, guardados, { intereses: ["Usados", "0 km"] }), {
    intereses: ["Usados", "0 km"],
  });
  assert.deepEqual(aplicarCambiosDeCampos(DEFS, guardados, { intereses: null }), {});
});

test("mapeoDeCambiosDeOpciones: renombres y decisiones sobre eliminadas, como un mapeo { vieja: [nuevas] }", () => {
  const guardadas = ["Contado, financiado, permuta", "Leasing", "Cheque"];
  const nuevas = ["Contado", "financiado", "permuta", "Leasing", "Cheque diferido"];
  const resultado = mapeoDeCambiosDeOpciones(
    "MULTI_SELECT",
    guardadas,
    nuevas,
    [{ from: "Cheque", to: "Cheque diferido" }],
    [
      {
        from: "Contado, financiado, permuta",
        action: "move",
        to: ["Contado", "financiado", "permuta", "permuta"],
      },
    ],
  );
  assert.deepEqual(resultado, {
    ok: true,
    mapeo: {
      Cheque: ["Cheque diferido"],
      "Contado, financiado, permuta": ["Contado", "financiado", "permuta"],
    },
  });
  // clear saca; keep no entra al mapeo.
  assert.deepEqual(
    mapeoDeCambiosDeOpciones(
      "SELECT",
      ["A", "B", "C"],
      ["C"],
      [],
      [
        { from: "A", action: "clear" },
        { from: "B", action: "keep" },
      ],
    ),
    { ok: true, mapeo: { A: [] } },
  );
});

test("mapeoDeCambiosDeOpciones: rechaza lo que no cierra", () => {
  const guardadas = ["A", "B"];
  const nuevas = ["B", "C"];
  const casos: [string, Parameters<typeof mapeoDeCambiosDeOpciones>][] = [
    [
      "eliminada que no estaba",
      ["SELECT", guardadas, nuevas, [], [{ from: "Z", action: "clear" }]],
    ],
    ["eliminada que sigue", ["SELECT", guardadas, nuevas, [], [{ from: "B", action: "clear" }]]],
    [
      "move sin destino",
      ["SELECT", guardadas, nuevas, [], [{ from: "A", action: "move", to: [] }]],
    ],
    [
      "destino que no es nuevo",
      ["SELECT", guardadas, nuevas, [], [{ from: "A", action: "move", to: ["Z"] }]],
    ],
    [
      "varios destinos en un SELECT",
      ["SELECT", guardadas, nuevas, [], [{ from: "A", action: "move", to: ["B", "C"] }]],
    ],
    [
      "renombrada y eliminada a la vez",
      ["SELECT", guardadas, nuevas, [{ from: "A", to: "C" }], [{ from: "A", action: "clear" }]],
    ],
  ];
  for (const [nombre, args] of casos) {
    assert.equal(mapeoDeCambiosDeOpciones(...args).ok, false, nombre);
  }
  // Varios destinos sí valen en un MULTI_SELECT.
  assert.equal(
    mapeoDeCambiosDeOpciones(
      "MULTI_SELECT",
      guardadas,
      nuevas,
      [],
      [{ from: "A", action: "move", to: ["B", "C"] }],
    ).ok,
    true,
  );
});
