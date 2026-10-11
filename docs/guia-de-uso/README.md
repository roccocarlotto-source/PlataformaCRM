# Guía de uso — convenciones

Esta carpeta es la **guía de uso de la aplicación**. Se incluye en el build del
frontend (`frontend/src/features/guia/`) y se muestra en la pantalla **Ayuda**,
así que lo que se escribe acá lo lee el personal de una automotora, no un
desarrollador.

## Regla de mantenimiento

**Todo PR que cambia lo que ve o hace un usuario actualiza la sección
correspondiente de esta carpeta en el mismo PR.** La plantilla de PR tiene una
casilla para eso y el CI avisa (sin fallar) cuando un PR toca
`frontend/src/features/` y no toca `docs/guia-de-uso/`.

## Archivos

Un archivo por sección, con prefijo numérico para el orden del índice:

| Archivo | Sección | Quién la ve |
|---|---|---|
| `01-primeros-pasos.md` | Primeros pasos | todos |
| `02-contactos-y-consultas.md` | Contactos y consultas | todos |
| `03-conversaciones.md` | Conversaciones | todos |
| `04-oportunidades-y-procesos-de-venta.md` | Oportunidades y procesos de venta | todos |
| `05-stock.md` | Stock | todos |
| `06-actividades-y-agenda.md` | Actividades y agenda | todos |
| `07-cupones-y-qr.md` | Cupones y QR | todos |
| `08-agentes-de-ia.md` | Agentes de IA | todos (configuración: ADMIN) |
| `09-base-de-conocimiento.md` | Base de conocimiento | todos (configuración: ADMIN) |
| `10-automatizaciones.md` | Automatizaciones | todos (configuración: ADMIN) |
| `11-campos-personalizados.md` | Campos personalizados | todos (configuración: ADMIN) |
| `12-usuarios-y-permisos.md` | Usuarios y permisos | todos |
| `13-organizacion-y-sucursales.md` | Configuración de la organización y sucursales | todos (configuración: ADMIN) |
| `14-plataforma.md` | Plataforma | solo platform admin |

El **slug** de la sección (la parte de la URL, `/ayuda/<slug>`) es el nombre
del archivo sin el prefijo numérico ni la extensión. No se renombran archivos:
los links de la app apuntan a ese slug.

## La guía de una clínica

En una organización de rubro **clínica**, la pantalla Ayuda arma la guía con
`clinicas/` (docs/rubros.md §1.3):

- cada archivo de `clinicas/` **reemplaza entero** al de la raíz con el mismo
  número, y tiene que llevar el mismo nombre (mismo slug, para que los links y
  los "?" de las pantallas sigan andando);
- las secciones de la raíz sin versión de clínica se muestran solo si la
  clínica tiene su módulo; Stock y Oportunidades no se muestran nunca;
- una automotora ve exactamente la guía de la raíz.

Como reemplaza la sección entera, cada archivo de `clinicas/` cubre todo lo
que una clínica usa de esa pantalla, con las mismas anclas que usan los "?"
(`frontend/src/features/guia/anclas.ts`). Se escribe para el personal de una
clínica (administración y recepción), con su vocabulario: pacientes,
profesionales, prestaciones, turnos, agenda, sedes y responsable. Sin nada de
autos: un test falla si aparecen "cliente", "vehículo", "stock",
"oportunidad" o "vendedor". Los roles son **Administrador** y **Recepción**.

## Formato

- El archivo empieza con un único `# Título de la sección`.
- Cada pantalla o tema es un `## Título {#ancla}`. El `{#ancla}` es
  **obligatorio** en los `##` y opcional en los `###`: es lo que usa el ícono
  "?" de cada pantalla para abrir la guía en el lugar correcto. Las anclas no
  cambian aunque cambie el título; se escriben en minúsculas, sin acentos, con
  guiones (`{#ficha-de-contacto}`).
- Markdown simple: párrafos, listas numeradas para pasos, listas con viñetas,
  **negrita** para nombres de botones y campos tal como se ven en pantalla,
  tablas chicas cuando ayudan, `>` para advertencias importantes.
- Sin HTML. Sin imágenes.
- Links internos a otra sección de la guía: `[Conversaciones](/ayuda/conversaciones#responder)`.
  Links a pantallas de la app: `[Contactos](/contacts)`.

## Cómo se escribe

Para el personal de una automotora: vendedores, recepción, administración.

- Español rioplatense simple, con voseo ("elegí", "tocá", "vas a ver").
- Qué hace cada cosa, para qué sirve y qué tener en cuenta. Pasos numerados
  cuando hay que hacer algo.
- Sin nombres de tablas, endpoints, variables, rutas de código ni términos
  técnicos. "El sistema" o "la app", nunca "el backend".
- Ejemplos con datos inventados: Ana Pérez, 11 2345 6789, ana@example.com,
  Toyota Hilux SRV 2021, Sucursal Centro.
- Donde cambie, diferenciar lo que puede hacer un **administrador** (ADMIN) y
  lo que puede hacer un **usuario** (USER): "Solo un administrador puede…".
- Las advertencias que evitan un error o una sorpresa van destacadas con `>`:
  qué se borra, qué le llega al cliente, qué no se puede deshacer, qué lee el
  agente de IA.
