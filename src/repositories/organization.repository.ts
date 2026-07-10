import { prisma, type Db } from "../lib/prisma";

export function findOrganizationBySlug(slug: string, db: Db = prisma) {
  return db.organization.findUnique({ where: { slug } });
}

export function createOrganization(
  data: { name: string; slug: string },
  db: Db = prisma,
) {
  return db.organization.create({ data });
}
