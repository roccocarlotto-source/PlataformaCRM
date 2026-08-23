# CLAUDE.md

## Project Identity

- **Project:** Plataforma CRM
- **Description:** CRM SaaS multi-tenant — backend en Node.js + Express +
  TypeScript, Prisma ORM sobre PostgreSQL (Supabase), autenticación
  delegada a Supabase Auth.

---

## Project Context

> Edit this section per project. This is the only section meant to
> change regularly.

- **Stack:** Node.js + Express + TypeScript, Prisma ORM, PostgreSQL
  (Supabase), autenticación Supabase Auth (JWT verificado vía
  JWKS/ES256)
- **Status / Phase:** Infraestructura base y autenticación completas.
  Módulos de negocio (`Company`, `Contact`, `Pipeline`, `Stage`,
  `Opportunity`, `Activity`, `Invitation`) completos — CRUD, soft
  delete, paginación. Administración acotada de `User`. Sin endpoint
  de login propio (decisión de diseño estable, no pendiente).
- **Key context:** Multi-tenant real — aislamiento por organización
  verificado end-to-end contra un proyecto real de Supabase. Diseño
  completo del producto y modelo de datos en
  `docs/project-overview.md`; diseño de autenticación/onboarding en
  `docs/authentication-architecture.md`.

---

## Toolkit Discovery

The responsibility of this section is to make the Toolkit locatable —
not to describe it.

The Toolkit is discovered at:

U:\Proyectos\Claude-Toolkit-V1.1

Today this is expressed as an absolute path. The discovery mechanism
may change in the future without changing what this section is for.

---

## Activation

When the user writes:

Activate Claude-Toolkit

this signals the Toolkit, at the location declared above, to begin
its own bootstrap. What happens next is defined entirely by the
Toolkit's own CLAUDE.md — nothing about it is described here.

---

## Boundaries

This file must never contain: Toolkit rules, Constitutional
Principles, internal Toolkit documentation, or Router logic. Any of
that belongs to the Toolkit's own CLAUDE.md, never to this one.
