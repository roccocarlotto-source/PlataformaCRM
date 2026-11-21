import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { before, test } from "node:test";
import type { Express } from "express";
import type { OrganizationEdition, OrganizationIndustry } from "@prisma/client";
import {
  CAMPOS_POR_RUTA,
  MODULOS,
  MODULOS_ACTIVABLES,
  MODULOS_POR_EDICION,
  MODULOS_POR_RUBRO,
  MODULOS_SIN_RUTAS,
  MODULO_DE_LA_TOOL,
  MODULO_DE_LA_TOOL_DE_CLINICA,
  ROLES_POR_RUBRO,
  RUTAS_POR_MODULO,
  RUTAS_PUBLICAS,
  SOLO_CLINICA,
  modulosDe,
  motivoDeExclusion,
  toolDelRubro,
} from "../config/ediciones";
import { rutasMontadas } from "../routes/rutasMontadas.test-helper";
import {
  CATALOGO_DE_TOOLS,
  toolsHabilitadas,
  toolsSinCampos,
  type ToolDelAgente,
} from "../services/agentTools.service";
import { reglasDelRubro } from "../services/reglasDelRubro";

// ---------------------------------------------------------------------------
// Ordenamiento en núcleo y dos productos (docs/ordenamiento-productos.md §5.0,
// punto 4): fotos fijas de lo que mover código entre carpetas NO puede
// cambiar. Los PR del plan (P4 en adelante) no tocan estos archivos: si uno
// los cambia, ese PR cambió comportamiento.
//
//   1. las rutas montadas en la app, en orden, con su autenticación y roles;
//   2. el catálogo del gate: módulos por edición y por rubro, rutas y campos
//      por módulo, tools por módulo y roles por rubro;
//   3. las tools que se le ofrecen al modelo en cada rubro y edición.
//
// Se compara contra los JSON de __snapshots__/, no contra el código que se
// mueve. Para regenerarlos cuando un cambio es a propósito (y entonces no es
// parte del ordenamiento): ACTUALIZAR_SNAPSHOTS=1 npx tsx --test
// src/compartido/ordenamientoSinCambios.test.ts, y revisar el diff.
// ---------------------------------------------------------------------------

const EDICIONES: readonly OrganizationEdition[] = ["COMPLETA", "ESENCIAL"];
const RUBROS: readonly OrganizationIndustry[] = ["AUTOMOTORA", "CLINICA"];

function compararConFoto(nombre: string, valor: unknown): void {
  const archivo = path.join(__dirname, "__snapshots__", `ordenamiento-${nombre}.json`);
  const actual = `${JSON.stringify(valor, null, 2)}\n`;
  if (process.env.ACTUALIZAR_SNAPSHOTS === "1") {
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    fs.writeFileSync(archivo, actual);
  }
  assert.deepEqual(JSON.parse(actual), JSON.parse(fs.readFileSync(archivo, "utf8")), archivo);
}

// Los conjuntos se guardan ordenados: lo que importa es qué tienen, no en qué
// orden se armaron. Las listas (rutas, campos) se guardan en su orden.
const ordenado = (conjunto: Iterable<string>): string[] => [...conjunto].sort();

// ---------------------------------------------------------------------------
// 1. Rutas montadas
// ---------------------------------------------------------------------------

let app: Express;

before(async () => {
  process.env.LOG_LEVEL = "fatal";
  ({ app } = await import("../app.js"));
});

test("las rutas montadas, en orden, con su autenticación y sus roles, no cambian", () => {
  const rutas = rutasMontadas(app);
  // Si el recorrido se rompe, la foto quedaría vacía y no probaría nada.
  assert.ok(rutas.length > 150, `solo ${String(rutas.length)} rutas`);
  compararConFoto(
    "rutas",
    rutas.map((r) => ({
      ruta: r.ruta,
      autenticada: r.autenticada,
      roles: r.roles === null ? null : ordenado(r.roles),
    })),
  );
});

// ---------------------------------------------------------------------------
// 2. Catálogo del gate
// ---------------------------------------------------------------------------

// Todos los nombres de tool que algún rubro conoce: el catálogo común, los de
// solo un rubro y los que tienen versión propia en un rubro.
function nombresDeTools(): string[] {
  const nombres = new Set<string>([
    ...CATALOGO_DE_TOOLS.keys(),
    ...Object.keys(MODULO_DE_LA_TOOL),
    ...Object.keys(MODULO_DE_LA_TOOL_DE_CLINICA),
  ]);
  for (const rubro of RUBROS) {
    const reglas = reglasDelRubro(rubro);
    for (const nombre of Object.keys(reglas.toolsExclusivas)) nombres.add(nombre);
    for (const nombre of Object.keys(reglas.toolsPropias)) nombres.add(nombre);
  }
  return ordenado(nombres);
}

test("el catálogo del gate (módulos, rutas, campos, tools y roles por rubro) no cambia", () => {
  const combinaciones = EDICIONES.flatMap((edicion) =>
    RUBROS.flatMap((rubro) =>
      [[], [...MODULOS_ACTIVABLES]].map((activados) => ({
        edicion,
        rubro,
        activados: ordenado(activados),
        modulos: ordenado(modulosDe(edicion, rubro, activados)),
      })),
    ),
  );
  const toolsPorRubro = Object.fromEntries(
    nombresDeTools().map((nombre) => [
      nombre,
      Object.fromEntries(
        EDICIONES.flatMap((edicion) =>
          RUBROS.map((rubro) => [`${edicion}/${rubro}`, toolDelRubro(nombre, edicion, rubro)]),
        ),
      ),
    ]),
  );
  compararConFoto("gate", {
    modulos: ordenado(MODULOS),
    modulosPorEdicion: Object.fromEntries(
      EDICIONES.map((e) => [e, ordenado(MODULOS_POR_EDICION[e])]),
    ),
    modulosPorRubro: Object.fromEntries(RUBROS.map((r) => [r, ordenado(MODULOS_POR_RUBRO[r])])),
    soloClinica: ordenado(SOLO_CLINICA),
    activables: ordenado(MODULOS_ACTIVABLES),
    sinRutas: ordenado(MODULOS_SIN_RUTAS),
    combinaciones,
    motivoDeExclusion: Object.fromEntries(
      ordenado(MODULOS).map((m) => [
        m,
        Object.fromEntries(
          RUBROS.map((r) => [r, motivoDeExclusion(m as (typeof MODULOS)[number], r)]),
        ),
      ]),
    ),
    rutasPorModulo: Object.fromEntries(
      ordenado(MODULOS).map((m) => [m, RUTAS_POR_MODULO[m as (typeof MODULOS)[number]]]),
    ),
    rutasPublicas: RUTAS_PUBLICAS,
    camposPorRuta: Object.fromEntries(
      ordenado(Object.keys(CAMPOS_POR_RUTA)).map((ruta) => [ruta, CAMPOS_POR_RUTA[ruta]]),
    ),
    moduloDeLaTool: Object.fromEntries(
      ordenado(Object.keys(MODULO_DE_LA_TOOL)).map((t) => [t, MODULO_DE_LA_TOOL[t]]),
    ),
    moduloDeLaToolDeClinica: Object.fromEntries(
      ordenado(Object.keys(MODULO_DE_LA_TOOL_DE_CLINICA)).map((t) => [
        t,
        MODULO_DE_LA_TOOL_DE_CLINICA[t],
      ]),
    ),
    toolsPorRubro,
    rolesPorRubro: Object.fromEntries(RUBROS.map((r) => [r, ordenado(ROLES_POR_RUBRO[r])])),
  });
});

// ---------------------------------------------------------------------------
// 3. Tools que ve el modelo
//
// La misma composición que hace runAgentTurn (agentOrchestration.service.ts,
// "Las tools con versión propia del rubro se reemplazan"), para un agente con
// TODAS las tools habilitadas y en el nivel que las permite todas, por chat.
// El nivel y el canal de voz son del núcleo y no se mueven: quedan afuera.
//
// De cada tool se guarda el nombre y un hash de su definición (descripción y
// parámetros): cualquier cambio de un byte la marca, y la foto queda chica.
// Las definiciones completas de una automotora ya están en
// src/clinicas/__snapshots__/prompt-automotora.txt.
// ---------------------------------------------------------------------------

function hashDe(tool: ToolDelAgente): string {
  return createHash("sha256").update(JSON.stringify(tool.definition)).digest("hex").slice(0, 16);
}

function toolsQueVeElModelo(edicion: OrganizationEdition, rubro: OrganizationIndustry) {
  const organizacion = { edition: edicion, industry: rubro };
  const reglas = reglasDelRubro(rubro);
  const habilitadas = nombresDeTools();
  const exclusivas = habilitadas
    .filter(
      (nombre) =>
        Object.hasOwn(reglas.toolsExclusivas, nombre) && toolDelRubro(nombre, edicion, rubro),
    )
    .map((nombre) => reglas.toolsExclusivas[nombre]);
  const tools = toolsSinCampos(
    [...toolsHabilitadas(habilitadas, organizacion), ...exclusivas].map(
      (tool) => reglas.toolsPropias[tool.definition.name] ?? tool,
    ),
    reglas.camposFueraDeLasTools,
  );
  const delSistema = reglas.toolsDelSistema ? reglas.toolsDelSistema([]) : [];
  return {
    habilitadas: tools.map((t) => ({ nombre: t.definition.name, definicion: hashDe(t) })),
    delSistema: delSistema.map((t) => ({ nombre: t.definition.name, definicion: hashDe(t) })),
  };
}

test("las tools que ve el modelo en cada rubro y edición, en orden, no cambian", () => {
  const porCombinacion = Object.fromEntries(
    EDICIONES.flatMap((edicion) =>
      RUBROS.map((rubro) => [`${edicion}/${rubro}`, toolsQueVeElModelo(edicion, rubro)]),
    ),
  );
  assert.ok(porCombinacion["COMPLETA/AUTOMOTORA"].habilitadas.length > 10);
  compararConFoto("tools", porCombinacion);
});
