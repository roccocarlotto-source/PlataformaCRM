# src/clinicas

El módulo de clínicas (`docs/rubros.md` §1.3). Todavía no tiene lógica de
negocio: la van sumando los PR R3 en adelante del plan (§15).

Lo propio del rubro CLINICA vive acá, con la misma organización por capas que
el resto del backend (`routes`, `controllers`, `services`, `repositories`,
`workers`, `config`), y no en ramas `if (industry === "CLINICA")` repartidas
por los services compartidos (§0.3).

Lo que **no** vive acá, porque es del núcleo compartido:

- el catálogo de módulos por edición y por rubro, el gate y el filtro de tools
  por rubro: `src/config/ediciones.ts` (`modulosDe`, `toolDelRubro`) y
  `src/middlewares/moduloDeLaEdicion.ts`;
- el rubro en el contexto de autenticación (`AuthContext.industry`).

## Suite "automotora sin cambios"

`automotoraSinCambios.test.ts` y `automotoraSinCambios.integration-test.ts`
hacen cumplir la regla firme del plan: nada de clínicas cambia el
comportamiento de una automotora (§0.3, §14.1). Cada PR del plan que toca el
núcleo les agrega su caso, comparando contra valores fijos del comportamiento
de antes, no contra el catálogo.
