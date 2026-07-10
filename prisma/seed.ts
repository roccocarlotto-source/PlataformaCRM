import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Catálogo mínimo de roles — prerequisito operativo para el flujo de
// onboarding descripto en docs/authentication-architecture.md sección 1
// (el trigger de creación de Organization+User busca el Role "ADMIN" por
// nombre; debe existir antes del primer signup). Idempotente: se puede
// correr de nuevo sin duplicar filas.
const ROLES = [
  {
    name: "ADMIN",
    description:
      "Administra la organización: invita usuarios, gestiona roles y accede a todos los datos del tenant.",
  },
  {
    name: "USER",
    description:
      "Usuario estándar: gestiona sus propios registros dentro de la organización.",
  },
] as const;

async function main() {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
  }
}

main()
  .then(async () => {
    console.log("Seed completado: catálogo de roles (ADMIN, USER).");
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
