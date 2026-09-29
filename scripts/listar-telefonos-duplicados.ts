import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { normalizarTelefono, soloDigitos } from "../src/lib/telefono";

// ---------------------------------------------------------------------------
// Teléfonos de contacto duplicados o sin normalizar — F5 de
// docs/prueba-en-vivo-2026-09-29.md.
//
// Desde F5 todo Contact.phone nuevo se guarda como "+" y solo dígitos
// (src/lib/telefono.ts) y no puede repetirse dentro de una organización. Los
// datos de ANTES no se migraron (sin migración, decisión de F5): este script
// los lista para que una persona decida qué fusionar o corregir. Por
// organización, dos listados:
//
//   (a) grupos de contactos no eliminados que comparten el mismo teléfono
//       normalizado — la comparación es por dígitos, la misma que usa el
//       WhatsApp entrante (findContactIdByNormalizedPhone), así que
//       `+59894000111` y `59894000111` caen en el mismo grupo;
//   (b) teléfonos guardados en una forma distinta de la normalizada, con la
//       forma que tendrían, o "no normalizable" si la regla no puede
//       convertirlos sin adivinar el país (un local con 0 inicial).
//
// SOLO LEE. La consulta corre en una transacción READ ONLY: si alguien le
// agregara una escritura por error, Postgres la rechaza en vez de ejecutarla.
//
// Uso:
//   npm run listar:telefonos-duplicados
//   npm run listar:telefonos-duplicados -- --org <organizationId>
//
// Necesita DATABASE_URL de la base a revisar (carga .env con dotenv, que no
// pisa una variable ya exportada).
// ---------------------------------------------------------------------------

interface FilaContacto {
  id: string;
  organization_id: string;
  organization_name: string;
  first_name: string;
  last_name: string;
  phone: string;
  created_at: Date;
}

function argumento(nombre: string): string | undefined {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function describir(c: FilaContacto): string {
  return `${c.id}  ${c.first_name} ${c.last_name}  phone=${JSON.stringify(c.phone)}  creado=${c.created_at.toISOString()}`;
}

async function main() {
  const orgId = argumento("--org");

  const filas = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return tx.$queryRaw<FilaContacto[]>`
      SELECT c.id, c.organization_id, o.name AS organization_name,
             c.first_name, c.last_name, c.phone, c.created_at
      FROM contacts c
      JOIN organizations o ON o.id = c.organization_id
      WHERE c.deleted_at IS NULL
        AND c.phone IS NOT NULL
        AND (${orgId ?? null}::uuid IS NULL OR c.organization_id = ${orgId ?? null}::uuid)
      ORDER BY o.name, c.organization_id, c.created_at, c.id
    `;
  });

  const porOrganizacion = new Map<string, FilaContacto[]>();
  for (const fila of filas) {
    const lista = porOrganizacion.get(fila.organization_id) ?? [];
    lista.push(fila);
    porOrganizacion.set(fila.organization_id, lista);
  }

  console.log("Teléfonos de contacto duplicados o sin normalizar (F5) — solo lectura");
  console.log(`  Alcance: ${orgId ? `organización ${orgId}` : "todas las organizaciones"}`);
  console.log(`  Contactos no eliminados con teléfono: ${String(filas.length)}`);

  let totalGrupos = 0;
  let totalSinNormalizar = 0;

  for (const [id, contactos] of porOrganizacion) {
    const porDigitos = new Map<string, FilaContacto[]>();
    for (const c of contactos) {
      const digitos = soloDigitos(c.phone);
      // Sin ningún dígito no hay número que compartir; igual aparece en (b).
      if (digitos.length === 0) continue;
      porDigitos.set(digitos, [...(porDigitos.get(digitos) ?? []), c]);
    }
    const grupos = [...porDigitos.entries()].filter(([, lista]) => lista.length > 1);
    const sinNormalizar = contactos.filter((c) => normalizarTelefono(c.phone) !== c.phone);

    if (grupos.length === 0 && sinNormalizar.length === 0) continue;
    totalGrupos += grupos.length;
    totalSinNormalizar += sinNormalizar.length;

    console.log("");
    console.log(`== ${contactos[0].organization_name} (${id})`);

    console.log(`  (a) Grupos con el mismo teléfono: ${String(grupos.length)}`);
    for (const [digitos, lista] of grupos) {
      console.log(`    +${digitos} — ${String(lista.length)} contactos`);
      for (const c of lista) console.log(`      ${describir(c)}`);
    }

    console.log(`  (b) Teléfonos sin normalizar: ${String(sinNormalizar.length)}`);
    for (const c of sinNormalizar) {
      const normalizado = normalizarTelefono(c.phone);
      console.log(
        `    ${describir(c)}  -> ${normalizado ?? "no normalizable (sin código de país o no es un teléfono)"}`,
      );
    }
  }

  console.log("");
  // Nunca en silencio, mismo criterio que las purgas: un 0 es información.
  console.log(
    `Total: ${String(totalGrupos)} grupo(s) de duplicados, ${String(totalSinNormalizar)} teléfono(s) sin normalizar. No se escribió nada.`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
