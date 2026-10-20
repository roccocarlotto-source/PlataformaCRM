import assert from "node:assert/strict";
import { test } from "node:test";
import { modulosDe } from "../config/ediciones";
import { guiaVisible } from "./guiaDeUso.service";
import {
  bloquesDe,
  elegirBloques,
  indiceDe,
  PRESUPUESTO_DE_CARACTERES,
  textoDeLosBloques,
} from "./helpAssistantBusqueda";

// ---------------------------------------------------------------------------
// La búsqueda del asistente sobre la guía real (docs/guia-de-uso/): que
// encuentre el bloque aunque la pantalla no tenga nada que ver con la
// pregunta, que entienda cómo pregunta la gente, y que respete el
// presupuesto. El eval con el modelo (scripts/eval-asistente-ayuda.ts) mide el
// resultado final.
// ---------------------------------------------------------------------------

const ADMIN = guiaVisible(
  {
    industry: "AUTOMOTORA",
    modulos: modulosDe("COMPLETA", "AUTOMOTORA", []),
    role: "ADMIN",
    isPlatformAdmin: false,
  },
  { conAvisosDeAdmin: true },
);
const RECEPCION = guiaVisible(
  {
    industry: "CLINICA",
    modulos: modulosDe("COMPLETA", "CLINICA", []),
    role: "RECEPCION",
    isPlatformAdmin: false,
  },
  { conAvisosDeAdmin: true },
);

const anclas = (bloques: ReturnType<typeof bloquesDe>) =>
  bloques.map((b) => `${b.slug}#${b.ancla ?? ""}`);

test("bloquesDe: un bloque por ## (con sus ###) y la introducción de cada sección", () => {
  const bloques = bloquesDe(ADMIN);
  const invitar = bloques.find((b) => b.ancla === "invitar");
  assert.ok(invitar);
  assert.equal(invitar.slug, "usuarios-y-permisos");
  assert.match(invitar.texto, /^## Invitar a una persona \{#invitar\}/);
  assert.ok(bloques.some((b) => b.slug === "primeros-pasos" && b.ancla === null));
});

test("desde Stock, '¿cómo invito a un vendedor nuevo?' trae el bloque de invitar, además del de la pantalla", () => {
  const elegidos = anclas(
    elegirBloques(bloquesDe(ADMIN), "¿Cómo invito a un vendedor nuevo?", "stock#stock"),
  );
  assert.ok(elegidos.includes("stock#stock"), "el de la pantalla");
  assert.ok(elegidos.includes("usuarios-y-permisos#invitar"), elegidos.join(", "));
});

test("cómo pregunta la gente: 'juntar dos clientes repetidos' encuentra unir contactos", () => {
  const elegidos = anclas(
    elegirBloques(bloquesDe(ADMIN), "Tengo un cliente repetido, ¿cómo los junto?", null),
  );
  assert.ok(elegidos.includes("contactos-y-consultas#unir-contactos"), elegidos.join(", "));
});

test("en una clínica, desde Conversaciones, 'un paciente no vino' encuentra Atendido y No vino", () => {
  const elegidos = anclas(
    elegirBloques(
      bloquesDe(RECEPCION),
      "¿Cómo marco que un paciente no vino?",
      "conversaciones#bandeja",
    ),
  );
  assert.ok(elegidos.includes("actividades-y-agenda#atendido-no-vino"), elegidos.join(", "));
});

test("respeta el presupuesto y devuelve en el orden de la guía", () => {
  const bloques = bloquesDe(ADMIN);
  const elegidos = elegirBloques(bloques, "oportunidad etapa cotización pago entrega stock", null);
  const largo = elegidos.reduce((t, b) => t + b.texto.length, 0);
  assert.ok(largo <= PRESUPUESTO_DE_CARACTERES);
  const posiciones = elegidos.map((b) => bloques.indexOf(b));
  assert.deepEqual(
    posiciones,
    [...posiciones].sort((a, b) => a - b),
  );
  // Mucho menos que la guía entera.
  const total = bloques.reduce((t, b) => t + b.texto.length, 0);
  assert.ok(largo < total / 2, `${String(largo)} de ${String(total)}`);
});

test("una pregunta sin nada en común no trae más que el bloque de la pantalla", () => {
  const elegidos = elegirBloques(bloquesDe(ADMIN), "xyzzy plugh", "stock#stock");
  assert.deepEqual(anclas(elegidos), ["stock#stock"]);
});

test("indiceDe: todas las secciones y temas, con el ancla citable; los de administrador como aviso", () => {
  const indice = indiceDe(
    guiaVisible(
      {
        industry: "AUTOMOTORA",
        modulos: modulosDe("COMPLETA", "AUTOMOTORA", []),
        role: "USER",
        isPlatformAdmin: false,
      },
      { conAvisosDeAdmin: true },
    ),
  );
  assert.match(indice, /- Contactos y consultas \(contactos-y-consultas\)/);
  assert.match(indice, / {2}- Contactos \(contactos-y-consultas#contactos\)/);
  assert.match(indice, /- Invitar a una persona — lo hace un administrador\./);
});

test("textoDeLosBloques: agrupa por sección con su slug y su título", () => {
  const bloques = bloquesDe(ADMIN)
    .filter((b) => b.slug === "usuarios-y-permisos")
    .slice(1, 3);
  const texto = textoDeLosBloques(bloques);
  assert.match(texto, /^<seccion slug="usuarios-y-permisos">\n# Usuarios y permisos/);
  assert.equal(texto.match(/<seccion /g)?.length, 1);
});
