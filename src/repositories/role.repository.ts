import { prisma, type Db } from "../lib/prisma";
import type { RoleName } from "../types/auth";

export function findRoleByName(name: RoleName, db: Db = prisma) {
  return db.role.findUnique({ where: { name } });
}
