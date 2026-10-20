import type { OrganizationIndustry, OrganizationEdition } from "@prisma/client";
import { modulosDe } from "../src/config/ediciones";
import { guiaVisible } from "../src/services/guiaDeUso.service";
import type { RoleName } from "../src/types/auth";

// ---------------------------------------------------------------------------
// Cuánto mide la guía de uso que recibe el asistente "¿Cómo se hace?" en cada
// vista (rubro × edición × taller × rol × platform admin). Es lo que entra en
// el prompt de cada pregunta, así que define el costo
// (docs-privados/asistente-de-ayuda-diseno.md §7.1, local).
//
// Sin base ni red: lee docs/guia-de-uso/ del disco. Los tokens son una
// ESTIMACIÓN (caracteres / 3,5, la relación habitual del español con
// markdown en los tokenizadores de Anthropic); el número exacto lo da el
// `usage` de la primera llamada real. Haiku 5.5 cobra el prompt 5 veces más
// caro pasados los 100k tokens: si una vista se acerca, el script lo marca.
//
//   npx tsx scripts/medir-guia-de-uso.ts
// ---------------------------------------------------------------------------

const CARACTERES_POR_TOKEN = 3.5;
const LIMITE_DE_PRECIO = 100_000;

interface Vista {
  nombre: string;
  industry: OrganizationIndustry;
  edition: OrganizationEdition;
  conTaller: boolean;
  role: RoleName;
  isPlatformAdmin: boolean;
}

const VISTAS: Vista[] = [];
for (const edition of ["COMPLETA", "ESENCIAL"] as const) {
  for (const conTaller of [false, true]) {
    for (const role of ["ADMIN", "USER"] as const) {
      VISTAS.push({
        nombre: `Automotora ${edition}${conTaller ? " + taller" : ""}, ${role}`,
        industry: "AUTOMOTORA",
        edition,
        conTaller,
        role,
        isPlatformAdmin: false,
      });
    }
  }
}
VISTAS.push({
  nombre: "Automotora COMPLETA + taller, ADMIN y platform admin",
  industry: "AUTOMOTORA",
  edition: "COMPLETA",
  conTaller: true,
  role: "ADMIN",
  isPlatformAdmin: true,
});
for (const role of ["ADMIN", "RECEPCION"] as const) {
  VISTAS.push({
    nombre: `Clínica, ${role}`,
    industry: "CLINICA",
    edition: "COMPLETA",
    conTaller: false,
    role,
    isPlatformAdmin: false,
  });
}

const filas = VISTAS.map((vista) => {
  const secciones = guiaVisible(
    {
      industry: vista.industry,
      modulos: modulosDe(vista.edition, vista.industry, vista.conTaller ? ["servicios"] : []),
      role: vista.role,
      isPlatformAdmin: vista.isPlatformAdmin,
    },
    { conAvisosDeAdmin: true },
  );
  const caracteres = secciones.reduce((total, s) => total + s.markdown.length, 0);
  const tokens = Math.round(caracteres / CARACTERES_POR_TOKEN);
  return {
    vista: vista.nombre,
    secciones: secciones.length,
    caracteres,
    "tokens (estim.)": tokens,
    aviso: tokens > LIMITE_DE_PRECIO * 0.8 ? "cerca de 100k" : "",
  };
});

console.table(filas);
