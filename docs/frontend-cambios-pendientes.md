# Cambios pendientes de frontend

Lista de cambios de UI/UX pedidos por Rocco durante el testeo del flujo real de la plataforma (sesión iniciada 2026-09-09). Cada entrada tiene el contexto necesario para implementarse sin tener que volver a preguntar. Estado: **pendiente** hasta que se implemente y se marque como **hecho**.

---

## 1. Filtro "Estado" en Stock de vehículos no se ve como un desplegable

**Estado:** hecho

**Dónde:** `/vehicles` (Stock de vehículos), filtro "Estado", primero de la fila de filtros.

**Archivo:** `frontend/src/features/vehicle/VehicleListPage.tsx` (líneas ~108-130).

**Comportamiento actual:** el filtro "Estado" es un `<select multiple>` nativo de HTML. Los navegadores renderizan ese elemento como una lista siempre abierta y scrolleable (se ven todas las opciones — "Disponible", "Reservado", "En preparación", "En tránsito", etc. — apiladas), no como un desplegable cerrado. Esto lo hace ver "roto" al lado de los demás filtros de la misma fila (Sucursal, Condición, Ordenar por, Orden), que sí son `<select>` simples, cerrados, que abren al hacer click.

El multi-select es intencional: el backend acepta varios estados a la vez vía query repetida (`statusListSchema`), así que hoy se puede filtrar por más de un estado en simultáneo.

**Comportamiento deseado:** reemplazar el `<select multiple>` nativo por un componente de desplegable con checkboxes — cerrado por defecto (mismo alto/estilo visual que los otros filtros de la fila), que al hacer click abre una lista con checkboxes para tildar uno o varios estados. El botón/trigger cerrado debería mostrar algo como "Todos" (sin selección) o "N seleccionados" / el nombre del único estado elegido (si es uno solo), para que se entienda de un vistazo qué está filtrado sin tener que abrirlo.

Se mantiene la multi-selección actual (no se resigna esa funcionalidad) — el cambio es puramente de presentación/interacción, no de qué filtros soporta el backend.

**Decisión ya tomada:** se descartó la alternativa de convertirlo en un `<select>` de un solo valor (como "Condición") porque se perdería la posibilidad de filtrar por varios estados a la vez.


---

## 2. Placeholder cortado en los buscadores de "filtro por empresa/contacto/etc." (píldora de filtros)

**Estado:** hecho

**Dónde se vio:** `/activities` (Actividades), filtro "Filtrar por empresa". Se muestra "Buscar empresa por nomb..." en vez del texto completo "Buscar empresa por nombre…".

**Archivos involucrados:**
- CSS compartido: `frontend/src/design-system/design-system.css`, reglas de `.ds-filters div:has(> label[for])` y `.ds-filters div:has(> label[for]) > input` (~líneas 361-460). Esta es la "píldora" genérica que envuelve a los selectores de búsqueda compartidos (CompanySelect, y cualquier otro con el mismo patrón `div > label[for] + input`).
- Componente puntual del ejemplo: `frontend/src/features/company/CompanySelect.tsx` (placeholder "Buscar empresa por nombre…", línea ~85), usado como filtro en `frontend/src/features/activity/ActivityListPage.tsx` (línea ~162) y potencialmente en otras pantallas que también lo usan como filtro (ej. Contactos) — no se relevaron todas todavía.

**Causa (diagnosticada por código, no solo el síntoma):** el input dentro de la píldora tiene `flex: 1 1 auto; min-width: 0;` sin ningún `min-width` mayor a 0 en la propia píldora (`.ds-filters div:has(> label[for])`). Cuando la fila de filtros (`.ds-filters`, `display:flex; flex-wrap: wrap`) está apretada con varios filtros al lado, esta píldora se achica más de lo necesario para mostrar el placeholder completo, y el texto queda cortado — en vez de que la píldora pase a la siguiente línea (que es lo que el `flex-wrap: wrap` del contenedor debería permitir si la píldora tuviera un ancho mínimo que respetar).

**Decisión ya tomada (alcance):** el arreglo es general, en el CSS compartido — no puntual a la pantalla de Actividades. Hay que darle un `min-width` razonable a la píldora de este tipo de selector de búsqueda (`.ds-filters div:has(> label[for])`, o una variante más específica si tocar la regla genérica afecta también a los `<select>` normales de forma no deseada — a evaluar al implementar) para que el placeholder nunca se corte, dejando que sea la fila la que haga wrap a una línea nueva si no entra, no la píldora la que se achique por debajo de su contenido. Esto debería corregir el mismo problema en cualquier otra pantalla que use CompanySelect (o selectores análogos) como filtro, sin tener que pedirlo pantalla por pantalla.


---

## 3. Ícono "+" faltante en el botón "Nueva X" de varias pantallas de listado

**Estado:** hecho

**Dónde se vio (capturas):** botón superior derecho en `/contacts` ("Nuevo contacto"), `/pipelines` ("Nuevo pipeline"), `/opportunities` ("Nueva oportunidad"), `/activities` ("Nueva actividad") y `/sources` ("Nueva fuente"). En las cinco falta el ícono "+" a la izquierda del texto.

**Referencia de cómo se ve bien:** `/companies` ("Nueva empresa"), `/vehicles` ("Nueva unidad") y el botón de nueva QR en `/qr` sí tienen el ícono. Ahí el patrón correcto es:
```tsx
<Link to="/companies/new" className="ds-link-button">
  <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
  Nueva empresa
</Link>
```
(`Plus` importado de `lucide-react`, mismo ícono que usa el sidebar).

**Archivos a corregir (les falta el `<Plus .../>` que sí tienen las páginas de referencia):**
- `frontend/src/features/contact/ContactListPage.tsx` (línea ~93, botón "Nuevo contacto")
- `frontend/src/features/pipeline/PipelineListPage.tsx` (línea ~51, botón "Nuevo pipeline")
- `frontend/src/features/opportunity/OpportunityListPage.tsx` (línea ~142, botón "Nueva oportunidad")
- `frontend/src/features/activity/ActivityListPage.tsx` (línea ~124, botón "Nueva actividad")
- `frontend/src/features/source/SourceListPage.tsx` (línea ~69, botón "Nueva fuente")

**Comportamiento deseado:** agregar `<Plus size={16} strokeWidth={1.5} aria-hidden="true" />` antes del texto en cada uno de esos cinco `Link` (mismo ícono, mismo tamaño, mismo estilo que ya usan `CompanyListPage` y `VehicleListPage`), sin cambiar el texto de ningún botón.

**Nota aparte (no pedida en las capturas, mencionar al implementar):** `frontend/src/features/invitation/InvitationListPage.tsx` (línea ~73) tiene el mismo problema de fondo — el botón dice "Invitar" y tampoco tiene el ícono — pero como el texto no sigue el patrón "Nuevo/Nueva X" y no estaba en las capturas, no se incluye en el alcance de este ítem a menos que Rocco confirme que también se agregue ahí.


---

## 4. Encabezado "Filtros" en la fila de filtros, y sacar la palabra repetida en el campo "Buscar"

**Estado:** hecho

**Dónde se vio:** capturas de `/companies`, `/contacts`, `/pipelines`, `/opportunities`, `/activities`, `/tasks` (Mis tareas), `/vehicles`, `/qr`, `/users`, `/sources`. El patrón se repite en casi todos los listados.

**Dos cambios relacionados, decididos juntos:**

**4.a — Encabezado `<h2>Filtros</h2>`** arriba de la fila de filtros (`.ds-filters`) en cada pantalla de listado, para dar contexto visual sin que cada control individual tenga que aclarar "esto es un filtro". Se eligió "Filtros" (no "Búsqueda") porque la fila combina texto libre con selects de filtro/orden, no es solo búsqueda.

Archivos y línea donde insertar el `<h2>Filtros</h2>` (inmediatamente antes de `<div className="ds-filters">`; en las pantallas donde esa fila está dentro de `.ds-list-card`, el `<h2>` va dentro de la tarjeta, antes de `.ds-filters`):

| Archivo | Línea de `.ds-filters` | Dentro de `.ds-list-card` |
|---|---|---|
| `frontend/src/features/company/CompanyListPage.tsx` | 81 | sí |
| `frontend/src/features/contact/ContactListPage.tsx` | 104 | sí |
| `frontend/src/features/pipeline/PipelineListPage.tsx` | 58 | sí |
| `frontend/src/features/opportunity/OpportunityListPage.tsx` | 152 | sí |
| `frontend/src/features/activity/ActivityListPage.tsx` | 131 | sí |
| `frontend/src/features/activity/MyTasksPage.tsx` | 155 | no (fila suelta, sin `.ds-list-card`) |
| `frontend/src/features/source/SourceListPage.tsx` | 75 | sí |
| `frontend/src/features/stage/StageListPage.tsx` | 115 | sí |
| `frontend/src/features/vehicle/VehicleListPage.tsx` | 98 | sí |
| `frontend/src/features/qr/QrListPage.tsx` | 146 | sí |
| `frontend/src/features/user/UserListPage.tsx` | 134 | no |
| `frontend/src/features/invitation/InvitationListPage.tsx` | 78 | no |
| `frontend/src/features/ingestionEvent/IngestionEventListPage.tsx` | 123 | sí |
| `frontend/src/features/apiKey/ApiKeyListPage.tsx` | 183 (la **segunda** `.ds-filters` de este archivo) | sí |

**Ojo con `ApiKeyListPage.tsx`:** tiene DOS `.ds-filters` en el archivo. La primera (línea ~141, "Fuente para la clave nueva" + botón "Crear clave") no es un filtro, es el formulario de alta de una clave nueva — no le corresponde el `<h2>Filtros</h2>`. Solo la segunda (línea 183, la que sí filtra el listado de claves) lo lleva.

**4.b — Ocultar visualmente el rótulo "Buscar"** del campo de texto libre (queda solo para lectores de pantalla — el campo sigue necesitando un nombre accesible, así que el `<label>` no se borra del HTML, se oculta con una clase de utilidad tipo `.ds-sr-only` que hoy no existe en `design-system.css` y hay que crear, patrón estándar: `position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;`). El placeholder ("Buscar por nombre", "Buscar por asunto o notas", "Buscar tarea…", etc.) no cambia — sigue mostrando el texto completo, ahora sin el rótulo repetido al lado.

Archivos y línea del `<label>Buscar` a tratar:

| Archivo | Línea |
|---|---|
| `frontend/src/features/company/CompanyListPage.tsx` | 83 |
| `frontend/src/features/contact/ContactListPage.tsx` | 106 |
| `frontend/src/features/pipeline/PipelineListPage.tsx` | 60 |
| `frontend/src/features/opportunity/OpportunityListPage.tsx` | 154 |
| `frontend/src/features/activity/ActivityListPage.tsx` | 133 |
| `frontend/src/features/activity/MyTasksPage.tsx` | 157 |
| `frontend/src/features/source/SourceListPage.tsx` | 77 |
| `frontend/src/features/stage/StageListPage.tsx` | 117 |

(`VehicleListPage`, `QrListPage`, `UserListPage`, `InvitationListPage`, `IngestionEventListPage` y la segunda fila de `ApiKeyListPage` no tienen campo "Buscar" de texto libre, así que no aplica el 4.b ahí — sí les toca el 4.a.)

**Nota aparte (no pedida en las capturas, mencionar al implementar):** `frontend/src/features/opportunity/OpportunityBoardView.tsx` (línea ~218, rótulo "Buscar" con placeholder "Buscar oportunidad…") tiene el mismo problema de fondo, pero vive en `.ds-board-toolbar` — la barra compacta arriba del tablero kanban de Oportunidades, no en la fila de filtros de un listado. No se incluye el `<h2>Filtros</h2>` ahí (quedaría raro en una barra angosta al lado de "Vista de tabla / Vista de embudo"), pero el tratamiento 4.b (ocultar el rótulo) sí podría aplicarse igual si Rocco lo confirma.

---

## 5. Sacar la redundancia label/placeholder en todos los inputs y selects (no solo "Buscar")

**Estado:** hecho

**Dónde se vio:** filas de filtros de `/contacts`, `/opportunities`, `/activities`, `/companies` y `/vehicles`, y los mismos selectores de búsqueda dentro de los formularios de alta/edición de Oportunidad, Actividad y Contacto.

**Contexto:** el ítem 4 sacó la redundancia "Buscar" + "Buscar por nombre" en el campo de texto libre de los filtros. Este ítem aplica el mismo principio — no repetir palabras entre el rótulo (`<label>`) y el placeholder o el texto de la opción vacía del campo — a **todos** los inputs y selects, no solo a ese campo. Son 12 cambios puntuales, agrupados en tres tipos según dónde vive el texto redundante.

### 5.1 — Texto hardcodeado dentro de componentes de búsqueda compartidos

Estos componentes reciben el `label` por prop del que los llama, pero el placeholder (o el texto de la opción vacía) está hardcodeado adentro del componente y repite el nombre del campo ("Buscar **empresa** por nombre…" al lado del rótulo "Empresa"). Como los mismos componentes se usan tanto en los filtros de listado como en los formularios de alta/edición (`OpportunityFormPage`, `ActivityFormPage`, `ContactFormPage`), el cambio de texto adentro del componente arregla la redundancia en todos los usos a la vez — no hace falta tocar los formularios por separado.

| Archivo | Línea | Antes | Después |
|---|---|---|---|
| `frontend/src/features/company/CompanySelect.tsx` | ~84 | `placeholder="Buscar empresa por nombre…"` | `placeholder="Buscar por nombre…"` |
| `frontend/src/features/opportunity/ContactSelect.tsx` | ~80 | `placeholder="Buscar contacto por nombre o email…"` | `placeholder="Buscar por nombre o email…"` |
| `frontend/src/features/activity/OpportunitySelect.tsx` | ~97 | `placeholder="Buscar oportunidad por título…"` | `placeholder="Buscar por título…"` |
| `frontend/src/features/vehicle/VehicleSelect.tsx` | ~84 | `placeholder="Buscar unidad disponible por marca, modelo, patente, VIN o código…"` | `placeholder="Buscar disponible por marca, modelo, patente, VIN o código…"` |
| `frontend/src/features/pipeline/PipelineSelect.tsx` | ~33 | `<option value="" disabled>Elegí un pipeline…</option>` | `<option value="" disabled>Elegí uno…</option>` |

En `VehicleSelect` se mantiene "disponible": es información real (el selector solo lista unidades en estado disponible), no una repetición del rótulo. Lo que se saca es "unidad", que ya lo dice el rótulo.

**Fuera de alcance, no tocar:** `frontend/src/features/stage/StageSelect.tsx`, texto "Elegí primero un pipeline…" en la opción vacía. No es redundancia con el rótulo "Etapa": es un mensaje legítimo de cross-reference que le dice al usuario que tiene que elegir un pipeline antes de poder elegir una etapa.

### 5.2 — Rótulo del que llama al componente: sacar el prefijo "Filtrar por"

El prefijo queda redundante por partida doble: con el `<h2>Filtros</h2>` que ya agregó el ítem 4.a arriba de la fila, y con el placeholder ya corregido en 5.1 ("Empresa" + "Buscar por nombre…" en vez de "Filtrar por empresa" + "Buscar empresa por nombre…").

| Archivo | Línea | Componente | Antes | Después |
|---|---|---|---|---|
| `frontend/src/features/contact/ContactListPage.tsx` | ~142 | `CompanySelect` | `label="Filtrar por empresa"` | `label="Empresa"` |
| `frontend/src/features/opportunity/OpportunityListPage.tsx` | ~190 | `CompanySelect` | `label="Filtrar por empresa"` | `label="Empresa"` |
| `frontend/src/features/activity/ActivityListPage.tsx` | ~169 | `CompanySelect` | `label="Filtrar por empresa"` | `label="Empresa"` |
| `frontend/src/features/opportunity/OpportunityListPage.tsx` | ~211 | `PipelineSelect` | `label="Filtrar por pipeline"` | `label="Pipeline"` |

**Nota, no requiere cambio:** `frontend/src/features/opportunity/OpportunityBoardView.tsx` (línea ~212, `PipelineSelect` con `label="Pipeline"`) ya tenía el rótulo corto — queda sin redundancia automáticamente con el cambio de la opción vacía interna de `PipelineSelect` (5.1).

### 5.3 — Inputs de texto simples cuyo propio placeholder repite el rótulo de al lado

Acá el rótulo y el placeholder viven en el mismo archivo. El placeholder no aporta nada que el rótulo no diga ("Industria" + "Filtrar por industria"), así que se saca y el campo queda sin placeholder — mismo criterio que los campos "Precio mín. (USD)" / "Precio máx. (USD)" de la misma fila en `/vehicles`, que ya no tienen placeholder.

| Archivo | Línea | Rótulo | Cambio |
|---|---|---|---|
| `frontend/src/features/company/CompanyListPage.tsx` | ~101 | Industria | sacar `placeholder="Filtrar por industria"` |
| `frontend/src/features/vehicle/VehicleListPage.tsx` | ~147 | Marca | sacar `placeholder="Filtrar por marca"` |
| `frontend/src/features/vehicle/VehicleListPage.tsx` | ~159 | Modelo | sacar `placeholder="Filtrar por modelo"` |

### Tests y otros archivos tocados por arrastre

- Los tests que localizaban estos campos por placeholder se actualizaron al texto nuevo (`CompanySelect`, `ContactSelect`, `OpportunitySelect`, `VehicleSelect`, `ActivityFormPage`, `OpportunityFormPage`, `ContactListPage`). Los de 5.3, que ya no tienen placeholder, pasaron a localizar el campo por su rótulo con `getByLabelText` (`CompanyListPage`, `VehicleListPage`); el de `OpportunityListPage` pasó de `getByLabelText("Filtrar por pipeline")` a `getByLabelText("Pipeline")`.
- `frontend/src/design-system/design-system.css`: el comentario de la regla `min-width: 260px` del input de los selectores de búsqueda (ítem 2) citaba los placeholders y rótulos viejos como justificación de la medida. Se actualizó para dejar claro que esas mediciones eran de los textos anteriores a este ítem y que los nuevos, más cortos, entran en el mismo mínimo. La regla en sí no cambia.


---

## 6. La sesión no debe sobrevivir a cerrar el navegador — pedir login en cada apertura del programa

**Estado:** hecho

**Dónde se vio:** verificado en producción por Rocco. Cerró el programa (el navegador), lo volvió a abrir, y entró al CRM directo sin que se le pidiera loguearse.

**Archivo:** `frontend/src/lib/supabase.ts` (líneas ~18-24, creación del cliente de Supabase).

**Comportamiento actual (antes de este ítem):** el cliente se crea con `persistSession: true` y sin `storage` custom, así que usa el default de la librería: `localStorage`. La sesión (access + refresh token) sobrevive indefinidamente a cerrar el navegador — mientras el refresh token siga vigente, la próxima apertura del CRM encuentra la sesión guardada y el usuario ya está adentro sin que se le pida nada.

**Comportamiento deseado:** cada vez que se cierra el navegador/programa y se vuelve a abrir, tiene que pedir login de nuevo. Un F5 (recargar la página sin cerrar el navegador) tiene que seguir manteniendo la sesión — eso no cambia.

**El cambio:** agregar `storage: window.sessionStorage` en las opciones de `auth` al crear el cliente (junto a `persistSession`, `autoRefreshToken` y `detectSessionInUrl`, que ya estaban). `sessionStorage` se comporta igual que `localStorage` frente a un F5 (sobrevive), pero se borra al cerrar la pestaña/el navegador — exactamente el comportamiento pedido. El comentario del mismo archivo (líneas ~8-17), que documentaba `persistSession` asumiendo el storage default, se corrigió para reflejar el storage explícito nuevo y por qué se eligió.

**Efecto secundario conocido — decisión tomada, no un bug a evitar:** `frontend/src/features/auth/AcceptInvitationPage.tsx` (rama `alreadyLoggedInEmail`, líneas ~278-300) dependía a propósito de que la sesión de Supabase sobreviviera a cerrar el navegador, para recuperar a alguien que cerró el navegador a mitad de aceptar una invitación, antes de terminar de poner su contraseña. Con `sessionStorage` esa recuperación deja de ser posible: esa persona va a ver el mismo mensaje que ya existe para enlaces inválidos/vencidos ("Este enlace no es válido o expiró. Pedile a tu administrador que te reinvite.") y se resuelve reinvitando. Rocco confirmó explícitamente que acepta este trade-off — no hace falta preservar ese caso ni buscar una alternativa más compleja.

Como consecuencia, en esa misma rama:
- se corrigió el comentario (líneas ~278-290) que explicaba la ambigüedad del caso asumiendo persistencia en `localStorage` — "cerré el navegador antes de terminar" ya no es un escenario que ese código pueda recuperar, porque la sesión ya no existiría;
- se sacó del JSX el párrafo "Si cerraste el navegador antes de terminar de configurar tu contraseña, podés hacerlo ahora sin perder tu cuenta.", que quedaba inexacto por la misma razón. La rama en sí se mantiene tal cual (mensaje de "ya iniciaste sesión" + formulario de contraseña): sigue siendo válida para el caso que sí queda — alguien ya logueado (con esta u otra cuenta), en la misma pestaña, sin haber cerrado el navegador, que hace click en un enlace de invitación;
- se ajustó el comentario de `AcceptInvitationPage.test.tsx` (líneas ~192-198) que justificaba el test de esa rama con la persistencia en `localStorage`. El test en sí sigue pasando sin cambios: usa mocks de auth, no depende de `localStorage`/`sessionStorage` real.

**Por arrastre:** `docs/project-overview.md` (sección 4, párrafo "Cierre del navegador entre accept exitoso y password pendiente") describía la persistencia en `localStorage` como hecho vigente; se le agregó una nota de "superado" apuntando a este ítem, sin reescribir el histórico.


---

## 7. Select de Propietario: sacar la opción redundante "Asignado a quien crea (por defecto)", preseleccionar directamente a quien crea

**Estado:** hecho

**Dónde se vio:** formulario "Nueva empresa" (`/companies/new`), campo "Propietario". Aplica igual a "Nuevo contacto" y "Nueva oportunidad".

**Contexto:** el select de "Propietario" (componente compartido `frontend/src/features/user/UserSelect.tsx`) mostraba siempre una primera opción "Asignado a quien crea (por defecto)" además de la lista real de usuarios — incluyendo al propio usuario que estaba creando el registro, que ya aparecía en la lista. Quedaba redundante: la opción "por defecto" y elegirse a uno mismo en la lista dicen literalmente lo mismo. Se pidió sacar esa opción y, en su lugar, preseleccionar directamente al usuario actual, sin ningún texto de "por defecto".

Este select se usa en tres formularios con la **misma semántica de backend** (`resolveOwnerId` en `src/services/ownership.service.ts`: si no se manda `ownerId`, el registro queda asignado a quien lo crea): `CompanyFormPage.tsx`, `ContactFormPage.tsx` y `OpportunityFormPage.tsx`, campo "Propietario" en los tres. Los tres se arreglaron igual, en este mismo ítem.

**Fuera de alcance, sin cambios:** `ActivityFormPage.tsx` (campo "Asignado a", `assigneeId`) y `VehicleFormPage.tsx` (campo "Asignado a", `assignedSalespersonId`) usan el mismo `UserSelect` pero con semántica distinta — el backend **nunca** autoasigna esos campos al creador (pueden quedar genuinamente sin asignar) y ya pasaban `emptyOptionLabel="Sin asignar"` explícito, que es correcto tal cual. Además, y esto es lo que decidió la forma de la Parte A: en esos dos formularios la opción "Sin asignar" **sirve para desasignar** — el PATCH de Activity acepta `assigneeId: null` y el de Vehicle `assignedSalespersonId: null` — así que tiene que seguir apareciendo aunque haya un usuario seleccionado. Ninguno de los dos archivos se tocó.

**El cambio, en tres partes:**

- **Parte A — `UserSelect.tsx`:** renderizaba siempre `<option value="">{emptyOptionLabel}</option>`, sin importar si `value` tenía un valor real. Se agregó un prop `clearable?: boolean` (default `true`, que conserva el comportamiento anterior para todo caller que no lo pase). Con `clearable={false}`, la opción vacía solo se renderiza cuando **no** hay `value` (`undefined` o `""`); con un valor real seleccionado (el creador preseleccionado, o el dueño real de un registro en edición) el `<select>` muestra únicamente la lista de usuarios, con el correcto marcado. El prop refleja lo que el backend acepta en el PATCH, no una preferencia de UI: `ownerId` no se puede limpiar (Company/Contact/Opportunity pasan `false`), `assigneeId`/`assignedSalespersonId` sí (Activity/Vehicle quedan en el default). Se actualizó el comentario del componente para describir el comportamiento real y los cinco callers actuales.

  *Por qué no fue incondicional:* la primera versión escondía la opción vacía siempre que hubiera valor, sin prop. Rompió el test de `ActivityFormPage.test.tsx` "limpiar body/dueDate/completedAt/assigneeId envía null explícito": en Actividad, elegir "Sin asignar" con alguien ya asignado es la única forma de desasignar, y sin esa opción el campo quedaba imposible de limpiar. El prop es la forma mínima de darles a los tres formularios de `ownerId` el comportamiento pedido sin cambiar nada en los otros dos.

- **Parte B — `CompanyFormPage.tsx`, `ContactFormPage.tsx`, `OpportunityFormPage.tsx`:** cada uno importa `useAuth` desde `../../auth/AuthContext` (mismo patrón que `OpportunityListPage.tsx`) y toma `me`. En modo creación, el valor inicial de `ownerId` es `me?.id` en vez de `undefined`: Company y Contact ganaron un `initialValues` (`isEditMode ? EMPTY_FORM : { ...EMPTY_FORM, ownerId: me?.id }`) con la misma forma que el que Opportunity ya tenía para `pipelineId`/`stageId` de la query string, y Opportunity sumó `ownerId: me?.id` a ese objeto. En edición sigue mostrando el propietario real del registro vía `toFormValues(...)`. Los tres `<UserSelect>` de "Propietario" pasan ahora `emptyOptionLabel="Sin asignar"` y `clearable={false}` explícitos, y se reescribieron los comentarios de Company y Contact que justificaban *no* pasar `emptyOptionLabel` ("Sin emptyOptionLabel: el default del componente…"), que dejaron de ser ciertos.

- **Parte C — caso de borde en edición (sin código adicional):** un registro existente puede tener `ownerId` null en la base (dato viejo). A diferencia de crear, guardar el formulario sin tocar el campo **no** asigna al creador: el backend solo autoasigna al crear, nunca al editar (`company.service.ts`, `contact.service.ts`, `opportunity.service.ts`: en el update, `ownerId` solo se toca si viene truthy). Para ese caso el select muestra "Sin asignar" (la opción de la Parte A, que aparece porque `value` es `undefined`), sin nada preseleccionado. Sale así solo con las Partes A y B: en edición con `ownerId` null, `toFormValues(...)` sigue devolviendo `ownerId: undefined` como antes.

**Decisiones ya tomadas:**

- **El id del creador viaja explícito en el POST.** Antes el payload de creación omitía `ownerId` y el backend lo resolvía; ahora manda `me.id`. El resultado es el mismo (`resolveOwnerId` devuelve `actorUserId` si no se manda nada, y valida el id si se manda — el creador es un usuario activo de su propia organización, así que pasa), pero la elección queda visible en el formulario en vez de implícita en un texto.
- **No se cambia el default del prop `emptyOptionLabel`.** Sigue siendo el texto histórico ("Asignado a quien crea (por defecto)"), aunque desde este ítem ningún caller lo usa: los cinco formularios pasan "Sin asignar". Se conservó como red de seguridad del test de regresión de `UserSelect.test.tsx`, cuyo comentario se reescribió porque ya no protege a Opportunity. Si en algún momento se quiere eliminar el default, es un cambio aparte y menor.
- **No se agrega forma de "quitar" el propietario desde un valor real.** Con `clearable={false}`, ya no se puede volver a `""` desde un usuario elegido en los tres formularios de `ownerId`. No se pierde nada: el PATCH nunca pudo limpiar `ownerId` (chequeo truthy en los tres services), así que esa opción antes tampoco hacía nada en edición.

**Tests:** `CompanyFormPage.test.tsx` y `ContactFormPage.test.tsx` ahora mockean `useAuth` por ruta de módulo (mismo patrón que sus `*ListPage.test.tsx`, `AuthContextValue` importado como tipo), con `me.id = "u1"` que coincide con "Ana Pérez" del handler de usuarios. Los tests "NO elegir propietario omite ownerId del payload" se reemplazaron por "el propietario arranca preseleccionado en quien crea, sin opción 'por defecto', y viaja en el POST" (valor `u1`, sin texto viejo, sin `option[value=""]`, `ownerId: "u1"` en el body); los de edición con dueño afirman que no se ofrece "Sin asignar", y los de edición sin dueño afirman que "Sin asignar" está y nada está marcado. Los asserts de payload de creación de esos dos archivos suman `ownerId: "u1"`. `OpportunityFormPage.test.tsx` sumó el mismo mock y un test de creación equivalente (sus asserts de payload usan `toMatchObject`, así que no rompieron). `UserSelect.test.tsx` conserva el test del default (con comentario corregido) y suma tres: `clearable={false}` con valor (solo los usuarios), `clearable={false}` sin valor (la opción vacía está, nada marcado) y `clearable` por default con valor (la opción vacía sigue ahí y elegirla llama a `onChange("")` — la regresión de Activity/Vehicle). `ActivityFormPage.test.tsx` y `VehicleFormPage.test.tsx` no se tocaron y siguen en verde.

**Por arrastre:** `docs/project-overview.md` (párrafo de M6 sobre `assigneeId` y el prop `emptyOptionLabel`) describía el default como el texto que Opportunity veía; se le agregó una nota de "superado" apuntando a este ítem, sin reescribir el histórico.


---

## 8. Columna "Acciones" de las pantallas de listado: reemplazar botones sueltos por un menú de 3 puntos

**Estado:** hecho

**Dónde se vio:** en varias pantallas de listado, la columna "Acciones" de cada fila. El caso más visible es Empresas (`/companies`): "Editar" como link de texto seguido de un botón rojo "Eliminar", uno al lado del otro.

**Contexto:** en varias pantallas de listado, la columna "Acciones" muestra los controles de cada fila (Editar, Eliminar, etc.) como enlaces/botones sueltos, uno al lado del otro, lo cual se ve inconsistente y poco prolijo (ejemplo: en Empresas, "Editar" como link de texto seguido de un botón rojo "Eliminar"). Cada pantalla resolvió la columna a su manera —links de texto en unas, `Button` dentro de `.ds-row-actions` en otras— y el resultado es una columna distinta en cada listado.

**Comportamiento deseado:** en las filas con 2 o más acciones, agrupar los controles detrás de un botón trigger con ícono de 3 puntos (kebab) que al hacer click despliega un menú con las acciones de esa fila. Las filas que hoy tienen una sola acción **no se tocan** — un menú de un solo ítem no aporta nada y suma un clic innecesario.

**Pantallas que pasan a usar el menú de 3 puntos (2+ acciones por fila):**

| Archivo | Acciones de la fila |
|---|---|
| `frontend/src/features/company/CompanyListPage.tsx` | Editar, Eliminar |
| `frontend/src/features/contact/ContactListPage.tsx` | Editar, Eliminar |
| `frontend/src/features/opportunity/OpportunityListPage.tsx` | Editar, Eliminar |
| `frontend/src/features/activity/ActivityListPage.tsx` | Editar, Eliminar |
| `frontend/src/features/pipeline/PipelineListPage.tsx` | Ver etapas, y si es admin: Editar, Eliminar — 2 o 3 según rol |
| `frontend/src/features/stage/StageListPage.tsx` | Editar, Eliminar |
| `frontend/src/features/vehicle/VehicleListPage.tsx` | Editar, Eliminar |
| `frontend/src/features/qr/QrListPage.tsx` | Ver imagen, Copiar link, Editar, Eliminar — 4 |
| `frontend/src/features/user/UserListPage.tsx` | Desactivar/Activar, Eliminar |
| `frontend/src/features/source/SourceListPage.tsx` | Editar, Ver claves, Importar archivo (solo en fuentes de tipo `FILE_IMPORT`), Ver eventos, Eliminar — 4 o 5 según tipo |

**Pantallas que se dejan como están (fuera de alcance, una sola acción hoy):**

| Archivo | Única acción |
|---|---|
| `frontend/src/features/apiKey/ApiKeyListPage.tsx` | Revocar |
| `frontend/src/features/invitation/InvitationListPage.tsx` | Revocar |
| `frontend/src/features/ingestionEvent/IngestionEventListPage.tsx` | Ver contacto |

**Cómo se implementa:** un componente nuevo y reutilizable del design system, `frontend/src/design-system/ActionsMenu.tsx`, que recibe la lista de acciones de la fila (rótulo, qué hace, y un flag opcional para marcar una acción como "destructiva" — Eliminar/Revocar/Desactivar según el caso) y renderiza:

- un botón trigger con el ícono de 3 puntos (de `lucide-react`, que ya es dependencia del proyecto) y un `aria-label` accesible ("Más acciones");
- un panel desplegable con las acciones como ítems de menú (`role="menu"` / `role="menuitem"`, navegable con teclado, con las convenciones ARIA típicas de un botón de menú);
- que se cierra con click afuera, con Escape y al elegir cualquier acción (el patrón de apertura/cierre es el de `MultiSelect.tsx`, no el de `Modal.tsx`, que no se cierra con esos gestos a propósito por su caso de uso de secretos irreversibles);
- y en el que la acción destructiva conserva un tratamiento visual distinto (texto en el color `--color-danger` que ya usa el resto del design system) para no perder la señal de "esto borra/revoca algo".

Los estilos van en `design-system.css`, con la convención de nombres y estructura de los otros componentes del sistema (`Modal`, `MultiSelect`, `Button`). Cada una de las 10 pantallas pasa a usar `ActionsMenu` en su columna "Acciones" con las acciones reales de cada una. Es un cambio puramente de presentación: qué hace cada acción, sus confirmaciones `window.confirm` y sus mutaciones no cambian; en `QrListPage` "Ver imagen" y "Copiar link" conservan su lógica propia, y en `SourceListPage` "Importar archivo" sigue apareciendo solo en las fuentes `FILE_IMPORT`.

**Decisiones ya tomadas:**

- **El menú se implementa SOLO en pantallas con 2+ acciones por fila.** Decisión explícita, ya confirmada con Rocco — no reabrir esta pregunta. Las tres pantallas de una sola acción quedan exactamente como están.
- **No cambia ningún comportamiento funcional de las acciones.** Solo cambia cómo se presentan: agrupadas detrás de un menú en vez de sueltas.


**Hallazgos al implementar (la lista de arriba, verificada contra el código):**

- **Pipelines:** "Ver etapas" no estaba en la columna "Acciones" sino en su propia columna "Etapas", visible para todo rol. Se dejó ahí, afuera del menú: moverla al menú cambiaría la estructura de la tabla para USER (que quedaría con un menú de un solo ítem, justo lo que este ítem descarta). El menú de Pipelines tiene entonces Editar + Eliminar, solo para admin.
- **Etapas:** la columna tenía cuatro controles, no dos: Editar, Eliminar, **Subir y Bajar**. Subir/Bajar quedan **afuera** del menú, como botones a la vista dentro de `.ds-row-actions` y con el menú de 3 puntos al final: reordenar suele ser varios clicks seguidos (abrir el menú cada vez lo haría tedioso) y su `disabled` —primera/última etapa— se ve de un vistazo. Es el único listado donde el menú convive con controles sueltos.
- **QR:** la fila tiene **cinco** acciones, no cuatro: Ver imagen, **Enviar**, Copiar link, Editar, Eliminar (las dos últimas solo admin; USER ve un menú de tres). Los íconos de `lucide-react` que ya tenía cada botón se conservan delante de cada ítem.
- **Usuarios:** "Desactivar" se marca como destructiva (le saca el acceso a alguien); "Activar" no. Antes las dos variantes eran un botón secundario; es el único ítem que gana la marca roja sin haberla tenido, y sale de la definición del propio ítem ("Eliminar/Revocar/Desactivar según el caso").

**Decisiones tomadas al implementar (`frontend/src/design-system/ActionsMenu.tsx`):**

- **API del componente:** `actions: ActionsMenuAction[]` con `label`, y una de `to` (navegación: se renderiza como `Link` de react-router con `href` real, así abrir en pestaña nueva y middle-click siguen funcionando igual que con el `<Link>Editar</Link>` que reemplaza) u `onClick` (imperativa); flags opcionales `destructive`, `disabled` (solo para `onClick`; Usuarios lo usa mientras una mutación está pendiente), `icon` (QR) y `keepOpen`. Prop `label` para el nombre accesible del trigger ("Más acciones" por defecto; Usuarios pasa "Más acciones de {nombre}"). Es la primera dependencia del design system sobre el router; se aceptó porque la alternativa —`onClick` + `navigate()`— degrada cada "Editar" a un botón sin URL.
- **`keepOpen` existe por "Copiar link" de QR:** su confirmación es el propio ítem pasando a decir "¡Copiado!" (el estado `copiadoId` de siempre); con el cierre por defecto la confirmación desaparecería junto con el menú. Es la única acción de las 10 pantallas que lo usa.
- **Ícono `MoreVertical`** (3 puntos verticales) de `lucide-react`, 16px, mismo `strokeWidth` 1.5 que el resto de los íconos del sistema.
- **Posición `fixed`, no `absolute`:** `Table.tsx` envuelve la tabla en `.ds-table-wrap` con `overflow-x: auto`, y un overflow no visible en un eje vuelve `auto` al otro: un menú absoluto colgando de la última fila quedaría recortado por el borde de la tarjeta. Un elemento `fixed` no lo recorta ningún overflow de sus ancestros (solo un `transform`, y el design system no usa ninguno). Se ubica desde el rectángulo del trigger al abrirse (alineado a su borde derecho; hacia arriba si no entra debajo) y se cierra al primer scroll o resize, como un `<select>` nativo. Verificado con un harness estático y el CSS real: el menú de la última fila se dibuja completo por fuera de la tarjeta.
- **Cierre:** click afuera (`pointerdown` en `document`, mismo mecanismo que `MultiSelect`), Escape (devuelve el foco al trigger), y al elegir una acción (salvo `keepOpen`). Al elegir, el menú se cierra **antes** de correr la acción: si la acción abre un `Modal`, ese se lleva el foco al montarse y no hay que pisárselo después; si abre un `window.confirm`, el foco ya está en el trigger cuando vuelve.
- **Teclado (patrón "menu button" de WAI-ARIA):** trigger con `aria-haspopup="menu"`, `aria-expanded` y `aria-controls`; menú `role="menu"` rotulado por el trigger; ítems `role="menuitem"` con `tabIndex={-1}`, foco con ArrowUp/ArrowDown (con vuelta), Home/End; ArrowDown/ArrowUp desde el trigger abren dejando el foco en el primer/último ítem; Tab cierra y sigue la tabulación desde el trigger. Con el menú cerrado los ítems no están en el DOM (como en `MultiSelect`).
- **CSS (`design-system.css`, bloque "ActionsMenu" después de `.ds-row-actions`):** trigger de 32px con las medidas del "×" de `Modal` (sin borde ni fondo hasta el hover; abierto se queda "presionado"), lista con el mismo fondo/borde/radio/sombra que la lista abierta de `MultiSelect`, ítems a ancho completo con foco marcado por fondo (`--color-surface-muted`) y la destructiva en `--color-danger` con hover `--color-danger-soft`, el mismo par de tokens que `.ds-button--danger` dentro de `.ds-row-actions`. `.ds-row-actions` sigue existiendo: lo usan las pantallas de una sola acción y Subir/Bajar de Etapas.

**Tests:** `ActionsMenu.test.tsx` (14 tests: cerrado por defecto y atributos ARIA, `label`, apertura por click con foco en el primer ítem, `to` como link con `href` real vs. `onClick` como botón, cierre por segundo click / click afuera / Escape / selección, `keepOpen`, marca `--danger` solo en la destructiva, `disabled`, navegación por teclado, Tab, `tabIndex -1`). Helper nuevo `frontend/src/test/openActionsMenu.ts` (`openActionsMenu(user, row?)`: abre el menú de la única fila o de la fila dada, esperando a que exista), extraído porque nueve `*ListPage.test.tsx` necesitaban lo mismo, con el mismo criterio que `cellByHeader.ts`. En esos nueve archivos, cada test que clickeaba "Editar"/"Eliminar"/etc. abre primero el menú; los que buscaban `getByRole("link"|"button", { name })` pasan a `menuitem`; en Fuentes, los tests de cross-links con tres filas recorren fila por fila (un menú abierto cierra al anterior); en Etapas, "Subir" se ubica por nombre accesible dentro de la fila en vez de `button:nth-of-type(2)`; en QR, "¡Copiado!" se afirma como `menuitem` con el menú aún abierto; en Usuarios, la fila propia afirma también que no hay trigger. `OpportunityListPage.test.tsx` no tenía test de ADMIN sobre las acciones de fila y ganó uno. Los tests de "USER no ve Editar/Eliminar" siguen válidos sin cambios. `ApiKeyListPage`, `InvitationListPage` e `IngestionEventListPage` (código y tests) no se tocaron.



---

## 9. Traducir las etapas del ciclo de vida de Contacto (Etapa)

**Estado:** hecho

**Dónde se vio:** formulario "Nuevo contacto" / "Editar contacto" (`/contacts/new`, `/contacts/:id/edit`), campo "Etapa"; y en `/contacts`, el filtro "Etapa" de la fila de filtros y la columna "Etapa" de la tabla.

**Contexto:** el campo "Etapa" de Contacto (`lifecycleStage`) mostraba en el select del formulario, en el filtro y en el badge de la columna del listado los valores crudos del enum, en inglés/siglas de marketing: `LEAD`, `MQL`, `SQL`, `CUSTOMER`, `CHURNED` — sin ninguna explicación. Ni Rocco mismo sabía qué significaban al verlos en el formulario "Nuevo contacto". Son las etapas clásicas de un embudo de marketing/ventas:

- `LEAD`: contacto sin calificar todavía.
- `MQL` ("Marketing Qualified Lead"): lo calificó marketing.
- `SQL` ("Sales Qualified Lead"): lo calificó/confirmó ventas como oportunidad real.
- `CUSTOMER`: ya es cliente.
- `CHURNED`: fue cliente y se perdió.

Este campo es **exclusivo de Contact**: verificado que `LifecycleStage` (`frontend/src/features/contact/types.ts`, línea 5) no se usa en ningún otro feature de la app. Oportunidad tiene su propio concepto de "Stage" (`Stage`, ligado a `Pipeline`), que es algo completamente distinto y no se toca acá.

**Traducciones:**

| Valor interno (sin cambios: sigue siendo esto en la API y en la base) | Texto nuevo en la UI |
|---|---|
| `LEAD` | Nuevo |
| `MQL` | Calificado (Marketing) |
| `SQL` | Calificado (Ventas) |
| `CUSTOMER` | Cliente |
| `CHURNED` | Perdido |

**Decisiones ya tomadas:**

- **No cambia el valor interno del enum.** Lo que se manda a la API y se guarda en la base sigue siendo `LEAD`/`MQL`/etc.; solo cambia el texto que ve la persona. El `value` de cada `<option>` sigue siendo el valor interno.
- **No cambian los colores de los badges.** `LIFECYCLE_BADGE_VARIANT` en `ContactListPage.tsx` (LEAD/MQL neutral, SQL info, CUSTOMER success, CHURNED danger) se mantiene tal cual; solo cambia el texto que va adentro del badge.
- **Un único mapeo, definido una sola vez.** Se creó `frontend/src/features/contact/labels.ts` con `LIFECYCLE_STAGE_LABELS: Record<LifecycleStage, string>`, siguiendo el mismo patrón que ya existe en `features/opportunity/labels.ts` (`LEAD_SOURCE_LABELS`, `FINANCING_TYPE_LABELS`) y `features/vehicle/labels.ts` — el archivo `labels.ts` por feature es el precedente más cercano, por eso se eligió ese lugar y ese nombre (plural, como los demás mapas) en vez de `ETIQUETA_DE_TIPO` de `SourceListPage.tsx` o de meterlo en `types.ts`. `Record<Enum, string>` hace que un valor nuevo del enum sin rótulo no compile. El mismo archivo exporta `LIFECYCLE_STAGES` (las claves del mapa, en el orden del embudo), que reemplaza al array literal que `ContactListPage.tsx` tenía para el filtro: agregar un valor al mapa es agregar la opción en el form y en el filtro a la vez.

**Dónde se aplica (3 lugares, mismo mapeo importado, sin duplicar):**

| Archivo | Lugar | Antes | Después |
|---|---|---|---|
| `frontend/src/features/contact/ContactFormPage.tsx` | select "Etapa" (~línea 220) | cinco `<option value="LEAD">LEAD</option>` literales | `LIFECYCLE_STAGES.map(...)` con `value={stage}` y texto `LIFECYCLE_STAGE_LABELS[stage]` |
| `frontend/src/features/contact/ContactListPage.tsx` | filtro "Etapa" (~línea 131) | `{stage}` crudo como texto de la opción | `LIFECYCLE_STAGE_LABELS[stage]`, `value={stage}` sin cambios |
| `frontend/src/features/contact/ContactListPage.tsx` | Badge de la columna "Etapa" (~línea 259) | `{contact.lifecycleStage}` crudo | `LIFECYCLE_STAGE_LABELS[contact.lifecycleStage]` |

**Tests:** los tests existentes de `ContactListPage.test.tsx`, `ContactFormPage.test.tsx` y `api.test.ts` referencian `LEAD`/`MQL`/`CUSTOMER` únicamente como valor de datos (mocks, payloads esperados, query params, `selectOptions` por `value`), no como texto visible en pantalla — siguen siendo correctos tal cual y no se tocaron. Se agregaron dos tests nuevos que fijan el contrato de este ítem: en el listado, que la columna y el filtro muestran el rótulo traducido y que elegir "Calificado (Ventas)" manda `lifecycleStage=SQL`; en el formulario, que las opciones son `[value interno, rótulo]` en el orden del embudo y que elegir "Cliente" manda `lifecycleStage: "CUSTOMER"` en el payload.


---

## 10. Marcar correctamente los campos obligatorios (asterisco) y agregar una referencia genérica al pie de cada formulario

**Estado:** hecho

**Dónde se vio:** en todos los formularios de la app. El pedido original era marcar los campos **opcionales**, pero se decidió dar vuelta el enfoque: los opcionales son la mayoría de los campos de la app, y anotarlos uno por uno hubiera sido ruido en todos lados. La solución es asegurarse de que **todo** campo realmente obligatorio tenga su asterisco visual, y agregar una frase genérica al pie de cada formulario explicando qué significa el asterisco.

**Contexto:** el mecanismo del asterisco ya existe en el design system: el label se envuelve en `<span className="ds-required">Label</span>` y el CSS (`frontend/src/design-system/design-system.css`, ~línea 249-250) le agrega `" *"` con un `::after`. El problema es que hoy no todo campo obligatorio lo usa: hay campos que el HTML, una función de validación o el backend exigen, pero que en pantalla se ven como cualquier campo opcional. Es una señal visual que no coincide con el comportamiento real.

**Fuera de alcance, decisión explícita de Rocco:** no se toca ningún campo opcional — ni placeholder, ni "(opcional)" en el label, nada.

**Parte A — frase genérica al pie de cada formulario.** Agregar, **una sola vez por formulario** (no repetida por cada `Card` individual dentro de un mismo formulario), cerca del botón "Guardar", un texto tipo:

> Los campos con asterisco (*) son obligatorios.

Aplica a estos formularios (todos tienen al menos un campo obligatorio): `ActivityFormPage.tsx`, `CompanyFormPage.tsx`, `ContactFormPage.tsx`, `OpportunityFormPage.tsx`, `InvitationFormPage.tsx`, `PipelineFormPage.tsx`, `QrFormDialog.tsx`, `SourceFormPage.tsx`, `StageFormPage.tsx`, `VehicleFormPage.tsx`, y el formulario inline de creación de clave dentro de `ApiKeyListPage.tsx`. No existe un componente para esto todavía: se crea uno chico y compartido en el design system (`frontend/src/design-system/RequiredFieldsHint.tsx`) en vez de repetir el texto suelto en cada archivo, siguiendo el estilo visual de otros textos auxiliares ya existentes en el sistema de diseño (texto chico, color muted).

**Parte B — bug real a corregir: campos que SON obligatorios pero hoy no muestran ningún asterisco.** Lista completa, verificada contra el código:

| Archivo | Campo | Por qué hoy no se ve obligatorio |
|---|---|---|
| `frontend/src/features/source/SourceFormPage.tsx` | Nombre | Tiene `required` en el HTML (el `<input>` real ya lo exige), pero el label (`<FormField label="Nombre">`, ~línea 165) **no** está envuelto en `ds-required` — es un typo/omisión directa. Envolverlo: `<FormField label={<span className="ds-required">Nombre</span>}>`. |
| `frontend/src/features/stage/StageFormPage.tsx` | Nombre | Mismo caso exacto que Fuentes: `required` en el HTML (~línea 135), falta `ds-required` en el label (~línea 130). |
| `frontend/src/features/qr/QrFormDialog.tsx` | Sucursal | Se exige solo vía la función `validar()` (~línea 80), sin atributo `required` nativo ni asterisco en el label (~línea 151). |
| `frontend/src/features/qr/QrFormDialog.tsx` | Nombre | Mismo caso: exigido solo por `validar()`, sin `required` ni asterisco en el label (~línea 156). |
| `frontend/src/features/qr/QrFormDialog.tsx` | Enlace de destino | Mismo caso: exigido solo por `validar()`, sin `required` ni asterisco en el label (~línea 165). |
| `frontend/src/features/vehicle/VehicleFormPage.tsx` | Sucursal (dentro de la Card "Sucursal y asignación", ~línea 685) | Se exige solo vía JS en `handleSubmit` (~línea 462), sin `required` nativo ni asterisco. |
| `frontend/src/features/apiKey/ApiKeyListPage.tsx` | "Fuente para la clave nueva" (~línea 143) | El botón "Crear clave" queda `disabled` sin elegir fuente (~línea 159, `!sourceIdNueva`), pero el campo no tiene ninguna marca visual de obligatorio. Es un `<label>` nativo suelto, no `FormField`/`ds-required` — se aplica el mismo tratamiento visual aunque el marcado HTML sea distinto al resto. |
| `frontend/src/features/opportunity/OpportunityFormPage.tsx` | Pipeline (`PipelineSelect`, ~línea 346) | El backend lo exige para crear una oportunidad, pero no hay ningún control del lado del cliente (ni `required` ni chequeo en el submit ni asterisco) — hoy se puede intentar guardar sin pipeline y el error sale recién de la respuesta del backend. |
| `frontend/src/features/opportunity/OpportunityFormPage.tsx` | Etapa (`StageSelect`, ~línea 352) | Mismo caso que Pipeline: lo exige el backend, cero validación ni indicación del lado del cliente. |

**Importante para estos últimos:** no alcanza con poner el asterisco — hay que agregar también la validación real del lado del cliente donde hoy no existe (Pipeline/Etapa en Oportunidades, Sucursal en QR/Vehículos) o donde hoy vive en un chequeo JS separado en vez de bloquear el submit de forma confiable (`QrFormDialog` ya tiene `validar()`, que sí bloquea — revisarlo para confirmar que efectivamente corre antes de cualquier guardado real; si ya bloquea, el trabajo ahí es solo visual). El asterisco tiene que corresponder a un campo que de verdad impida guardar si falta — si no, se repite el mismo problema de fondo (una señal visual que no coincide con el comportamiento real). Los componentes compartidos `PipelineSelect` y `StageSelect` (usados por Oportunidades) probablemente no acepten hoy una prop `required` — agregarla si hace falta, o resolverlo con una validación en el `handleSubmit` de `OpportunityFormPage.tsx`; a criterio de quien implementa, siempre que el resultado final sea: asterisco visible **y** el submit realmente bloqueado sin el campo.

**Formularios que ya tienen su(s) campo(s) obligatorio(s) correctamente marcados hoy** (columna referencial, no hace falta tocarlos, solo agregarles la Parte A): `ActivityFormPage.tsx` (Asunto), `CompanyFormPage.tsx` (Nombre), `ContactFormPage.tsx` (Nombre, Apellido), `InvitationFormPage.tsx` (Email), `PipelineFormPage.tsx` (Nombre), `VehicleFormPage.tsx` (Año, Marca, Modelo — además de Sucursal, que sí está en la tabla de arriba).

**Decisiones ya tomadas:**

- **Se marcan los obligatorios, no los opcionales.** Decisión explícita de Rocco, no reabrir: ningún campo opcional cambia (ni label, ni placeholder, ni texto auxiliar).
- **Una sola frase por formulario, junto al botón "Guardar",** compartida vía un componente del design system, no texto suelto repetido.
- **El asterisco tiene que ser veraz.** Todo campo que gana asterisco tiene que bloquear el submit del lado del cliente si falta: la mutación no se dispara.
- **Este ítem es aditivo, no una reescritura.** Ningún comportamiento de los campos que ya funcionan bien hoy (los de la lista "ya correctamente marcados") cambia.

**Hallazgos al implementar (la tabla de arriba, verificada contra el código):** los nueve campos y sus líneas eran exactos; no apareció ningún obligatorio sin marcar fuera de la lista. `validar()` de `QrFormDialog` corre al principio de `handleSubmit` y devuelve antes de cualquier `mutateAsync`, así que en QR el trabajo fue solo visual. El chequeo de Sucursal de `VehicleFormPage` (`handleSubmit`) ya bloqueaba; se conservó como red para el hueco descrito abajo.

**Decisiones tomadas al implementar:**

- **`RequiredFieldsHint` (`frontend/src/design-system/RequiredFieldsHint.tsx`):** un `<p className="ds-hint">` con la frase fija, sin props (la frase es única). Reusa `.ds-hint` tal cual —mismo trato que los otros textos auxiliares y el precedente exacto del hint que `OpportunityFormPage` ya tenía en ese mismo lugar—, sin CSS nuevo. Va dentro del `<div>` del pie, inmediatamente antes del `Button` de guardar, en los nueve formularios de página; en `QrFormDialog` va al final del cuerpo del `<form>` (el botón vive en el pie del `Modal`, fuera del form, y eso es lo más cerca posible); en `ApiKeyListPage` va debajo de la fila `.ds-filters` que contiene el select y el botón "Crear clave".
- **Prop `required` en `PipelineSelect`, `StageSelect` y `BranchSelect`** (default `false`, sin cambio para los callers que no lo pasan, incluidos los filtros de listado de QR y Stock que usan `BranchSelect`). Un solo prop hace las dos cosas a la vez: envuelve el rótulo en `.ds-required` **y** pone `required` en el `<select>`. Se eligió esto y no ampliar `label` a `ReactNode` justamente para que el asterisco no pueda existir sin su bloqueo. `StageSelect` lo aplica en sus dos variantes (el placeholder deshabilitado de "sin pipeline" y la lista real).
- **Oportunidades: `required` nativo + chequeo en `handleSubmit`, los dos.** El `required` del `<select>` frena el click en Guardar en el navegador (y en jsdom, verificado), pero tiene huecos: el `<select>` solo existe cuando su lista cargó, y el de Etapa está deshabilitado sin pipeline (un control `disabled` no participa de la validación nativa). Por eso `handleSubmit` chequea `pipelineId` y `stageId` antes del `try` y corta con "Elegí un pipeline antes de guardar." / "Elegí una etapa antes de guardar." (mismo estilo que el de Sucursal en Vehículos), sin disparar la mutación. Aplica en creación y edición (un registro existente siempre los tiene). Se reescribieron el comentario de `toCreateInput` ("no se duplica esa validación acá") y el del restyle ("el * va SOLO en Título"), que dejaron de ser ciertos.
- **Vehículos:** `BranchSelect` con `required`; el chequeo de `handleSubmit` queda como red para el mismo hueco (lista de sucursales cargando). Efecto visible: sin sucursal, el click en Guardar ahora lo frena el globo nativo del navegador sobre el select (como ya pasaba con Año/Marca/Modelo) en vez del `ErrorState` propio, que sigue apareciendo si el submit igual llega.
- **QR:** `BranchSelect` con `required`, `.ds-required` en Nombre y Enlace de destino, y atributo `required` en esos dos inputs. Como el `<form>` es `noValidate` a propósito (mensajes propios en vez de globos del navegador), esos `required` son semántica (aria) que refleja el bloqueo de `validar()`, no lo que lo produce; el comentario de cabecera del archivo lo dice.
- **Claves:** `<span className="ds-required">` dentro del `<label>` nativo y `required` en el `<select>`; lo que bloquea sigue siendo el `disabled` del botón (no hay `<form>`).
- **Por arrastre, `ClaimPage.tsx`:** tenía un comentario que difería el asterisco de Sucursal "para cuando BranchSelect tenga su pasada" (solo aceptaba `label: string`). Esa pasada es esta: se le pasó `required` y se corrigió el comentario. Es un cambio de una línea fuera de la lista de los 10 formularios; el hint genérico no se agregó ahí ni en `NewOrganizationPage`, que quedan fuera de este ítem.

**Tests:** `RequiredFieldsHint.test.tsx` (frase + clase). `PipelineSelect.test.tsx`, `StageSelect.test.tsx` (placeholder deshabilitado y lista real) y `BranchSelect.test.tsx`: con `required` el rótulo lleva `.ds-required` y el `<select>` es `required`; sin el prop, ninguna de las dos marcas. Los nueve `*FormPage.test.tsx` más `QrFormDialog.test.tsx` y `ApiKeyListPage.test.tsx` afirman que sus obligatorios están marcados (`toBeRequired` + clase) y que la frase aparece **una sola vez**. `OpportunityFormPage.test.tsx`: el test "falta Company y Contact" ahora elige Pipeline y Etapa antes de guardar (si no, lo frena el cliente y el mensaje del backend nunca llega); test nuevo de submit bloqueado sin Pipeline/Etapa que cubre las dos capas: el click en Guardar no dispara nada (required nativo), y `fireEvent.submit` —que saltea la validación nativa, como el hueco de lista cargando— muestra los mensajes propios; en ningún caso hay POST. `VehicleFormPage.test.tsx`: "create sin sucursal" se reescribió con la misma estructura de dos capas. Ningún `getByLabelText` cambió: el "*" lo dibuja CSS y no entra en el nombre accesible. Los tests de Company/Contact/Activity/Invitation/Pipeline/Source/Stage no necesitaron cambios en los existentes.


---

## 11. Editor de etapas integrado en el formulario de Pipeline

**Estado:** hecho

**Dónde se vio:** `/pipelines/:id/edit` (Editar pipeline) y `/pipelines/new` (Nuevo pipeline).

**Contexto:** hoy `PipelineFormPage.tsx` (`/pipelines/:id/edit`) solo tiene los campos "Nombre" y "Default" — no hay forma de configurar las etapas (el flujo de venta real) desde ahí. Eso vive hoy en una pantalla completamente separada (`StageListPage.tsx` / `StageFormPage.tsx`, rutas `/pipelines/:id/stages` y sus hijas, con un link "Ver etapas" desde `PipelineListPage.tsx`), y un pipeline recién creado arranca con **cero** etapas (`createPipeline` en `src/services/pipeline.service.ts` no crea ninguna por defecto). Decisión explícita: se quiere el editor de etapas **integrado en el mismo formulario de Pipeline**, sin cambiar de pantalla, en vez de solo agregar un link.

**Diseño confirmado:**

- **Mecánica de guardado:** cada etapa se guarda al toque, reutilizando tal cual los hooks que ya existen — `useCreateStage(pipelineId)`, `useUpdateStage(pipelineId)`, `useDeleteStage(pipelineId)` de `frontend/src/features/stage/mutations.ts` — con toda su lógica de backend sin tocar (nombre único dentro del pipeline, como máximo una etapa `isWon` y una `isLost` por pipeline —regla retirada después en §13—, no se puede borrar una etapa con oportunidades activas, locking y reindexado en `src/services/stage.service.ts`). El botón "Guardar" grande del formulario de Pipeline sigue existiendo pero queda acotado a los campos propios del Pipeline (Nombre, Default) — **no** intenta guardar etapas; cada etapa maneja su propio guardado/error de forma independiente dentro de su fila. No hace falta ningún endpoint nuevo de backend — es trabajo de frontend, orquestando llamadas que ya existen.
- **Reordenar etapas:** se mantienen los botones "Subir"/"Bajar" (mismo mecanismo que ya usa `StageListPage.tsx` hoy, vía `handleMove` + `useUpdateStage`). No se agrega drag-and-drop.

**Comportamiento del editor integrado:**

- **Modo edición (pipeline ya existe, tiene id):** debajo de la Card "Datos del pipeline" de `PipelineFormPage.tsx`, una nueva sección "Etapas" que muestra la lista de etapas del pipeline (nombre, probabilidad, badge si es ganada/perdida — mismo criterio visual que ya usa `StageListPage.tsx`: `formatProbability`, `probabilityWidth`, `Badge variant="success"/"danger"`), con Subir/Bajar/Editar/Eliminar por fila (mismo patrón que `StageListPage.tsx` ya tiene después del ítem 8: Subir/Bajar como botones sueltos en `.ds-row-actions`, Editar/Eliminar agrupados en un `ActionsMenu` con `destructive: true` en Eliminar), y una fila/formulario "Nueva etapa" que agrega una etapa (Nombre, Probabilidad, Ganada, Perdida — mismos campos que `StageFormPage.tsx` hoy, **sin** el campo Orden explícito: el orden lo determina la posición en la lista + Subir/Bajar, igual que ya es opcional al crear vía API). Cada fila se guarda llamando al hook correspondiente apenas se confirma esa fila — no hace falta un "Guardar" aparte para las etapas.
- **Modo creación (pipeline nuevo, todavía sin id):** la sección "Etapas" aparece deshabilitada/oculta con un aviso tipo "Guardá el pipeline para poder agregar sus etapas" — no se puede crear un Stage sin un `pipelineId` real. Al guardar el pipeline por primera vez, la página pasa a modo edición **en el mismo lugar** (sin navegar a `/pipelines`, a diferencia de como se comporta hoy — ver excepción documentada abajo) y la sección de etapas se habilita ahí mismo.

**Qué pasa con la pantalla separada actual** (`StageListPage.tsx` / `StageFormPage.tsx`, rutas `/pipelines/:id/stages` y sus hijas) — **CONFIRMADO:** se deja de respaldo, tal cual está hoy, sin tocar. El link "Ver etapas" en `PipelineListPage.tsx` (línea ~138) tampoco se saca. El editor integrado es un agregado, no un reemplazo — las dos formas de gestionar etapas coexisten.

**Excepción de navegación — CONFIRMADO y a documentar bien en el código:** al guardar un pipeline **nuevo** por primera vez, `handleSubmit` de `PipelineFormPage.tsx` (línea ~77, hoy hace `navigate("/pipelines")` siempre) deja de navegar a la lista en el caso de creación — se queda en la misma página, ahora en modo edición con la sección Etapas habilitada. En modo edición (pipeline ya existente) el comportamiento actual de `navigate("/pipelines")` tras guardar **sí** se mantiene sin cambios. Esto es una excepción puntual al patrón general "crear → navegar a la lista" que usa el resto de la app (Company, Contact, etc.) — dejar un comentario explícito en el código explicando por qué Pipeline es distinto acá, para que no se "corrija" por accidente en una limpieza futura buscando consistencia con los demás formularios.

**Archivos involucrados** (para referencia; confirmar los detalles leyendo el código actual antes de tocar nada):

| Archivo | Qué pasa ahí |
|---|---|
| `frontend/src/features/pipeline/PipelineFormPage.tsx` | Se agrega la sección Etapas debajo de la Card actual, y se ajusta `handleSubmit` para la excepción de navegación en creación. |
| `frontend/src/features/stage/StageListPage.tsx` | Lógica de listado/reorden/borrado a reutilizar/adaptar (`useStages`, `useDeleteStage`, `useUpdateStage`, `handleMove`, `handleDelete`, `formatProbability`, `probabilityWidth`, uso de `ActionsMenu`). |
| `frontend/src/features/stage/StageFormPage.tsx` | Campos del formulario individual de etapa (Nombre, Probabilidad, Ganada, Perdida) a adaptar como fila/mini-formulario embebido para "Nueva etapa" y para editar una etapa existente inline. |
| `frontend/src/features/stage/mutations.ts` | `useCreateStage` / `useUpdateStage` / `useDeleteStage`, ya aceptan `pipelineId` fijo en el hook e id/input en cada llamada; se reutilizan tal cual. |
| `frontend/src/features/stage/types.ts` | `CreateStageInput` / `UpdateStageInput` / `Stage`, sin cambios esperados. |
| `frontend/src/features/pipeline/PipelineListPage.tsx` (línea ~138) | El link "Ver etapas" se deja sin tocar. |
| `src/services/stage.service.ts` / `src/services/pipeline.service.ts` | Sin cambios funcionales esperados, toda la lógica de backend se reutiliza tal cual desde el frontend. |

**Decisiones ya tomadas:**

- **Editor integrado, no un link.** Decisión explícita de Rocco — no reabrir.
- **Guardado por fila, al toque,** con los hooks existentes; el "Guardar" del Pipeline no toca etapas.
- **Subir/Bajar, sin drag-and-drop.**
- **`StageListPage` / `StageFormPage` y sus rutas quedan de respaldo,** sin cambios funcionales; el link "Ver etapas" también queda.
- **Excepción de navegación solo en creación:** guardar un pipeline nuevo se queda en la página (modo edición); guardar uno existente sigue navegando a la lista.
- **A criterio de quien implementa:** si "Editar" de una etapa abre una fila editable inline (recomendado: evita duplicar UI de edición/creación) o reutiliza un sub-componente compartido entre "Nueva etapa" y la edición de una fila existente — documentando la decisión en un comentario.

**Hallazgos al implementar (la tabla de arriba, verificada contra el código):** las referencias de línea eran exactas (`navigate("/pipelines")` en la línea 77 de `PipelineFormPage.tsx`, "Ver etapas" en la 138 de `PipelineListPage.tsx`). Dos cosas que la tabla no anticipaba: (1) `PipelineFormPage` era un único `<form>` que envolvía toda la página, y cada fila del editor necesita ser su propio `<form>` (Enter guarda, `required` frena el submit) — un form adentro de otro es HTML inválido, así que el esqueleto pasó a ser `div.ds-form > [form del pipeline, editor]`; (2) las rutas de escritura de Pipeline están bajo `AdminRoute` (`app/router.tsx`), así que el editor no necesita chequear rol como hace `StageListPage`. Un hallazgo colateral, **no corregido** porque `StageFormPage.tsx` queda sin tocar: su input "Probabilidad (%)" es `type="number"` sin `step`, y el step por defecto (1) hace que la validación nativa del navegador frene el submit al editar una etapa con probabilidad decimal (por ejemplo 37.5, que el listado sí muestra). En el editor integrado se resolvió con `step="any"`; en `StageFormPage` queda como pendiente menor para otro ítem.

**Decisiones tomadas al implementar:**

- **Componente nuevo `frontend/src/features/stage/StageEditor.tsx`,** montado por `PipelineFormPage` debajo del formulario, solo en modo edición (`<StageEditor pipelineId={id} />`). En creación va una `Card` "Etapas" con el aviso "Guardá el pipeline para poder agregar sus etapas." Vive en `features/stage/` (es lógica de etapas: sus hooks, sus tipos) y no en `features/pipeline/`.
- **"Editar" es una fila editable inline, y "Nueva etapa" es el mismo mini-formulario.** Un único sub-componente privado, `StageRowForm` (Nombre de la etapa, Probabilidad (%), Ganada, Perdida, botón de submit y "Cancelar" opcional), sirve para los dos modos: al pie de la lista como "Nueva etapa" (botón "Agregar etapa"; tras guardar se vacía y deja el foco en el nombre para cargar la siguiente sin volver a clickear) y en reemplazo de la fila de lectura cuando se elige "Editar" (botón "Guardar etapa" + "Cancelar"; Escape también cancela; el foco va al nombre al abrirse). La única diferencia entre modos es qué mutation corre y si el formulario se vacía al terminar. Una sola fila en edición a la vez. Se descartó un `Modal` para editar: el panel lateral tapa la lista que se está ordenando, y §11 pide "sin cambiar de pantalla".
- **El rótulo es "Nombre de la etapa", no "Nombre":** en la misma página está el "Nombre" del pipeline, y dos campos con el mismo nombre accesible son ambiguos para un lector de pantalla (y para `getByLabelText` en los tests existentes).
- **Cada fila muestra su propio error.** El mensaje del backend (409 por nombre duplicado, segunda etapa ganada, etc.) aparece como `ErrorState` dentro del mini-formulario que lo causó, sin toast y sin vaciar los campos. Los errores de Eliminar y Subir/Bajar (que no tienen fila editable) van a nivel de la lista, como en `StageListPage`. Para que no se mezclen, Subir/Bajar usan una **segunda instancia** de `useUpdateStage(pipelineId)` distinta de la que usa la edición inline.
- **Sin campo Orden; sin paginación.** `toCreateInput` no manda `order` (el backend agrega al final) y `toUpdateInput` tampoco (editar no mueve). Se piden hasta 100 etapas (el máximo de `listQuerySchema`) ordenadas por `order`; si `totalPages > 1` se muestra un `.ds-hint` con link a `/pipelines/:id/stages` para no truncar en silencio (el problema que R1.10 arregló en `StageListPage`), y "Bajar" del último de la página no se deshabilita (no es el último real).
- **Helper compartido `frontend/src/features/stage/probability.ts`:** `formatProbability` y `probabilityWidth` salieron de `StageListPage.tsx` sin cambios y ahora las importan las dos pantallas. Es el único cambio en `StageListPage.tsx` (comportamiento idéntico, tests sin tocar). `StageFormPage.tsx` y las rutas no se tocaron.
- **Excepción de navegación en creación, en `handleSubmit`:** al crear, `navigate(\`/pipelines/${created.id}/edit\`, { replace: true })` en vez de `navigate("/pipelines")`. `replace` para que "Atrás" no vuelva al formulario vacío de "Nuevo pipeline" sino a donde estaba la persona (la lista). Además la respuesta del POST se siembra en la caché (`queryClient.setQueryData(pipelineKeys.detail(id), created)`) para que el modo edición arranque con los datos cargados, sin pasar por `LoadingState` ni un GET redundante mientras sean frescos. En edición, guardar sigue navegando a `/pipelines`. El comentario en el código explica por qué Pipeline es distinto y pide no "corregirlo" por consistencia.
- **Toasts del editor (§12):** "Etapa guardada" al crear o editar, "Etapa eliminada" al borrar. Subir/Bajar **no** muestran toast: la fila cambia de lugar a la vista y reordenar suele ser varios clicks seguidos.
- **CSS (`design-system.css`, bloque "Editor de etapas integrado"):** ajustes sobre piezas existentes, no un componente nuevo: la `Table` adentro de la `Card` sin sombra ni margen (`.ds-stage-editor .ds-table-wrap`), los `FormField` de siempre en una fila alineada por la base (`.ds-stage-editor-fields`, Nombre crece, Probabilidad 120px, las casillas con el alto de un control para quedar a la altura de los inputs), y el subtítulo "Nueva etapa" con el trato de un rótulo de campo. Verificado con el harness estático y el CSS real.

**Tests (`PipelineFormPage.test.tsx`):** P19 se reescribió (crear se queda en modo edición con Etapas habilitadas, sin navegar, con el toast y con GET /stages del id nuevo); P20 afirma además que el toast sobrevive a la navegación; P22 afirma que un 409 no habilita Etapas. Bloque nuevo "editor de etapas integrado" (12 tests): listado ordenado con probabilidad/badge y un solo "Guardar" en la página; empty state; Agregar etapa (POST con `pipelineId` sin `order`, fila nueva, toast, formulario vacío con foco en el nombre); Ganada/Perdida se desmarcan mutuamente; error 409 en la propia fila sin toast; Editar inline con valores hidratados, PATCH sin `order`, vuelta a lectura y toast; Cancelar y Escape sin PATCH; Eliminar con confirm + DELETE + toast; confirm cancelado; Subir/Bajar (PATCH con el order del vecino, reorden tras el refetch, sin toast, deshabilitados en los bordes); error al mover a nivel de lista; aviso y link con más de una página. Un servidor de etapas en memoria (`mockStagesServer`) responde el listado con el estado actual para que el refetch de cada mutation muestre el resultado real. `AdminRoute.test.tsx`: el wrapper de las rutas de Pipeline suma `ToastProvider` y el test de edición como ADMIN mockea GET /stages (la página ahora monta el editor).

---

## 12. Indicador de guardado exitoso (toast)

**Estado:** hecho

**Dónde se vio:** ligado directamente a la sección 11 — `/pipelines/new` y `/pipelines/:id/edit`.

**Contexto:** como guardar el Pipeline ya no navega a ningún lado en el caso de creación (se queda en la misma página) y cada etapa "se guarda al toque" sin ninguna navegación tampoco, no habría ninguna señal de que el guardado funcionó. Se pidió explícitamente una confirmación visual de guardado exitoso.

**Mecanismo confirmado:** un mensaje tipo "toast" — un cartelito chico que aparece, dice algo como "Guardado" o "Pipeline guardado con éxito", y se borra solo después de unos segundos. No existe ningún componente de este tipo en el sistema de diseño todavía (confirmado: no hay toast/snackbar/notification en `frontend/src/design-system/`) — hay que construirlo de cero. Ya existen los tokens de color `--color-success` / `--color-success-soft` en `design-system.css` (ya usados hoy por `Badge.tsx` para `variant="success"`), reutilizables para el estilo del toast.

**Alcance confirmado:** aplica a los **dos** guardados de la sección 11 — el del Pipeline (Nombre/Default) y el de cada etapa individual cuando se guarda al toque. Mismo mecanismo en los dos casos.

**A definir en la implementación:** nombre/ubicación del componente nuevo (sugerencia: `frontend/src/design-system/Toast.tsx`, siguiendo el patrón de otros componentes del design system como `Modal.tsx` / `ActionsMenu.tsx`, con su propio bloque en `design-system.css`); posición en pantalla y duración antes de desaparecer, a criterio de quien implementa, consistente con el resto del sistema de diseño. Construirlo genérico/reutilizable (no acoplado a Pipeline/Stage en su API), pero en este ítem se usa **únicamente** en Pipeline/Stage — no agregarlo a ningún otro formulario existente todavía.

**Decisiones ya tomadas:**

- **Toast, no navegación ni texto fijo en la página.** Es la confirmación pedida explícitamente.
- **Se usa solo en Pipeline/Stage en este ítem.** Genérico en su API, pero sin sumarlo a otros formularios todavía.
- **Depende de la sección 11 — se implementan juntas,** en el mismo PR/rama.

**Decisiones tomadas al implementar (`frontend/src/design-system/Toast.tsx` + `useToast.ts`):**

- **Dos piezas y un provider global.** `Toast` es el cartel (mensaje, ícono `CircleCheck` de `lucide-react`, botón "×" con `aria-label="Cerrar aviso"`); recibe `message`, `onDismiss` y `duration` opcional, y llama a `onDismiss` al vencerse el tiempo o al click en la "×". `ToastProvider` guarda el toast activo, expone `show(message)` por contexto y renderiza el cartel en una región fija. `useToast()` (en `useToast.ts`, archivo aparte para no chocar con `react-refresh/only-export-components`, como documenta `AuthContext`) devuelve solo `{ show }`: quien consume no necesita saber si hay un toast ni cerrarlo. Sin el provider, `useToast` **lanza** un error explícito en vez de fallar en silencio.
- **El provider va en `App.tsx`, por encima del router.** Es la razón de que sea global y no estado local de la página: guardar un pipeline existente navega a la lista, y un toast local a la página se perdería con ella (y también con cualquier remonte al pasar de `/pipelines/new` a `/pipelines/:id/edit`). Se descartó pasar el mensaje por `location.state`: un `replace` con state sobrevive al refresh del navegador y el toast reaparecería.
- **Uno a la vez.** Un `show()` nuevo reemplaza al visible y reinicia su tiempo; no se apilan (con cinco etapas seguidas sería una columna de carteles). Se implementa con `key={id}` y un contador: el mismo mensaje dos veces seguidas es un id nuevo, el cartel se remonta y el temporizador arranca de cero.
- **Duración: 4 segundos** (`TOAST_DURATION_MS`), lo que lleva leer dos o tres palabras con margen. **Posición: fijo abajo a la derecha** (`--space-5` de cada borde), `z-index` 200 por encima del overlay de `Modal` (100) para que una confirmación disparada desde un panel lateral también se vea. Única pieza del sistema con animación de entrada (opacidad + 8px hacia arriba, 160ms), apagada bajo `prefers-reduced-motion`.
- **Solo confirmaciones, sin `variant`.** Los errores siguen siendo `ErrorState` en su lugar (un error que se va solo a los cuatro segundos es peor que uno que se queda). Si aparece un consumidor que necesite otra variante, se agrega una prop como en `Badge`; no se anticipa.
- **Accesibilidad:** la región del provider es `role="status"` (aria-live polite implícito) y existe **siempre**, vacía o no: un lector de pantalla anuncia lo que se inserta en una región viva que ya estaba en el DOM, no una que se monta junto con su contenido. El temporizador no se pausa con hover (mejora posible, no necesidad de hoy).
- **CSS (`design-system.css`, bloque "Toast", después de ActionsMenu):** el cartel toma el par de tokens de `Badge variant="success"` (`--color-success-soft` de fondo, `--color-success` en borde, texto e ícono), el radio y la sombra de los desplegables (`--radius-md`, `--shadow-overlay`) y el alto de un control (40px). `pointer-events: none` en la región (ocupa su esquina aunque esté vacía) y `auto` en el cartel. La "×" tiene las medidas de la de `Modal` (32px).
- **Mensajes usados en este ítem:** "Pipeline guardado" (crear y editar el pipeline), "Etapa guardada" (crear y editar una etapa), "Etapa eliminada". Ningún otro formulario lo usa todavía.

**Tests:** `Toast.test.tsx` (11 tests, con timers falsos y `fireEvent`): mensaje y "×"; `onDismiss` exactamente al vencer la duración por defecto y no antes; duración propia; "×" inmediata; desmontar cancela el temporizador; región `role=status` siempre presente y vacía; `show()` muestra dentro de la región y se va solo; "×" cierra antes de tiempo; un `show()` nuevo reemplaza y reinicia el tiempo; el mismo mensaje dos veces también reinicia; `useToast` fuera del provider lanza. Los tests de `PipelineFormPage` afirman el toast en cada guardado exitoso (ver §11).

---

## 13. Etapas "Ganada"/"Perdida" dejan de ser únicas por pipeline, y Probabilidad pasa a ser un campo oculto por defecto

**Estado:** hecho

**Dónde se vio:** `/pipelines/:id/edit` (editor de etapas integrado, §11) y `/pipelines/:id/stages/new` / `/pipelines/:id/stages/:stageId/edit` (la pantalla de respaldo).

**Este ítem es distinto a los anteriores: toca el BACKEND** (una migración real de base de datos), no solo el frontend.

### Parte A — "Ganada" y "Perdida" dejan de ser exclusivas por pipeline

**Origen:** al usar el editor de etapas, marcar una segunda etapa como "Ganada" (o "Perdida") en el mismo pipeline fallaba con un 409 ("Ya existe una etapa marcada como ganada/perdida en este pipeline"). Se decidió que esto está mal planteado: "Ganada" no representa "la única etapa terminal de éxito del embudo" sino "esta etapa ya fue superada/pasada en el proceso" — es natural que varias etapas la tengan marcada a la vez a medida que una oportunidad avanza. Por el mismo criterio, "Perdida" también deja de ser exclusiva.

**Confirmado:** el texto de los checkboxes y de los badges se mantiene igual ("Ganada"/"Perdida" en el formulario, "Etapa de Ganada"/"Etapa de Perdida" en la tabla) — no se renombra nada, solo cambia la regla de cuántas etapas pueden tenerlo marcado.

**Esto es un cambio de backend, no alcanza con tocar el frontend:** hoy la exclusividad está garantizada por dos índices únicos **parciales** reales en la base de datos —

```sql
create unique index if not exists stages_pipeline_won_unique
  on public.stages (pipeline_id)
  where is_won = true and deleted_at is null;

create unique index if not exists stages_pipeline_lost_unique
  on public.stages (pipeline_id)
  where is_lost = true and deleted_at is null;
```

definidos en `prisma/sql/manual_constraints.sql` (líneas ~110-120) y ya aplicados en la migración `20260821140000_incorporate_manual_ddl_into_migrations` — más un chequeo redundante en la capa de aplicación, en `src/services/stage.service.ts` (`createStage` e `updateStage`, usando `findStageWithFlag` de `src/repositories/stage.repository.ts`). Sacar la exclusividad requiere una migración real de Prisma que borre esos dos índices, no solo borrar código de la app.

**Confirmado — esto NO se toca:** el CHECK `stages_won_lost_exclusive_check`, que impide que UNA MISMA etapa sea "Ganada" y "Perdida" a la vez. Es una restricción distinta e independiente de la que se está sacando (esa es sobre una fila individual, no sobre cuántas filas del pipeline pueden tener el flag) y sigue teniendo sentido: una etapa no puede ser las dos cosas al mismo tiempo.

**Verificado en el código antes de decidir esto:** `Stage.isWon`/`isLost` no tienen ninguna conexión funcional con `Opportunity.status` (que es un campo propio e independiente de la oportunidad, `OPEN`/`WON`/`LOST`) — son puramente descriptivos/informativos hoy. Sacar la exclusividad no rompe ninguna otra lógica del sistema.

### Parte B — el campo Probabilidad deja de estar siempre visible

**Origen:** tanto en el editor integrado (`StageEditor.tsx`) como en la pantalla de respaldo (`StageFormPage.tsx`), el campo "Probabilidad (%)" siempre ocupa un lugar en el formulario, aunque no se use casi nunca. Se pidió ocultarlo por defecto.

**Confirmado:** se reemplaza por un link/botón chico, algo como "+ Agregar probabilidad", que al hacer click desaparece y en su lugar aparece el input numérico de siempre (mismo rango 0-100, mismo comportamiento). Si nunca se abre, la etapa se guarda con probabilidad 0 (el default actual — sin cambios en el contrato del backend, esto es puramente de presentación). En modo edición, si la etapa que se está editando ya tiene una probabilidad distinta de 0 asignada, el campo arranca visible mostrando el valor directamente (no tiene sentido esconder un dato que ya existe y que la persona probablemente quiera ver/tocar).

**Confirmado:** aplica a las **dos** pantallas donde existe el campo — el editor integrado (`StageEditor.tsx`, el sub-componente `StageRowForm` que usan tanto "Nueva etapa" como la edición inline) y la pantalla de respaldo (`StageFormPage.tsx`).

**Archivos involucrados** (para referencia; confirmar los detalles leyendo el código actual antes de tocar nada):

| Archivo | Qué pasa ahí |
|---|---|
| `prisma/sql/manual_constraints.sql` (líneas ~110-120) | Sacar los dos `CREATE UNIQUE INDEX ... stages_pipeline_won_unique` / `stages_pipeline_lost_unique`. Este archivo se reaplica en cada deploy (`npm run migrate:deploy` → `scripts/apply-manual-sql.ts`) como red de seguridad idempotente — si no se sacan de acá, el próximo deploy los vuelve a crear y deshace la migración. |
| Una migración nueva de Prisma (carpeta nueva bajo `prisma/migrations/`, mismo formato de timestamp que las existentes) | `DROP INDEX IF EXISTS stages_pipeline_won_unique; DROP INDEX IF EXISTS stages_pipeline_lost_unique;`. Generarla con el flujo normal de Prisma contra la base de desarrollo local (`npx prisma migrate dev --name stages_won_lost_no_exclusivos` o el nombre que se prefiera); si la base local no está levantada, hay una skill de este mismo Claude Code para levantarla (setup de Supabase local). Después de generar la migración, correr `npm run migrate:deploy` para reaplicar `manual_constraints.sql` ya editado. |
| `prisma/schema.prisma` (líneas ~654-659, el comentario sobre el modelo `Stage`) | Actualizar el comentario que menciona los cuatro índices únicos parciales — quedan solo dos (`(pipeline_id, order)` y `(pipeline_id, name)` `WHERE deleted_at IS NULL`), sacar la mención a `is_won`/`is_lost`. |
| `src/services/stage.service.ts` | Sacar los bloques de chequeo de exclusividad en `createStage` (líneas ~173-184, los `if (input.isWon) {...}` e `if (input.isLost) {...}`) y en `updateStage` (líneas ~251-262, mismo patrón). Revisar si `findStageWithFlag` (de `src/repositories/stage.repository.ts`) queda sin ningún otro uso — si es así, se puede borrar también, a criterio de quien implementa. En `rethrowAsConflict` (líneas ~120-140), las ramas que traducen el P2002 de los índices won/lost a un 409 quedan muertas una vez que esos índices no existen más — sacarlas si parece más limpio, no es obligatorio pero evita código que nunca puede volver a ejecutarse. |
| `src/services/stage.service.test.ts` | Hay dos tests (líneas ~90-105) que verifican el 409 de "ya existe una etapa marcada como ganada/perdida" — se vuelven inválidos, hay que sacarlos o adaptarlos. El test de la línea ~130 (CHECK de ganada+perdida en la misma fila) sigue siendo válido, no tocarlo. |
| `src/services/stage.service.integration-test.ts` | El test de la línea ~66 (marcar `isWon` y después `isLost` sobre LA MISMA etapa falla por el CHECK) sigue siendo válido tal cual, no tocarlo — es sobre la restricción que se mantiene. Agregar un test nuevo que confirme que ahora SÍ se puede marcar `isWon: true` en dos etapas distintas del mismo pipeline (y lo mismo para `isLost`), sin que ninguna de las dos falle. |
| `docs/project-overview.md` (líneas ~519-523, sección `Stage`) | El bullet que dice "único `(pipelineId) WHERE is_won = true` y `(pipelineId) WHERE is_lost = true` — a lo sumo una etapa ganada y una perdida por pipeline" queda desactualizado — corregirlo para reflejar que esos dos índices ya no existen (quedan los otros dos), siguiendo el mismo criterio que se usó en ítems anteriores para notas de este estilo en ese documento. |
| `frontend/src/features/stage/StageEditor.tsx` | El comentario de la línea ~37 dice literalmente "a lo sumo una etapa ganada y una perdida" — corregirlo. Ahí mismo está `StageRowForm`, el sub-componente a modificar para la Parte B (Probabilidad oculta por defecto). |
| `frontend/src/features/stage/StageFormPage.tsx` | Mismo tratamiento de Probabilidad oculta por defecto que en `StageEditor.tsx`, adaptado a esta pantalla. |

**Decisiones ya tomadas:**

- **"Ganada"/"Perdida" pueden estar marcadas en varias etapas del mismo pipeline.** Se sacan los dos índices únicos parciales de la base (con migración real) y el pre-check de la aplicación.
- **El CHECK `stages_won_lost_exclusive_check` se mantiene.** Una misma etapa sigue sin poder ser ganada y perdida a la vez.
- **Los textos de checkboxes y badges no cambian.**
- **Probabilidad oculta por defecto, detrás de "+ Agregar probabilidad",** en las dos pantallas; visible desde el arranque en edición si la etapa ya tiene una probabilidad distinta de 0. Sin cambios en el contrato del backend (`probability?: number`, 0 si nunca se tocó).

**Hallazgos al implementar (la tabla de arriba, verificada contra el código):** las referencias eran exactas (índices en `manual_constraints.sql` 110-120, pre-checks en `stage.service.ts` 173-184 y 251-262, comentario en `schema.prisma` 657-661, `StageEditor.tsx` 37). Dos cosas que la tabla no anticipaba: (1) **`docs/auditoria-2026-08-21-diagnostico.sql` afirmaba la existencia de los dos índices** (fila 7, "índices únicos parciales que faltan o cambiaron de definición") y `scripts/verify-schema.ts` corre ese diagnóstico en el job `integration` de CI después de reconstruir la base — con la migración aplicada, la fila 7 habría reportado `stages_pipeline_won_unique → FALTA` y CI habría fallado; se sacaron las dos entradas con una nota en su lugar. (2) El **test de integración de T-2** (`stage.service.integration-test.ts`, el del CHECK sobre la misma fila) sigue válido tal cual y no se tocó su lógica, pero sus comentarios explicaban el escenario a través de `findStageWithFlag`, que ya no existe; se reescribieron para que no apunten a una función borrada. Además, `prisma migrate dev` no funciona en este entorno (la shadow database no tiene el schema `auth`, ver la bitácora del 2026-09-07), así que la migración se escribió a mano con el mismo formato de las existentes y se aplicó con `npm run migrate:deploy` contra el Supabase local — verificado en `pg_indexes` que los dos índices desaparecieron y en `pg_constraint` que `stages_won_lost_exclusive_check` sigue.

**Decisiones tomadas al implementar:**

- **Migración `20260910120000_stages_won_lost_no_exclusivos`:** dos `drop index if exists` (`public.stages_pipeline_won_unique`, `public.stages_pipeline_lost_unique`), con la decisión y lo que NO se toca documentados en la cabecera del `.sql`. `if exists` para que sea segura en una base donde la red de seguridad nunca llegó a crearlos. No hay backfill ni cambio de datos: solo desaparece una restricción, ninguna fila existente puede violarla.
- **`findStageWithFlag` se borró** (`stage.repository.ts`): sus únicos consumidores eran los dos pre-checks que se sacaron. El comentario de B-12 que compartía con `countStagesByName` se reescribió para hablar solo de esta última, con una nota de dónde estaba el gemelo.
- **`rethrowAsConflict` sin las ramas `won`/`lost`:** sin los índices no puede llegar ningún P2002 con esos targets, y una rama que nunca corre es peor que ninguna (tapa la lectura de lo que sí corre). Los dos tests unitarios que las cubrían se sacaron; el del CHECK y el del nombre siguen. El comentario de T-2 explica ahora que ningún pre-check mira el flag opuesto de la fila (antes decía que `findStageWithFlag` "no podía reemplazar" al CHECK).
- **Test de integración nuevo (§13):** cuatro etapas de un pipeline, dos pasan a `isWon` con `updateStage` y dos a `isLost`; después `createStage` con cada marca puesta en el mismo pipeline. Se afirma sobre lo persistido (tres ganadas y tres perdidas activas, ninguna con las dos) — y como corre contra la base reconstruida desde cero en CI, también vigila que `manual_constraints.sql` no vuelva a crear los índices por accidente.
- **Componente compartido `frontend/src/features/stage/ProbabilityField.tsx`:** un solo lugar para el patrón "+ Agregar probabilidad" → input, usado por `StageRowForm` (editor integrado) y por `StageFormPage`. Recibe `value`/`onChange` (string, como el resto de los inputs numéricos) y decide solo si arranca visible: `Number(value) !== 0` **una vez, al montar** (inicializador de `useState`). Revelar es una decisión de la persona y no se deshace sola: en "Nueva etapa", después de guardar, los valores se vacían pero el campo revelado queda a la vista (vacío) para la siguiente etapa. En `StageFormPage` el form recién se renderiza con la etapa cargada (`LoadingState` antes), así que el valor inicial que ve el campo es el real; en el editor, `StageRowForm` recibe `initialValues` de la etapa.
- **Foco:** al revelar por click, el foco pasa al input recién aparecido (`autoFocus` solo en ese caso). Si arrancó visible (edición con probabilidad), el foco lo sigue decidiendo el formulario — en el editor va al nombre, como antes.
- **`step="any"` en las dos pantallas:** al compartir el input, `StageFormPage` hereda el `step="any"` que el editor ya tenía. Cierra el pendiente menor anotado en §11 (la validación nativa frenaba el submit de una etapa con probabilidad decimal en la pantalla de respaldo).
- **Contrato con el backend sin cambios:** `toCreateInput`/`toUpdateInput` de las dos pantallas siguen mandando `probability` solo si hay un valor; si el campo nunca se abrió, no viaja y la etapa queda con el default 0.
- **CSS (`design-system.css`):** una clase nueva chica, `.ds-text-button` (junto a `.ds-link-button`): un `<button>` real sin fondo ni borde, texto chico en `--color-primary`, subrayado al hover, con el `focus-visible` global. Es un botón y no un link porque dispara una acción en la misma página, no una navegación. En el editor (`.ds-stage-editor-fields .ds-text-button`) toma la altura de un control para quedar alineado con los inputs de la fila. Nada más cambió visualmente.
- **Textos de checkboxes y badges intactos,** y la cortesía visual de desmarcar Ganada al marcar Perdida (y viceversa) también: sigue siendo sobre la misma fila, que es la regla que se mantiene.
- **Referencias corregidas fuera del código:** `docs/project-overview.md` (bullet de índices de `Stage` y la nota de "a lo sumo una etapa ganada" en el estado de los módulos), `prisma/schema.prisma` (comentario del modelo), `StageEditor.tsx` (comentario de cabecera) y la mención de §11 de este mismo documento.

**Tests:** backend — `stage.service.test.ts` sin los dos tests de P2002 won/lost (quedan nombre, target string, genérico, CHECK y relanzado); `stage.service.integration-test.ts` con el test nuevo de §13 (6/6 en local contra el Supabase local). Frontend — `StageFormPage.test.tsx`: S22 afirma además que no hay botón cuando el campo arranca visible; S24 pasa a ejemplificar el 409 con el nombre duplicado (el mensaje de "segunda ganada" ya no existe); nuevos S26 (segunda Ganada se guarda y navega sin error), S27 (creación: oculta, revela con foco y `step="any"`, el botón desaparece, el valor viaja en el POST) y S28 (edición con probabilidad 0 arranca oculta). `PipelineFormPage.test.tsx`: "Agregar etapa" ahora revela el campo antes de tipear y afirma que queda visible y vacío tras guardar; nuevos: "Nueva etapa" oculta y POST sin `probability` (la fila muestra 0%); revelar con foco; Editar oculta con 0 y visible con 25.5 (dentro de la fila, con el foco en el nombre); segunda Ganada con badge en las dos filas, sin alert y con toast. `mockStagesServer` ahora copia `isWon`/`isLost` en POST y PATCH, sin ninguna regla de exclusividad, como el backend.

---

## 14. Columna Probabilidad: mostrar un guión en vez de "0%" cuando no se cargó ningún valor

**Estado:** hecho

**Dónde se vio:** `/pipelines/:id/edit` (editor de etapas integrado, §11) y `/pipelines/:id/stages` (la pantalla de etapas de siempre) — la columna "Probabilidad" de la tabla de etapas en las dos.

**Origen:** desde que Probabilidad quedó oculta por defecto detrás de "+ Agregar probabilidad" (ítem 13), una etapa donde nunca se abrió ese campo se guarda con probabilidad 0 (el default del backend) y hoy se ve en la tabla como "0%", indistinguible visualmente de una etapa donde alguien deliberadamente puso 0%. Se pidió mostrar un guión ("-") en la columna Probabilidad cuando el valor es 0, para no confundirlo con un 0% real cargado a propósito.

**Confirmado — limitación real a documentar, no a resolver acá:** el modelo de datos no distingue "nunca se tocó el campo" de "se cargó 0 a propósito" — las dos situaciones guardan `probability: 0` en la base, sin ningún flag que las diferencie. Así que el guión va a aparecer siempre que el valor sea 0, sin importar si alguien lo puso a propósito o nunca lo tocó. Es una limitación aceptada, no un bug a arreglar en este ítem — si en el futuro hace falta distinguir los dos casos, sería un cambio de modelo de datos aparte.

**Archivo:** `frontend/src/features/stage/probability.ts`, función `formatProbability` (compartida por `StageListPage.tsx` y `StageEditor.tsx`, así que el cambio aplica a las dos pantallas con un solo edit).

**Verificado al implementar:** `formatProbability` sigue siendo el único lugar que arma el texto "N%" de la columna en las dos pantallas (`StageListPage.tsx` y `StageEditor.tsx`); `probabilityWidth` solo alimenta el ancho de la barra y no se tocó — con 0 la barra sigue vacía, que es lo esperado. El cambio es de una línea de decisión: `Number(probability) === 0` devuelve `"-"`, cualquier otro valor sigue como `"N%"`. Ningún otro texto de la app cambia.

**Tests:** nuevo `probability.test.ts` (función pura: "0", "0.0", "0.00" → guión; 37.5, 25.50, 100, 0.5 → "N%"; y `probabilityWidth` con 0 sigue en 0). `StageListPage.test.tsx`: nuevo S13b (fila con probabilidad 0 muestra guión y no "0%"). `PipelineFormPage.test.tsx`: la aserción de "Nueva etapa sin abrir Probabilidad" pasa de esperar "0%" a esperar el guión y afirmar que "0%" no aparece.

---

## 15. Feedback de carga en "Subir"/"Bajar" del editor de etapas integrado

**Estado:** hecho

**Dónde se vio:** `/pipelines/:id/edit`, editor de etapas integrado (§11), botones "Subir" y "Bajar" de cada fila de la tabla.

**Archivo:** `frontend/src/features/stage/StageEditor.tsx` (render de cada fila, los dos `<Button>` de Subir/Bajar).

**Origen:** se reportó como "los botones Subir/Bajar no funcionan". Diagnosticado en vivo con DevTools: **sí funcionan** — el click manda el PATCH, el backend responde 200 y el reordenamiento se aplica — pero la respuesta puede tardar varios segundos (se observaron ~4 s, probablemente por el cold start del backend en Render) y durante ese tiempo el botón no cambia en absoluto: no se deshabilita, no cambia de texto, no hay ningún indicador. La persona interpreta que el click "no hizo nada". Flujo real observado en el Network tab: clic en "Bajar" → preflight `OPTIONS` (204) → `PATCH /api/stages/:id` (200, ~4 s) → refetch del listado (200) → recién ahí la tabla se reordena.

**Comportamiento actual:** los botones solo se deshabilitan por posición (`isFirstOverall`/`isLastOverall`, el borde real del pipeline). Mientras la mutation de mover (`moveStageMutation`) está en curso, todos siguen habilitados y sin indicador. Como el editor nunca reordena localmente antes de la respuesta (decisión de §11: propone el `order` del vecino y confía en el refetch), no hay ningún cambio visible hasta que el backend contesta.

**Comportamiento deseado:** mientras haya un movimiento en curso (Subir o Bajar, de cualquier fila), **todos** los botones "Subir"/"Bajar" de la tabla quedan deshabilitados — no solo el que se clickeó — y vuelven a su estado normal (habilitado/deshabilitado según si es borde de tabla) cuando la request termina, sea con éxito o con error.

**Decisiones ya tomadas:**

- **Se deshabilita toda la tabla en conjunto, no solo la fila/botón clickeado.** Es la opción más simple: ya existe una única instancia de mutation (`moveStageMutation`) compartida por todos los movimientos, así que `isPending` describe exactamente "hay un movimiento en curso". De paso evita que se acumulen varios clicks antes de que responda el primero — cada movimiento propone el `order` del vecino calculado sobre la lista *actual*, y un segundo click antes del refetch trabajaría sobre datos viejos.
- **Alcance: SOLO el editor integrado (`StageEditor.tsx`).** La pantalla de respaldo (`StageListPage.tsx`, accesible vía "Ver etapas") queda sin tocar: no es la pantalla donde se reportó el problema, y ya hay precedente en este documento de tocar solo una de las dos pantallas cuando se decide explícitamente.
- **Sin spinner ni cambio de texto:** alcanza con el estado deshabilitado (el `Button` del design system ya lo muestra visualmente). Es un fix de feedback, no de funcionalidad — no cambia qué se manda ni cuándo.

**Decisiones tomadas al implementar:**

- **Un `|| moveStageMutation.isPending` en el `disabled` de cada botón,** sumado a la condición de borde que ya tenían (`isFirstOverall`/`isLastOverall`). Nada más cambió: ni el handler, ni la mutation, ni qué se manda. Como `isPending` vuelve a `false` también cuando el PATCH falla, los botones se rehabilitan en el error y el mensaje "No pudimos mover la etapa" sigue mostrándose a nivel de la lista como antes.
- **Sin cambios de CSS ni de texto:** el `Button` del design system ya muestra el estado deshabilitado. El comentario del JSX explica que el bloqueo es de feedback de carga y por qué abarca toda la tabla, en el estilo del resto del archivo.
- **`StageListPage.tsx` intacto,** según lo decidido arriba.

**Tests:** `PipelineFormPage.test.tsx`, describe "editor de etapas integrado": test nuevo con tres etapas que retiene la respuesta del PATCH con una promesa que el propio test libera (mismo patrón que E2-4 de `IngestionEventListPage.test.tsx`). Con la request pendiente afirma que los seis botones Subir/Bajar están deshabilitados (incluidos los de las filas no clickeadas) y que la tabla todavía no se reordenó; tras liberar el PATCH, que la fila cambió de lugar, que cada botón volvió a responder solo a su posición y que salió un único PATCH con el order del vecino. Verificado que el test falla sin el fix. El handler que retiene devuelve `undefined` para que msw siga con el de `mockStagesServer`, así el refetch refleja el intercambio real de order. Suite completa de frontend 898/898, typecheck, lint y Prettier limpios.

---

## 16. Rendimiento de red al mover una etapa: batching de `reindexStages`, `Access-Control-Max-Age` en CORS y `staleTime` en `/api/me`

**Estado:** hecho

**Dónde se vio:** `/pipelines/:id/edit`, editor de etapas integrado (§11), botones "Subir"/"Bajar" — el mismo flujo que §15 diagnosticó en vivo. §15 resolvió el *feedback* (los botones se deshabilitan mientras la request está en vuelo); este ítem ataca una parte del *tiempo* que esa request tarda.

**Este ítem toca BACKEND y FRONTEND, y a diferencia de §13 no cambia ningún comportamiento observable:** ni el contrato de la API, ni qué se guarda, ni la política de CORS, ni cuándo la sesión se invalida. Lo único que cambia es la **cantidad de round trips de red** (entre el backend y Postgres, y entre el navegador y el backend). Todo lo que hoy funciona tiene que seguir funcionando exactamente igual, y todos los tests existentes tienen que seguir pasando **sin modificarlos**.

**Origen:** mover una etapa tarda varios segundos. Parte de eso es infraestructura (cold start del backend en Render, fuera del alcance de este ítem), pero al mirar el flujo completo aparecieron tres fuentes de round trips innecesarios que se pueden eliminar sin tocar infraestructura:

### Parte A — `reindexStages` hace 2×N consultas donde alcanzan 2

**Archivo:** `src/repositories/stage.repository.ts`, función `reindexStages` (líneas ~235-263).

**Comportamiento actual:** en cada movimiento, `updateStage` (`src/services/stage.service.ts`) arma la lista final de ids de **todas** las etapas activas del pipeline y llama a `reindexStages`, que les asigna `1..N` en dos pasadas: primero a valores negativos (`-1..-N`) y después a los finales (`1..N`). Cada pasada es un `for` con un `updateMany` **por fila**, `await` uno atrás del otro: con un pipeline de 8 etapas son 16 consultas secuenciales a Postgres solo para el reindexado, cada una con su latencia de ida y vuelta.

**Lo que hay que conservar, y por qué:** las **dos pasadas** existen por una razón real. Hay un índice único parcial `(pipeline_id, "order") WHERE deleted_at IS NULL` (ver el comentario del modelo `Stage` en `prisma/schema.prisma`), y Postgres evalúa la unicidad **por sentencia**, no al final de la transacción. Sin el paso intermedio a negativos, escribir los valores finales de a una fila chocaría contra ese índice en cuanto dos etapas necesiten intercambiarse (la primera toma un `order` que la segunda todavía ocupa). También hay que conservar la **validación de pertenencia**: si algún id de `orderedStageIds` no pertenece a `pipelineId` (bug del caller, condición de carrera, id ajeno de otra organización), la función tiene que abortar la transacción con un error en vez de reindexar en silencio — hoy lo garantiza el `count !== 1` de cada `updateMany`, y `tenant-isolation.integration-test.ts` lo fija.

**Comportamiento deseado:** las mismas dos pasadas, pero cada una como **UNA sola sentencia SQL** que actualiza todas las filas de `orderedStageIds` de una vez — un `UPDATE stages SET "order" = CASE id WHEN ... END WHERE pipeline_id = $1 AND id = ANY($2)` vía `$executeRaw` con `Prisma.sql`/`Prisma.join`, con los casts `::uuid` que ya usa el resto del repo (referencia: `lockStageForUpdate` en el mismo archivo, y los `Prisma.join` de `ingestionEvent.repository.ts`). La validación de pertenencia se mantiene comparando la cantidad de filas afectadas de cada pasada contra `orderedStageIds.length`: si no coincide, se lanza el mismo error que hoy (el mensaje se generaliza, porque sin loop ya no se sabe *qué* id falló, pero tiene que seguir siendo igual de claro y conservar la frase "no pertenece al pipeline" que el test de aislamiento afirma). **La firma no cambia** (`reindexStages(pipelineId, orderedStageIds, db)`).

**Round trips a Postgres por movimiento (solo `reindexStages`):** 2×N → 2. Con 8 etapas: 16 → 2.

### Parte B — el navegador manda un preflight `OPTIONS` antes de cada request mutante

**Archivo:** `src/app.ts`, el `app.use(cors({...}))` (líneas ~54-59).

**Comportamiento actual:** el middleware de CORS no configura `maxAge`, así que la respuesta al preflight no lleva `Access-Control-Max-Age` y el navegador **no cachea** la decisión: manda un `OPTIONS` nuevo antes de cada `PATCH`/`POST`/`DELETE`, aunque repita el mismo origen, método y headers segundos después. En el Network tab de §15 se ve exactamente eso: cada "Bajar" es `OPTIONS` (204) + `PATCH` (200) + `GET` del listado.

**Comportamiento deseado:** agregar `maxAge: 600` (10 minutos, un valor conservador y estándar) a las opciones de `cors()`. El navegador reutiliza la decisión del preflight durante esa ventana. **La política de CORS no cambia en absoluto:** mismos orígenes permitidos (`CORS_ORIGIN`), mismas credenciales, mismos métodos y headers — solo se le dice al navegador por cuánto tiempo puede recordar la respuesta.

**Round trips HTTP por movimiento (después del primero de cada ventana de 10 minutos):** 3 → 2 (`OPTIONS` + `PATCH` + `GET` → `PATCH` + `GET`).

### Parte C — `/api/me` se vuelve a pedir demasiado seguido

**Archivo:** `frontend/src/auth/AuthContext.tsx`, el `useQuery` de `meQuery` (líneas ~143-152).

**Comportamiento actual:** esa query no define `staleTime` propio, así que hereda el default global de `frontend/src/lib/queryClient.ts` (`staleTime: 30_000`, con `refetchOnWindowFocus: true`). Es decir, no es que se refetchee en *cada* remount o foco de ventana — lo hace cuando pasaron más de 30 segundos desde la última respuesta, que en la práctica es casi siempre al volver a la pestaña. El rol y la organización del usuario casi nunca cambian durante una sesión, así que esos refetches de fondo son trabajo (y un round trip, con su preflight si cambió algo del preflight cacheado) que no aporta nada.

**Comportamiento deseado:** `staleTime: 5 * 60 * 1000` (5 minutos) en la config de `meQuery`. **No afecta** el circuito de logout por 401 (`registerUnauthorizedHandler`, que ya maneja el caso de sesión realmente inválida a partir de cualquier request, sin depender de este refetch), ni el `queryClient.clear()` que ya corre en cada cambio real de identidad, ni `retryProfile()` (que llama a `refetch()`, y `refetch()` ignora `staleTime` por diseño).

**Round trips por foco de ventana:** a lo sumo uno cada 30 segundos → a lo sumo uno cada 5 minutos.

**Decisiones ya tomadas:**

- **Ninguna de las tres partes cambia comportamiento observable.** Es un cambio de rendimiento puro: menos consultas a Postgres, menos requests del navegador. Si implementar alguna parte obligara a cambiar un test existente, eso sería señal de que se está cambiando comportamiento y hay que frenar y revisar, no adaptar el test.
- **Parte A conserva las dos pasadas y la validación de pertenencia**; solo colapsa cada pasada de N consultas a 1. Los tests de concurrencia de `stage.service.integration-test.ts` (que dependen del comportamiento exacto de `reindexStages`, incluido *dónde* se bloquea un reorden concurrente) y el de `tenant-isolation.integration-test.ts` tienen que seguir pasando tal cual.
- **Parte B es una línea.** Si el patrón de test contra la app real que ya existe (`errorHandler.integration-test.ts`: `app.listen(0)` + `fetch`) alcanza para afirmar el header, se agrega un test; si no, se verifica a mano con un `curl -i -X OPTIONS` y se documenta en el PR.
- **Parte C es una línea.** Se corre `AuthContext.test.tsx` completo para confirmar que ningún test dependía implícitamente del `staleTime` heredado — en particular "5. Evento repetido no refetchea" y "9. TOKEN_REFRESHED no refetchea". Si alguno dependiera de él, se frena y se decide en conversación, no se cambia a ciegas.

**Hallazgos al implementar (verificado contra el código):** las referencias de líneas eran exactas. Dos cosas que el diagnóstico original no decía del todo bien: (1) **la query de `/api/me` no estaba en `staleTime: 0`** — heredaba los 30 segundos del `queryClient` global, así que el problema real era "un refetch por cada foco de ventana pasados 30 s", no "en cada remount"; la solución (5 minutos) es la misma, pero la mejora es 30 s → 5 min, no 0 → 5 min. (2) **Las dos pasadas de `reindexStages` son obligatorias incluso colapsadas en una sentencia cada una**, no solo "preferibles": un índice único no diferible (y un índice parcial nunca puede ser `DEFERRABLE`) se verifica fila por fila también dentro de un mismo `UPDATE`, así que el clásico `SET "order" = CASE ...` que intercambia dos posiciones falla con `duplicate key` a mitad de camino. El paso intermedio a negativos sigue siendo exactamente lo que lo evita; el comentario de la función lo explica.

**Decisiones tomadas al implementar:**

- **`reindexStages` (`stage.repository.ts`): misma firma, mismas dos fases, cada fase un solo `$executeRaw`** delegado a una función privada `asignarOrden(pipelineId, orderedStageIds, orderDe, db)` que recibe cómo calcular el `order` de cada índice (`-(i + 1)` en la primera fase, `i + 1` en la segunda). El SQL es `UPDATE stages SET "order" = CASE id WHEN $id::uuid THEN $n::int ... END, updated_at = now() WHERE pipeline_id = $1::uuid AND id = ANY($2::uuid[])`, armado con `Prisma.sql`/`Prisma.join` como los `INSERT` por tandas de `ingestionEvent.repository.ts` (el `import type { Prisma }` pasó a import de valor). El `id = ANY(...)` no es redundante con el `CASE`: sin él, las filas del pipeline que no están en la lista caerían en el `ELSE` implícito (`NULL`) y el `NOT NULL` de `order` las rechazaría.
- **`updated_at = now()` a mano.** `updateMany` lo bumpeaba solo por el `@updatedAt` del schema; `$executeRaw` no pasa por Prisma, y dejar de tocar `updatedAt` en un reorden sí habría sido un cambio observable en la respuesta de la API. Es el único detalle que había que reproducir explícitamente.
- **Validación de pertenencia: `count !== orderedStageIds.length` → `throw`.** Mismo criterio que el `count !== 1` por fila que había antes, con el mensaje generalizado ("al menos un stage de los N recibidos no pertenece al pipeline X (se actualizaron M)") — conserva la frase "no pertenece al pipeline" que `tenant-isolation.integration-test.ts` afirma con regex. Lo que se pierde es saber *qué* id falló, que ninguna capa de arriba usaba. Efecto colateral menor y para mejor: una lista con ids duplicados (que ningún caller produce) antes pasaba en silencio con numeración no contigua; ahora el `CASE` la actualiza una sola vez, el `count` no cuadra y aborta.
- **Lista vacía: retorno temprano.** `Prisma.join` rechaza un array vacío; el `for` anterior lo toleraba (cero iteraciones) y ningún caller llega con la lista vacía, pero la función no tiene por qué dejar de tolerarlo.
- **CORS (`app.ts`): `maxAge: 600`** y un comentario al lado del bloque de CORS que ya existía. Nada más de la política cambió.
- **Test nuevo `src/app.test.ts` (suite unitaria, sin base):** contra la app REAL de `app.ts` con el mismo patrón `app.listen(0)` + `fetch` de `errorHandler.integration-test.ts`. Va en la suite unitaria y no en la de integración porque un preflight lo responde el middleware antes de cualquier router, no toca la base ni necesita identidad — `CORS_ORIGIN` es la única variable que hace falta y el job unitario de CI ya la tiene. Verificado localmente también sin `.env` (solo `CORS_ORIGIN` en el entorno), que es exactamente lo que tiene ese job. Toma el primer origen de `CORS_ORIGIN` en vez de hardcodear `localhost:5173`, así vale con cualquier configuración. Como el test cubre el header contra la app real, no hizo falta la verificación manual con `curl`.
- **`AuthContext.tsx`: `staleTime: 5 * 60 * 1000`** en la config de `meQuery`, con un comentario que apunta al default global que pisa y a los tres mecanismos de invalidación que NO dependen de él (401 → `registerUnauthorizedHandler`, cambio de identidad → `queryClient.clear()`, `retryProfile()` → `refetch()`, que ignora `staleTime`).
- **Ningún test existente se modificó.** Era la condición de la decisión de arriba, y se cumplió: los de concurrencia de `stage.service.integration-test.ts` (incluido el que afirma *dónde* se bloquea el segundo reorden, contra `pg_locks`), el de aislamiento de `reindexStages` y los 13 de `AuthContext.test.tsx` pasaron tal cual. Sobre estos últimos: ninguno dependía implícitamente del `staleTime` de 30 s — el "5" afirma sobre `queryClient.clear()` y un evento repetido para la misma identidad no cambia la `queryKey`; el "9" corta antes de tocar la identidad por el `return` de `TOKEN_REFRESHED`; el "13" usa `refetch()`, que fuerza el fetch sin mirar `staleTime`; y los de cambio de identidad (6, 10) trabajan con `queryKey` distintas.

**Round trips, antes → después (contados sobre el código, un movimiento de etapa con un pipeline de 8 etapas):**

| Tramo | Antes | Después |
|---|---|---|
| Consultas a Postgres en `updateStage` para un `PATCH` que trae solo `order` (lectura previa + lock del pipeline + relectura + hermanos + `reindexStages` + relectura final; sin contar `BEGIN`/`COMMIT`) | 5 + 16 = 21 | 5 + 2 = 7 |
| Requests HTTP del navegador por movimiento, después del primer preflight de cada ventana de 10 minutos (`OPTIONS` + `PATCH` + `GET` del listado) | 3 | 2 |
| Refetches de fondo de `/api/me` al volver a la pestaña | a lo sumo 1 cada 30 s | a lo sumo 1 cada 5 min |

**Tests:** backend — `src/app.test.ts` nuevo (2 tests: preflight de origen permitido responde 204 con `Access-Control-Max-Age: 600`, origen reflejado, credenciales y `PATCH` permitido; un origen no permitido sigue sin `Access-Control-Allow-Origin`). Suite unitaria 600/600, suite de integración 562/562 contra el Supabase local, typecheck, lint y Prettier limpios. Frontend — sin tests nuevos (el cambio es una opción de cache; los 13 de `AuthContext.test.tsx` cubren cuándo sí y cuándo no se pide `/api/me`), suite completa 903/903, typecheck, lint y Prettier limpios.

## 17. Toggle "Vista de tabla" / "Vista de embudo": el botón activo pierde el contraste del texto al pasar el mouse

**Estado:** hecho

**Dónde se ve:** `/opportunities`, el toggle "Vista de tabla" / "Vista de embudo" (grupo `.ds-segmented`, hoy usado solo por `frontend/src/features/opportunity/OpportunityListPage.tsx`). El botón que está activo (`aria-pressed="true"`) pierde todo el contraste de texto al pasar el mouse por encima: el texto se vuelve prácticamente invisible sobre su propio fondo y parece que el botón "desaparece". Al sacar el mouse vuelve a verse normal.

**Causa raíz (verificada en el código, con los valores exactos de los tokens):** en `frontend/src/design-system/design-system.css`, la regla `.ds-segmented .ds-button[aria-pressed="true"]` (línea ~1507) pone fondo `--color-primary` y texto `--color-primary-contrast`. Pero `.ds-segmented .ds-button:hover:not(:disabled)` (línea ~1503) tiene **más especificidad** (una clase, una clase, una pseudo-clase y la pseudo-clase de dentro de `:not()`: 0,4,0 contra 0,3,0 de la regla del activo), así que al hacer hover sobre el botón activo pisa el `background` a `--color-surface-muted` **sin tocar el `color`**, que sigue siendo `--color-primary-contrast`. En `tokens.css`:

| Modo | `--color-surface-muted` (fondo en hover) | `--color-primary-contrast` (texto del activo) |
|---|---|---|
| Claro | `#f0efeb` | `#f6f6f3` |
| Oscuro | `#262623` | `#1b1b18` |

Casi el mismo color en los dos modos: texto claro sobre fondo claro, y texto oscuro sobre fondo oscuro. No es un bug de JS ni de `aria-pressed` (que se setea bien, como fija el test del toggle en `OpportunityListPage.test.tsx`): es puramente el orden de cascada de dos reglas de CSS.

**Comportamiento deseado:** el botón que **ya está activo no cambia de aspecto al pasar el mouse**. No hay ninguna acción nueva que tomar sobre él (ya está seleccionado), así que no tiene por qué mostrar un estado de hover; se queda con su fondo `--color-primary` y su texto `--color-primary-contrast`. El hover **sigue funcionando exactamente igual** para los botones NO activos del grupo (fondo `--color-surface-muted` sobre texto `--color-text-muted`): eso no se toca.

**Arreglo:** una sola línea de CSS. En `.ds-segmented .ds-button:hover:not(:disabled)` se agrega `:not([aria-pressed="true"])` al selector, así la regla de hover deja de aplicar sobre el botón ya activo del grupo y la regla del activo queda sin nada que la pise. Sin cambios de JS ni de la lógica de `aria-pressed` en `OpportunityListPage.tsx`. Como `.ds-segmented` es una regla compartida del sistema de diseño, el fix corrige lo mismo en cualquier otro lugar que la use en el futuro.

**Tests:** el único test relacionado con el toggle (`OpportunityListPage.test.tsx`, "el toggle pasa de la vista de tabla a la de embudo y vuelve...") afirma el `aria-pressed` al hacer click, que no cambia. El hover es CSS puro, que Testing Library no evalúa (jsdom no aplica hojas de estilo), así que no se agrega un test nuevo para este ajuste de contraste; la verificación es visual.


---

## 18. Formulario de Oportunidad: seis ajustes (Monto formateado, Moneda cerrada, fecha estimada "desconocida", "Origen del cliente", Estado en español, cierre condicional con fecha automática)

**Estado:** hecho

**Dónde:** `/opportunities/new` y `/opportunities/:id/edit`, `frontend/src/features/opportunity/OpportunityFormPage.tsx`. Seis ajustes independientes al mismo formulario, diagnosticados en el código y con las decisiones de diseño ya cerradas. Se implementan juntos en una sola rama y un solo PR. Ninguno toca el backend ni el contrato de la API.

### Parte A — Monto: separador de miles y decimales con coma, estilo Uruguay

**Comportamiento actual:** `<input type="number" min={0} step="0.01">` sin ningún formato: "20000.5" se ve tal cual, con punto decimal y sin separador de miles.

**Comportamiento deseado:** mientras se escribe, el campo se formatea en vivo estilo Uruguay — punto cada 3 dígitos de la parte entera, coma para los decimales. "20000,5" se ve "20.000,5" al tipear y "20.000,50" al salir del campo (los decimales se completan a 2 recién al perder el foco, para que borrar hacia atrás no pelee con el relleno). Un valor cargado en edición se muestra ya formateado ("1.234,50"). El backend sigue recibiendo el monto real como `number` (Decimal 14,2): es puramente presentación del input.

**Decisión de diseño:** los inputs `type="number"` nativos no admiten separadores de miles en ningún navegador, así que el campo pasa a `type="text" inputMode="decimal"` con formateo/parseo manual. Se agrega un componente genérico del sistema de diseño, `frontend/src/design-system/CurrencyInput.tsx`, que recibe y devuelve el valor canónico (`"20000.5"`, el mismo string que ya guardaba el formulario y que `Number()` convierte) y muestra el formateado con `Intl.NumberFormat("es-UY")`, cuidando la posición del cursor al tipear en medio de un número ya formateado (se cuenta cuántos dígitos quedan a la izquierda del cursor antes de reformatear y se lo vuelve a poner después del mismo dígito). Un punto tipeado se toma como coma decimal (numpad). No se agrega ninguna dependencia: `package.json` no tiene librería de máscaras y una sola función con `Intl` alcanza.

**Alcance:** SOLO el campo Monto de Oportunidad. `VehicleFormPage.tsx` tiene campos de precio con el mismo problema (`priceListUsd`, `priceListLocal`) y NO se tocan acá; el componente queda genérico para que Vehículo lo adopte en otro ítem.

**Tests:** los casos que escriben en Monto y verifican el payload siguen esperando el número real, sin puntos ni comas. Se agregan casos para el formateo visual, para el valor cargado en edición ya formateado, y un test unitario del componente (`CurrencyInput.test.tsx`) con parseo, formateo y cursor.

### Parte B — Moneda: de texto libre a `<select>` con USD/UYU

**Comportamiento actual:** `<input type="text" maxLength={3} pattern="[A-Z]{3}">`, normalizado a 3 letras mayúsculas con `normalizeCurrency`. El comentario de esa función defendía el texto libre a propósito ("el backend acepta cualquier ISO 4217 y una lista inventaría una restricción").

**Comportamiento deseado:** `<select>` cerrado con dos opciones, USD y UYU, sin "Otra". El backend sigue aceptando cualquier ISO 4217 (no se toca); la restricción es solo del lado del cliente, porque la operación real es en Uruguay y el texto libre solo generaba tipeos ("usd", "U$S"). `EMPTY_FORM.currency` sigue siendo `"USD"` como valor inicial.

**Decisión de diseño:** dos casos de borde que el `<select>` cerrado tiene que seguir soportando sin romper lo que ya existía: (1) al vincular una unidad de stock, `handleVehicleChange` vacía Moneda (`""`) para que el backend tome el precio de la unidad — mientras el valor es `""` el select muestra una opción "Según la unidad" que desaparece apenas se elige USD o UYU; (2) un registro persistido con otra moneda (datos viejos, o cargados por API) la muestra como opción extra mientras sea el valor vigente, para que el select nunca muestre "USD" mientras el PATCH manda "ARS". `normalizeCurrency` queda sin callers y se borra.

**Tests:** los casos que tipeaban en Moneda pasan a `selectOptions`. Se agregan: las dos opciones fijas, la opción "Según la unidad" solo mientras está vacía, y la moneda persistida fuera de la lista.

### Parte C — "Fecha estimada de cierre": opción "Desconocida"

**Comportamiento actual:** `<input type="date">`, opcional, sin ninguna afordancia para decir "no sé".

**Comportamiento deseado:** un checkbox al lado, "Fecha desconocida", que al tildarse vacía y deshabilita el input; al destildarlo, el input vuelve a habilitarse. Sin cambio de modelo de datos: "desconocida" y "vacío" son lo mismo para la API. Es afordancia de UI.

**Decisión de diseño:** el checkbox necesita su propio estado local (`useState(false)`): si se derivara de "el campo está vacío", destildarlo con el campo vacío sería imposible (seguiría vacío, seguiría tildado y deshabilitado). Arranca destildado siempre, también en edición con la fecha vacía: como no se persiste, no hay forma de distinguir "desconocida" de "todavía no la cargaron". Va como un `FormField` propio (label > checkbox), que el CSS del sistema de diseño ya pone en fila.

**Tests:** tildar vacía y deshabilita el campo (y el payload de creación lo omite); destildar lo vuelve a habilitar.

### Parte D — "Origen del lead" → "Origen del cliente"

**Comportamiento actual:** label "Origen del lead".

**Comportamiento deseado:** "Origen del cliente". Solo el texto visible: `leadSource`, `OpportunityLeadSource`, `LEAD_SOURCE_LABELS` y `LEAD_SOURCE_OPTIONS` son nombres internos y no cambian. Verificado que "lead" no aparece en ningún otro texto visible de Oportunidad.

**Tests:** los `getByLabelText("Origen del lead")` pasan a "Origen del cliente".

### Parte E — Select "Estado": OPEN/WON/LOST en inglés → español

**Comportamiento actual:** tres `<option>` hardcodeadas con el enum crudo como texto. La traducción correcta ya existía en `OpportunityListPage.tsx` (`STATUSES` y `STATUS_LABEL`: Abierta/Ganada/Perdida), usada en el filtro y en el badge; solo el select del formulario quedó afuera.

**Comportamiento deseado:** el select muestra Abierta/Ganada/Perdida. El `value` de cada opción sigue siendo `"OPEN"`/`"WON"`/`"LOST"`.

**Decisión de diseño:** `STATUS_LABEL` y `STATUSES` se mueven a `frontend/src/features/opportunity/labels.ts` (mismo archivo y mismo patrón `Record<Enum, string>` que `FINANCING_TYPE_LABELS`/`LEAD_SOURCE_LABELS`), se importan desde la lista (reemplazando la definición local) y desde el formulario (las 3 opciones pasan a un `.map`, igual que Financiación/Origen).

**Tests:** los que usan el enum crudo sobre el select de Estado siguen funcionando (`selectOptions` por `value`); se afirma el texto visible. `OpportunityListPage.test.tsx` se corre entero tras mover los símbolos.

### Parte F — "Motivo de pérdida" y "Fecha real de cierre": visibles solo al cerrar, con fecha automática

**Comportamiento actual:** la tarjeta "Estado y cierre" (solo en edición) muestra siempre los dos campos sin importar el Estado. Fue una decisión deliberada de M5 (`docs/project-overview.md`, "`lostReason` — corregido durante el diseño"): se descartó ocultarlo porque dejaba sin definir qué pasa al volver de Perdida a Abierta. Esa decisión se da vuelta acá, con la vuelta definida.

**Comportamiento deseado (cerrado en 3 rondas):**

- **Visibilidad:** los dos campos se muestran juntos SOLO cuando el Estado es Ganada o Perdida; ocultos con Abierta. Un solo criterio para los dos.
- **Fecha automática:** al cambiar el Estado de Abierta a Ganada o a Perdida (las dos) dentro de la misma sesión de edición, "Fecha real de cierre" se completa sola con la fecha de HOY si estaba vacía.
- **Editable:** el auto-completado es solo un valor inicial cómodo; el input sigue siendo un `<input type="date">` normal, visible y editable, nunca `disabled`.
- **Solo la transición vivida en el formulario:** nunca por el valor con el que cargó el registro. Si "Fecha real de cierre" ya tiene un valor (una oportunidad que ya estaba cerrada, o cargada a mano), cambiar el Estado no lo pisa.
- **Reabrir limpia:** al volver el Estado a Abierta se limpian "Fecha real de cierre" y "Motivo de pérdida" en el mismo `setValues` (mismo criterio que `handlePipelineChange` con `stageId`). Sin esto quedarían ocultos pero viajarían igual en el PATCH, y reabrir arrastraría datos de un cierre anterior. En edición eso viaja como `null` explícito, que es lo que el backend espera para limpiar.

"Hoy" se calcula con `todayIsoDate` de `boardMove.ts` (reloj local, nunca `toISOString()`), que es exactamente lo que ya hace el embudo al arrastrar a Ganada/Perdida.

**Tests:** los que esperaban ver los dos campos siempre visibles pasan a arrancar en Ganada/Perdida. Se agregan: Abierta → Perdida con fecha vacía completa hoy; lo mismo para Ganada; con fecha ya cargada no la pisa; el campo sigue editable tras autocompletarse; volver a Abierta oculta los dos campos, los limpia y el PATCH manda `null` en ambos.


---

## 19. Moneda de la organización: pantalla de configuración (nueva) y cálculo automático USD ↔ moneda local en la ficha de vehículo

**Estado:** hecho

**Dónde:** dos partes en una sola rama y un solo PR. (A) una pantalla nueva de configuración de moneda de la organización, bajo "Administración"; (B) `frontend/src/features/vehicle/VehicleFormPage.tsx`, tarjeta "Comercial", par `priceListUsd`/`priceListLocal`. Ninguna toca el backend ni el contrato de la API.

**Contexto:** el backend YA tiene toda la infraestructura de cotizaciones (Fase 2c del módulo de stock, `src/services/organization.service.ts`): `Organization.preferredCurrency` / `Organization.alternateCurrency` (opcionales, nullable, ISO 4217), `GET /api/organization` (cualquier usuario autenticado) devuelve `{ id, name, preferredCurrency, alternateCurrency, exchangeRates: [{ targetCurrency, rate, rateDate }] }` con la cotización USD→X más reciente de cada moneda configurada distinta de USD (nunca hay fila USD→USD), y `PATCH /api/organization` (solo ADMIN) acepta `{ preferredCurrency?, alternateCurrency? }`, al menos un campo, cada uno nullable (`null` = desconfigurar). Si tras aplicar el body las dos monedas quedan iguales (y ninguna es `null`), responde 400 con "La moneda de preferencia y la alternativa no pueden ser la misma". El frontend nunca consumió nada de esto: no existía `features/organization/`, ni pantalla, ni query.

### Parte A — pantalla "Organización" (configuración de moneda)

**Comportamiento actual:** no hay forma de configurar la moneda de la organización desde la app; `exchangeRates` no se muestra en ningún lado.

**Comportamiento deseado:** una página nueva, "Organización", en `/organization`, con dos `<select>` —"Moneda de preferencia" y "Moneda alternativa"— con las mismas dos opciones que Moneda en Oportunidad (ítem 18.B: USD y UYU, sin "Otra") más una opción "Sin configurar" (valor vacío, que viaja como `null`). Un botón "Guardar" manda el `PATCH` con los dos campos y muestra el toast "Configuración guardada" (ítem 12). El 400 de monedas iguales se muestra tal cual llega, en el `ErrorState` del formulario. Debajo, de solo lectura, la cotización vigente si `exchangeRates` trae alguna fila: "1 USD = 40,1235 UYU" con su fecha; si no hay ninguna, un texto que dice que todavía no hay cotización cargada.

**Decisiones de diseño:**

- **Feature nueva `frontend/src/features/organization/`** con la misma separación que `source/` y `branch/` (`types.ts`, `api.ts`, `queries.ts`, `mutations.ts`), pero para una entidad SINGLETON por organización: un solo `GET`, un solo `PATCH`, sin lista, sin paginación ni filtros. `organizationKeys` tiene una sola clave (`settings()`); la mutación invalida esa clave al terminar, mismo criterio de invalidación mínima que el resto.
- **`CURRENCY_OPTIONS` pasa a ser compartida**, en `frontend/src/lib/currencies.ts`, y `OpportunityFormPage.tsx` la importa de ahí en vez de la constante local del ítem 18.B. Es la misma lista y el mismo criterio de "restricción del lado del cliente" (el backend sigue aceptando cualquier ISO 4217): dos copias divergirían tarde o temprano.
- **Valor persistido fuera de la lista:** mismo criterio que Moneda en Oportunidad (18.B). Si una organización tiene, por datos viejos o cargados por API, una moneda que no es USD ni UYU, el select la muestra como opción extra mientras sea el valor vigente, para que nunca muestre "USD" mientras el PATCH manda otra cosa.
- **Se mandan siempre los dos campos** en el PATCH (`"" → null`), sin diferenciar cuál cambió: el backend exige al menos uno, y mandar los dos es la forma más simple de expresar "la configuración queda así". La validación de "no pueden ser la misma" queda del lado del backend a propósito —no se replica en el cliente— porque el mensaje que devuelve es exactamente el que hay que mostrar.
- **Ruta y navegación:** `/organization` dentro del mismo `<AdminRoute>` que ya envuelve `/sources`, `/api-keys`, etc. en `frontend/src/app/router.tsx` (la lectura es abierta a cualquier autenticado, pero la pantalla es toda escritura y no tiene sentido para un USER); link "Organización" en el grupo "Administración" del sidebar (`frontend/src/layout/AppLayout.tsx`), después de "Eventos".
- **Formato de la cotización:** el `rate` llega como string decimal ("40.123456") y `rateDate` como "YYYY-MM-DD". Se muestra con `Intl.NumberFormat("es-UY")` hasta 4 decimales y la fecha con `formatDate` de `features/opportunity/format.ts` (formatea en UTC para que "2026-09-10" no se corra al 9 en una zona horaria negativa) — se reutiliza en vez de duplicarla.

**Tests:** `api.test.ts` (GET y PATCH contra MSW, `null` viaja como `null`, el error del backend se propaga con su mensaje), `queries.test.tsx`/`mutations.test.tsx` (la query pega al endpoint; la mutación invalida la query de settings), `OrganizationSettingsPage.test.tsx` (carga y muestra los valores persistidos y la cotización; sin cotización muestra el aviso; guardar manda el PATCH con los dos campos y `null` por "Sin configurar" y muestra el toast; el 400 de monedas iguales se muestra tal cual; un valor persistido fuera de la lista aparece como opción extra). ADMIN-only: bloque nuevo en `auth/AdminRoute.test.tsx` con la jerarquía real (USER entrando a `/organization` no ve la pantalla ni pide el GET; ADMIN sí) y casos en `layout/AppLayout.test.tsx` (ADMIN ve "Organización", USER no).

### Parte B — cálculo automático USD ↔ moneda local en la ficha de vehículo

**Comportamiento actual:** `priceListUsd` y `priceListLocal` son dos `<input type="number">` independientes; hay que cargar los dos a mano.

**Comportamiento deseado:** al completar uno de los dos con el otro vacío, el otro se calcula solo con la cotización vigente de `exchangeRates` (USD × rate = local; local ÷ rate = USD, redondeado a 2 decimales). El campo calculado sigue siendo un input normal, editable, para pisar el cálculo a mano — mismo criterio de "sugerido pero editable" que ya usa `handleVehicleChange` en Oportunidad. Si `exchangeRates` está vacío (organización sin moneda distinta de USD configurada, o el worker diario todavía no corrió), el cálculo automático simplemente no aplica: los dos campos quedan editables a mano como hoy, sin bloquear el formulario ni mostrar error.

**Decisiones de diseño:**

- **Qué cotización se usa:** como el universo de monedas está limitado a USD/UYU (ítem 18.B), `exchangeRates` tiene como máximo UNA fila (la del par no-USD configurado, sea `preferredCurrency` o `alternateCurrency`). Se usa esa fila directamente como la cotización USD↔moneda local, sin mapear cuál de los dos campos de organización es cuál. La ficha consume `useOrganizationSettings()` de la Parte A.
- **No pisar lo tipeado a mano** (mismo cuidado que Monto en 18.A): el auto-cálculo solo llena un campo que está vacío. Pero "vacío" no alcanza como único criterio: al tipear "25000" en USD, después del primer dígito la moneda local ya no está vacía y se quedaría en 2 × cotización. Por eso la ficha recuerda con un estado local cuál de los dos campos tiene un valor CALCULADO (`derivedPriceField`): mientras el otro campo siga siendo calculado, se recalcula con cada tecla; apenas la persona lo edita a mano deja de serlo y no se toca más. Borrar el campo de origen borra también el calculado (nunca fue tipeado), y no toca uno tipeado a mano. En edición los dos valores persistidos cuentan como tipeados a mano: cambiar uno no recalcula el otro si ya tenía valor.
- **Alcance:** SOLO el par `priceListUsd`/`priceListLocal`. `priceOnRequest`, `minAcceptablePriceUsd`, `acquisitionCostUsd` y el resto de los campos de precio no se tocan. Los inputs siguen siendo `type="number"`: adoptar `CurrencyInput` (18.A) en la ficha de vehículo sigue siendo un ítem aparte.
- **Un hint debajo del par**, solo cuando hay cotización, explica que el otro campo se calcula con la cotización vigente (con el valor y la fecha) y que se puede corregir a mano — mismo criterio que la nota de Oportunidad al vincular una unidad, para que un campo que "se llena solo" no parezca un error.

**Tests (`VehicleFormPage.test.tsx`):** los handlers base pasan a responder también `GET /api/organization` (sin cotización), para que los tests existentes que tipean en "Precio de lista (USD)" sigan esperando `priceListLocal: null`. Se agregan: completar USD calcula la moneda local con una cotización mockeada (y el POST manda los dos); completar la moneda local calcula USD; sin cotización el otro campo queda vacío y editable; un valor ya tipeado a mano en el otro campo no se pisa; el valor calculado se puede corregir a mano y después no se recalcula.

---

## 20. Sucursales: pantalla de administración (listado, alta, edición y baja)

**Estado:** hecho

**Dónde:** feature `frontend/src/features/branch/`, rutas nuevas `/branches`, `/branches/new` y `/branches/:id/edit` en `frontend/src/app/router.tsx`, link "Sucursales" en el grupo "Administración" del sidebar (`frontend/src/layout/AppLayout.tsx`). No toca el backend ni el contrato de la API.

**Contexto:** el backend de Sucursal (`Branch`) está completo desde el módulo de reservas (`src/controllers/branch.controller.ts`, `branch.service.ts`, `branch.repository.ts`, `branch.routes.ts`), pero el frontend nunca construyó una pantalla para administrarlas: `features/branch/` tiene solo `types.ts`, `api.ts` (únicamente `listBranches`) y `queries.ts` (`useBranches`), lo justo para `BranchSelect.tsx`, el desplegable de solo lectura que usan QR y Vehículo. El comentario de `types.ts` lo decía explícito: "no se implementa CRUD de sucursales (feature aparte, fuera de este plan)" — una decisión de alcance de la Fase 3 de QR, no un olvido. Hoy la única forma de crear una sucursal es por API.

Contrato existente que se consume tal cual:

- `GET /api/branches` (lectura abierta a cualquier autenticado; paginado; filtros `search`, `sortBy` `name|createdAt`, `sortOrder`) y `GET /api/branches/:id`.
- `POST /api/branches` y `PATCH /api/branches/:id` (ADMIN-only): `{ name: string (1-255, requerido), timezone: string (1-50, requerido) }`; `timezone` tiene que ser una zona IANA que el runtime reconozca (`esZonaHorariaValida` en `src/utils/timezone.ts`, que además rechaza offsets crudos como `-03:00`). El PATCH acepta los mismos campos, parciales, al menos uno. **Sin unicidad de nombre**: dos sucursales pueden llamarse igual, no hay 409 que manejar.
- `DELETE /api/branches/:id` (ADMIN-only) → 204 sin body. Es un **RESTRICT lógico** con lock, no un borrado simple: responde 400 con uno de cuatro mensajes específicos si la sucursal tiene recursos activos, servicios activos, QRs activos o Google Calendar todavía conectado. Los mensajes están escritos para mostrarse directo a la persona ("No se puede eliminar una sucursal que tiene recursos activos. Eliminá primero sus recursos.").

**Comportamiento actual:** no hay pantalla. `BranchSelect` lista lo que exista, y si no existe nada, no hay forma de crearlo desde la app.

**Comportamiento deseado:** una pantalla "Sucursales" bajo "Administración", con tabla (Nombre, Zona horaria, Acciones: Editar / Eliminar), búsqueda por nombre y orden, y un formulario de alta/edición con Nombre y Zona horaria. Eliminar pide confirmación y, si el backend lo bloquea por el RESTRICT, muestra su mensaje tal cual.

**Decisiones de diseño:**

- **Mismo patrón que `features/source/`**, la referencia más parecida en tamaño: `api.ts` suma `getBranch`, `createBranch`, `updateBranch` y `deleteBranch`; `queries.ts` suma `details()`/`detail(id)` a `branchKeys` y `useBranch(id)` para hidratar el formulario de edición; `mutations.ts` (nuevo) expone `useCreateBranch`, `useUpdateBranch`, `useDeleteBranch` con invalidación mínima sobre `branchKeys.lists()` (y `detail(id)` en el update). Invalidar `lists()` alcanza para que `BranchSelect` (que usa `branchKeys.list(BRANCHES_PARA_SELECT)`) vea una sucursal nueva sin más trabajo. `types.ts` suma `CreateBranchInput`/`UpdateBranchInput` y corrige el comentario de alcance.
- **Sin gate `isAdmin` en los botones**, igual que `SourceListPage`: las tres rutas viven dentro de `AdminRoute` y toda la escritura de `/api/branches` es ADMIN-only, así que un `isAdmin ?` sería una condición que nunca evalúa a false. `GET /api/branches` es de lectura abierta, pero el listado va adentro del `AdminRoute` de todas formas, mismo criterio que `/organization` (§19): la pantalla es toda escritura y un USER ya ve las sucursales donde las necesita, en `BranchSelect`.
- **Borrado con `window.confirm`** ("¿Eliminar esta sucursal?") y el mensaje real del backend en un `ErrorState` cuando el DELETE falla — `deleteBranchMutation.isError` + `error.message`, el mismo patrón que `PipelineListPage` usa para su propio RESTRICT. No se replica la regla en el cliente: el backend es quien sabe si hay recursos, servicios, QRs o un calendario colgando, y su mensaje ya dice qué hacer.
- **Zona horaria: `<select>` acotado, no texto libre.** Quedó a criterio de la implementación y se eligió el select porque es lo más simple de mantener y suficiente para la operación real: `TIMEZONE_OPTIONS` en `features/branch/timezones.ts` con cinco zonas de la región (America/Montevideo, America/Argentina/Buenos_Aires, America/Sao_Paulo, America/Santiago, America/Asuncion), etiquetadas con la ciudad (acotada a tres en §26: Buenos Aires y São Paulo eran la misma zona que Montevideo en la práctica). Un input libre obligaría a replicar en el cliente la validación IANA del backend (o a mostrar el 400 recién al guardar) y sigue permitiendo el tipeo que `esZonaHorariaValida` existe para evitar. Es una restricción del lado del cliente: el backend acepta cualquier zona válida y no cambia. Por eso, mismo cuidado que `CURRENCY_OPTIONS` (§18.B/§19): un valor persistido **fuera de la lista** (una sucursal creada por API con `UTC`, por ejemplo) se muestra como opción extra mientras sea el vigente, para que el select nunca muestre Montevideo mientras el PATCH manda otra cosa. Default al crear: America/Montevideo.
- **PATCH con los dos campos**, sin diferenciar cuál cambió: el backend exige al menos uno y mandar los dos expresa "la sucursal queda así", mismo criterio que `SourceFormPage` y que el PATCH de organización (§19).
- **Formulario**: un solo `BranchFormPage` para crear y editar (el modo lo da el `:id` de la ruta), `useFormDraft` para no pisar lo tipeado cuando llega la fila, Nombre con marca de obligatorio y `RequiredFieldsHint` (§10), y navegación a `/branches` al guardar. Sin toast: §12 lo acotó a Pipeline/Stage y los formularios que navegan a su lista al guardar no lo usan.
- **Ruta y navegación:** las tres rutas dentro del mismo `<AdminRoute>` que ya envuelve `/sources` y `/organization`; link "Sucursales" (ícono `MapPin`) en el grupo "Administración" del sidebar, después de "Organización".

**Tests:** `BranchListPage.test.tsx` (columnas Nombre/Zona horaria; acciones Editar/Eliminar en el menú de tres puntos sin gate por rol; filtros en la query y reset de página; paginación; carga, error y vacío; eliminar: cancelar no llama al backend, confirmar manda el DELETE del id correcto, un 400 del RESTRICT muestra el mensaje del backend tal cual; y el caso de un USER entrando por la jerarquía real `ProtectedRoute → AdminRoute`, que no ve la pantalla ni dispara el GET). `BranchFormPage.test.tsx` (crear manda `name` + `timezone` con Montevideo por defecto y navega a la lista; elegir otra zona viaja en el body; el 400 del backend se muestra sin perder lo tipeado; edición hidrata los dos campos y el PATCH manda los dos; una zona persistida fuera de la lista aparece como opción extra y se conserva al guardar; carga y error al traer la sucursal; marca de obligatorio; y un USER que entra a `/branches/new` es redirigido sin pedir nada). `router.test.tsx` (las tres rutas existen y están bajo `AdminRoute`) y `AppLayout.test.tsx` (ADMIN ve "Sucursales" apuntando a `/branches`, USER no).

---

## 21. Equipamiento del vehículo: de un texto con comas a una lista de chips con nombre normalizado

**Estado:** hecho

**Dónde:** `frontend/src/features/vehicle/VehicleFormPage.tsx`, campo "Equipamiento" de la Card "Especificaciones técnicas" (ficha de vehículo, crear y editar). Componente nuevo `frontend/src/features/vehicle/EquipmentField.tsx` y normalizador puro en `frontend/src/features/vehicle/equipment.ts`. No toca el backend ni el contrato de la API.

**Contexto:** `Vehicle.equipment` es `String[]` en Prisma. El backend (`equipmentSchema` en `src/controllers/vehicle.controller.ts`) valida la **forma** de cada código, no su pertenencia a un catálogo: hasta 50 caracteres, `^[A-Z0-9_]+$` (solo mayúsculas, dígitos y guión bajo; el schema hace `trim().toUpperCase()` antes), sin repetidos, hasta 100 ítems. No hay catálogo cerrado de valores permitidos y esta tarea no lo crea.

**Comportamiento actual:** un único `<input type="text">` con placeholder "Códigos separados por coma, ej. ABS, AIRBAG_LATERAL". El estado del formulario guarda un string con comas (`equipment: string`) y recién `toInput` lo parte en array, hace trim y mayúsculas, y descarta los vacíos. Para sacar un ítem hay que editar el blob completo; un código con espacio o tilde ("aire acondicionado") llega al backend con la forma incorrecta y vuelve como 400.

**Comportamiento deseado:** una lista de chips. Un input "Equipamiento" con un botón "+ Agregar equipamiento" al lado (Enter también agrega, sin enviar el formulario) suma un ítem nombrado individualmente; cada ítem se ve como su propio chip con una ✕ para quitarlo sin afectar a los demás. El nombre se normaliza **en vivo** mientras se tipea, para que lo guardado cumpla siempre la validación del backend sin que la persona tenga que pensar en el formato: mayúsculas automáticas, espacios → guión bajo, tildes fuera. Tipear "Aire acondicionado" se ve y se guarda como `AIRE_ACONDICIONADO`. Un vehículo existente con equipamiento cargado se ve como chips al entrar a editar.

**Decisiones de diseño:**

- **Estado del formulario como `string[]`**, no más string con comas: `VehicleFormValues.equipment: string[]`, `toFormValues` lo pasa tal cual desde el detail y `toInput` lo manda tal cual. El payload no cambia (`equipment: string[]`, mismo contrato); cambia solo cómo se arma ese array en la UI. La normalización de `toInput` (split/trim/upper) desaparece porque la lista ya es válida por construcción.
- **Normalizador puro y compartido** (`normalizeEquipmentCode` en `equipment.ts`): NFD + borrado de marcas diacríticas (la misma técnica que `normalizarEncabezado` en `features/source/fieldMapping.ts` y `utils/slug.ts` en el backend), mayúsculas, espacios y guiones → `_`, cualquier otro carácter fuera de `[A-Z0-9_]` descartado, sin `_` al principio, y tope de 50 caracteres. No colapsa `__` ni recorta el `_` final mientras se tipea: "AIRE_" es el estado natural entre "AIRE" y "AIRE_A", y el backend lo acepta. Al agregar sí se recortan los `_` sobrantes de los extremos, así un espacio de más al final no queda guardado como `AIRE_ACONDICIONADO_`.
- **Los tres límites del backend se aplican del lado del cliente antes de que exista un chip inválido**, no al enviar: `maxLength={50}` en el input (y el normalizador también corta a 50, por si algo lo pisa); duplicado comparando ya normalizado → mensaje inline "ya está en la lista" y no se agrega; con 100 ítems el input y el botón se deshabilitan y un hint dice que se llegó al máximo. Como todo lo que entra a la lista ya pasó por esto, `handleSubmit` no necesita un chequeo propio: no hay estado de la lista que el backend pueda rechazar por forma.
- **El input de texto vive en el componente, no en el formulario**: lo que se está tipeando todavía no es equipamiento. Se limpia al agregar y queda con el foco para cargar el siguiente. Un texto tipeado y no agregado se pierde al guardar, igual que pasaría con cualquier campo que no se confirmó; no se agrega solo al enviar para no guardar a escondidas algo que la persona no confirmó.
- **Sin `FormField`**: `FormField` es un `<label>` que envuelve a su hijo, y el control "rotulado" de un label es su primer descendiente rotulable; con los botones ✕ de los chips adentro, un click en el rótulo activaría la primera ✕. El componente arma el `.ds-field` a mano con `<label htmlFor>` apuntando al input (mismo patrón que `BranchSelect`/`UserSelect`), así `getByLabelText("Equipamiento")` sigue encontrando el input y `.ds-field-grid label` lo estiliza como rótulo de campo sin regla nueva.
- **Chip = `Badge` neutral + botón ✕** con `aria-label="Quitar <CÓDIGO>"`, en una `<ul>` con `aria-label="Equipamiento cargado"`. Reusa el pill que ya existe en vez de inventar otro; solo se agregan las reglas del botón de quitar y del contenedor (`.ds-chip-list`, `.ds-chip-remove`, `.ds-chip-add`) en `design-system.css`, donde vive todo el CSS del proyecto.
- **Vive en `features/vehicle/`** y no en `design-system/` por el mismo criterio que `FieldMappingEditor`: hoy tiene un solo consumidor. Si aparece un segundo campo de "lista de códigos", ahí se promueve.
- **No se interpreta la coma como separador**: la coma es un carácter fuera del alfabeto y el normalizador la descarta. Pegar "ABS, AIRBAG" da un solo chip `ABS_AIRBAG`, no dos. Si alguna vez se pide carga masiva, se agrega como split explícito al agregar, no como parte de la normalización en vivo.

**Tests:** `equipment.test.ts` (normalizador: mayúsculas, tildes, espacios y guiones, caracteres fuera del alfabeto, `_` inicial, tope de 50; `finalizeEquipmentCode` recorta los `_` de los extremos). `VehicleFormPage.test.tsx`: los casos existentes de crear y editar pasan del texto con comas al flujo de agregar de a uno; casos nuevos en su propio `describe`: agregar un ítem lo muestra como chip ya normalizado y el input queda vacío; tipear con espacios/tildes/minúsculas se normaliza en vivo en el input; el input corta a 50 caracteres; quitar un chip no afecta a los demás; un duplicado (comparando normalizado) no se agrega y avisa; Enter agrega sin enviar el formulario; con 100 ítems no se puede agregar más; el POST manda el array de códigos; en edición los códigos persistidos se ven como chips y el PATCH los manda tal cual, con o sin cambios.

---

## 22. Garantía del vehículo: quinta opción "Otra" con texto libre

**Estado:** hecho

**Dónde:** `frontend/src/features/vehicle/VehicleFormPage.tsx`, campo "Garantía" de la Card "Documentación y garantía" (ficha de vehículo, crear y editar), más `types.ts` y `labels.ts` del mismo feature. A diferencia de los ítems anteriores de este lote, **sí toca el backend y lleva una migración de base real**: `prisma/schema.prisma`, `prisma/migrations/20260911120000_vehicle_warranty_other/`, `src/controllers/vehicle.controller.ts`, `src/services/vehicle.service.ts`.

**Contexto:** `Vehicle.warranty` es el enum cerrado `VehicleWarranty { NONE, FACTORY, DEALER_6M, DEALER_12M }` (nullable). En el frontend el único consumidor es el `EnumField` de la ficha (no hay detalle ni vista pública que lo muestre); en el backend, `warrantySchema` en el controller y el tipo `VehicleWritableFields` del service. No existe ningún campo de texto para una garantía que no sea una de las cuatro.

**Comportamiento actual:** el select ofrece "Sin especificar" más las cuatro opciones fijas. Una garantía real que no encaja ("Garantía del fabricante importador, 90 días") no se puede registrar: o se fuerza a la opción más parecida o queda en blanco.

**Comportamiento deseado:** una quinta opción "Otra". Al elegirla aparece un input de texto "Detalle de la garantía" para escribir la garantía real. Al elegir cualquiera de las cuatro opciones fijas (o "Sin especificar") el input desaparece **y su valor se limpia**: cambiar de "Otra" a "De fábrica" y guardar no arrastra el texto viejo. Las cuatro opciones oficiales no se tocan ni se convierten en texto libre: siguen siendo el enum cerrado que ya son. Un vehículo existente con "Otra" y detalle cargado muestra el texto al entrar a editar.

**Decisiones de diseño:**

- **Modelo: un valor más en el enum y una columna aparte**, no reemplazar el enum por texto. `VehicleWarranty` gana `OTHER`; `Vehicle` gana `warrantyOther String? @db.VarChar(255)` mapeado a `warranty_other` (el criterio snake_case del resto del modelo: `warranty` a secas no lleva `@map` porque ya es una palabra). Es el par "enum + detalle" y no un enum con valores libres: el listado, los filtros y cualquier reporte futuro siguen pudiendo agrupar por las cuatro categorías fijas, y "Otra" es una categoría más, con su detalle al lado.
- **Migración escrita a mano** (`prisma migrate dev` no funciona en este repo: shadow database sin el schema `auth`), con timestamp redondo como todas: `ALTER TYPE "VehicleWarranty" ADD VALUE IF NOT EXISTS 'OTHER'` y `ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "warranty_other" VARCHAR(255)`. Mismo molde que `DEAD_LETTER` en `20260902130000`: Postgres prohíbe **usar** un valor de enum en la misma transacción que lo agrega, y `migrate deploy` corre cada migración dentro de una transacción; la migración no usa `OTHER` en ningún lado (ni default, ni backfill, ni CHECK), así que no la afecta. Sin backfill: no hay filas que puedan tener "Otra" todavía. Reversible y sin reescritura de tabla (columna nullable sin default).
- **Sin CHECK en la base**, a diferencia de la sección de consignación. Dos motivos: un CHECK con el literal `'OTHER'` caería justo en la prohibición de arriba (habría que escribirlo con `warranty::text = 'OTHER'`, que funciona pero es una rareza que alguien va a "corregir" en una revisión futura), y cada CHECK manual entra al diagnóstico (`docs/auditoria-2026-08-21-diagnostico.sql`, fila 8) y a los contadores de `verify:schema`. Es un campo descriptivo que no participa de ningún RESTRICT ni cálculo; la consistencia la sostiene el service, que es la única puerta de escritura.
- **La regla de consistencia vive en el service, no en un `.refine()` del controller.** El ticket sugería un refine en `vehicleFields`, pero el precedente del propio módulo es `applyConsignmentRule`: una función pura del service que recibe el valor con el que la fila **queda** (el del body, o el actual si el body no lo trae). Un refine de Zod solo ve el body, y el caso que importa en un PATCH es justamente el que no ve: mandar `warrantyOther` solo, sobre una unidad cuya garantía persistida no es "Otra"; o mandar `warranty: "FACTORY"` solo, sobre una unidad que tenía un detalle cargado. `applyWarrantyRule(effectiveWarranty, data)` calca a la de consignación: si queda en `OTHER`, lo que vino se escribe; si no queda en `OTHER` y el body trae `warrantyOther` con contenido, 400 con mensaje claro (vaciarlo en silencio descartaría lo que el cliente pidió guardar); si no queda en `OTHER` y no trae nada, `warrantyOther` va a `null` en la misma escritura. Cubre POST y PATCH con una sola regla y queda registrado en el historial de cambios como cualquier otro campo. En el controller solo cambia el enum (`OTHER`) y entra `warrantyOther` como `nullableText(255)`: trim y vacío = null, como el resto de los textos.
- **Frontend: limpiar al salir de "Otra", no solo ocultar.** `handleWarrantyChange` hace el `setValues` de `warranty` y, si el valor nuevo no es `OTHER`, de `warrantyOther: ""` en la misma actualización (mismo criterio que reabrir una oportunidad en §18 Parte F). Distinto de la consignación, que conserva lo tipeado y avisa: acá el detalle no tiene sentido sin "Otra" y el ticket pide explícitamente que no se arrastre. `toInput` manda `warrantyOther` solo con `warranty === "OTHER"` y `null` en cualquier otro caso, así el payload cumple la regla del service aunque el estado del form tuviera algo (cinturón y tiradores: el estado ya se limpió).
- **Sin componente nuevo**: un `FormField` con `<input type="text" maxLength={255}>` condicional dentro de la misma grilla, al lado del select. `EnumField` no cambia: "Otra" entra por `WARRANTY_LABELS`, que es de donde saca las opciones.
- **Rótulo en `FIELD_LABELS`** (`warrantyOther: "Detalle de la garantía"`): el historial de cambios muestra `fieldName` por ese mapa, y un campo sin rótulo se vería por su nombre técnico.

**Tests:** backend — `vehicle.controller.test.ts` (`OTHER` acepta; `warrantyOther` con trim, vacío → null y tope de 255; sigue siendo opcional en POST y PATCH). `vehicle.service.test.ts` (`applyWarrantyRule` puro: con `OTHER` pasa tal cual; sin `OTHER` un `warrantyOther` con contenido es 400; sin `OTHER` y sin detalle, `warrantyOther: null` en el resultado; `null` explícito está permitido). `vehicle.integration-test.ts` (crear con `OTHER` + detalle y leerlo; cambiar la garantía a una fija vacía el detalle en la misma escritura y queda en el historial; detalle sin `OTHER` es 400 en POST y en PATCH). Frontend — `VehicleFormPage.test.tsx`, `describe` propio: elegir "Otra" revela el input; guardar con "Otra" manda `warranty: "OTHER"` + `warrantyOther` con el texto; con una opción fija el input no está y viaja `warrantyOther: null`; cambiar de "Otra" a una fija limpia el texto (volver a "Otra" lo muestra vacío); en edición, un vehículo con `OTHER` y detalle muestra el texto y el PATCH lo manda tal cual.

---

## 23. Ficha de vehículo: separador de miles en los precios (formato Uruguay) y en el kilometraje

**Estado:** hecho

**Dónde:** `frontend/src/features/vehicle/VehicleFormPage.tsx` (crear y editar), Cards "Precios y publicación", "Consignación", "Características" y "Documentación y garantía". Solo frontend: no toca el backend ni el contrato de la API. Es el ítem que el propio comentario de `CurrencyInput.tsx` dejó anunciado desde el §18 ("los precios de VehicleFormPage tienen el mismo problema y pueden adoptarlo en otro ítem").

**Comportamiento actual:** los catorce campos numéricos de la ficha son `<input type="number">` nativos, sin formato. Un precio de lista de 25000,50 dólares se ve "25000.5", con punto decimal y sin separador de miles; un kilometraje de 150000 se ve "150000".

**Comportamiento deseado:** los importes se formatean en vivo estilo Uruguay, exactamente como el Monto de Oportunidad desde el §18 Parte A: "20000,5" se ve "20.000,5" al tipear y "20.000,50" al salir del campo; un valor cargado en edición se muestra ya formateado. El kilometraje se formatea con punto cada 3 dígitos ("150000" se ve "150.000") y **nunca** lleva coma ni decimales: es un entero (`z.number().int()` en el backend). El backend sigue recibiendo los mismos `number` de siempre: es puramente presentación de los inputs.

**Alcance (revisado campo por campo con Rocco):** de los catorce numéricos, siete no son plata ni cantidades grandes y un separador de miles los empeoraría ("2.011" en vez de "2011"). Se aplica formato SOLO a:

- **Seis importes → `CurrencyInput`**, el componente que ya existe, sin modificarlo: `priceListUsd`, `priceListLocal`, `minAcceptablePriceUsd`, `acquisitionCostUsd`, `consignmentAgreedPriceUsd` y `licensePlateDebtLocal`.
- **Una cantidad → separador de miles sin decimales ni moneda**: `mileage`.

**Fuera de alcance:** `year`, `cylinderCapacityLiters`, `doors`, `seats`, `powerHp`, `declaredConsumptionKmL` y `consignmentCommissionPercent` siguen siendo `<input type="number">` nativos tal cual están. Tampoco se tocan los dos filtros numéricos de `VehicleListPage.tsx` (son filtros de listado, no de formulario): si en algún momento se quieren con el mismo formato, es otro ítem.

**Decisiones de diseño:**

- **Los seis importes adoptan `CurrencyInput` tal cual.** El contrato del componente es el mismo string canónico que la ficha ya guarda en su estado (`"25000.5"`, `""` si está vacío), así que el reemplazo es directo: `<input type="number" value={values.x} onChange={(event) => update("x", event.target.value)}>` pasa a `<CurrencyInput value={values.x} onChange={(value) => update("x", value)}>`. `min`/`step` desaparecen porque no aplican a un `type="text"`; el parseo descarta cualquier signo, así que no entra un negativo por esa vía. Lo único que cambia en `CurrencyInput.tsx` es el comentario de cabecera, que decía que solo lo usaba Oportunidad.
- **El auto-cálculo del §19 no se toca.** `handlePriceListChange(field, value)` ya recibe el valor como string canónico, no como evento: el `onChange` de `CurrencyInput` le pasa `value` directo, y `convertPriceList` y `derivedPriceField` quedan intactos. Cuando el otro precio se recalcula, `CurrencyInput` lo ve como un cambio del padre y rehace el texto desde el valor nuevo (es exactamente el caso "el padre cambia el valor por su cuenta" que el componente ya contempla desde el §18 para Monto/vincular unidad). Los siete tests del §19 se conservan con las mismas acciones: solo cambian las aserciones de valor de número a texto formateado.
- **Kilometraje: componente hermano `IntegerInput`, no un `CurrencyInput` con parámetro.** `frontend/src/design-system/IntegerInput.tsx` + `integerFormat.ts` (funciones puras `parseInteger` / `formatInteger`, misma división que `CurrencyInput.tsx` + `currencyFormat.ts`). Mismo contrato canónico (`"150000"`, sin separadores), `type="text" inputMode="numeric"` (teclado solo de dígitos en el celular), y el mismo mecanismo de cursor al tipear en medio de un número ya formateado. Se descartó agregarle a `CurrencyInput` un prop de cantidad de decimales: con cero decimales cambia el teclado, desaparece la regla "un punto tipeado es una coma" y desaparece el separador colgado ("20.000,") que el formato en vivo preserva; serían tres condicionales dentro del componente más delicado del sistema de diseño para ahorrarse un archivo chico. Las dos funciones de cursor (`countSignificantBefore` / `positionAfterSignificant`) sí se comparten: ganan un tercer parámetro opcional con el criterio de "carácter significativo" (por defecto el de siempre, dígitos y coma), y `IntegerInput` les pasa "solo dígitos", para que una coma o un punto tipeados por costumbre se descarten sin correr el cursor. Queda una repetición asumida entre los dos componentes (estado del texto, resincronización con el padre, `useLayoutEffect` del cursor): son dos casos y la regla de tres dice que recién con un tercero vale la pena extraer un hook común.
- **La posición pendiente del cursor es estado, no un ref.** Un desvío respecto de `CurrencyInput`, que salió de un test: si lo tipeado se descarta entero (una coma en medio de "1.500"), el texto formateado no cambia, un ref no provoca render y el `useLayoutEffect` no corre; mientras tanto React restaura el valor controlado en el DOM y el cursor se va al final. Con un objeto nuevo en estado por cada tecla hay render y el efecto corre después de esa restauración. `CurrencyInput` tiene el mismo caso latente (una letra tipeada en medio de un monto manda el cursor al final): es cosmético, no se toca en este ítem por decisión de alcance, y queda anotado para cuando se extraiga el hook común.
- **Sin dependencia nueva ni CSS nuevo**: `Intl.NumberFormat("es-UY")`, como en el §18, y los inputs siguen tomando el estilo de `.ds-field input`.

**Tests:** `VehicleFormPage.test.tsx` — los casos existentes que escriben o leen estos campos pasan de aserciones numéricas a texto formateado (mismo criterio que la adaptación de Monto en `OpportunityFormPage.test.tsx` durante el §18); los siete del §19 conservan sus acciones. `describe` nuevo: cada uno de los seis importes muestra "20.000,5" al tipear "20000,5" y "20.000,50" al perder el foco; Kilometraje muestra "150.000" al tipear "150000" y descarta una coma o un punto tipeados; los siete campos fuera de alcance siguen siendo `type="number"`; un vehículo en edición muestra todos los importes y el kilometraje ya formateados y el PATCH manda los números de siempre. `IntegerInput.test.tsx` nuevo (funciones puras, formato en vivo, cursor en el medio, resincronización con el padre) y el caso de cursor con predicado en `CurrencyInput.test.tsx`.

---

## 24. Moneda de la organización: la primera cotización no aparece hasta reiniciar el backend

**Estado:** hecho

**Dónde:** backend. `src/services/organization.service.ts` (`updateOrganizationCurrency`, lo que ejecuta `PATCH /api/organization`) y `src/services/exchangeRate.service.ts`. Sin cambios de contrato de la API ni de frontend.

**Comportamiento actual:** `src/workers/exchangeRateWorker.ts` arranca una sola vez por proceso (en `server.ts`) con una primera pasada inmediata — inmediata respecto del **arranque del servidor**, no respecto de cuándo una organización configura su moneda. En el caso normal el servidor ya está corriendo cuando un ADMIN configura `preferredCurrency`/`alternateCurrency` por primera vez: esa pasada inicial ya pasó sin encontrar nada que buscar, y nada vuelve a disparar una búsqueda hasta `EXCHANGE_RATE_WORKER_POLL_MS` después de **ese arranque** (default 24 horas), no 24 horas después de guardar la configuración. En producción esto significó que Rocco configuró USD/UYU en la pantalla de Organización y no vio ninguna cotización hasta reiniciar el backend a mano.

**Comportamiento deseado:** guardar la configuración de moneda dispara una búsqueda de cotización a pedido, sin depender de que el servidor se reinicie ni de la cadencia del worker. `GET /api/organization` refleja la cotización poco después del `PATCH` (lo que tarde la fuente en responder), y el worker sigue siendo el que la mantiene al día.

**Decisiones de diseño:**

- **Se reutiliza `fetchAndStoreExchangeRates` tal cual.** Ya sabe qué monedas buscar (consulta las de TODAS las organizaciones, no solo la que acaba de guardar), ya maneja la fuente caída y cada upsert sin lanzar (devuelve `{ actualizadas, fallidas }`), y es idempotente: un solo `fetch` a la API trae todas las monedas, así que llamarla de más es barato.
- **No bloquea la respuesta del `PATCH`.** `fetchAndStoreExchangeRates` hace un `fetch()` real a `open.er-api.com`; esperarla dentro del handler haría que quien guarda la configuración espere esa llamada de red. Se dispara sin `await` (fire-and-forget) desde `updateOrganizationCurrency` inmediatamente después de que el `UPDATE` de la fila commiteó, y el resultado se loguea: el resumen como `info` (mismo formato que la pasada del worker) y un fallo inesperado como `error` — el mismo criterio del `catch` del worker: un fallo no se pierde en silencio ni tira abajo el proceso. Consecuencia asumida: la respuesta del `PATCH` normalmente NO trae todavía la cotización nueva (la lee de la base antes de que la fuente responda); es el `GET` siguiente el que la refleja.
- **Cuándo se dispara:** siempre que la fila QUEDE con al menos una moneda configurada distinta de USD — el mismo `currenciesNeedingRate` que ya usan el `GET` y el worker. Sin chequeo más fino de "¿esta moneda ya tenía cotización vigente?": priorizar que ande antes que optimizar, y la API se llama una sola vez por guardado. Un guardado que deja solo USD o nada configurado no dispara nada.
- **Respeta `EXCHANGE_RATE_WORKER_ENABLED=false`.** El mensaje que ese flag ya loguea ("no se actualizan cotizaciones y las organizaciones ven la última guardada") tiene que seguir siendo verdad: con el flag apagado tampoco se dispara la búsqueda a pedido. Es un ambiente que decidió no pegarle a la fuente, no un worker que casualmente no corre.
- **Patrón de "efecto secundario async sin bloquear":** en el proyecto no hay un mecanismo reutilizable para esto (el outbox es para eventos que deben entregarse con reintentos, no para un efecto que puede perderse sin daño porque el worker lo repite igual). Se sigue el mismo `void promesa` + log que ya usa el propio worker (`void tick()`), en una función chica y exportada — `dispararActualizacionDeCotizaciones` en `exchangeRate.service.ts` — para poder probarla sin base.
- **`currenciesNeedingRate` se muda de `organization.service.ts` a `exchangeRate.service.ts`.** Hasta ahora `exchangeRate.service` la importaba de `organization.service`; con `organization.service` importando ahora de `exchangeRate.service`, quedaba un import circular entre los dos. La dependencia correcta es en un solo sentido: el service de organización usa el de cotizaciones, no al revés. Sus tests se mudan con ella.

**Tests:**

- `exchangeRate.service.test.ts` (nuevo, sin base): los de `currenciesNeedingRate` mudados; `dispararActualizacionDeCotizaciones` dispara con una moneda distinta de USD, no dispara con solo USD/nada ni con el flag apagado, y un rechazo de la búsqueda se loguea como `error` sin propagarse.
- `organization.service.integration-test.ts` (nuevo, Postgres real, búsqueda inyectada): guardar una moneda nueva distinta de USD dispara la búsqueda; guardar solo USD no; el service resuelve mientras la búsqueda sigue pendiente (la promesa la libera el test DESPUÉS de que el service devolvió); un fallo de la búsqueda no hace fallar el guardado ni se propaga al caller.
- `organization.controller.integration-test.ts`: por HTTP real y con la fuente stubbeada a nivel de `fetch` global (sin pegarle a la API real), un `PATCH /api/organization` con una moneda nueva responde 200 mientras la fuente todavía no contestó, y `GET /api/organization` refleja la cotización una vez que la fuente responde.

---

## 25. Actividades de otras personas: un USER solo ve las suyas (listado "Actividades" pasa a ser ADMIN-only, "Mis tareas" intacta)

**Estado:** hecho

**Dónde:** backend y frontend. Backend: `src/services/activity.service.ts` (`listActivities`, `getActivityById`), `src/controllers/activity.controller.ts` (`listActivitiesHandler`, `getActivityHandler`) y el comentario de `src/routes/activity.routes.ts`. Frontend: `frontend/src/app/router.tsx` (`/activities` entra al `AdminRoute`) y `frontend/src/layout/AppLayout.tsx` (link "Actividades" solo para ADMIN). `MyTasksPage.tsx` (ruta `/tasks`) no se toca.

**Comportamiento actual:** `GET /api/activities` y `GET /api/activities/:id` son de lectura abierta a cualquier usuario autenticado de la organización, sin ningún filtro por rol: `listActivitiesHandler` pasa la query tal cual llegó a `listActivities`, sin tocar `assigneeId`. Un USER puede pedir el listado completo de actividades de la organización —propias y ajenas— y cualquier actividad por id, no solo lo que la pantalla "Actividades" le muestra. Rocco no quiere que un USER vea las actividades de otras personas.

**Comportamiento deseado:** un USER ve únicamente las actividades asignadas a sí mismo, por cualquier vía (listado, id, o la API a mano). ADMIN sigue viendo todo, exactamente como hoy. "Mis tareas" sigue funcionando igual para ambos roles: leer las tareas propias pendientes y tildarlas/destildarlas.

**Decisión de alcance (tomada con Rocco):** alcanza con la versión simple, restringir a ADMIN. Se evaluó y **se descartó** un rol nuevo tipo "Encargado de sucursal" (con asignación de sucursal a usuario y `branchId` en `Activity`/`Company`/`Contact`/`Opportunity`): no es parte de este ítem y no se construye nada de eso.

**Decisiones de diseño:**

- **La restricción vive en el service, NO es `authorize("ADMIN")` en la ruta.** La razón es que "Mis tareas" (`MyTasksPage.tsx`, disponible a ambos roles) usa el MISMO endpoint: `useMyPendingActivities` llama a `GET /api/activities?assigneeId=<yo>&completed=false` y pasa por el mismo `listActivitiesHandler`/`listActivities` que alimenta la pantalla "Actividades". Con `authorize("ADMIN")` en la ruta, "Mis tareas" se rompería por completo para USER: no podría ni ver ni completar sus propias tareas. La ruta sigue abierta a cualquier autenticado (`authenticate`, sin `authorize`); un USER sigue necesitando pedir su propio listado.
- **`listActivities` y `getActivityById` reciben quién pregunta** — el mismo tipo `ActivityActor` (`{ userId, role }`) que ya usa `canSelfServiceCompleteActivity` para el PATCH, armado desde `req.auth` en el controller (un helper local `actorFromRequest` para no repetir el objeto en tres handlers).
  - `actor.role === "ADMIN"`: sin cambios de comportamiento. Ve todo y puede mandar cualquier filtro, incluido el `assigneeId` de otra persona.
  - No ADMIN: se **ignora** cualquier `assigneeId` que mande el cliente en la query y se fuerza `assigneeId = actor.userId`. "Mis tareas", que ya manda `assigneeId=<yo>`, sigue funcionando exactamente igual; pero ya no hay forma de pedir las actividades de otra persona ni de pedir el listado sin filtrar y recibir todo. Consecuencia asumida: un USER tampoco ve las actividades **sin asignar** (`assigneeId` null), que es lo mismo que "Mis tareas" ya mostraba.
- **Mismo criterio para `getActivityById`: 404, no 403.** Si no es ADMIN y la actividad encontrada tiene un `assigneeId` distinto del actor (o ninguno), se responde "Actividad no encontrada" con 404 —el mismo mensaje y status que cuando el id no existe— para no confirmar que ese id existe fuera del alcance de quien pregunta. Es deliberadamente distinto del 403 que `canSelfServiceCompleteActivity` ya usa para el PATCH: ese caso presupone que quien pregunta ya tiene el id de una fuente legítima (por ejemplo "Mis tareas" mostrándoselo); este no. Por eso el PATCH sigue leyendo la fila con un helper interno sin actor (`requireActivity`): su regla de autorización es propia y su 403 no cambia.
- **Dos reglas puras, exportadas y probadas sin base**, mismo criterio que `canSelfServiceCompleteActivity`: `scopeActivityFiltersToActor(actor, filters)` (qué filtros llegan realmente al repositorio) y `canReadActivity(actor, activity)` (si una fila encontrada se muestra). El service las aplica; el repositorio no cambia.
- **Frontend: `/activities` entra al mismo `AdminRoute`** que ya envuelve `/sources`, `/organization` y `/branches` en `router.tsx`. El comentario que decía "/activities NO va dentro del AdminRoute" se reemplaza por el motivo nuevo; las comparaciones "como /activities" de otras rutas de lectura abierta (QR, /users) se reescriben contra `/companies`. El link "Actividades" del sidebar (`AppLayout.tsx`) se muestra solo si `isAdmin`, mismo patrón que Organización/Sucursales, dentro del mismo grupo "Actividad" donde "Mis tareas" queda para ambos roles. `ActivityListPage.tsx` no cambia: sus ramas por rol (sin `GET /api/users` para USER, acciones solo ADMIN) quedan como defensa en profundidad y sus tests siguen valiendo tal cual.
- **"Mis tareas" no se toca.** `MyTasksPage.tsx`, `/tasks` fuera del `AdminRoute`, `useMyPendingActivities` y el PATCH de solo `completedAt` siguen exactamente igual.
- **Docs que afirmaban "lectura abierta a cualquier rol" para Activity** (`project-overview.md`, `data-classification.md`, `qr-integration.md`) se corrigen en el mismo PR.

**Tests:**

- Backend, `activity.service.test.ts` (sin base): matriz de `scopeActivityFiltersToActor` (ADMIN conserva lo que mande, incluido el `assigneeId` de otra persona; USER sin filtro recibe el suyo forzado; USER con `assigneeId` ajeno lo ve pisado por el propio; el resto de los filtros se conserva) y de `canReadActivity` (ADMIN cualquiera; USER solo la propia; ajena y sin asignar no).
- Backend, `activity.service.integration-test.ts` (Postgres real): USER sin filtro recibe solo las suyas; USER con `assigneeId` de otra persona igual recibe solo las suyas; el caso exacto de "Mis tareas" (`assigneeId=<yo>&completed=false`) devuelve solo lo propio pendiente; USER por id de una ajena y de una sin asignar recibe 404 "Actividad no encontrada"; ADMIN sin cambios (todo, filtrar por cualquier `assigneeId`, cualquier id).
- Backend, `activity.controller.integration-test.ts` (nuevo, HTTP real con `authenticate` real, mismo patrón que `organization.controller.integration-test.ts`): confirma que el controller arma el actor desde `req.auth` y no desde la query — USER `GET /api/activities?assigneeId=<otro>` recibe solo las suyas; `GET /api/activities/:id` ajena responde 404; ADMIN filtrando por el `assigneeId` de cualquier persona recibe lo pedido.
- Frontend: `AdminRoute.test.tsx` (USER entrando a `/activities` no renderiza la lista ni dispara `GET /api/activities`; ADMIN sí), `router.test.tsx` (`/activities` bajo `AdminRoute`, `/tasks` sigue fuera), `AppLayout.test.tsx` (link "Actividades" solo para ADMIN; "Mis tareas" para ambos). `MyTasksPage.test.tsx` pasa sin cambios.

---

## 26. Sucursales: el select de zona horaria ofrece tres opciones que son la misma zona en la práctica

**Estado:** hecho

**Dónde:** solo frontend. `frontend/src/features/branch/timezones.ts` (`TIMEZONE_OPTIONS`, del ítem 20) y `frontend/src/features/branch/BranchFormPage.test.tsx`. No se toca `BranchFormPage.tsx`, el backend, ni el contrato de la API.

**Comportamiento actual:** al crear o editar una Sucursal, el select "Zona horaria" ofrece cinco opciones: Montevideo, Buenos Aires, São Paulo, Santiago y Asunción. Rocco notó que tres de ellas —Montevideo, Buenos Aires y São Paulo— son hoy exactamente la misma zona en la práctica: las tres son UTC-3 fijo todo el año y ninguna observa horario de verano (Brasil lo abolió en 2019; Argentina y Uruguay no lo tienen desde hace años). Elegir cualquiera de las tres da el mismo comportamiento de horarios (disponibilidad, reservas, Google Calendar), así que ofrecerlas como opciones "distintas" es confuso: parece una decisión con consecuencias y no la tiene. Santiago y Asunción sí tienen horario de verano (cambian de offset durante el año), así que esas dos no son redundantes ni entre sí ni con las otras.

**Comportamiento deseado:** el select ofrece tres opciones: Montevideo, Santiago y Asunción. El default al crear sigue siendo America/Montevideo.

**Decisiones de diseño:**

- **Se sacan de la lista Buenos Aires y São Paulo; queda Montevideo como representante de UTC-3 fijo.** Es la zona de la operación real (Uruguay) y ya era el default, así que es la que menos sorprende. `DEFAULT_TIMEZONE` no cambia.
- **No se migra ningún dato.** Es un cambio de las opciones que se ofrecen, no de lo que es válido: el backend acepta cualquier zona IANA que el runtime reconozca (`esZonaHorariaValida`) y sigue igual. Una sucursal que ya tenga persistida `America/Argentina/Buenos_Aires` o `America/Sao_Paulo` (creada antes de este cambio, o por API) sigue siendo válida y editable tal cual: al abrirla, el select la muestra como **opción extra** mientras sea el valor vigente, gracias al mecanismo que `timezones.ts` ya contemplaba para cualquier valor fuera de la lista (`isKnownTimezone` + la `<option>` extra en `BranchFormPage.tsx`, el mismo patrón que Moneda en Oportunidad/Organización para un valor legacy fuera de la lista cerrada, §18.B/§19). Guardar sin tocar la zona manda el valor tal cual; si la persona elige otra opción de la lista, la extra desaparece porque ya no es el valor vigente. Lo que cambia es solo lo que se ofrece para una sucursal **nueva** o al elegir una zona distinta.
- **El comentario de cabecera de `timezones.ts`** deja registrado el criterio de selección (una sola opción por comportamiento real; no se listan zonas que hoy son equivalentes) para que quien quiera agregar una zona sepa qué preguntarse. El ejemplo "Buenos Aires" del tipeo a evitar sigue valiendo: es exactamente el texto libre que la validación IANA existe para rechazar.

**Tests:** `BranchFormPage.test.tsx`: el caso de "ofrece la lista acotada" pasa a comprobar las tres opciones que quedan (Montevideo, Santiago, Asunción) y que Buenos Aires y São Paulo **no** están; "elegir otra zona viaja en el body" pasa a usar Santiago; "con una zona de la lista NO se agrega ninguna opción extra" espera tres opciones; y se agrega el caso de **una sucursal con una zona que se sacó de la lista (la vieja Buenos Aires) se sigue mostrando como opción extra al editar, se conserva al guardar sin perder el valor, y al elegir otra zona de la lista el PATCH manda la nueva**. El caso existente con `UTC` (zona que nunca estuvo en la lista) queda como está.

---

## 27. Toggle "Vista de tabla" / "Vista de embudo": el botón NO activo no tiene ningún hover perceptible

**Estado:** hecho

**Dónde se ve:** `/opportunities`, el toggle "Vista de tabla" / "Vista de embudo" (grupo `.ds-segmented` en `frontend/src/design-system/design-system.css`, hoy usado solo por `frontend/src/features/opportunity/OpportunityListPage.tsx`). Es la contracara del §17: aquel arregló el botón **activo** (`aria-pressed="true"`, fondo `--color-primary` y texto `--color-primary-contrast`), que no se toca acá. Este ítem es sobre los botones **no activos** del grupo.

**Comportamiento actual:** al pasar el mouse por un botón no activo del toggle no se nota nada. Rocco lo comparó con los botones "+ Nueva empresa", "+ Nuevo contacto", etc. (`.ds-link-button`), que sí cambian de color de forma clara al hacer hover, y con el toggle "no pasa nada".

**Causa raíz (verificada en el código, con los valores exactos de los tokens):** el botón no activo tiene `background: transparent`, así que en reposo lo que se ve es el fondo del contenedor `.ds-segmented`, que es `--color-surface-sunken`. La regla de hover `.ds-segmented .ds-button:hover:not(:disabled):not([aria-pressed="true"])` lo pasa a `--color-surface-muted`. En `tokens.css`:

| Modo | `--color-surface-sunken` (lo que se ve en reposo) | `--color-surface-muted` (fondo en hover) |
|---|---|---|
| Claro | `#f6f6f3` | `#f0efeb` |
| Oscuro | `#181816` | `#262623` |

En modo claro la diferencia es de 6 sobre 255 en cada canal: existe, pero es invisible en la práctica. En cambio `.ds-link-button` va de `--color-primary` (`#1b1b18`) a `--color-primary-hover` (`#2e2e29`) al hacer hover, un salto de color fuerte que sí se percibe. No es un bug de JS ni de `aria-pressed`: el hover se aplica, pero con un matiz casi idéntico al reposo.

**Comportamiento deseado (decisión confirmada con Rocco):** el hover del botón no activo tiene que ser del **mismo tipo** que el de "+ Nueva": un cambio de color fuerte y notorio, no un matiz. Concretamente, en hover el botón no activo toma el mismo fondo y texto que "+ Nueva" muestra en su propio hover: fondo `--color-primary-hover` y texto `--color-primary-contrast`. Al sacar el mouse vuelve a su reposo (fondo transparente, texto `--color-text-muted`), por CSS puro.

**Nota de diseño, para que no se lea como un error:** con este cambio el hover del botón no activo queda visualmente muy parecido al reposo del botón activo (`--color-primary-hover` `#2e2e29` es cercano a `--color-primary` `#1b1b18`; en oscuro, `#ffffff` contra `#f0efe9`). Es intencional: Rocco lo pidió así explícitamente para que el hover se note. No es un descuido de contraste como el del §17 (allí el texto se volvía invisible sobre su propio fondo; acá texto y fondo van siempre en el par contrastado `--color-primary-hover` / `--color-primary-contrast`).

**Arreglo:** una sola regla de CSS, sin JS ni backend. En `.ds-segmented .ds-button:hover:not(:disabled):not([aria-pressed="true"])`, el `background` pasa de `--color-surface-muted` a `--color-primary-hover` y se agrega `color: var(--color-primary-contrast)`. El botón activo (`[aria-pressed="true"]`) no se toca; el reposo del no activo no se toca. El comentario de cabecera del bloque `.ds-segmented` deja registrado por qué el hover del no activo usa los mismos tokens que el activo usa en reposo, para que quien lo lea después no lo confunda con un copy-paste. Como `.ds-segmented` es una regla compartida del sistema de diseño, el cambio alcanza a cualquier otro uso futuro del segmented control.

**Tests:** el único test relacionado con el toggle (`OpportunityListPage.test.tsx`, "el toggle pasa de la vista de tabla a la de embudo y vuelve...") afirma el `aria-pressed` al hacer click, que no cambia. El hover es CSS puro, que Testing Library no evalúa (jsdom no aplica hojas de estilo), así que, igual que en el §17, no se agrega un test automatizado nuevo; la verificación es visual.

---

## 28. "Ver detalle": popup de solo lectura en el menú de 3 puntitos de cada listado

**Estado:** hecho

**Contexto:** Hoy, para ver los datos completos de un registro en cualquier listado, la única forma es entrar a "Editar" — lo cual abre el formulario editable, mezclando "consultar" con "modificar". Se quiere una forma de ver el detalle completo de un registro sin exponer controles de edición ni navegar a otra pantalla.

**Comportamiento deseado:** en cada una de las 10 pantallas que ya usan `ActionsMenu` (ver §8), se agrega un nuevo ítem "Ver detalle" al PRINCIPIO de la lista de acciones de cada fila (antes de "Editar" y de cualquier otra acción). Al elegirlo se abre un pop up CENTRADO en la pantalla con el detalle completo de ese registro, en solo lectura: sin inputs, sin poder guardar nada. La única interacción posible es cerrarlo (botón "×", clic afuera del pop up, o Escape).

Pantallas (mismas 10 del §8): `CompanyListPage.tsx`, `ContactListPage.tsx`, `OpportunityListPage.tsx`, `ActivityListPage.tsx`, `PipelineListPage.tsx`, `StageListPage.tsx`, `VehicleListPage.tsx`, `QrListPage.tsx`, `UserListPage.tsx`, `SourceListPage.tsx`.

**Decisiones ya tomadas:**

- **Posición:** "Ver detalle" va primero en el menú, antes de "Editar" — es la acción menos "peligrosa" y la que más se usa para consultar rápido.
- **No es navegación:** se implementa con `onClick` que abre un estado local (ej. `detalleAbierto: <Id> | null` en el propio `*ListPage.tsx`), no con `to` — el pop up no tiene URL propia, no se puede compartir el link ni volver atrás con el botón del navegador. Si en el futuro se pide eso es un cambio aparte, no reabrir esta decisión ahora.
- **Contenido:** los mismos campos que muestra el formulario de edición de esa entidad, en solo lectura, con exactamente los mismos datos que se verían al entrar a "Editar" — ninguna lista "resumida" ni recortada a mano.
- **Fuente de datos: NO hace falta ningún pedido nuevo al backend.** Los 10 listados ya traen el objeto completo de cada fila en la respuesta de "listar" (`Company`, `Contact`, `Opportunity`, `Activity`, `Pipeline`, `Stage`, `VehicleListItem` —que extiende `Vehicle` completo, más `coverPhotoUrl`—, `QrCode`, `User`, `Source` — verificado revisando cada `types.ts`). El pop up usa el mismo objeto que ya está en memoria para esa fila; no dispara un GET adicional.
- **Formato de los valores:** reusar el mismo formato/resolución que cada listado ya usa para mostrar ese dato en su columna — nombres de relaciones ya resueltos (empresa, propietario, etc.; nunca IDs crudos), `Badge` para los enums que ya se muestran así, `PhoneNumber` para teléfono (§ phone-display-format), separador de miles para precios/kilometraje (§23), fecha en formato local. No se inventa un formato nuevo: se reutilizan los mismos helpers que cada `*ListPage.tsx` ya usa en su columna.
- **Secciones (caso Vehículo):** el formulario de Vehículo agrupa campos en secciones — ver los comentarios `// Identificación`, `// Comercial`, `// Consignación`, `// Características`, `// Documentación / garantía`, `// Operativo`, `// Multimedia`, `// Publicación`, `// Contenido` en `frontend/src/features/vehicle/types.ts`. El pop up de detalle respeta esas mismas secciones como subtítulos, para que un vehículo con ~40 campos no se vea como una lista plana. La sección "Multimedia" (fotos) puede omitirse del pop up o mostrarse como referencia simple (a tu criterio al implementar) — no es el foco de este ítem.
- **Campos que NO se muestran:** cualquier campo puramente interno o de ayuda de UI del formulario que no sea un dato del registro (ej. "Completitud para publicar" / "Campos que faltan para publicar" en `VehicleFormPage` — son ayudas de validación del formulario de edición, no datos del vehículo).
- **QR:** ya tiene una acción "Ver imagen" en el menú (abre la imagen del código). "Ver detalle" es una acción distinta y adicional — muestra los datos del registro (estado, fechas, etc.), no la imagen. Las dos conviven.
- **Fuera de alcance (no tocar):** `ApiKeyListPage.tsx`, `InvitationListPage.tsx`, `IngestionEventListPage.tsx` — no tienen `ActionsMenu` hoy (ver §8). Agregarles "Ver detalle" implicaría decidir cómo se ve una columna de acciones con un solo ítem, que es una decisión de diseño aparte no pedida todavía.

**Cómo se implementa:**

- Nueva variante en `frontend/src/design-system/Modal.tsx`: agregar una prop (ej. `variant?: "panel" | "dialog"`, default `"panel"` = el comportamiento actual, SIN CAMBIOS para los consumidores existentes). La variante `"dialog"` es una caja CENTRADA en la pantalla (no el panel deslizante desde el borde derecho), más angosta que alta, que SÍ se cierra con click en el overlay y con Escape — al revés que el panel de hoy. Leé el comentario de cabecera de `Modal.tsx`: ya anticipa este caso ("Si alguna vez hace falta un diálogo descartable —una confirmación, un detalle— esto se extiende con una prop... No se agrega hoy: no hay un consumidor que diga qué forma tendría que tener"). Ese consumidor es este ítem. El motivo por el que el panel de hoy NO se cierra así (el secreto irreversible de una API key) no aplica acá: no hay nada que perder al cerrar un pop up de solo lectura. La variante `"dialog"` no lleva `primaryAction` — el pie solo tiene el botón de cierre ("Cerrar").
- Nuevo componente de presentación reutilizable para el contenido (ej. `frontend/src/design-system/DetailList.tsx`, nombre a tu criterio siguiendo la convención `ds-*`) que recibe secciones con pares rótulo/valor y las renderiza, para no repetir el mismo layout en las 10 pantallas.
- Cada `*ListPage.tsx` gana: un estado local con el id de la fila cuyo detalle está abierto, el nuevo ítem "Ver detalle" en `ActionsMenu` con `onClick` que lo setea, y el render condicional del `Modal` variant="dialog" con el contenido de esa fila (tomado del array ya cargado, sin fetch nuevo).

**Tests:** cada una de las 10 `*ListPage.test.tsx` gana un test que abre el menú, elige "Ver detalle", verifica que el pop up muestra el dato esperado, y se cierra con "×" y con Escape. `Modal.test.tsx` gana los casos de la variante `dialog` (cierre con click en el overlay, cierre con Escape) y confirma que la variante `panel` no cambia su comportamiento actual (regresión).

**Hallazgos al implementar (la lista de arriba, verificada contra el código):**

- **`PhoneNumber` no existe en `master`:** vive en la rama `feat/phone-display-format` (PR #218, sin mergear al implementar este ítem). Como la regla es "el mismo formato que la columna del listado", y en `master` las columnas Teléfono de Contactos y Empresas muestran el string tal cual, el detalle hace lo mismo. Cuando #218 se mergee, cambiar los dos `{ label: "Teléfono", value: … }` (Contactos, Empresas) y el teléfono del consignante (Vehículo) a `PhoneNumber` es un cambio de una línea cada uno.
- **Dos relaciones sin columna en su listado:** la "Unidad de stock" de una Oportunidad y la "Sucursal" de una unidad de stock no tienen columna en su tabla, así que ningún mapa de nombres ya cargado las resuelve, y mostrar el UUID está descartado. Sucursal se resuelve con la misma query que el filtro "Sucursal" de la pantalla ya tiene abierta (`useBranches(BRANCHES_PARA_SELECT)`, la de `BranchSelect`): TanStack Query la dedupe y no hay request nueva. La unidad de una Oportunidad no tiene ninguna query abierta que la sirva, así que `OpportunityListPage` la pide con `useVehicle(detalle?.vehicleId)` —la misma query por id que `VehicleSelect` usa en el formulario— **solo con el pop up abierto y solo si hay unidad vinculada**; nunca por fila al cargar la tabla. Es el único desvío al "sin pedido nuevo" de la decisión, y es sobre una relación, no sobre el registro: el registro sigue saliendo del array ya cargado en las diez pantallas (los tests lo afirman contando requests).
- **Usuarios no tiene formulario de edición** (se edita en línea, rol y estado): el detalle muestra lo que la fila ya muestra —nombre, email, rol, estado con el mismo Badge— más los dos datos del registro que ninguna celda tiene, "Último acceso" y "Fecha de alta". La **fila propia sigue sin menú**, y por lo tanto sin "Ver detalle": sería un menú de un solo ítem, justo lo que §8 descarta, y los datos propios ya están en la fila.
- **Actividades muestra "Autor"** aunque el formulario no lo tenga (no se edita): está en la tabla, es un dato de la actividad y el detalle no lo recorta. Mismo criterio en QR: además de los campos de `QrFormDialog` van el número, el estado derivado (mismo Badge) y las fechas de reclamo, uso y creación, que es lo que la decisión pide ("estado, fechas, etc.").
- **Oportunidad, Motivo de pérdida y Fecha real de cierre** solo con Ganada/Perdida, como en el formulario (`isClosed`). El "Fecha desconocida" del formulario es un checkbox de ayuda para vaciar la fecha estimada, no un dato: no se muestra. **Monto** usa `formatAmount` de `opportunity/format.ts` —el de la columna— y no el `es-UY` de `CurrencyInput`: la regla del listado manda sobre la del formulario cuando difieren, y dejar los dos formatos en la misma pantalla sería peor que cualquiera de los dos.
- **Fuentes:** el mapeo de columnas de una `FILE_IMPORT` (`fieldMapping`) se muestra como una línea por columna, "encabezado → campo" con la misma `ETIQUETA_DE_CAMPO` del editor; en los otros tipos la fila no aparece, como el editor del formulario.
- **`StageEditor.tsx`** (el editor de etapas integrado en el formulario de Pipeline, §11) también usa `ActionsMenu`, pero no es una de las 10 pantallas de listado del ítem y no se tocó.

**Decisiones tomadas al implementar:**

- **`Modal` variant="dialog"** (`design-system/Modal.tsx`): `ModalProps` pasa a ser una unión discriminada por `variant`, así `primaryAction` con `variant="dialog"` no compila en vez de ignorarse en silencio. El default sigue siendo `"panel"` y ningún consumidor existente cambió. En el diálogo: el overlay cierra solo si el click nació en el propio overlay (`event.target === event.currentTarget`), Escape se escucha en `document` (el foco no está atrapado y puede haber salido de la caja), el `closeLabel` por defecto es "Cerrar" en vez de "Listo" (es un descarte, no una confirmación) y el "×" se llama "Cerrar diálogo" y no "Cerrar panel", para que no tenga el mismo nombre accesible que el botón del pie. CSS: `.ds-modal-overlay--dialog` centra y `.ds-modal--dialog` fija 520px de ancho (entran los rótulos largos de Vehículo a dos columnas), alto según contenido con tope en 85vh, radio grande y la sombra de los desplegables; las medidas internas del panel no cambian.
- **`DetailList`** (`design-system/DetailList.tsx`): recibe `sections: { heading?, items: { label, value }[] }[]` y dibuja un `<dl>` por sección con un `<h3>` cuando hay título; `null`/`undefined`/`""` se muestran como "—" **acá, una sola vez**, para que ningún listado repita el fallback campo por campo (0 y `false` no son vacío). Los helpers puros van en `detailFormat.ts` aparte (`EMPTY_VALUE`, `yesNo` para los checkboxes del formulario, `formatDateTime` = el `toLocaleString()` que ya usaban Actividades y la tarjeta "Registro" de Vehículo), mismo criterio que `currencyFormat.ts` junto a `CurrencyInput`. CSS: bloque "DetailList" en `design-system.css`, rótulos con el trato de `.ds-field-label`, grilla de dos columnas con `display: contents` por fila y `white-space: pre-line` en el valor (las notas y la descripción pública conservan sus saltos de línea).
- **Vehículo en archivo aparte** (`features/vehicle/VehicleDetail.tsx`): nueve secciones, las tarjetas de `VehicleFormPage` en el mismo orden y con los mismos rótulos (`fieldLabel`), "Consignación" solo con origen Consignación y "Detalle de la garantía" solo con "Otra", como el formulario. Importes con el `formatAmount` de `CurrencyInput` ("25.000,00") y kilometraje con el de `IntegerInput`; fechas de solo día con el `formatDate` de Oportunidades; "Multimedia" muestra la portada del listado (`coverPhotoUrl`) como referencia, no la galería. Los otros nueve listados definen sus secciones en línea en el propio `*ListPage.tsx` (entre dos y trece campos, no ameritan archivo).
- **QR** entra en la unión `Dialogo` existente (`{ kind: "detalle"; qr }`) en vez de un `useState` con el id aparte: la pantalla ya tenía cuatro diálogos con ese mecanismo y un quinto con otro sería dos formas de hacer lo mismo. Ítem con ícono `Info` de `lucide-react`, como el resto de las acciones de esa fila.
- **Resoluciones compartidas:** donde la columna resolvía un nombre con una expresión en línea (Owner en Empresas y Contactos, Empresa en Contactos, Vendedor en Vehículos) esa expresión pasó a una función local del componente (`nombreDePropietario`, `nombreDeEmpresa`, `nombreDeVendedor`) que usan la columna y el detalle: una sola verdad de qué se muestra cuando falta el dato.

**Tests (hecho):** `Modal.test.tsx` gana un bloque `variant=dialog` (cierre por overlay pero no por click adentro, cierre por Escape, nombres "Cerrar diálogo"/"Cerrar", y una regresión explícita de que el panel sigue sin cerrarse por gesto y sin las clases nuevas). `DetailList.test.tsx` nuevo (secciones y `<dl>`, sin título, vacíos como "—" con 0 como no-vacío, `yesNo`, `formatDateTime`). Cada una de las diez `*ListPage.test.tsx` gana un test §28 que abre el menú, afirma que "Ver detalle" es el primer ítem, lo elige, verifica en el `dialog` los datos esperados (relaciones por nombre, Badges por clase, importes formateados, sin `input/select/textarea` adentro, sin ids crudos) y lo cierra con "×" y con Escape; Empresas y Vehículos cuentan además que no hubo GET del registro, Oportunidades que la unidad se pide recién al abrir. Fuentes y Vehículos tienen un segundo test para la sección/fila condicional ausente. En `QrListPage.test.tsx` las dos listas exactas de ítems del menú (ADMIN y USER) pasan a empezar con "Ver detalle". Suite completa del frontend: 114 archivos, 1094 tests.

---

## 29. Confirmación del admin sobre las tareas que el asignado marca como hechas

**Estado:** hecho

**Contexto:** Hoy "completada" es un solo campo (`completedAt: DateTime?` en el modelo `Activity`). El asignado tilda su propia tarea en "Mis tareas" (`PATCH /activities/:id { completedAt }`, la única escritura que no es ADMIN-only — `canSelfServiceCompleteActivity` en `activity.service.ts`) y queda completada sin que nadie más intervenga. Se quiere que ese tilde no sea la palabra final: la tarea queda "pendiente de confirmar" hasta que un ADMIN la confirme.

**Comportamiento deseado:**

1. El asignado (USER o ADMIN) tilda su tarea en "Mis tareas", igual que hoy.
2. La tarea NO se da por terminada todavía: queda en un estado "pendiente de confirmar". En "Mis tareas" del propio asignado, en vez de desaparecer de la lista, pasa a un bloque nuevo "Esperando confirmación" (grisada, sin checkbox — ya no hay nada que tildar) hasta que un ADMIN actúe.
3. Un ADMIN ve las tareas pendientes de confirmar en la pantalla "Actividades" (`ActivityListPage`, ya es ADMIN-only) y tiene dos acciones nuevas en el menú de 3 puntos: **"Confirmar"** (la tarea queda definitivamente completada) y **"Rechazar"** (la tarea vuelve a pendiente — como si nunca se hubiera tildado — y reaparece en "Mis tareas" del asignado, en sus bloques normales por vencimiento, no en "Esperando confirmación").
4. Recién con "Confirmar" la tarea desaparece de "Mis tareas" del asignado.

**Decisiones ya tomadas:**

- **Tres estados posibles, no dos:** pendiente (sin completar) → pendiente de confirmar (completada, sin confirmar) → confirmada. "Rechazar" vuelve directo al primer estado, no es un cuarto estado.
- **Solo el ADMIN confirma o rechaza.** Cualquier ADMIN de la organización, no necesariamente quien creó/asignó la tarea — mismo criterio que ya existe hoy (un ADMIN puede editar o borrar cualquier actividad, no solo las que creó él).
- **"Confirmar" y "Rechazar" solo se ofrecen mientras la tarea está en "pendiente de confirmar"** (completada y sin confirmar todavía). Una vez confirmada, ninguna de las dos aparece — si hace falta revertir una confirmación ya hecha, es edición manual de la actividad (el ADMIN ya puede tocar cualquier campo), no está en el alcance de este ítem.
- **Cuando el ADMIN marca una tarea como completada directamente** (el campo "Completada" de `ActivityFormPage`, no el flujo de "Mis tareas"), **queda confirmada automáticamente en el mismo momento** — no tiene sentido pedirle al mismo ADMIN que se autoconfirme. Esto aplica solo a la transición de sin-completar a completada hecha por un ADMIN; no revalida nada si el ADMIN edita otro campo de una actividad que ya estaba completada.
- **El asignado NO puede destildar su propia tarea una vez tildada.** Hoy la regla de self-service permite `PATCH { completedAt }` sin mirar el valor actual (podría poner `null` para destildar). Con confirmación de por medio, eso dejaría que el asignado revierta una tarea que ya está esperando revisión. Pasa a permitirse SOLO cuando la actividad todavía no está completada (transición pendiente → completada). Para deshacer un tilde por error, la vía es que el ADMIN la rechace.
- **Si se rechaza o se revierte una tarea, la confirmación se borra con ella.** No puede quedar una tarea "confirmada" con `completedAt` en null — es una invariante que el service tiene que garantizar en cualquier camino de escritura, no solo en el nuevo.

**Cómo se implementa:**

**Schema** (`prisma/schema.prisma`, modelo `Activity`): dos columnas nuevas, nullable, mismo patrón que `assigneeId`/`assignee`:
- `confirmedAt DateTime? @map("confirmed_at")`
- `confirmedById String? @map("confirmed_by_id") @db.Uuid`
- relación `confirmedBy User? @relation("ActivityConfirmedBy", fields: [organizationId, confirmedById], references: [organizationId, id], onDelete: NoAction)` — mismo criterio que la relación `assignee` (FK compuesta por organización, `onDelete: NoAction` para no perder el rastro de auditoría si se borra el usuario).

Generá la migración corriendo `npx prisma migrate dev` contra tu stack local de Docker (confirmá antes que `DIRECT_URL`/`DATABASE_URL` apuntan a `127.0.0.1`, nunca a producción — el mismo chequeo de siempre). Nombrá la migración algo como `activity_confirmation`. Después corré la cadena completa de `scripts/apply-manual-sql.ts` si hace falta reaplicar `manual_constraints.sql`/`rls_policies.sql` — activities ya tiene RLS por organización, revisá si necesita algo nuevo (no debería, son columnas nullable sin relación con el aislamiento por organización, pero confirmalo vos mismo mirando el archivo).

**Backend — `src/services/activity.service.ts`:**

- `canSelfServiceCompleteActivity`: hoy recibe `activity: { assigneeId }`. Pasa a recibir también `completedAt`, y la condición de self-service pasa a ser: `onlyCompletedAt && activity.assigneeId === actor.userId && activity.completedAt === null` — el `=== null` es lo nuevo: un USER solo puede completar, nunca destildar, su propia tarea.
- `UpdateActivityInput` gana un campo `confirmed?: boolean` — NO agregues `confirmedAt`/`confirmedById` como campos que el cliente pueda mandar directamente (mismo criterio que `authorId`, que ya está deliberadamente afuera de `CreateActivityInput`: que sea imposible que un valor del cliente pise quién confirmó o cuándo). `confirmed` es un campo "de acción", no un dato que se guarda tal cual.
- En `updateActivity`, después de la autorización de siempre: si el body trae `confirmed`, es una rama aparte que requiere `actor.role === "ADMIN"` explícito (defensa en profundidad, aunque ya no debería llegar ahí un USER: el campo `confirmed` no es `completedAt`, así que `canSelfServiceCompleteActivity` ya lo rechaza antes por no ser "solo completedAt"):
  - `confirmed: true` ("Confirmar"): requiere `activity.completedAt !== null` (si no, 400 "no se puede confirmar una actividad que no está completada") y `activity.confirmedAt === null` (si no, 400 "ya está confirmada" — evita doble-confirmación). Si pasa, poné `confirmedAt = new Date()` y `confirmedById = actor.userId`, calculados en el server — nunca tomados del body.
  - `confirmed: false` ("Rechazar"): requiere `activity.completedAt !== null` (si no, 400 "no hay nada que rechazar"). Si pasa, poné `completedAt = null`, `confirmedAt = null`, `confirmedById = null`.
- Auto-confirmación del ADMIN: cuando el body trae `completedAt` (el campo normal, no `confirmed`) con un valor no nulo, la actividad actual tenía `completedAt === null`, y `actor.role === "ADMIN"` → además de `completedAt`, seteá `confirmedAt = new Date()` y `confirmedById = actor.userId` en la misma escritura.
- Invariante en cualquier camino: si el `completedAt` final (después de aplicar el input) queda en `null`, forzá `confirmedAt`/`confirmedById` a `null` también, sea cual sea el camino que lo produjo (edición manual del ADMIN limpiando el campo, o el rechazo de arriba).

**Backend — filtros de listado:** `ListActivitiesParams`/`listQuerySchema` (controller) ganan `confirmed?: boolean` (mismo patrón que el `completed` que ya existe: `true` → `confirmedAt not null`, `false` → `confirmedAt null`), combinable con `completed`. Es lo que arma la cola de "pendientes de confirmar" (`completed=true&confirmed=false`) y lo que "Mis tareas" va a usar (ver abajo).

**Frontend — `ActivityListPage.tsx`:**
- Nueva columna "Confirmación" (al lado de "Completada"): `Badge` — "—" (variant neutral) si no está completada, "Pendiente de confirmar" (variant info) si está completada y sin confirmar, "Confirmada" (variant success) si está confirmada.
- `ActionsMenu` de cada fila gana "Confirmar" y "Rechazar", visibles SOLO cuando `completedAt !== null && confirmedAt === null` — van después de "Ver detalle" y antes de "Editar" (son acciones de flujo de trabajo, entre la de consulta y las de edición/borrado).
- El pop up "Ver detalle" (§28, `DetailList`) gana los campos "Confirmación" (mismo Badge de la columna), y si está confirmada, "Confirmada por" (nombre, resuelto igual que Autor/Asignado — no el UUID) y "Fecha de confirmación".
- Nuevo filtro en la fila de filtros: selector "Confirmación" con "Todas" / "Pendiente de confirmar" / "Confirmada", que arma `completed`+`confirmed` según corresponda (solo tiene sentido combinado con completadas, así que "Pendiente de confirmar" y "Confirmada" mandan `completed=true` implícito).

**Frontend — `MyTasksPage.tsx`:**
- `useMyPendingActivities` (`queries.ts`) cambia el filtro de `completed: false` a `confirmed: false` — trae tanto lo no completado como lo completado-sin-confirmar (antes solo traía lo primero).
- `taskBuckets.ts`: nuevo bucket `AWAITING_CONFIRMATION` ("Esperando confirmación"), al FINAL de `TASK_BUCKET_ORDER` (después de `NO_DATE`) — no son tareas por vencer, son tareas ya hechas esperando revisión, menos urgentes que lo que sigue pendiente. `bucketFor()` no cambia (sigue siendo una función pura sobre `dueDate`, con su propio test): la elección de bucket para una tarea con `completedAt` no nulo se decide en el punto de armado de los grupos en `MyTasksPage.tsx` (`completedAt ? "AWAITING_CONFIRMATION" : bucketFor(dueDate, now)`), no dentro de `bucketFor`.
- Las filas del bloque "Esperando confirmación" no llevan checkbox (ya no hay nada que tildar): en su lugar, un indicador visual de que está esperando (grisado, mismo criterio de opacidad/color mutado que ya usa el resto del design system para estados neutros). La columna de la derecha muestra "Completada el <fecha>" en vez del vencimiento.
- El truco de `completedIds` que hoy hace desaparecer la fila al tildar (remoción optimista del array en memoria) ya no es correcto: la fila tiene que QUEDAR, solo que cambia de bloque. Reemplazalo por una actualización optimista del `completedAt` de esa tarea en la cache de TanStack Query (`queryClient.setQueryData`), así el agrupamiento la reubica solo en el próximo render, sin sacarla de la lista.

**Tests:**
- Backend: `activity.service.test.ts` gana casos de `canSelfServiceCompleteActivity` (ya no permite destildar), de `confirmed: true`/`false` (éxito, los dos 400 de guarda, que un USER con `confirmed` en el body sigue dando 403), de la auto-confirmación del ADMIN, y de la invariante (limpiar `completedAt` a mano también limpia `confirmedAt`/`confirmedById`). Un test de integración real (server levantado) que cubra el flujo completo: USER completa → queda sin confirmar → ADMIN confirma → USER ya no la ve en "Mis tareas".
- Frontend: `ActivityListPage.test.tsx` gana los Badges de "Confirmación", las dos acciones nuevas del menú (visibles/ausentes según estado) y el filtro nuevo. `MyTasksPage.test.tsx` gana el bloque "Esperando confirmación" (aparece al tildar, sin checkbox, con la fecha de completada) y que desaparece de verdad recién cuando el backend confirma (mockeable simulando el PATCH de confirmación en un segundo fetch). `DetailList` de Actividades en `ActivityListPage.test.tsx` gana los campos de confirmación.

**Hallazgos al implementar (la lista de arriba, verificada contra el código):**

- **`npx prisma migrate dev` no se puede usar en este repo** (la shadow database no tiene el schema `auth`, es el mismo motivo por el que ninguna migración se genera así desde 20260821): la migración `20260914120000_activity_confirmation` está escrita a mano con el molde de las anteriores y aplicada en local con `npm run migrate:deploy` (migración + `manual_constraints.sql` + `rls_policies.sql`). `verify:schema` pasa 14/14: la FK nueva entra sola en la fila 14 (C-3, chequeo estructural) porque copia exactamente a `assignee_id` (compuesta por organización, `MATCH SIMPLE`, `ON DELETE NO ACTION`, `ON UPDATE CASCADE`). **RLS: nada nuevo**, confirmado leyendo `rls_policies.sql`: `activities_isolation` es `for all using/with check (organization_id = current_organization_id())`, cubre todas las columnas de la fila. Sin índice sobre `confirmed_by_id` (nada filtra por quién confirmó) y sin CHECK "confirmada implica completada": la invariante la sostiene el service, única puerta de escritura, y cada CHECK manual entra a los contadores de `verify:schema` (misma decisión que `warranty_other`, §22). **Sin backfill:** las tareas completadas antes de este cambio quedan como "pendiente de confirmar", que es exactamente lo que son (nadie las revisó), y se resuelven una por una desde "Actividades".
- **Producción sigue sin esta migración** hasta correr `migrate:deploy` contra prod después del merge, igual que las anteriores.
- **El backend no distingue "el ADMIN tildó desde Mis tareas" de "el ADMIN completó desde el formulario":** los dos son `PATCH { completedAt }`. La regla de auto-confirmación se aplica tal cual está escrita arriba (ADMIN + `completedAt` no nulo + la fila no estaba completada), así que **un ADMIN que tilda su propia tarea en "Mis tareas" queda confirmado en el acto y la fila desaparece sin pasar por "Esperando confirmación"**. Es coherente con la decisión ("no tiene sentido pedirle al mismo ADMIN que se autoconfirme") y "Mis tareas" lo contempla: la respuesta del PATCH manda sobre la cache y una fila ya confirmada no se muestra ni un render.
- **`confirmed` y `completedAt` en el mismo body es 400** ("confirmed no se combina con completedAt en el mismo PATCH"). No estaba previsto arriba; sin la guarda, `{ confirmed: true, completedAt: null }` habría dado una actividad confirmada-y-limpiada-en-el-mismo-paso cuyo resultado dependía del orden interno. Ningún caller manda las dos; se rechaza para que la ambigüedad no exista.
- **La invariante solo actúa cuando la escritura toca `completedAt`.** Un PATCH que edita otro campo (asunto, relaciones) no escribe nada sobre `confirmedAt`/`confirmedById`: la fila ya cumple la invariante por construcción y así la regla devuelve solo lo que cambia (y no pisa en silencio una confirmación al editar un asunto).
- **Un USER mandando `completedAt: null` sobre una tarea todavía pendiente sigue pasando**: la regla nueva mira la fila (`completedAt === null`), no el valor del body, y ese caso es un no-op, no una reversión. Se dejó así a propósito y con test, en vez de agregar una segunda condición sobre el valor.
- **"—" dos veces por fila en "Actividades":** la columna "Confirmación" muestra "—" para una tarea sin completar, y las columnas de relaciones también usan "—" como fallback. Dos tests existentes (`getByText("—")` sobre la fila) pasaron a mirar la celda concreta.
- **`confirmedById` no se resuelve en "Mis tareas"** (esa página nunca pide `GET /api/users`, ni para USER ni para nadie, y el asignado no necesita saber quién lo confirmará): solo "Actividades" lo muestra, en el detalle.

**Decisiones tomadas al implementar:**

- **Backend, `resolveConfirmationPatch(actor, activity, { completedAt, confirmed }, now)`** (`activity.service.ts`): toda la lógica de Confirmar/Rechazar/auto-confirmación/invariante vive en una función pura exportada, con `now` inyectable, que devuelve SOLO las columnas de completado/confirmación a escribir además del resto del input, o lanza el `AppError` correspondiente. `updateActivity` la llama después de `canSelfServiceCompleteActivity` y antes de validar relaciones (un 400 de confirmación no toca la base). Mismo criterio que `canSelfServiceCompleteActivity`/`scopeActivityFiltersToActor`: la regla sensible se prueba sola sin base (matriz completa en `activity.service.test.ts`), y con filas reales se prueba que el service la aplica. `confirmed` se separa del input con destructuring antes de armar `data` (tipado como `UpdateActivityData` del repositorio, que ganó `confirmedAt`/`confirmedById`): nunca llega al `updateMany` como columna.
- **Repositorio:** `ActivityFilters.confirmed` con el mismo spread que `completed`; el controller lo parsea con el mismo `z.enum(["true","false"])` (nunca `z.coerce.boolean()`), y `confirmed: z.boolean().optional()` en `updateActivitySchema` (claves desconocidas como `confirmedAt`/`confirmedById` en el body las descarta Zod, verificado por HTTP).
- **Frontend, `confirmationStatusOf()`** en `activity/types.ts`: una sola definición de los tres estados (`NOT_COMPLETED` / `AWAITING_CONFIRMATION` / `CONFIRMED`) para la columna, el filtro, las acciones del menú y el detalle. El Badge y su texto/variant salen de un único mapa `CONFIRMATION_BADGE` en `ActivityListPage.tsx`, reutilizado por la columna y el detalle.
- **`useConfirmActivity()`** en `mutations.ts`, mismo esquema de id-por-llamada que `useCompleteActivity`, body SOLO `{ confirmed }`. El error de Confirmar/Rechazar se muestra con la acción que falló ("No pudimos confirmar/rechazar la actividad: …"), leyendo `mutation.variables`.
- **`taskBuckets.ts`:** `bucketFor` pasa a devolver `DueDateBucket = Exclude<TaskBucket, "AWAITING_CONFIRMATION">`, así el tipo documenta que ese bloque nunca sale de ahí. Se agrega `formatTaskCompletedAt(completedAt, now)` ("Completada hoy, 11:00" / "Completada el jue 3 sep, 11:00"), reusando `formatTaskDueDate` para que las dos columnas se lean igual.
- **Optimismo sobre la cache, no sobre una lista aparte:** `patchCached(id, patch)` en `MyTasksPage.tsx` usa `queryClient.setQueriesData` con el prefijo `activityKeys.lists()`, que alcanza todas las páginas que `useMyPendingActivities` tenga abiertas. Al tildar escribe `completedAt`; en `onSuccess` escribe la respuesta del server (así el ADMIN auto-confirmado sale en el acto); en `onError` vuelve `completedAt` a `null`. La página filtra `confirmedAt === null` sobre lo que haya en cache como defensa: lo confirmado no se muestra ni un render mientras llega el refetch que el hook dispara igual.
- **Pie de "Mis tareas":** "N tareas pendientes" cuenta solo las sin tildar; si hay tareas esperando, agrega " · M esperando confirmación". Sin tareas esperando, el texto es idéntico al de antes.
- **CSS:** `.ds-task-row--awaiting` (opacidad 0.55, la misma de `button:disabled`) y `.ds-task-awaiting-mark` (un círculo relleno y mutado del tamaño del checkbox, para que la columna de la izquierda siga alineada). El comentario del checkbox circular deja de decir que la fila "se va".
- **Comentarios que decían "tildar o destildar"** en `activity.routes.ts`, `activity.service.ts`, `mutations.ts` y el test de integración se corrigieron; el `completed=false` de "Mis tareas" citado en el §25 del service y en `router.tsx` pasa a `confirmed=false`. El texto del §25 de este documento queda como historia.

**Tests (hecho):** backend `activity.service.test.ts` (regla de self-service con `completedAt` en la fila: no destildar, `confirmed` siempre `false` para USER, el no-op de `completedAt: null` sobre pendiente; matriz de `resolveConfirmationPatch`: confirmar, doble confirmación 400, rechazar, rechazar sin completar 400, USER 403, combinación con `completedAt` 400, auto-confirmación ADMIN y no-USER, sin efecto sobre una ya completada, invariante), `activity.service.integration-test.ts` (USER completa y queda sin confirmar; destildar 403 sin escribir; ADMIN confirma con `confirmedById` del actor y no dos veces; rechaza y el USER vuelve a tildar; 400 sobre no completada; USER con `confirmed` 403; auto-confirmación y edición posterior que no la toca; invariante al limpiar a mano; los tres filtros `confirmed`), `activity.controller.integration-test.ts` (flujo completo por HTTP con JWT reales: USER completa → sigue en `confirmed=false` → no puede destildar ni confirmar → cola del ADMIN → ADMIN confirma con `confirmedById` del JWT, aunque el body intente colar `confirmedAt`/`confirmedById` → doble confirmación 400 → desaparece de "Mis tareas"; y el rechazo por HTTP). Frontend: `ActivityListPage.test.tsx` (los tres Badges con su variant, Confirmar/Rechazar solo en la fila que espera y en la posición pedida con sus PATCH, error de Confirmar, el filtro con sus tres combinaciones de query, el detalle con "Confirmada por" por nombre y "Fecha de confirmación" solo si está confirmada), `MyTasksPage.test.tsx` (tildar mueve la fila a "Esperando confirmación" sin checkbox y con "Completada hoy"; una ya tildada al cargar aparece ahí grisada con "Completada el …"; sobrevive al refetch tras el PATCH y desaparece recién cuando el server la devuelve confirmada; el ADMIN auto-confirmado desaparece en el acto; el fallo del PATCH la devuelve a su bloque), `taskBuckets.test.ts` (orden con el bloque nuevo al final, `bucketFor` nunca lo devuelve, `formatTaskCompletedAt`), `api.test.ts` (`confirmed` viaja como "true"/"false") y `mutations.test.tsx` (`useConfirmActivity` manda solo `{ confirmed }` e invalida lo mismo que el resto). Suites completas: backend 725 unitarios + 687 de integración; frontend 116 archivos, 1116 tests.

## 30. Dashboard comercial: KPIs en $, tendencia mensual, "Recent deals", "Top deals" y feed de actividad

**Estado:** hecho

**Contexto:** El Dashboard actual (M8) muestra únicamente conteos exactos por status de Opportunity (`OpportunitySummaryCards`: abiertas/ganadas/perdidas, vía `pagination.total`) y conteos por etapa (`PipelineStageSummary`), con un comentario explícito en ambos archivos y en `dashboard/queries.ts` diciendo que no hay `amount`, win rate ni forecasting "porque ninguna de esas es category A con el contrato actual del backend" (no existe ningún endpoint de SUM/agregado, solo listados). Rocco compartió dos capturas de un dashboard de referencia ("Fairview CRM": 4 KPI en fila con $ y variación vs. mes anterior, un gráfico de línea "Pipeline overview", una tabla "Recent deals", una lista "Top deals" con barras proporcionales al monto, y un feed de "Activity") y pidió que el Dashboard de este CRM tenga esa MISMA distribución de estadísticas — el pedido es sobre el layout/la información mostrada, no sobre el tema visual oscuro del mockup: este ítem se implementa dentro del design system actual (claro), sin reskin.

**Comportamiento deseado:** Fila de 4 KPI comerciales con montos reales y variación porcentual vs. el mes anterior, un gráfico de ingresos por mes, una tabla de operaciones recientes, un ranking de las de mayor monto, y un feed de actividad reciente — todo con datos reales del backend, sin inventar ningún número.

**Decisiones ya tomadas (confirmadas con Rocco):**
- Alcance: se construyen las 4 piezas — KPIs+variación, "Recent deals", "Top deals", feed de actividad. Las 4 elegidas explícitamente por Rocco.
- El gráfico de línea "Pipeline overview" del mockup (valor del pipeline día a día) NO se construye tal cual: no existe ninguna tabla de historial de Opportunity/Stage (solo `VehicleChangeLog`, de otro módulo) y por lo tanto no hay forma de saber "cuánto valía el pipeline" en una fecha pasada. Rocco eligió reemplazarlo por un gráfico que sí es real hoy.
- Los totales en $ (Pipeline Value, Won This Month) se calculan SOLO en la moneda preferida de la organización (`organization.preferredCurrency`, o `"USD"` si no está configurada) — Rocco lo eligió así, sabiendo que hay oportunidades que pueden estar en otra moneda (currency es libre por oportunidad, sin validación que fuerce una sola por organización) y que esas quedan afuera de los totales en $. Nota para quien lea esto más adelante: esto es DISTINTO del criterio que ya usa `formatAmountTotals` (`frontend/src/features/opportunity/format.ts`), que sí agrupa y muestra un total por cada moneda presente en vez de descartar las que no coinciden — ahí la razón documentada es "sumar 1500 USD con 300 ARS en un solo número sería un dato inventado". Acá se decidió lo contrario a propósito, por simplicidad de las cards de KPI (un solo número grande), no por desconocimiento de ese precedente.

**Decisiones de implementación (mías, con un default razonable y reversible — avisar si se quiere otra cosa):**
- **Reemplazo del gráfico de línea:** "Ingresos ganados por mes" — `SUM(amount)` de oportunidades `WON` cuyo `actualCloseDate` cae en cada uno de los últimos 6 meses calendario (incluyendo el actual), en la moneda de la organización. Es un dato 100% real (no una reconstrucción de historial), y sirve al mismo propósito visual del original (una tendencia de ingresos en el tiempo).
- **Variaciones ("+X% vs mes anterior") de Open Deals y Pipeline Value:** NO se calculan reconstruyendo "cuántas estaban abiertas hace un mes" — verificado en `opportunity.service.ts` que `UpdateOpportunityInput.status` no tiene ninguna guarda que impida que un ADMIN revierta una oportunidad ganada/perdida de vuelta a `OPEN` vía PATCH (`status` es un campo libre en el update), así que cualquier reconstrucción basada en "asumir que status solo avanza" sería potencialmestrictamentente incorrecta. En cambio, la variación de estas dos cards se calcula sobre oportunidades CREADAS en el período (`createdAt`, que es inmutable), no sobre el estado actual reconstruido:
  - Open Deals: card grande = `COUNT(status=OPEN)` ahora mismo. Variación = `COUNT(createdAt en este mes)` vs `COUNT(createdAt en el mes anterior)` — mostrar como "+N nuevas oportunidades vs. mes anterior", NO como si fuera literalmente "oportunidades abiertas hace un mes" (sería un dato que no se puede saber con certeza).
  - Pipeline Value: card grande = `SUM(amount)` de las `OPEN` en la moneda de la organización, ahora mismo. Variación = `SUM(amount)` de las CREADAS este mes vs las creadas el mes anterior (en la moneda de la organización, sin filtrar por status actual) — mostrar como "+X% en valor nuevo vs. mes anterior".
  - Won This Month: card grande = `SUM(amount)` de `WON` con `actualCloseDate` en el mes actual. Variación = mismo cálculo para el mes anterior. Sin las salvedades de arriba: es una comparación limpia entre dos períodos cerrados.
  - Win Rate: `WON / (WON + LOST)` entre las oportunidades cuyo `actualCloseDate` cae en el mes actual (no all-time). Variación = mismo cálculo para el mes anterior, mostrada en PUNTOS PORCENTUALES ("+7 pts"), no en variación relativa, para no confundirla con las variaciones en $ de las otras cards. Si el denominador de un período es 0 (nada cerrado ese mes), mostrar "—" en vez de dividir por cero.
- **Límites de mes:** calculados en UTC en el backend (el servidor no conoce la zona horaria de quien mira, y es una aproximación del mismo tipo que ya usa el codebase en otros lugares — ver el comentario de `[now] = useState(...)` en `ActivityListPage.tsx`). Documentar esto en el código nuevo con un comentario, no dejarlo implícito.
- **Sin dependencia nueva de gráficos:** el gráfico de "Ingresos por mes" se hace con un `<svg>` a mano (polyline sobre los 6 puntos, escalado al máximo de la serie), mismo espíritu que las barras de `.ds-meter-fill` que ya existen en `PipelineStageSummary` — no se agrega `recharts` ni ninguna librería nueva (el frontend hoy no tiene ninguna). Reversible si más adelante se prefiere una librería real.
- **"Deal ID" del mockup:** Opportunity no tiene ningún código legible por humanos (a diferencia de Vehicle, que sí tiene `internalCode`/stock number) — la tabla "Recent deals" NO inventa un ID: usa la columna "Título" en su lugar, que es un dato real.
- **"Top deals":** reutiliza exactamente las clases `.ds-meter-list`/`.ds-meter`/`.ds-meter-track`/`.ds-meter-fill` que ya usa `PipelineStageSummary` para las barras proporcionales — mismo patrón visual, sin CSS nuevo para las barras. Filtra por la moneda de la organización (mismo criterio que Pipeline Value, para que las barras sean proporcionalmente correctas) — lee esa moneda del resultado de `useDashboardSummary()` en vez de pedirla de nuevo.
- **Feed de actividad:** lista las últimas 8 actividades (`GET /api/activities?sortBy=createdAt&sortOrder=desc&pageSize=8`), CON el mismo scoping que ya existe (§25: un USER solo ve las suyas, un ADMIN las ve todas) — sin ningún cambio de autorización en el backend. Reutiliza EXACTAMENTE los hooks de resolución de nombres que ya usa `ActivityListPage.tsx` (`useCompaniesByIds`, `useContactNames`, `useOpportunityNames`, `useOwnerNames`) — no se inventa una segunda forma de resolver nombres. Muestra tipo (reutilizando `ACTIVITY_TYPE_LABELS`), asunto, a quién/qué está relacionada, y el timestamp absoluto vía el mismo criterio de formato que ya existe (no se agrega un formateador de tiempo relativo nuevo).
- **"Oportunidades perdidas" como card separada desaparece:** hoy `OpportunitySummaryCards` tiene 3 cards (abiertas/ganadas/perdidas). El mockup tiene 4 (Open/Pipeline Value/Won/Win Rate). Se reemplaza el componente completo por las 4 nuevas — el conteo de "perdidas" ya no tiene su propia card (esa señal ahora vive adentro del denominador de Win Rate). Avisar si se prefiere mantenerla como una 5ta card.
- **Layout final de `DashboardPage.tsx` (de arriba a abajo):** `VehicleSummaryCards` (sin cambios) → fila de 4 KPI comerciales nuevos → `RevenueByMonthChart` (ancho completo) → `.ds-card-grid` con `RecentDealsTable` + `TopDealsList` → `.ds-card-grid` con `PipelineStageSummary` (sin cambios) + `ActivityFeed` → `QuickActions` (sin cambios).

**Cómo se implementa:**

*Backend:*
- Nuevo endpoint `GET /api/opportunities/dashboard-summary` en `opportunity.routes.ts` — `authenticate` solamente (sin `authorize`, mismo criterio que el resto de lecturas de Opportunity: cualquier usuario autenticado de la organización). **Importante:** declararlo ANTES de `GET /opportunities/:id` en el router, si no Express va a intentar matchear `"dashboard-summary"` como si fuera un `:id`.
- Nueva función en `opportunity.service.ts`: `getDashboardSummary(organizationId, { now = new Date() }: { now?: Date } = {})`, con `now` inyectable (mismo patrón que `resolveConfirmationPatch` en `activity.service.ts`, para poder testear los límites de mes sin depender del reloj real). Lee `organization.preferredCurrency` (fallback `"USD"`) y calcula, con `prisma.opportunity.count`/`aggregate` (`_sum: { amount: true }`) filtrados siempre por `organizationId`, `deletedAt: null` y `currency`:
  - `openCount` (status=OPEN, sin filtro de moneda — es un conteo, no un monto)
  - `openValue` (SUM amount, status=OPEN, currency=orgCurrency)
  - `createdThisMonth` / `createdLastMonth`: count Y sum(amount, currency=orgCurrency) de oportunidades con `createdAt` en cada mes
  - `wonThisMonth` / `wonLastMonth`: sum(amount, currency=orgCurrency, status=WON, actualCloseDate en el mes)
  - `wonCountThisMonth`/`lostCountThisMonth`/`wonCountLastMonth`/`lostCountLastMonth`: count por status con `actualCloseDate` en el mes correspondiente (para Win Rate)
  - `revenueByMonth`: 6 queries en paralelo (`Promise.all`), una por cada uno de los últimos 6 meses calendario (actual incluido), cada una un `aggregate` de WON con `actualCloseDate` en ese mes — mismo estilo de "N queries en paralelo, una por bucket" que ya usa `useDefaultPipelineStageSummary` en el frontend (acá es en el backend, pero mismo espíritu: sin `$queryRaw`, sin `date_trunc`, evitando SQL crudo).
  - Devolvé los montos como Decimal serializado a string (mismo criterio que el resto de la API — nunca `Number` en la respuesta JSON), y `currency` explícito en la respuesta para que el frontend no tenga que adivinar.
- Helpers de fecha: `startOfMonthUTC(date)` / `startOfNextMonthUTC(date)` / mes anterior — nuevos, puros, testeables solos, viven en `opportunity.service.ts` o en un archivo de utilidad si preferís seguir el patrón de `taskBuckets.ts`.
- Controller `getDashboardSummaryHandler` en `opportunity.controller.ts`: sin query params (el rango de 6 meses es fijo), llama al service, devuelve JSON.
- **Actualizar los comentarios que quedan desactualizados** ahora que SÍ hay SUM: el comentario de `OpportunitySummaryCards.tsx`, el de `useOpportunitySummary` en `dashboard/queries.ts`, y el de `DashboardPage.tsx` que dicen "el backend no soporta SUM" — corregirlos para que no queden mintiendo (mismo criterio que §29 corrigiendo comentarios de "tildar o destildar"). El comentario de `VehicleSummaryCards.tsx` sobre el stock de vehículos NO se toca — sigue siendo cierto, este ítem no agrega SUM de Vehicle.

*Frontend:*
- `frontend/src/features/dashboard/queries.ts`: nuevo hook `useDashboardSummary()`, un solo `useQuery` sin filtros (`["dashboard", "summary"]` como queryKey — no hace falta una key factory nueva, es un solo endpoint) contra el nuevo `GET /opportunities/dashboard-summary`. Las variaciones porcentuales/en puntos y el manejo de "—" cuando el período anterior es 0 se calculan en el FRONTEND a partir de los números crudos que devuelve el backend (mismo criterio que `StatusCount`/`DefaultPipelineStageSummary`: el backend manda datos, el frontend decide formato).
- Reemplazar `OpportunitySummaryCards.tsx` por un componente nuevo con las 4 cards (Open Deals, Pipeline Value, Won This Month, Win Rate), cada una con label + valor grande + una línea chica de variación (verde con `--color-success` si es positiva, roja con `--color-danger` si es negativa, gris/neutral si no hay dato del período anterior). CSS nuevo: `.ds-kpi-delta`, `.ds-kpi-delta--up`, `.ds-kpi-delta--down`, `.ds-kpi-delta--neutral`.
- Nuevo `RevenueByMonthChart.tsx`: SVG a mano con los 6 puntos de `revenueByMonth`, eje X con abreviaturas de mes (mismo array `MONTHS` que ya existe en `taskBuckets.ts`, no lo dupliques — importalo o replicá el mismo criterio si no se puede importar entre features).
- Nuevo `RecentDealsTable.tsx`: reutiliza el componente `Table` del design system, columnas Título/Empresa/Monto/Etapa (Badge — mismo `STATUS_BADGE_VARIANT` que ya usa `OpportunityListPage.tsx` para el status, no inventes una paleta nueva), query `listOpportunities({ sortBy: "createdAt", sortOrder: "desc", pageSize: 5 })`, resuelve nombres de empresa con el hook que ya existe.
- Nuevo `TopDealsList.tsx`: mismo patrón de `.ds-meter-list` que `PipelineStageSummary`, query `listOpportunities({ status: "OPEN", currency: <de useDashboardSummary().data.currency>, sortBy: "amount", sortOrder: "desc", pageSize: 5 })`.
- Nuevo `ActivityFeed.tsx`: como se describe arriba en "Decisiones de implementación".
- `DashboardPage.tsx`: reordenar según el layout final descripto arriba.

**Tests:**
- Backend: `opportunity.service.test.ts` gana casos de `getDashboardSummary` con `now` inyectado — límites exactos de mes (un `createdAt`/`actualCloseDate` justo en el borde), fallback a USD sin `preferredCurrency`, exclusión de otras monedas de los totales en $ (pero no del conteo `openCount`), Win Rate con denominador 0 → `null`/"—", `revenueByMonth` con exactamente 6 entradas en orden cronológico. Un test de integración real contra la base (`opportunity.service.integration-test.ts` o el archivo que corresponda) que arme oportunidades reales en distintos meses/monedas/status y verifique los números devueltos end to end, más aislamiento por organización (una oportunidad de otra organización nunca debe sumar acá).
- Frontend: un test por componente nuevo (`RevenueByMonthChart`, `RecentDealsTable`, `TopDealsList`, `ActivityFeed`, y el reemplazo de `OpportunitySummaryCards`) cubriendo loading/error/empty/success independientes entre sí (igual que el resto del Dashboard: que un componente falle no debe tumbar a los demás), formato de variación (positiva/negativa/sin dato anterior), y que `TopDealsList` espera la moneda de `useDashboardSummary` antes de pedir sus datos.

**Hallazgos al implementar:**

- **Los tests unitarios del backend no tocan la base, y el plan pedía probar bordes de mes sin reloj real.** Los `*.test.ts` de este repo son funciones puras (ver `opportunity.service.test.ts` antes de este ítem); para probar `getDashboardSummary` con `now` inyectado sin Postgres, la función recibe también `db?: Db` (el mismo tipo que ya usan los repositorios para participar de una transacción), y el test arma una "base en memoria" mínima que aplica el WHERE real (organizationId, `deletedAt: null`, status, currency y las ventanas `gte`/`lt`). Las llamadas a Prisma no viven en el service sino en `opportunity.repository.ts`, como el resto del módulo: `countOpportunitiesWhere` y `sumOpportunityAmount` reciben solo el recorte que cambia entre consultas y ponen ellos organizationId y `deletedAt: null`, así ninguna consulta puede olvidarse del aislamiento.
- **Los helpers de fecha quedaron en `src/utils/utcMonth.ts`** (`startOfMonthUTC`, `startOfNextMonthUTC`, `startOfPreviousMonthUTC`, `addMonthsUTC`, `monthKeyUTC`, `monthWindowUTC`, `lastMonthsUTC`), con su propio `utcMonth.test.ts` — la opción "archivo de utilidad" del plan. El comentario de cabecera explica por qué UTC y qué caso de borde implica (una oportunidad creada a las 22:00 de Montevideo el último día del mes cae en el mes siguiente).
- **`actualCloseDate` es `@db.Date`** (sin hora): la comparación `gte`/`lt` con instantes UTC funciona igual (verificado en el test de integración con un cierre el `2026-03-01`, que cae en marzo y no en febrero). Consecuencia que el plan no decía: una oportunidad WON **sin** `actualCloseDate` no entra en ningún mes — ni en "ganado este mes" ni en la serie ni en la tasa de cierre. En la práctica el formulario la carga al cerrar desde OPEN (§18), pero una ganada creada por API sin fecha queda fuera. Es coherente con "cerradas por mes de cierre" y no se inventa una fecha.
- **17 consultas en un solo `Promise.all`, no 19:** "ganado este mes" y "ganado el mes anterior" son exactamente las dos últimas entradas de la serie de 6 meses, así que se derivan de ahí en vez de pedirse otra vez. La respuesta real (`DashboardSummary` en el service, `OpportunityDashboardSummary` en el frontend) agrupa lo que el plan listaba suelto: `wonThisMonth`/`wonLastMonth` son `{ count, value }` (el `count` es el `wonCountThisMonth`/`wonCountLastMonth` del plan), `lostCountThisMonth`/`lostCountLastMonth` van planos, `createdThisMonth`/`createdLastMonth` son `{ count, value }`, y `revenueByMonth` es `[{ month: "YYYY-MM", value }]`. Los montos son string con dos decimales (`Decimal.toFixed(2)`, `"0.00"` cuando el SUM es `null` porque no hay filas).
- **El orden de las rutas se fija con un test unitario** (`src/routes/opportunity.routes.test.ts`) que lee la pila de capas del router real y exige que `/opportunities/dashboard-summary` esté antes que `/opportunities/:id` — sin HTTP ni base, y sin depender de que alguien lo recuerde.
- **"Mis oportunidades abiertas recientes" (`RecentOpenOpportunities`, M8) desaparece del Dashboard.** El layout final del plan no la incluye y "Oportunidades recientes" ocupa su lugar en el mockup. Se eliminaron el componente, el hook `useMyRecentOpenOpportunities` y sus tests (código muerto). Es la decisión más reversible del ítem: si se la quiere de vuelta, es restaurar dos archivos del historial y sumarla al layout.
- **`STATUS_BADGE_VARIANT` se movió de `OpportunityListPage.tsx` a `opportunity/labels.ts`** (era una constante privada de la página; la tabla de recientes necesita la misma paleta). Mismo movimiento que hizo el §18.E con `STATUS_LABEL`.
- **`MONTHS` de `taskBuckets.ts` pasó a exportarse** y lo importa `dashboard/revenueChart.ts`, que tiene la geometría pura del gráfico (`toChartPoints`, `toPolylinePoints`, `monthShortLabel`, caja fija `CHART_BOX`) con su propio test; el componente solo dibuja. Del skill de visualización de datos se tomaron tres cosas que el plan no mencionaba: sin leyenda (una sola serie, el título la nombra), tooltip nativo con `<title>` en cada marcador, y una tabla `.ds-sr-only` con los mismos 6 valores para lector de pantalla.
- **La columna de la tabla de recientes se llama "Estado", no "Etapa":** el plan decía "Etapa (Badge — mismo `STATUS_BADGE_VARIANT`…)", pero lo que pinta ese Badge es el status (Abierta/Ganada/Perdida), y en este CRM "Etapa" es el Stage del pipeline (columna aparte en `OpportunityListPage`). Se mantuvo el dato que pedía el plan con el nombre que ya usa el listado. Mostrar el Stage real habría sumado una resolución de nombres por fila que el plan no pedía.
- **El feed muestra también el autor** ("por Vos" / nombre / "—"), porque el plan pedía reutilizar `useOwnerNames` y sin autor ese hook no tenía qué resolver. La regla del rótulo, que vivía como closure dentro de `ActivityListPage`, se extrajo a `resolveUserLabel` en `activity/relationResolution.ts` y la usan las dos pantallas. Consecuencia: **para ADMIN el Dashboard ahora dispara un `GET /api/users`** (el mismo que ya dispara "Actividades"); para USER sigue sin dispararse nunca. El test de `DashboardPage` que decía "nunca dispara GET /api/users (ADMIN ni USER)" pasó a "USER nunca lo dispara". El timestamp del feed es `new Date(createdAt).toLocaleString()` inline, el mismo criterio de todas las columnas de fecha del proyecto.
- **La fila de KPI es un solo request, no cuatro:** loading y error son de la fila entera (los cuatro rótulos se pintan siempre, con "Cargando…" o un `role="alert"` debajo de cada uno), y siguen siendo independientes del resto del Dashboard. La variación de "abiertas" es la diferencia de creadas (`+2 nuevas oportunidades vs. mes anterior`), neutral cuando da 0 — un mes anterior con 0 creadas sigue siendo un dato, no "sin base"; las tres variaciones en % y en puntos sí muestran "— sin base de comparación el mes anterior" cuando el período anterior es 0.
- **La queryKey `["dashboard", "summary"]` no la invalida ninguna mutación de Opportunity** (invalidan `opportunityKeys.lists()`/`detail()`): el resumen se refresca por `staleTime` (30 s) y por `refetchOnWindowFocus` de `lib/queryClient.ts`. Para un tablero de KPIs alcanza; si algún día se quiere que crear/ganar una oportunidad refresque las cards en el acto, es una línea en `opportunity/mutations.ts`.
- **Comentarios corregidos además de los tres que listaba el plan:** los de `design-system.css` que nombraban `OpportunitySummaryCards.tsx`/`RecentOpenOpportunities.tsx` como únicos consumidores de `.ds-kpi`/`.ds-list`, el de `.ds-meter-*` (ahora también `TopDealsList`), y las referencias a `useOpportunitySummary`/`OpportunitySummaryCards` en `vehicle/queries.ts` y `VehicleSummaryCards.tsx` (solo el nombre; lo que dicen sobre el stock sigue siendo cierto). La narrativa de M8 en `docs/project-overview.md` se dejó como historia.

**Decisiones tomadas al implementar:**

- Endpoint: `GET /api/opportunities/dashboard-summary`, `authenticate` solo, declarado antes de `/opportunities/:id`, sin query params. Service: `getDashboardSummary(organizationId, { now, db })`, moneda `organization.preferredCurrency ?? "USD"` (`DASHBOARD_DEFAULT_CURRENCY`), serie de `DASHBOARD_REVENUE_MONTHS = 6`.
- Frontend nuevo en `features/dashboard/`: `OpportunityKpiCards.tsx` (reemplaza a `OpportunitySummaryCards.tsx`), `kpi.ts` (`buildKpiCards`, `percentDelta`, `winRate`), `RevenueByMonthChart.tsx` + `revenueChart.ts`, `RecentDealsTable.tsx`, `TopDealsList.tsx`, `ActivityFeed.tsx`; `useDashboardSummary` en `queries.ts`; `getOpportunityDashboardSummary` en `opportunity/api.ts` y el tipo en `opportunity/types.ts`; fixture `test/dashboardFixtures.ts`. CSS: `.ds-kpi-delta` (+ `--up`/`--down`/`--neutral`) y `.ds-chart`, `.ds-chart-line`, `.ds-chart-point`, `.ds-chart-grid`, `.ds-chart-label`.
- Títulos visibles: "Oportunidades abiertas", "Valor del pipeline", "Ganado este mes", "Tasa de cierre del mes"; "Ingresos ganados por mes"; "Oportunidades recientes"; "Mayores oportunidades abiertas"; "Actividad reciente". Los montos se muestran con el `formatAmount` de siempre (`1500.00 USD`), sin formateador nuevo.
- `TopDealsList` muestra "No hay oportunidades abiertas en USD." (con la moneda) cuando el listado filtrado viene vacío, y si falla el resumen no pide el listado y muestra el error del resumen.
- Suites completas: backend 739 unitarios + 690 de integración (Supabase local); frontend 123 archivos, 1145 tests. Typecheck, build, ESLint y Prettier limpios en los dos paquetes.

## 31. Toggle manual de tema (claro/oscuro/sistema)

**Estado:** hecho

**Contexto:** El modo oscuro ya existe en el código — `frontend/src/design-system/tokens.css` tiene una paleta oscura completa bajo `@media (prefers-color-scheme: dark)`, y se verificó que todo el design system la consume vía tokens (`var(--color-*)`), sin ningún color hardcodeado que se rompa (se revisaron los `#` sueltos del frontend: los únicos son comentarios descriptivos, el generador de imagen de QR — que es un asset propio, no la UI de la app — y el widget embebible de chat para sitios de clientes, que tiene su propio sistema de estilos aparte y queda fuera de este ítem). Hoy el tema sigue la preferencia del sistema operativo automáticamente, sin ningún control en la UI — es una decisión previa documentada explícitamente en el comentario de `tokens.css`. Rocco pidió agregar un botón para elegirlo a mano.

**Comportamiento deseado:** Un control en la app para elegir Sistema/Claro/Oscuro, visible siempre (no escondido en una pantalla de configuración que hoy no existe), que cambia el tema al instante y se recuerda la próxima vez que se abre la web.

**Decisiones ya tomadas (confirmadas con Rocco):**
- Se agrega el toggle manual (no alcanza con que ya funcione automáticamente por el SO).
- La preferencia se guarda SOLO en este navegador/dispositivo (`localStorage`) — sin tocar el backend, sin columna nueva en `User`, sin migración de Prisma. Es un cambio 100% frontend.

**Decisiones de implementación (mías, con un default razonable y reversible):**
- **Tres estados, no dos:** Sistema / Claro / Oscuro — no Claro/Oscuro nada más. Así nadie pierde la posibilidad de "seguir el SO" que ya tenía por defecto: alguien que nunca toca el control sigue exactamente como está hoy. "Sistema" es el valor por defecto para cualquiera que no haya elegido nada todavía (nadie ve un cambio de tema el día que se despliega esto).
- **Mecanismo, sin flash del tema incorrecto al cargar:** un `<script>` inline en `frontend/index.html`, en el `<head>`, ANTES que cualquier otra cosa — lee la preferencia guardada (o "sistema" si no hay nada guardado o el valor es inválido), la resuelve a claro/oscuro (usando `window.matchMedia("(prefers-color-scheme: dark)")` cuando la preferencia es "sistema"), y pone `document.documentElement.dataset.theme = "light" | "dark"` ANTES de que se pinte la página. Envuelto en try/catch — `localStorage` puede tirar en modo privado (mismo criterio de cautela que ya usa `widget/session.ts` en este repo). Esta lógica se DUPLICA a propósito entre el script inline de `index.html` y el módulo `theme.ts` de React (abajo) — un script inline no puede importar un módulo TS, y este es el único punto de todo el frontend donde hace falta código antes de que React exista. Dejalo comentado en los dos lados, cruzando la referencia.
- **`tokens.css`:** el bloque `@media (prefers-color-scheme: dark)` se REEMPLAZA por `:root[data-theme="dark"] { /* mismos valores */ }` (mismos tokens, mismos valores — no se inventa una paleta nueva). El bloque `:root { }` de arriba (valores claros) queda igual, sin envolver: sigue siendo la base. `color-scheme: light dark` de `global.css` pasa a resolverse también por `data-theme`: agregar `:root[data-theme="light"] { color-scheme: light; }` y `:root[data-theme="dark"] { color-scheme: dark; }` — así los controles nativos del navegador (scrollbar, `<select>`) siguen el tema ELEGIDO, no el del SO, cuando alguien elige explícitamente.
- **Módulo `frontend/src/theme/theme.ts`** (nuevo, sin React, testeable solo — mismo espíritu que `taskBuckets.ts`/`kpi.ts`): `export type ThemePreference = "system" | "light" | "dark"`, `export type ResolvedTheme = "light" | "dark"`, y las funciones puras `resolveTheme(preference, systemPrefersDark: boolean): ResolvedTheme`, `readStoredPreference(): ThemePreference` (localStorage, key `"plataforma-crm:theme"`, cualquier valor que no sea exactamente uno de los tres cae a `"system"`, try/catch), `writeStoredPreference(preference)` (try/catch, si tira no rompe la UI — la preferencia simplemente no persiste esa vez). `applyResolvedTheme(theme)` hace el `document.documentElement.dataset.theme = theme`.
- **`frontend/src/theme/ThemeContext.tsx`** (nuevo, mismo patrón que `auth/AuthContext.tsx`): `ThemeProvider` guarda `preference` en estado de React (inicializado desde `readStoredPreference()`), calcula `resolvedTheme` con `resolveTheme` + un `useState`/`useEffect` que escucha `window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", ...)` — SOLO relevante cuando `preference === "system"`, para que si alguien cambia el tema del SO con la pestaña abierta y tiene "Sistema" elegido, se actualice solo, sin recargar. Cada cambio de `resolvedTheme` llama `applyResolvedTheme`. `setPreference(pref)` actualiza el estado Y llama `writeStoredPreference`. Expone `useTheme()`. Envuelve la app en `App.tsx`, por fuera de `QueryClientProvider` (no depende de queries ni de auth, es un estado más global todavía).
- **`frontend/src/design-system/ThemeToggle.tsx`** (nuevo): grupo de 3 botones (`role="group"`, `aria-label="Tema"`), iconos `Monitor`/`Sun`/`Moon` de `lucide-react` (ya es dependencia del proyecto, se usa en todos lados), cada uno `aria-pressed={preference === "system"|"light"|"dark"}` y `aria-label`/`title` con el nombre completo ("Sistema"/"Claro"/"Oscuro") — son botones solo-ícono, necesitan nombre accesible. Al click, `setPreference(...)` del `useTheme()`. CSS nuevo: `.ds-theme-toggle` (contenedor) y `.ds-theme-toggle-button`/`.ds-theme-toggle-button.is-active` (mismo criterio visual que `.ds-sidebar-link.is-active`, reusar esos tokens en vez de inventar un estado "activo" nuevo).
- **Dónde vive:** dentro de `ds-sidebar-account` en `AppLayout.tsx`, arriba del nombre/rol y el botón "Cerrar sesión" (mismo bloque, no una pantalla de configuración nueva — no existe ninguna hoy y crear una sería un ítem aparte).

**Cómo se implementa:**
- `frontend/index.html`: agregar el `<script>` inline descripto arriba, en `<head>`, antes de los `<link>` de Google Fonts.
- `frontend/src/theme/theme.ts`, `frontend/src/theme/ThemeContext.tsx`, `frontend/src/design-system/ThemeToggle.tsx`: nuevos, como se describió.
- `frontend/src/app/App.tsx`: envolver con `<ThemeProvider>` por fuera de `<QueryClientProvider>`.
- `frontend/src/design-system/tokens.css`: reemplazar el `@media` por el selector `[data-theme="dark"]`, agregar las dos reglas de `color-scheme`.
- `frontend/src/layout/AppLayout.tsx`: agregar `<ThemeToggle />` en `ds-sidebar-account`.
- `frontend/src/design-system/design-system.css`: las clases nuevas del toggle.

**Tests:**
- `theme.test.ts`: `resolveTheme` con las 3 preferencias × 2 valores de `systemPrefersDark` (6 casos), `readStoredPreference` con valor ausente/inválido/válido y con `localStorage.getItem` tirando excepción, `writeStoredPreference` con `localStorage.setItem` tirando excepción (no debe propagar).
- `ThemeToggle.test.tsx`: los 3 botones con su `aria-pressed` correcto según la preferencia actual, que clickear cada uno llama `setPreference` con el valor correcto.
- `AppLayout.test.tsx`: el toggle está presente y en el lugar esperado (no rompe ningún test existente de estructura del sidebar).
- Un test de integración liviano (puede vivir en `ThemeContext.test.tsx`) que monte `ThemeProvider` + `ThemeToggle`, haga click en "Oscuro", y verifique que `document.documentElement.dataset.theme === "dark"` y que `localStorage` quedó con el valor — y el camino inverso, montar con localStorage ya en `"dark"` y verificar que arranca en oscuro sin necesidad de click.

**Hallazgos al implementar (la lista de arriba, verificada contra el código):**

- **Lo investigado se confirmó tal cual:** `tokens.css` tenía la paleta oscura completa bajo `@media (prefers-color-scheme: dark)` con los 24 tokens de color y sombra del bloque claro, mismos nombres, y el único otro `color-scheme` del frontend era el `light dark` del `body` en `styles/global.css`. No hubo que tocar ningún componente ni ninguna pantalla: el cambio de selector alcanzó para que todo el design system siguiera al `data-theme`.
- **`useTheme()` vive en `theme/useTheme.ts`, no en `ThemeContext.tsx`.** El plan decía "mismo patrón que `auth/AuthContext.tsx`", pero ese archivo exporta el hook junto al provider con un `eslint-disable` de `react-refresh/only-export-components` cuya justificación (12 `vi.mock` por ruta que se romperían al mudarlo) no aplica a un módulo nuevo. Se siguió el patrón más reciente del repo, `useToast.ts` separado de `Toast.tsx`: contexto + hook en `useTheme.ts`, provider en `ThemeContext.tsx`, sin disable. `ThemeToggle.test.tsx` mockea `../theme/useTheme` por ruta, igual que los tests que mockean `useAuth`.
- **`color-scheme` salió del `body`.** El plan pedía agregar `:root[data-theme="light"] { color-scheme: light }` y `:root[data-theme="dark"] { color-scheme: dark }` y dejar el `light dark` de `global.css`. Eso no funcionaba: `color-scheme` es heredable, y una declaración en `body` pisa el valor heredado de `<html>` para todo lo que está adentro — los `<select>` y scrollbars habrían seguido al SO igual. Quedó así: `color-scheme: light` en el `:root` base de `tokens.css` (aplica también antes de que corra el script inline y con cualquier valor que no sea `"dark"`, así que la regla separada para `[data-theme="light"]` era redundante y no se agregó), `color-scheme: dark` dentro de `:root[data-theme="dark"]`, y `body` sin `color-scheme` en `global.css`, con un comentario que explica por qué no volver a ponerlo.
- **`theme.ts` tiene dos helpers más de los que listaba el plan:** `getSystemPrefersDark()` y `subscribeToSystemPrefersDark(listener)`, que encapsulan `window.matchMedia` con un guard (`typeof window.matchMedia === "function"`). El motivo es que jsdom no implementa `matchMedia`: sin el guard, `ThemeProvider` reventaba en TODOS los tests que montan `AppLayout`. Sin `matchMedia`, "Sistema" resuelve a claro, que es también lo que hace un navegador sin soporte de `prefers-color-scheme`. También se exportan `THEME_STORAGE_KEY`, `THEME_PREFERENCES`, `DARK_SCHEME_QUERY` e `isThemePreference()` para que los tests no repitan literales.
- **El `try/catch` del script inline envuelve SOLO la lectura de `localStorage`, no todo.** La primera versión envolvía todo el bloque; si `getItem` tiraba, no se escribía ningún `data-theme` y la página arrancaba clara hasta que React montara — exactamente el flash que el script existe para evitar. Ahora, sin storage, `stored` queda en `null`, la preferencia cae a `"system"` y el `data-theme` se escribe igual a partir de `matchMedia`. Se verificó que el build de Vite conserva el script inline tal cual en `dist/index.html` (es un script clásico, no `type="module"`, así que Vite no lo procesa).
- **`AppLayout.test.tsx` monta el `ThemeProvider` REAL, no un mock.** El provider no tiene dependencias externas (sin `matchMedia` en jsdom y con `localStorage` vacío arranca en "Sistema"/claro), así que envolver `renderLayout()` fue más simple y más honesto que mockear `useTheme`. El test de "Mis tareas" que hacía su propio `render` inline pasó a usar `renderLayout()`. Ningún test existente cambió su aserción.
- **`ThemeProvider` reescribe el `data-theme` al montar con el mismo valor que ya puso el script inline.** Es idempotente a propósito: la lógica es la misma en los dos lados, y el `useEffect` sobre `resolvedTheme` es lo que después aplica los cambios de verdad. No se intentó "saltear" la primera escritura leyendo el atributo existente — sería una segunda fuente de verdad.
- **El toggle muestra la PREFERENCIA, no el tema resuelto:** con "Sistema" elegido y el SO en oscuro, el botón presionado es "Sistema", no "Oscuro". Es lo que la persona pidió y lo que va a seguir pasando cuando el SO cambie. Hay un test explícito de esto en `ThemeToggle.test.tsx`.
- **La regla `.ds-sidebar-account button { width: 100% }` (la de "Cerrar sesión") alcanza a los tres botones nuevos.** No se tocó esa regla: `.ds-theme-toggle-button` usa `flex: 1 1 0`, que reparte el ancho parejo y deja el `width` sin efecto. Está comentado en el CSS.
- **El comentario de cabecera de `tokens.css` quedó desactualizado y se reescribió:** decía "no hay toggle manual ni selector de tema a propósito, se sigue la preferencia del SO". Ahora explica el mecanismo de `data-theme`, quién lo escribe (script inline y `ThemeProvider`) y por qué `color-scheme` se declara ahí.
- **Verificación visual:** harness HTML estático en el scratchpad con los CSS reales por `file://` (el mismo criterio de las revisiones del rediseño), capturas del pie de la sidebar con `data-theme="light"` y `"dark"` vía `/browse`. El activo se ve igual que el link activo del nav en los dos temas y `getComputedStyle(html).colorScheme` devuelve `light`/`dark` según el atributo.

**Decisiones tomadas al implementar:**

- Archivos nuevos: `frontend/src/theme/theme.ts` (+ `theme.test.ts`), `frontend/src/theme/useTheme.ts`, `frontend/src/theme/ThemeContext.tsx` (+ `ThemeContext.test.tsx`, el test de integración liviano del plan), `frontend/src/design-system/ThemeToggle.tsx` (+ `ThemeToggle.test.tsx`). Modificados: `frontend/index.html`, `app/App.tsx`, `layout/AppLayout.tsx` (+ test), `design-system/tokens.css`, `design-system/design-system.css`, `styles/global.css`.
- Clave de `localStorage`: `"plataforma-crm:theme"`, valores exactos `"system" | "light" | "dark"`; cualquier otra cosa cae a `"system"`. Montar el provider sin preferencia guardada NO escribe nada en storage.
- Textos visibles (solo como `aria-label`/`title`, los botones son solo-ícono): "Sistema", "Claro", "Oscuro"; el grupo se llama "Tema". Íconos `Monitor`/`Sun`/`Moon` de `lucide-react`, 16px, `strokeWidth` 1.5 como el resto de la sidebar.
- CSS: `.ds-theme-toggle` (fila con borde, fondo `--color-surface-sunken`, `--radius-md`, 2px de padding) y `.ds-theme-toggle-button` (32px de alto, `--radius-sm`, hover `--color-surface-muted`) con `.is-active` = `--color-primary` sobre `--color-primary-contrast`, exactamente los tokens de `.ds-sidebar-link.is-active`.
- Suite completa del frontend: 126 archivos, 1177 tests (eran 123/1145 en §30: +3 archivos, +32 tests). Typecheck, ESLint, Prettier (frontend y raíz) y build (app y widget) limpios. Sin cambios de backend, sin migración.

## 32. Gráfico de ingresos: curva suave, animaciones y corrección de un bug de escalado

Motivo: pedido de mejorar el diseño general del Dashboard, con foco en el
gráfico "Ingresos ganados por mes" ("no me gustó nada"). Al investigar el
motivo se encontró un bug real, no solo una cuestión de gusto: el <svg> usa
un viewBox fijo (CHART_BOX.width=600) mientras que la tarjeta se estira sin
tope (main no tiene max-width, a propósito — ver global.css). En un monitor
ancho la tarjeta renderiza bien por encima de 600px, y como font-size/
stroke-width de .ds-chart-label viven DENTRO del sistema de coordenadas del
viewBox, escalan junto con todo lo demás — por eso el rótulo "0.00 USD" se
veía tan grande como un número de KPI.

Se evaluó adoptar una librería de gráficos (Recharts, y después Bklit UI —
un registry de shadcn/ui que hubiera metido Tailwind CSS en un frontend que
deliberadamente no lo usa). Se descartaron las dos: para un solo gráfico en
un dashboard interno, construir a mano con SVG + CSS (como ya se había
hecho en §30) sale más barato que adoptar una librería completa o, peor,
reimplementar a mano las piezas sueltas de otra (@visx/*) para imitar el
resultado de una librería que no se puede usar tal cual.

Cambios:
- CHART_BOX deja de ser un ancho fijo: revenueChart.ts recibe el ancho real
  medido del contenedor (ResizeObserver, sin librería) y arma el viewBox Y
  los atributos width/height del <svg> con ESE número — nunca un viewBox
  que se estira por CSS. Así 1 unidad de viewBox es siempre 1px real, y el
  bug de escalado queda estructuralmente resuelto (mismo principio que
  ResponsiveContainer de Recharts, sin la dependencia).
- La polilínea recta pasa a ser una curva suave (Catmull-Rom → Bézier,
  función pura y testeada) con relleno en degradé debajo (acento índigo),
  dibujado con una animación de entrada.
- Los 4 KPI comerciales (OpportunityKpiCards) entran con un fade + rise
  escalonado; las tarjetas de esa fila levantan levemente al hover.
- Toda animación respeta prefers-reduced-motion.
- Alcance contenido a propósito: las clases nuevas van bajo el prefijo
  ds-chart-* (ya existente) y un wrapper nuevo ds-kpi-row en la <section>
  de OpportunityKpiCards — NO se tocó la regla base .ds-card (usada en
  toda la app) ni VehicleSummaryCards.tsx. Las tablas/listas de más abajo
  del Dashboard (oportunidades recientes, pipeline, actividad, acciones
  rápidas) quedan sin cambios en esta pasada.

**Hallazgos al implementar:**

- **El bug de escalado se confirmó leyendo el código, tal como estaba descripto.** `.ds-chart` tenía `width: 100%; height: auto` sobre un `viewBox="0 0 600 200"`, así que en una tarjeta de 1100px todo se multiplicaba por ~1,8 (los rótulos de 11px se veían a ~20px). Ahora `.ds-chart` ya no tiene `width` en CSS, y en el harness visual `getComputedStyle(.ds-chart-label).fontSize` da `11px` con la tarjeta a 1100px de ancho.
- **El último mes de la serie es siempre el mes calendario en curso: confirmado, y por eso el último tramo va punteado.** `getDashboardSummary` usa `lastMonthsUTC(now, 6)`, cuyo comentario y cuyo test (`utcMonth.test.ts`, "la actual al final") fijan que la ventana del mes actual es la última. El controller llama `getDashboardSummary(req.auth.organizationId)` sin inyectar `now`, así que en producción `now` es siempre `new Date()`. Salvedad: "en curso" es el mes UTC; entre las 21:00 del último día del mes en Montevideo y la medianoche, la serie ya arrancó el mes siguiente (mismo criterio que el §30).
- **Catmull-Rom sin cota dibujaba ingresos negativos.** Con la serie del fixture (oct 100, nov 0, dic 250…), el punto de control del tramo que llega a noviembre caía por debajo de la base: la curva bajaba del eje "0" entre dos puntos reales. `smoothSegments` acota las Y de los puntos de control al rango vertical de la serie; como una cúbica nunca sale de la envolvente convexa de sus cuatro puntos, la curva queda siempre entre la base y el techo. Hay un test que demuestra que sin la cota el control se pasaba.
- **`useContainerWidth` es un callback ref, no `useRef` + `useEffect`.** El `<div>` medido se monta recién con `isSuccess && max > 0`, después del primer render; un efecto con deps vacías ya habría corrido con el ref en `null` y nunca habría observado nada. React 19 acepta que el callback ref devuelva una función de limpieza, que es donde se hace `observer.disconnect()`. Vive en `lib/` (junto a `useFormDraft.ts`) porque no tiene nada del Dashboard, y tiene su test.
- **El `<svg>` no se dibuja hasta la primera medición, pero la tabla `.ds-sr-only` sí.** La tabla accesible no depende del ancho, así que un lector de pantalla tiene los datos desde el primer render. Hay un test con un `ResizeObserver` que nunca notifica: sin `img`, con tabla.
- **jsdom no tiene `ResizeObserver`, y eso afectaba también a `DashboardPage.test.tsx`** (espera el `img` del gráfico), no solo al test del componente. El stub quedó en `test/resizeObserverStub.ts` y lo usan los tres archivos de test. Notifica sincrónicamente al observar, con 600px por defecto. Sin él, el fallback del hook (`getBoundingClientRect`) da 0 en jsdom y el gráfico no se dibujaría.
- **La animación de dibujado no se repite en un refetch en background: verificado leyendo el código.** El `<svg>` y los `<path>` no tienen `key`; `isSuccess` sigue en `true` durante un refetch (React Query no pasa a loading si ya hay datos), así que React reconcilia los mismos nodos y solo cambia el atributo `d`, y una animación CSS no se reinicia por un cambio de atributo. Dos casos sí la repiten, y se dejan así: (1) cuando cambia el mes calendario, las `key` de marcadores y rótulos son el mes y esos nodos se vuelven a montar, lo que es correcto porque son otros datos; (2) si un refetch falla, `isSuccess` pasa a `false`, el gráfico deja lugar al `ErrorState` y al recuperarse vuelve a entrar animado. Ese segundo caso es el comportamiento de estados que ya tenía el §30, no algo nuevo de este ítem.
- **Hover sin JS: la franja de hover es un `<rect>` invisible por columna.** Apuntar a un círculo de 4px es incómodo; cada marcador es un `<g>` con un `<rect class="ds-chart-hit">` que cubre desde la mitad del camino con el vecino anterior hasta la mitad con el siguiente, y `.ds-chart-marker:hover` muestra guía y tooltip. Tiene que ser `fill: transparent` y no `fill: none`, porque un relleno `none` no recibe eventos de puntero. Guía y tooltip llevan `pointer-events: none` para no robarle el hover a la columna vecina.
- **El tooltip visual no mide texto.** Estima el ancho por cantidad de caracteres a 11px (`tooltipLayout`), se corre hacia adentro cerca de los bordes, y `CHART_BOX.top` subió a 40 para que el del punto más alto no se salga por arriba. Es `aria-hidden`: la vía accesible sigue siendo el `<title>` del círculo más la tabla, que no se tocaron.
- **Todas las animaciones usan `animation-fill-mode: backwards`, no `both`.** Con `both`, el `transform` final de `ds-rise-in` quedaría aplicado para siempre sobre `.ds-kpi` y `.ds-chart-marker`, y un `animation` gana sobre las declaraciones normales, así que el `transform` del hover no tendría efecto. Con `backwards` el estado inicial se aplica durante el delay y al terminar cada elemento vuelve a su estilo normal.
- **La línea se dibuja con `pathLength={1}`**, así `stroke-dasharray: 1` y `stroke-dashoffset` de 1 a 0 funcionan sin medir el largo real desde JS. El tramo punteado del último mes es un `<path>` aparte (sin `pathLength`, con su propio `stroke-dasharray: 4 5`) que se funde cuando la línea terminó de dibujarse. Por eso existe `segmentsToPath`: arma el `d` de un subconjunto de tramos con los mismos puntos de control que la curva completa, y los dos `<path>` empalman sin quiebre.
- **Hizo falta un token de sombra nuevo.** `tokens.css` solo tenía `--shadow-sm` (la de reposo de `.ds-card`) y `--shadow-overlay` (modales). El hover de la fila de KPI usa `--shadow-md`, definido en los dos temas. La sombra del hover va fuera de `prefers-reduced-motion` porque no es movimiento; el `translateY(-2px)` y las transiciones van adentro.
- **Verificación visual:** harness HTML estático en el scratchpad con los CSS reales por `file://`, con el markup que produce el componente de verdad (volcado desde un test temporal ya borrado), en claro y oscuro, a 1100px de ancho, vía `/browse`. Se verificó que los rótulos quedan a 11px reales, que la curva y el relleno se ven bien en los dos temas, que el tramo punteado se nota, y que el hover del primer y el último mes muestra la guía y el tooltip dentro del `<svg>`. No se pudo verificar `prefers-reduced-motion: reduce` en el navegador, porque `Emulation.setEmulatedMedia` está denegado en el harness (mismo límite ya anotado para el modo oscuro); se verificó leyendo el CSS, donde toda regla con `animation`, `transition` o `transform` de hover está dentro de `@media (prefers-reduced-motion: no-preference)`.

**Decisiones tomadas al implementar:**

- `revenueChart.ts`: `CHART_BOX` sin `width` (`height: 240`, `left: 88`, `right: 24`, `top: 40`, `bottom: 36`) y `CHART_BASELINE` exportado. `toChartPoints(series, width)` recibe el ancho. `toPolylinePoints` se borró porque ya no la usaba nadie. Funciones nuevas, todas puras y con test: `smoothSegments`, `segmentsToPath`, `toSmoothPath`, `toAreaPath`, `tooltipLayout` y `hitBand`.
- El margen izquierdo pasó de 56 a 88 para que un máximo de cuatro cifras ("3000.00 USD") no se pise con la grilla. Con importes de siete cifras o más, el rótulo asoma sobre el padding de la tarjeta (`.ds-chart { overflow: visible }`) en vez de recortarse.
- `RevenueByMonthChart.tsx`: el dibujo se separó en `ChartSvg` y `ChartMarker`, en el mismo archivo y sin exportar. El `id` del degradé sale de `useId()` para que dos gráficos en una misma página no compartan `id`. El escalonado de los marcadores usa la custom property inline `--ds-chart-index`, con 130ms entre puntos después de 350ms.
- Tiempos de entrada: grilla y rótulos 300ms, línea 1,1s, relleno 700ms desde los 250ms, tramo punteado 400ms desde 1s, marcadores 400ms cada uno, y KPI 420ms con 80ms entre tarjetas. Hover: 140ms en el gráfico y 160ms en las tarjetas.
- Colores: línea, marcadores, guía y degradé en `--color-accent`, que es el índigo de marca y pasa al índigo claro en oscuro. El degradé va de 28% de opacidad a 0. El tooltip usa `--color-primary` sobre `--color-primary-contrast`, los mismos tokens del ítem activo de la sidebar. Antes la línea era `--color-primary`.
- Alcance CSS respetado: clases nuevas solo `ds-chart-*` y `ds-kpi-row`, con los keyframes `ds-fade-in`, `ds-rise-in` y `ds-chart-draw`, más el token `--shadow-md`. No se tocaron la regla base `.ds-card`, `.ds-kpi` fuera de `.ds-kpi-row` ni `VehicleSummaryCards.tsx`.
- Archivos nuevos: `lib/useContainerWidth.ts` (+ test) y `test/resizeObserverStub.ts`. Modificados: `revenueChart.ts` (+ test), `RevenueByMonthChart.tsx` (+ test), `OpportunityKpiCards.tsx` (solo la clase del `<dl>`), `DashboardPage.test.tsx` (solo el stub), `design-system.css` y `tokens.css`. Sin cambios de backend, sin migración y sin dependencias nuevas.
- Suite completa del frontend: 127 archivos y 1197 tests (en el §31 eran 126 y 1177). Typecheck, ESLint, Prettier y build (app y widget) limpios.

## 33. Selector de período (mensual/semanal/diario) y crosshair continuo en el gráfico de ingresos

Motivo: seguir mejorando el gráfico "Ingresos ganados por mes" — un hover
que se sienta continuo (como el crosshair de un componente de referencia que
se evaluó y se descartó en el §32 por traer Tailwind/shadcn) y la
posibilidad de ver la serie por semana o por día, no solo por mes.

Parte A — hover continuo: los seis marcadores con su propia franja de
:hover (§32) se reemplazan por un único crosshair que sigue al puntero
(onPointerMove sobre el área del gráfico, sin librería), con una transición
CSS para que el desplazamiento entre puntos se sienta como un deslizamiento
y no un salto. El <title> nativo por punto y la tabla accesible no cambian.

Parte B — granularidad: nuevo endpoint GET /opportunities/revenue-series
?granularity=month|week|day, separado de /opportunities/dashboard-summary
a propósito — las 4 KPI cards siguen siendo mensuales siempre, y cambiar la
granularidad del gráfico no debe refetchear ni recalcular esas cards. El
último bucket de cualquier granularidad es siempre el período en curso, sin
cerrar (mismo criterio que ya vale para el mes en el §32, generalizado).
Ventanas: semana lunes-a-domingo UTC, día calendario UTC. Cantidad de
buckets: 6 meses (sin cambios), 8 semanas, 30 días — constantes ajustables.
Selector visual: segmented control de texto ("Mensual"/"Semanal"/"Diario"),
mismo patrón visual que .ds-theme-toggle, en el header de la tarjeta.

Refactor necesario: revenueChart.ts (toChartPoints y compañía) dejaba de
saber calcular el rótulo de mes internamente (monthShortLabel) para poder
servir las tres granularidades sin triplicar el componente — ahora recibe
puntos ya rotulados ({label, value}) y quien arma esos puntos (el
componente) elige el formateador según la granularidad activa.

**Hallazgos al implementar:**

- **Un `<g>` por punto no se puede "deslizar": los atributos `x`/`cx` de SVG no son animables por CSS.** Para que el crosshair se mueva y no salte, todo su contenido se dibuja en coordenadas RELATIVAS al punto activo y el grupo se coloca con dos `transform` anidados (`translateX(point.x)` afuera, `translateY(point.y)` adentro). `transform` sí es interpolable, así que una sola regla `transition: transform 160ms` alcanza. El grupo interno lleva su propia transición porque su Y es independiente de la X del externo.
- **El `<rect>` de captura tiene que estar ARRIBA de los círculos, y eso apaga el tooltip nativo del navegador.** Si los círculos quedaran encima, al pasar el puntero sobre uno el evento apuntaría al círculo —que es hermano y no descendiente del rect— y el `pointerleave` del rect se dispararía, haciendo parpadear el crosshair. Con el rect último, el `<title>` de cada círculo sigue siendo su nombre accesible (lector de pantalla), pero ya no se ve el tooltip amarillo del sistema operativo. Es una pérdida aceptable: el tooltip que lo reemplaza sigue al puntero y es el que se quería.
- **El índice del punto activo se conserva al salir del gráfico.** El estado es `{index, visible}` y `onPointerLeave` solo apaga `visible`: si se borrara el índice, el crosshair se desvanecería mientras vuelve al primer punto de la serie. Hay un test que fija exactamente eso (el `transform` sigue en el último punto apuntado después del `pointerLeave`).
- **jsdom 29 sí implementa `PointerEvent`**, así que `fireEvent.pointerMove(rect, { clientX })` lleva un `clientX` real hasta el handler de React. Y como `getBoundingClientRect()` devuelve ceros en jsdom, el `clientX` del test es directamente la X del viewBox: la aritmética del test es la misma que la del navegador, sin stubs.
- **Con 30 puntos los rótulos del eje X se pisan.** Un rótulo como "14 feb" a 11px no entra en los ~34px que le tocan a cada día. Se dibuja uno de cada `ceil(n / 8)`, contando desde el ÚLTIMO para que el período en curso siempre tenga el suyo. Con 6 meses y 8 semanas el paso da 1 y no cambia nada de lo que ya había. La tabla accesible sigue teniendo las 30 filas.
- **El título de la tarjeta tuvo que volverse dinámico.** Con "Diario" activo, "Ingresos ganados por mes" es simplemente falso. Ahora es "Ingresos ganados por mes / por semana / por día", y ese mismo texto alimenta el `aria-label` de la `<section>`, el `aria-label` del `<svg>`, el `<caption>` de la tabla y el encabezado de su primera columna. Como el default sigue siendo mensual, los tests que buscaban la tarjeta por "Ingresos ganados por mes" no cambiaron.
- **El archivo NO se renombró a `RevenueChart.tsx`, y es por Windows.** Al lado vive `revenueChart.ts` (el módulo de geometría); en un filesystem case-insensitive, `import ... from "./revenueChart"` contra un `RevenueChart.tsx` hermano es exactamente la clase de ambigüedad que después falla solo en CI (Linux, case-sensitive). El nombre del componente queda como estaba.
- **El test de "error parcial" del Dashboard cambió de premisa, y para bien.** Antes verificaba que si caía el resumen caían las KPI, el gráfico y las mayores abiertas. Ahora el gráfico tiene su propio endpoint, así que el test verifica lo contrario para él: el resumen cae y el gráfico sigue dibujando. Es la degradación por sección del §30 llevada un paso más lejos.
- **`tsc --noEmit` pasó y `tsc -b` (el del build) no.** Un `initialProps: { granularity: "month" as const }` en `renderHook` fija el tipo del prop en `"month"` y hace que el `rerender({ granularity: "week" })` no compile. El typecheck suelto no lo vio; `npm run build` sí. Conviene correr el build y no solo el typecheck antes de dar por cerrado un cambio de tests.
- **La semana lunes-a-domingo se probó con un domingo a propósito.** El `now` de los tests es el domingo 15/3/2026, que es el ÚLTIMO día de la semana que arranca el lunes 9 — el caso donde un `startOfWeek` mal escrito devolvería el 15 o el 16. Hay filas de fixture en el domingo 8 (semana anterior) y en el lunes 9 y el domingo 15 (semana en curso) para fijar los dos bordes.
- **Verificación visual:** harness HTML estático en el scratchpad con los CSS reales por `file://` y el markup que produce el componente de verdad (volcado desde un test temporal ya borrado), con el crosshair activo, en claro y oscuro, vía `/browse`. Se verificó que la guía punteada, el círculo resaltado y el tooltip se leen bien en los dos temas, y que el segmented control de período tiene el mismo peso visual que el del tema en la sidebar. La transición en sí no se puede capturar en una foto: se verificó leyendo el CSS.

**Decisiones tomadas al implementar:**

- **Parte A.** `hitBand` se borró y la reemplaza `nearestPointIndex(points, pointerX)`, pura y con test: divide por el paso uniforme, redondea y acota a la serie. Clases nuevas `.ds-chart-crosshair`, `.ds-chart-crosshair-focus` y `.ds-chart-crosshair-point`; se fueron `.ds-chart-marker` y `.ds-chart-tooltip` (el grupo, no la caja ni el texto). La animación de entrada escalonada pasó del `<g>` del marcador al propio `<circle class="ds-chart-point">`, con la misma custom property `--ds-chart-index`; a ese círculo se le sacaron `transform-box`/`transform-origin`, que existían solo para el `scale` del hover viejo. La transición es `transform 160ms cubic-bezier(0.22, 1, 0.36, 1)` (sale rápido, frena al llegar) y vive dentro de `@media (prefers-reduced-motion: no-preference)`, igual que el resto del movimiento del gráfico.
- **Backend: `src/utils/utcWindow.ts` es archivo nuevo, y `utcMonth.ts` no se tocó** (más allá de que el service ya no importa el tipo `MonthWindow`). Expone `startOfDayUTC`/`addDaysUTC`/`startOfNextDayUTC`/`dayWindowUTC`/`lastDaysUTC` y `startOfWeekUTC`/`addWeeksUTC`/`startOfNextWeekUTC`/`weekWindowUTC`/`lastWeeksUTC`, más `dateKeyUTC`, sobre una interfaz `DateWindow { label, start, end }`. `addDaysUTC` suma milisegundos y no días de calendario: en UTC no hay horario de verano, así que todos los días duran lo mismo (en hora local no alcanzaría).
- **`getRevenueSeries(organizationId, granularity, { now, db })`** con `REVENUE_SERIES_BUCKET_COUNT = { month: DASHBOARD_REVENUE_MONTHS, week: 8, day: 30 }` — el mes reusa la constante del §30 en vez de repetir el 6. `inWindow` se generalizó a `{ start, end }` y la búsqueda de la moneda de reporte se extrajo a `resolveReportingCurrency`, compartida con `getDashboardSummary`, así las dos respuestas no pueden divergir. Un test unitario compara la serie mensual contra `revenueByMonth` del resumen, entrada por entrada.
- **La granularidad se valida con `z.enum(["month","week","day"])` SIN default**, con mensaje en español vía `errorMap`: si falta o es inválida es 400. Un default escondería un bug de quien llama; el frontend siempre la manda.
- **Test de integración en archivo nuevo** (`opportunityRevenueSeries.integration-test.ts`) y no como extensión de `opportunityDashboard.integration-test.ts`: las filas que hacen interesante a la serie son otras (bordes de semana y de día) y meterlas en el escenario del resumen habría cambiado sus aserciones exactas sin aportarle nada.
- **Frontend: `useRevenueSeries(granularity)` con key `["dashboard", "revenue-series", granularity]`**, sin colgar de `DASHBOARD_SUMMARY_KEY`. Hay dos tests que fijan la garantía del ítem: uno en `queries.test.tsx` (cambiar de granularidad pide otra serie y el resumen se pide una sola vez) y otro en `DashboardPage.test.tsx` (lo mismo end-to-end, con las KPI mostrando sus números intactos después del cambio).
- **`toChartPoints(series, width)` recibe `{ label, value }` ya rotulado.** `monthShortLabel` se quedó en `revenueChart.ts` y se le sumó `dateShortLabel` ("2026-03-09" → "9 mar"), las dos por `slice` y sin pasar por `Date` — pasarla por `Date` arrastraría la zona horaria del navegador y en Montevideo correría cada rótulo un día para atrás. El componente elige cuál usar según la granularidad activa.
- **`key={granularity}` en el subárbol del `<svg>`:** cambiar de vista remonta y repite la animación de entrada (son otros datos), y un refetch en background de la MISMA granularidad reconcilia los mismos nodos y no la repite — el criterio del §32, ahora explícito en una key.
- **Cambiar de granularidad muestra "Cargando…" mientras llega la serie nueva.** No se usó `placeholderData` para mantener el gráfico viejo en pantalla: los tres estados (loading / error / vacío) son los mismos que la tarjeta ya tenía desde el §30, y sostener datos de otra granularidad mientras carga es justo el tipo de mentira transitoria que el §32 evitó con el ancho medido. Si molesta en uso real, es un ítem aparte de una línea.
- **`Card` ganó un prop `headerAction`.** `.ds-card-header` ya era un flex con `space-between` esperando un segundo hijo desde el §30; el selector de período es su primer consumidor real. Las clases `.ds-period-toggle*` copian el patrón visual de `.ds-theme-toggle*` (pista hundida, activo con los tokens del ítem activo de la sidebar) y solo difieren en que los botones se miden por su texto en vez de repartirse el ancho.
- **Suites completas en verde:** frontend 127 archivos y 1207 tests (en el §32 eran 127 y 1197), backend 753 unitarios y 695 de integración contra el Postgres local. Typecheck, ESLint, Prettier y build (app y widget) limpios en los dos lados. Sin migración, sin dependencias nuevas.

## 34. Animación de entrada para el pop up "Ver detalle" (desliza desde abajo)

**Estado:** hecho

**Contexto:** Los pop ups "Ver detalle" son `Modal` con `variant="dialog"` (§28), usados en los 10 listados (Activity, Company, Contact, Opportunity, Pipeline, Qr, Source, Stage, User, Vehicle). Hoy `.ds-modal--dialog` y `.ds-modal-overlay--dialog` (design-system.css) no tienen ninguna transition ni animation: aparecen instantáneos. Rocco pidió que entren deslizándose desde abajo hacia su posición final, de forma fluida. La variante "panel" del mismo componente (export de reseñas QR, secreto de API key) NO se toca — es una clase CSS separada y el pedido fue específicamente sobre "Ver detalle".

**Comportamiento deseado:** al abrirse cualquier pop up "Ver detalle", la caja entra con un desplazamiento vertical desde abajo hacia su posición final, de manera suave — no de golpe.

**Decisiones de implementación (ya tomadas, con un default razonable y reversible — no hace falta volver a preguntarle a Rocco):**
- Alcance: solo `.ds-modal--dialog` / `.ds-modal-overlay--dialog`. `.ds-modal` (panel) sin cambios.
- Keyframe nueva y dedicada para la caja (no reusar `ds-rise-in`: el comentario del código la reserva explícitamente para `.ds-kpi-row` y `.ds-chart-*`). Nombre sugerido: `ds-modal-dialog-in` — `opacity: 0` + `transform: translateY(24px)` → `opacity: 1` + `transform: none`. 24px (no los 6-8px de `ds-rise-in`/`ds-toast-in`) porque acá el movimiento tiene que leerse como "sube desde abajo", pedido explícito, no ser un matiz casi imperceptible.
- Duración/easing de la caja: `220ms ease-out` — más que el toast (160ms, elemento chico y periférico), menos que las entradas del dashboard (400-420ms, para no sentirse lento en un click que se espera responda al toque).
- El overlay funde con `opacity 0→1` en `160ms ease-out` (podés reusar la keyframe `ds-fade-in` ya existente, que es exactamente eso, en vez de crear una idéntica) — para que el fondo no tape de golpe antes de que la caja empiece a moverse.
- Sin animación de salida/cierre: no fue lo pedido, y requeriría demorar el desmontaje en React (estado + timeout), un cambio de otro orden.
- `prefers-reduced-motion: reduce` desactiva ambas animaciones (mismo criterio que `.ds-toast`): la caja y el overlay aparecen directo, sin salto ni movimiento — agregar el bloque `@media (prefers-reduced-motion: reduce) { .ds-modal--dialog, .ds-modal-overlay--dialog { animation: none; } }`.

**Cómo se implementa:**
- `frontend/src/design-system/design-system.css`: agregar la `animation` a `.ds-modal--dialog` y a `.ds-modal-overlay--dialog`, la keyframe nueva `ds-modal-dialog-in`, y el bloque de `prefers-reduced-motion: reduce`. `Modal.tsx` no cambia — las clases ya existen.

**Tests:** ninguno nuevo necesario — cambio puro de CSS sobre clases ya cubiertas por `Modal.test.tsx` (verifica presencia de clases, no estilos computados). Correr igual la suite completa del frontend para confirmar que nada se rompe.

**Hallazgos al implementar:**

- **La keyframe `ds-fade-in` se define 370 líneas MÁS ABAJO que la regla que la estrena.** `.ds-modal-overlay--dialog` vive en el bloque de Modal y `@keyframes ds-fade-in` en el de `.ds-kpi-row`. Funciona igual: las `@keyframes` son globales al documento y no siguen el orden de la cascada, a diferencia de las reglas. Para que no se lea como un error al pasar, el comentario que ya estaba arriba de la keyframe ("compartidos por .ds-kpi-row y .ds-chart-*") ahora nombra también al overlay y dice explícitamente que el orden no importa. Mover la keyframe habría sido peor: la alejaría de sus otros tres consumidores.
- **El CSSOM no es legible con hojas enlazadas por `file://`.** En el harness de verificación, `sheet.cssRules` tira `SecurityError` para cada `<link>` a un `.css` local, así que el chequeo de "¿existe el bloque de `prefers-reduced-motion: reduce`?" dio vacío — un falso negativo de la verificación, no del cambio. Con los dos CSS inlineados en `<style>` dentro del harness, el CSSOM sí se lee y el bloque aparece con los dos selectores y `animation: none`. Vale para cualquier verificación futura que quiera leer reglas y no solo estilos computados: `getComputedStyle` funciona con `file://`, `cssRules` no.
- **La animación se muestreó con la Web Animations API, no persiguiendo un frame.** `el.getAnimations()` devuelve las `CSSAnimation`; con `a.pause()` y `a.currentTime = 55` la página queda congelada en un punto exacto del recorrido y la captura es reproducible. A 55ms (25% de los 220ms) la caja estaba 14,9px por debajo de su posición final con `opacity 0.38` —el ease-out ya consumió el 38% del recorrido— y el overlay en `opacity 0.50`. Sin esto, "sacar la foto a mitad de la animación" es una carrera contra el screenshot.
- **Verificación visual:** harness HTML estático en el scratchpad con `tokens.css` y `design-system.css` reales y el markup exacto que produce `Modal.tsx` con `variant="dialog"`. Se capturó el estado intermedio (caja abajo y traslúcida, fondo a medio fundir) y el estado final en claro y oscuro, que es el del §28 sin cambios. Se confirmó además por estilos computados que `.ds-modal` y `.ds-modal-overlay` (la variante panel) siguen con `animation-name: none`.

**Decisiones tomadas al implementar:**

- **Nada divergió de lo planeado.** La keyframe quedó con el nombre sugerido, `ds-modal-dialog-in` (`opacity 0` + `translateY(24px)` → `opacity 1` + `transform: none`), la caja con `ds-modal-dialog-in 220ms ease-out` y el overlay reusando `ds-fade-in 160ms ease-out`. Verificado por estilos computados en el navegador, no solo leyendo el archivo.
- **Se siguió el patrón de `.ds-toast` y no el del dashboard.** Hay dos formas de manejar el movimiento reducido en este archivo: declarar la `animation` en la clase y apagarla en un bloque `@media (prefers-reduced-motion: reduce)` (`.ds-toast`), o declararla adentro de un `@media (prefers-reduced-motion: no-preference)` (`.ds-kpi-row`, `.ds-chart-*`). Se eligió la primera porque es la que pedía el ítem y porque acá la regla base de cada clase ya existe con otras cinco propiedades: meter la `animation` en un `no-preference` obligaría a repetir el selector igual, sin ganar nada.
- **Un solo bloque `reduce` con los dos selectores**, no uno por clase: apagan lo mismo por el mismo motivo, y así el comentario que lo explica se escribe una vez.
- **Sin tests nuevos, como estaba previsto.** La suite completa del frontend quedó en 127 archivos y 1207 tests, idéntica al §33 — ninguno miraba estilos computados, así que un cambio de CSS puro no podía moverla. Typecheck (`tsc -b`), ESLint, Prettier y `npm run build` (app y widget) limpios. `Modal.tsx` no se tocó.

## 35. El selector de período (Mensual/Semanal/Diario) pasa a controlar toda la fila de KPIs, no solo el gráfico

**Estado:** hecho

**Contexto:** Desde el §33, el selector Mensual/Semanal/Diario vive en la tarjeta "Ingresos ganados por mes" y solo cambia esa serie — fue una decisión explícita de ese ítem, documentada en el código (`useRevenueSeries`/`RevenueByMonthChart.tsx`: "las 4 KPI cards de arriba son siempre mensuales, así que pasar el gráfico a Semanal o Diario no tiene que refetchearlas ni recalcularlas"). Rocco pidió dar vuelta esa decisión: quiere que el selector controle también los números de la fila de KPIs de arriba, para que todo el Dashboard responda al mismo período.

**Comportamiento deseado (confirmado con Rocco):**
- El selector se saca de la tarjeta del gráfico y pasa a vivir arriba de todo, junto al título "Dashboard" — un control de página, no de una tarjeta puntual.
- De las 4 tarjetas de KPI de la segunda fila, tres pasan a seguir el período elegido: **Ganado este mes** (→ "esta semana"/"hoy"), **Tasa de cierre del mes** (→ "de la semana"/"del día"), y **Oportunidades abiertas**, que además cambia de significado: deja de mostrar "todo lo que está abierto ahora mismo" y pasa a mostrar cuántas oportunidades se CREARON en el período elegido (mes/semana/día) — esto es un cambio real de comportamiento incluso en la vista Mensual por defecto, no solo al cambiar de período, y ya fue confirmado con Rocco.
- **Valor del pipeline** NO se toca: sigue siendo la foto de todo lo que está abierto ahora mismo, con su variación siempre contra el mes anterior, sin importar el selector — es un valor de inventario del momento, no algo de un período.
- Las tarjetas de stock (Unidades en stock, Disponibles, arriba de todo) tampoco se tocan: son otro componente (Fase 3b de vehículos), inventario actual, no algo de un período.

**Hallazgo importante que condiciona la implementación:** el backend de hoy calcula la variación de "Valor del pipeline" (`newValueDelta`, en `kpi.ts`) a partir de los MISMOS campos que hoy alimentan "Oportunidades abiertas" (`createdThisMonth`/`createdLastMonth`, oportunidades creadas ese mes/el anterior). Como una tarjeta se queda fija en mensual y la otra pasa a seguir el selector, esos dos campos ya no pueden ser una sola cosa: hace falta un par SIEMPRE mensual (para "Valor del pipeline") y un par SEGÚN LA GRANULARIDAD elegida (para "Oportunidades") — ver el diseño del endpoint abajo.

**Decisiones de implementación (mías, con un default razonable y reversible — no hace falta volver a preguntarle a Rocco, pero verificalas contra el código real antes de aplicarlas):**

- **`GET /opportunities/dashboard-summary` pasa a aceptar `?granularity=month|week|day`**, igual que `/opportunities/revenue-series` (mismo schema Zod `revenueGranularitySchema` ya definido en `opportunity.controller.ts`, reusado tal cual — parámetro obligatorio, 400 si falta o es inválido, mismo criterio que la otra ruta). El frontend SIEMPRE lo manda explícito (el estado por defecto es `"month"`), así que no hace falta un valor implícito del lado del backend.
- **`getDashboardSummary(organizationId, { now, db, granularity })`** en `opportunity.service.ts`: la ventana "actual/anterior" para lo que sigue al selector se elige con `monthWindowUTC`/`weekWindowUTC`/`dayWindowUTC` de `utcWindow.ts`/`utcMonth.ts` (ya existen desde el §33, ningún cálculo de fechas nuevo) según `granularity`.
- **Nuevo shape de `DashboardSummary`** (renombrando para que el nombre diga la verdad):
  - `openCount`, `openValue`: sin cambios, siempre "ahora mismo". (`openCount` queda sin ningún consumidor en el frontend después de este ítem — el mismo caso que `revenueByMonth` en el §33. No hace falta borrarlo del backend si no molesta, es barato de calcular, pero vale la pena confirmarlo al implementar por si conviene sacarlo también.)
  - `createdThisMonth` / `createdLastMonth`: quedan EXACTAMENTE como están hoy (siempre mes calendario, sin importar `granularity`) — son la base de la variación de "Valor del pipeline", que no se mueve.
  - `createdThisPeriod` / `createdLastPeriod` (nuevos): igual que los de arriba pero con la ventana de `granularity` — la base del VALOR y la variación de "Oportunidades". Cuando `granularity === "month"` coinciden exactamente con `createdThisMonth`/`createdLastMonth`: evitar la consulta duplicada y reusar esos dos valores en ese caso (si `granularity !== "month"`, ahí sí van 2 consultas más de count+sum).
  - `wonThisMonth`/`wonLastMonth` → renombrados a `wonThisPeriod`/`wonLastPeriod`: sin otro consumidor que la tarjeta "Ganado", así que se generalizan directo a la ventana de `granularity`, sin conflicto. Se calculan con una consulta directa (`sum({ status: "WON", actualCloseDate: inWindow(period) })`), ya no derivados de una serie de varios meses.
  - `lostCountThisMonth`/`lostCountLastMonth` → renombrados a `lostCountThisPeriod`/`lostCountLastPeriod`: mismo caso, único consumidor es la Tasa de cierre.
  - `revenueByMonth`/`DASHBOARD_REVENUE_MONTHS` se ELIMINAN del endpoint: es la serie de 6 meses que el §33 dejó de usar en el frontend (verificar: el campo está en `OpportunityDashboardSummary` pero ningún componente lo lee — el gráfico usa `/revenue-series` desde el §33). Hoy sobrevive solo porque `wonThisMonth`/`wonLastMonth` se derivaban de sus últimas dos entradas para no repetir una consulta; al generalizar a `wonThisPeriod`/`wonLastPeriod` con consulta directa, ese motivo desaparece. `opportunity.service.test.ts` y `frontend/.../queries.test.tsx` mencionan el campo — hay que actualizar esos tests, no es un descuido.
  - Se agrega `granularity` al response (eco del query param), mismo criterio que `OpportunityRevenueSeries`.
- **`useDashboardSummary` pasa a tomar `granularity` y a llevarlo en la query key** (`["dashboard", "summary", granularity]`, mismo patrón que `useRevenueSeries`): cada período se cachea aparte, volver a uno ya visto es instantáneo.
- **El estado de `granularity` se levanta de `RevenueByMonthChart` a `DashboardPage`** (`useState<OpportunityRevenueGranularity>("month")`), y baja por props a `OpportunityKpiCards`, `RevenueByMonthChart` y `TopDealsList` (este último NO usa ningún campo que varíe por período —solo `currency`, igual en cualquier granularidad— pero comparte la misma query key/hook, así que necesita el prop para pedir la MISMA entrada de caché que ya pidió `OpportunityKpiCards`, sin duplicar el request).
- **El selector (`PeriodToggle` + el array `PERIODS`) se saca de `RevenueByMonthChart.tsx`** a un módulo compartido dentro de `features/dashboard/` (por ejemplo `period.ts` + el componente), porque ahora lo usan tres lugares (`DashboardPage` lo renderiza, `OpportunityKpiCards` y `RevenueByMonthChart` necesitan el `noun`/`column`/`window` de cada opción para sus propios textos) y no puede seguir viviendo dentro del componente del gráfico.
- **Ubicación visual:** `DashboardPage.tsx` envuelve `<h1>Dashboard</h1>` y el `<PeriodToggle>` en un `<div className="ds-page-header">` — la misma clase que ya usan los listados para "título + acción a la derecha" (`CompanyListPage.tsx` y el resto), sin CSS nuevo.
- **Rótulos y comparación por granularidad** (evitar un template genérico tipo "este {noun}": en español "mes"/"semana"/"día" no funcionan igual con género, y "hoy/ayer" es más natural que "este día"/"el día anterior"). Las 9 combinaciones:
  - Ganado: Mensual → "Ganado este mes" / "vs. mes anterior". Semanal → "Ganado esta semana" / "vs. semana anterior". Diario → "Ganado hoy" / "vs. ayer".
  - Tasa de cierre: Mensual → "Tasa de cierre del mes" / "vs. mes anterior". Semanal → "Tasa de cierre de la semana" / "vs. semana anterior". Diario → "Tasa de cierre del día" / "vs. ayer".
  - Oportunidades: Mensual → "Oportunidades creadas este mes" / "vs. mes anterior". Semanal → "Oportunidades creadas esta semana" / "vs. semana anterior". Diario → "Oportunidades creadas hoy" / "vs. ayer".
  - La variación de "Oportunidades" deja de decir "nuevas oportunidades" en el texto (ya lo dice el rótulo: "creadas"): pasa a ser solo `"{signed} vs. {ventana anterior}"`, igual de escueta que la de "Tasa de cierre".
  - "Valor del pipeline" no cambia ningún texto: sigue siempre "vs. mes anterior".

**Cómo se implementa:**
- Backend: `src/controllers/opportunity.controller.ts` (reusar `revenueGranularitySchema` en `getDashboardSummaryHandler`), `src/services/opportunity.service.ts` (el rediseño de `getDashboardSummary` de arriba).
- Frontend: `frontend/src/features/opportunity/types.ts` (`OpportunityDashboardSummary` con el shape nuevo), `frontend/src/features/opportunity/api.ts` (`getOpportunityDashboardSummary(granularity, signal)` con el query param, mismo patrón que `getRevenueSeries`), `frontend/src/features/dashboard/queries.ts` (`useDashboardSummary(granularity)`), `frontend/src/features/dashboard/kpi.ts` (las 3 tarjetas que cambian según la tabla de arriba; "Valor del pipeline" sin tocar), `frontend/src/features/dashboard/OpportunityKpiCards.tsx` (recibe `granularity`), `frontend/src/features/dashboard/RevenueByMonthChart.tsx` (deja de tener estado propio y de renderizar el toggle; recibe `granularity` por prop), `frontend/src/features/dashboard/TopDealsList.tsx` (recibe `granularity`, lo pasa a `useDashboardSummary`), `frontend/src/features/dashboard/DashboardPage.tsx` (dueño del estado, arma el `.ds-page-header`), el nuevo módulo compartido del `PeriodToggle`/`PERIODS`.

**Tests:** hay que tocar todos los que hoy cubren lo que se mueve, no es opcional dado el tamaño del cambio:
- `opportunity.service.test.ts`: `getDashboardSummary` con las 3 granularidades, el par siempre-mensual vs. el par según-período coincidiendo cuando `granularity === "month"` y divergiendo cuando no, sin `revenueByMonth`.
- Tests de controller/routes que validen `dashboard-summary`: 400 con granularity inválida o ausente, igual que `revenue-series`.
- `kpi.test.ts`: las 9 combinaciones de rótulo/comparación de la tabla, más "Valor del pipeline" confirmando que NO cambia con `granularity`.
- `queries.test.tsx`: `useDashboardSummary` con distintas granularidades usa keys distintas y cachea aparte.
- `OpportunityKpiCards.test.tsx`, `RevenueByMonthChart.test.tsx`, `TopDealsList.test.tsx`, `DashboardPage.test.tsx`: props/wiring del estado levantado — un click en el selector (ahora en `DashboardPage`) cambia las tres tarjetas Y el gráfico a la vez, sin tocar "Valor del pipeline" ni el stock.

**Hallazgos al implementar:**

- **`DASHBOARD_REVENUE_MONTHS` también tuvo que irse, no solo `revenueByMonth`.** La constante nació en el §30 para la serie de 6 meses del resumen, y desde el §33 su único consumidor real era `REVENUE_SERIES_BUCKET_COUNT.month`. Al sacar la serie del resumen, el nombre dejaba de describir nada: quedó `month: 6` escrito en la tabla de buckets, con el comentario que explica de dónde salen los tres números. Una constante exportada menos, cero cambios de comportamiento.
- **El texto de "sin base de comparación" también sigue al período, y eso no estaba en la tabla de 9 combinaciones.** El plan cubría rótulo y comparación, pero `SIN_BASE` era una constante con "el mes anterior" adentro. Con la granularidad semanal habría dicho "— sin base de comparación el mes anterior" debajo de un "Ganado esta semana": el rótulo y la explicación contradiciéndose. Ahora hay un quinto texto por granularidad (`previous`: "el mes anterior" / "la semana anterior" / "ayer") y "Valor del pipeline" pasa explícitamente el mensual, porque su comparación sí es siempre mensual. Son 12 textos, no 9.
- **`Card` se quedó sin el prop `headerAction`, que existía solo para este selector.** Lo estrenó el §33 ("el primer consumidor real es el selector de período del gráfico de ingresos"), y al mudarse el selector al header de la página quedaba un slot sin consumidores y sin test. Se sacó, con un comentario en `Card.tsx` que dice que existió, por qué se fue y que reponerlo es agregar el prop de vuelta — `.ds-card-header` sigue siendo un flex con `space-between`, así que el CSS ya está.
- **Confirmado que `openCount` se quedó sin consumidor en el frontend, y se decidió conservarlo igual** (ver decisiones).
- **La base en memoria de `opportunity.service.test.ts` tiene un `createdAt` por defecto que cae DENTRO de la semana en curso** (martes 10/3), así que las filas WON/LOST del test semanal contaban además como "creadas en el período" y el primer intento dio `{count: 3, value: "103.00"}` en vez de `{count: 1, value: "2.00"}`. No es un bug del service: es que hasta el §35 ninguna prueba miraba una ventana más chica que el mes, donde ese default era inofensivo. Las filas cerradas del test ahora llevan un `createdAt` explícito de enero.
- **"Volver a un período ya visto no dispara ningún request" es falso con el QueryClient de los tests.** Sin `staleTime` (el de `newClient()` solo pone `retry: false`), React Query sirve la caché en el mismo render y revalida de fondo igual. Lo que sí es cierto y es lo que importa para la UX —que la card no vuelve a "Cargando…"— es lo que el test afirma ahora (`isLoading === false` y los datos presentes). El `staleTime` real de la app vive en `lib/queryClient.ts`.
- **Verificación visual (harness estático, `/browse`):** el toggle entra en `.ds-page-header` sin una línea de CSS nueva — título a la izquierda, selector a la derecha, alineados verticalmente, y a 420px de ancho todavía entran los dos en la misma fila. Los rótulos semanales, que son los más largos ("Oportunidades creadas esta semana", "Tasa de cierre de la semana"), entran en una sola línea en cada card. El único texto que envuelve a dos líneas es "— sin base de comparación la semana anterior", igual que envolvería su equivalente mensual: es el caso sin datos y se deja así.

**Decisiones tomadas al implementar:**

- **`granularity` va en el objeto de opciones de `getDashboardSummary` y es OBLIGATORIA**, sin default — como decía el ítem. Queda asimétrico con `getRevenueSeries`, donde la granularidad es un parámetro posicional y el objeto de opciones es enteramente opcional; se respetó la firma del ítem en vez de uniformar las dos, que sería un refactor de otro alcance. El efecto práctico es el buscado: ningún test ni llamador puede pedir el resumen "a ver qué sale", tiene que decir qué ventana quiere.
- **`buildKpiCards` lee `summary.granularity` en vez de recibirla como segundo argumento.** El backend ya devuelve el eco del query param, así que los rótulos describen SIEMPRE la ventana de los números que acompañan: durante un cambio de período no puede existir un render con "Ganado esta semana" arriba de un monto mensual. El esqueleto de carga sí usa el prop, porque ahí todavía no hay resumen.
- **Renombres para que los nombres digan la verdad:** `DashboardMonthFigures` → `DashboardFigures` (ya no es solo de meses) y las keys de las cards `open` → `created` y `wonThisMonth` → `won`. La key `open` era la que peor mentía: la card dejó de mostrar lo abierto.
- **`kpiLabels(granularity)` es la única fuente de los rótulos**, y la usan tanto `buildKpiCards` como el esqueleto de `OpportunityKpiCards`. Antes había un array `LABELS` duplicado en el componente que había que mantener sincronizado a mano con `kpi.ts`; con 3 granularidades esa duplicación pasaba de 4 strings a 12.
- **El selector quedó partido en dos archivos: `period.ts` (datos puros: `PERIODS`, `periodOption`) y `PeriodToggle.tsx` (el componente).** Es la misma separación que ya usan `kpi.ts`/`OpportunityKpiCards.tsx` y `revenueChart.ts`/`RevenueByMonthChart.tsx`. Los rótulos de las KPI NO se mudaron a `period.ts`: viven en `kpi.ts`, junto a la lógica que arma las cards, porque no se derivan de `noun`/`column`/`window` sino que son 12 textos escritos a mano.
- **Se agregó `PeriodToggle.test.tsx`.** Los tests del selector vivían en `RevenueByMonthChart.test.tsx` y probaban de paso el estado interno de aquel componente; ahora el control se prueba solo (aria-pressed, `onChange`, `type="button"`) y el wiring con el estado de la página queda en `DashboardPage.test.tsx`, donde un click en el toggle mueve las tres cards Y el gráfico y deja quietos "Valor del pipeline" y el stock.
- **`RevenueGranularity`/`OpportunityRevenueGranularity` se movieron ARRIBA del bloque del resumen** en `opportunity.service.ts` y en `types.ts`. Los tipos hoistean, así que era cosmético, pero ahora el archivo se lee en el orden en que se usan las cosas: primero el tipo que comparten los dos agregados, después cada agregado.
- **`openCount` se mantiene en el endpoint aunque ningún componente lo lea.** Es un COUNT sobre el mismo índice que ya recorre el SUM de `openValue`, es el compañero natural de "Valor del pipeline" (cuántas unidades hay detrás de ese monto) y es la aserción que usan los tests de aislamiento multi-tenant para probar que una organización no ve filas de otra. Sacarlo es un `git revert` de tres líneas si molesta.
- **Los tests de la frontera de la ruta prueban el SCHEMA, no HTTP.** El repositorio no tiene supertest ni ningún arnés de request para los controllers; `opportunity.controller.test.ts` ya probaba `createOpportunitySchema`/`updateOpportunitySchema` directo, con el comentario "sin base y sin HTTP: lo que está bajo prueba es la frontera del schema". Se exportó `revenueGranularitySchema` y se siguió ese patrón: como los dos handlers lo pasan por el mismo `parseOrThrow`, el test cubre las dos rutas a la vez.
- **Suites completas en verde:** frontend 128 archivos y 1229 tests (en el §34 eran 127 y 1207), backend 759 unitarios y 695 de integración contra el Postgres local. Typecheck, ESLint, Prettier y build (app y widget) limpios en los dos lados. Sin migración, sin dependencias nuevas, sin CSS nuevo.

## 36. Sacar "Valor del pipeline" del Dashboard: ya vive en el embudo de Oportunidades

**Estado:** hecho

**Contexto:** Rocco pidió que le explicara qué es "Valor del pipeline" (la tarjeta del §30: SUM(amount) de las oportunidades abiertas AHORA MISMO, en la moneda de reporte de la organización — una foto del momento, no algo de un período, por eso quedó fuera del selector en el §35). Al explicarlo se confirmó que esa información ya vive, de forma más completa, en la vista de embudo de Oportunidades (`OpportunityBoardView.tsx`): el header muestra "N oportunidades · $X en curso" para el pipeline seleccionado (`formatAmountTotals(inProgress)`), y cada columna/etapa tiene su propio "Total: $X" al pie — y esa versión es multi-moneda (suma cada moneda por separado), mientras que la tarjeta del Dashboard solo suma la moneda de reporte. La diferencia real es de alcance: el embudo es por-pipeline (el que esté seleccionado) y la tarjeta del Dashboard sumaba TODOS los pipelines juntos. Rocco decidió que esa diferencia no amerita mantener la tarjeta: se saca del Dashboard sin agregar nada nuevo al embudo.

**Comportamiento deseado (confirmado con Rocco):** el Dashboard queda con 3 tarjetas de KPI —Oportunidades creadas, Ganado, Tasa de cierre—, las tres siguiendo el selector de período del §35. "Valor del pipeline" desaparece del todo del Dashboard (ni la tarjeta ni sus datos). El embudo de Oportunidades no se toca — ya tiene lo que hace falta.

**Hallazgo que simplifica la implementación:** "Valor del pipeline" era el ÚNICO consumidor de `createdThisMonth`/`createdLastMonth` (el par SIEMPRE mensual que el §35 separó justo para esta tarjeta) y de `openValue`. Al sacarla:

- El backend puede sacar `createdThisMonth`/`createdLastMonth` del todo: ni el tipo, ni las 4 consultas (count+sum × mes actual/anterior), ni las variables `thisMonth`/`lastMonth`.
- El atajo de "cuando granularity==='month', createdThisPeriod/LastPeriod reusan el par mensual en vez de consultar de nuevo" (el `periodIsMonth`/`createdPeriod` del §35) deja de tener sentido: ya no hay ningún par mensual para reusar. `createdThisPeriod`/`createdLastPeriod` pasan a calcularse SIEMPRE directo con `periodWindow(granularity, now, 0/-1)`, sin ninguna rama condicional — de hecho el service queda más simple que en el §35, no solo más chico.
- `openCount`/`openValue` NO se tocan: ya quedaron sin consumidor en el frontend desde el §35 (el primero) y ahora también el segundo, pero se mantienen por el mismo criterio de entonces — son baratos de calcular y los usan los tests de aislamiento multi-tenant (`opportunityDashboard.integration-test.ts`).

**Decisiones de implementación (mías, con un default razonable y reversible):**

- `src/services/opportunity.service.ts`: sacar `createdThisMonth`/`createdLastMonth` de `DashboardSummary` y de `getDashboardSummary` (incluidas las 4 consultas y las variables de ventana), sacar el branching `periodIsMonth`/`createdPeriod` — `createdThisPeriod`/`createdLastPeriod` se calculan siempre directo, sin condicional.
- `frontend/src/features/opportunity/types.ts`: sacar `createdThisMonth`/`createdLastMonth` de `OpportunityDashboardSummary`.
- `frontend/src/features/dashboard/kpi.ts`: sacar `"pipelineValue"` de `KPI_KEYS`/`KpiKey`, su entrada en `byKey` y en `kpiLabels`, `PIPELINE_VALUE_LABEL`, `MONTH_COMPARISON` y `newValueDelta`. `percentDelta` se queda (la sigue usando "Ganado").
- `frontend/src/design-system/design-system.css`: sacar la regla `.ds-kpi-row .ds-kpi:nth-child(4)` (con 3 tarjetas nunca matchea, queda muerta) — `.ds-card-grid` es `repeat(auto-fit, minmax(260px, 1fr))`, así que el layout de 3 tarjetas no necesita ningún otro cambio de CSS.
- `frontend/src/features/dashboard/OpportunityKpiCards.tsx`: sin cambios de props ni de estructura — sigue leyendo `kpiLabels(granularity)`/`buildKpiCards(summary)`, que ahora devuelven 3 en vez de 4.

**Tests:** hay que actualizar todos los que hoy afirman algo sobre "Valor del pipeline" o sobre `createdThisMonth`/`createdLastMonth`:

- `opportunity.service.test.ts` y `opportunityDashboard.integration-test.ts`: sacar las aserciones de `createdThisMonth`/`createdLastMonth` (incluida la que comparaba `createdThisPeriod` contra `createdThisMonth` cuando `granularity === "month"`, que ya no aplica).
- `frontend/src/test/dashboardFixtures.ts`: sacar esos dos campos del fixture.
- `kpi.test.ts`: sacar todos los tests de la card `pipelineValue`.
- `OpportunityKpiCards.test.tsx`: el esqueleto y las aserciones pasan de 4 rótulos a 3.
- `DashboardPage.test.tsx`: el test grande del §35 afirmaba explícitamente que "Valor del pipeline" NO se movía con el selector — esa tarjeta ya no existe, sacar esa parte del test (el resto del test, sobre las 3 que sí siguen al selector y el stock, se mantiene).
**Hallazgos al implementar:**

- **`DashboardPage.test.tsx` usaba "4500.00 USD" (el `openValue` de "Valor del pipeline") como señal de "la fila de KPIs ya tiene datos" en otros TRES tests**, además del test grande del §35 que el ítem sí nombraba: el de las 8 secciones, el de loading independiente y —vía un `toHaveLength(4)` de alerts— el de error parcial. Ninguno hablaba de la tarjeta; simplemente era el primer número del resumen que aparecía en pantalla. Los tres pasaron a esperar "3000.00 USD" (el "Ganado" del fixture) y el de alerts a 3. Es la misma clase de acoplamiento invisible que el ítem anticipó para el backend: un dato que sobrevive en los tests por ser conveniente, no por ser lo que se está probando.
- **La regla CSS muerta venía con un comentario igual de muerto.** Además de `.ds-kpi-row .ds-kpi:nth-child(4)`, el bloque arranca con "entrada escalonada de las cuatro tarjetas": se actualizó a tres, con la nota de que eran cuatro hasta el §36. Sacar la regla sin tocar el comentario habría dejado el archivo afirmando algo falso.
- **El test `con granularity=month el par del período ES el par mensual, sin consultar dos veces` se quedó sin premisa, no solo sin aserciones.** Su título describía el atajo que este ítem elimina. Se conservó el test (las dos aserciones directas sobre las ventanas mensuales siguen siendo válidas) con el título `con granularity=month las ventanas son el mes en curso y el anterior`, para que el trío mes/semana/día del service siga leyéndose como un juego completo.
- **El test de "sin base de comparación" de `OpportunityKpiCards.test.tsx` dependía de la tarjeta borrada para producir ese estado.** Forzaba `createdLastMonth: 0` y leía la línea de "Valor del pipeline". Se rearmó con datos consistentes: menos creadas que el período anterior (la variación en rojo, `-3 vs. mes anterior`) y nada cerrado el período anterior (`wonLastPeriod.count: 0`, `lostCountLastPeriod: 0`), lo que deja DOS líneas de "sin base de comparación" —"Ganado" y "Tasa de cierre"— y el test las verifica a las dos.
- **"Valor del pipeline" estaba nombrada en comentarios de cinco archivos que el ítem no listaba:** `opportunity.service.ts` (el bloque que explicaba los dos juegos de ventanas), `types.ts`, `kpi.ts`, `DashboardPage.tsx` ("lo que el selector NO toca") y `TopDealsList.tsx` (que justificaba su filtro por moneda citándola). Todos se actualizaron: borrar el código y dejar los comentarios describiendo una tarjeta que ya no existe es peor que no tocar nada.
- **Verificación visual (harness estático, `/browse`):** con tres tarjetas, `.ds-card-grid` (`auto-fit, minmax(260px, 1fr)`) las reparte en 400px cada una a 1280px de ancho, contra los ~296px que les tocaban siendo cuatro. El efecto secundario bueno es que el texto más largo de la fila, "— sin base de comparación la semana anterior", ahora entra en UNA línea: en el §35 era el único que envolvía a dos. A 420px de ancho las tres apilan sin scroll horizontal (`scrollWidth === clientWidth`).

**Decisiones tomadas al implementar:**

- **Las aserciones sobre `createdThisMonth` de tests que corrían con `granularity: "month"` se convirtieron a `createdThisPeriod` en vez de borrarse.** Con granularidad mensual la ventana es exactamente la misma, así que la cobertura que tenían —monedas ajenas que cuentan pero no suman, borradas y filas de otra organización que no cuentan ni suman— se conserva intacta apuntando al campo que quedó. Solo se borraron las aserciones donde el punto ERA la coexistencia de los dos pares (semanal y diaria).
- **En el test de integración semanal se conservó la aserción de `openValue`**, reescrita como lo que en realidad prueba: el stock abierto no tiene ventana, así que mover el selector no puede cambiarlo. Era la mitad honesta de un bloque que además comparaba el par mensual.
- **El comentario de `openCount`/`openValue` en `DashboardSummary` ahora dice por qué siguen ahí** (dos agregados baratos sobre el mismo índice, y la aserción de los tests de aislamiento multi-tenant), en vez de describirlos como la base de una tarjeta. El criterio es el mismo del §35, pero escrito donde se lee al leer el tipo.
- **`PERIOD_COPY` no se tocó.** Los cinco textos por granularidad (rótulos, comparación y ventana anterior) los usan las tres tarjetas que quedan; "Valor del pipeline" solo leía `PERIOD_COPY.month.comparison`/`.previous` desde afuera, así que su salida no dejó ningún texto huérfano.
- **Suites completas en verde:** frontend 128 archivos y 1224 tests (en el §35 eran 128 y 1229: se fueron los 5 de la tarjeta), backend 759 unitarios y 695 de integración contra el Postgres local. Typecheck, ESLint y Prettier limpios en los dos lados. Sin migración, sin dependencias nuevas, y el único cambio de CSS es una regla que se borra.

## 37. Animación de contador progresivo ("odómetro") para los números grandes del Dashboard, solo en la primera carga

**Estado:** hecho

**Contexto:** Rocco pidió, mostrando una captura del Dashboard, que los números grandes de las 5 tarjetas de arriba —las 2 de stock (`VehicleSummaryCards`: Unidades en stock, Disponibles) y las 3 de KPI comercial (`OpportunityKpiCards`: Oportunidades creadas, Ganado, Tasa de cierre)— tengan una animación de conteo progresivo tipo cuentakilómetros: que el número suba desde 0 hasta su valor real de forma fluida en vez de aparecer de golpe.

**Comportamiento deseado (confirmado con Rocco):**
- Al entrar al Dashboard, los 5 números grandes cuentan desde 0 hasta su valor real la primera vez que cargan.
- Después de esa primera carga, cambiar el selector de período (Mensual/Semanal/Diario) actualiza los 3 números que le siguen (Oportunidades creadas, Ganado, Tasa de cierre) directo a su nuevo valor, **sin volver a animar** — confirmado explícitamente con Rocco: la animación es solo de la primera carga, no de cada cambio de dato.
- Los estados sin número (`Cargando…`, error, o el "—" de Tasa de cierre cuando no se cerró nada en el período) no animan: se muestran igual que hoy.
- `prefers-reduced-motion: reduce` salta directo al valor final, sin contar — mismo criterio que el resto de las animaciones del Dashboard (§32, §34).

**Decisiones de implementación (mías, con un default razonable y reversible — no hace falta volver a preguntarle a Rocco, pero verificalas contra el código real antes de aplicarlas):**

- **Nuevo hook genérico `useCountUp`, en `frontend/src/lib/useCountUp.ts`** (mismo lugar que `useContainerWidth.ts`, mismo espíritu: un hook de comportamiento de navegador, sin nada de estilo). Firma: `useCountUp(target: number | null, durationMs = 900): number | null`.
  - Devuelve `null` mientras `target` es `null` (nada que animar todavía).
  - La primera vez que `target` deja de ser `null` en la vida de esa instancia del hook, anima desde 0 hasta `target` con `requestAnimationFrame`, easing `ease-out cubic` (`1 - (1-t)³`), a lo largo de `durationMs`.
  - Cualquier cambio de `target` DESPUÉS de esa primera animación (p. ej. el selector de período trae un número nuevo) actualiza el valor devuelto directo, sin volver a animar — un `useRef` booleano (`hasAnimatedRef`) marca "ya se animó una vez" y lo decide.
  - `prefers-reduced-motion: reduce` (chequeado con `window.matchMedia`, mismo guard defensivo que ya usa `theme.ts` para cuando `matchMedia` no existe) hace que la primera aparición también sea directa, sin animar.
  - Limpieza: cancela el `requestAnimationFrame` pendiente si el componente se desmonta a mitad de la animación.

- **Nuevo componente `AnimatedNumber`, en `frontend/src/design-system/AnimatedNumber.tsx`** (primitiva visual reusable, como `Card`/`Toast`): `<AnimatedNumber value={number | null} format={(n: number) => string} fallback={string} durationMs?={number} />`. Usa `useCountUp(value, durationMs)` y renderiza `format(display)`, o `fallback` mientras `display` es `null`. `fallback` cubre el caso "—" de Tasa de cierre y cualquier `null` que llegue.

- **`kpi.ts` (`buildKpiCards`) se extiende para exponer el número crudo detrás de cada `value`, no solo el string ya formateado**, porque animar requiere reformatear en cada frame intermedio con la MISMA lógica que arma el string final:
  - `KpiCard` gana dos campos: `numericValue: number | null` (el número que hay detrás de `value`; `null` cuando `value` es "—", es decir Tasa de cierre sin base) y `formatValue: (n: number) => string` (la misma función que produjo `value`, reutilizable con cualquier número intermedio).
  - `created`: `numericValue = summary.createdThisPeriod.count`, `formatValue = (n) => String(Math.round(n))`.
  - `won`: `numericValue = Number(summary.wonThisPeriod.value)`, `formatValue = (n) => formatAmount(String(n), summary.currency)` (reusa `formatAmount`, no reimplementa el formateo de moneda).
  - `winRate`: `numericValue = rateThisPeriod` (ya puede ser `null` hoy — en ese caso no hay nada que animar y `value` se queda en "—"), `formatValue = (n) => `${Math.round(n)}%``.
  - `value` (el string ya formateado) se sigue calculando igual que hoy, como `formatValue(numericValue)` cuando `numericValue` no es `null` — ningún test que solo mire `card.value` debería necesitar cambiar.

- **`OpportunityKpiCards.tsx`**: donde hoy se pinta `<dd className="ds-kpi-value">{card.value}</dd>`, pasa a pintar `<AnimatedNumber value={card.numericValue} format={card.formatValue} fallback={card.value} />` (el `fallback` cubre el "—" de Tasa de cierre). Sin cambios de props del componente ni de `kpi.ts` más allá de lo de arriba.

- **`VehicleSummaryCards.tsx`**: `card.total` (`number | null`) ya es el número crudo, no necesita pasar por `kpi.ts`. Donde hoy se pinta `{card.total}`, pasa a `<AnimatedNumber value={card.total} format={(n) => String(Math.round(n))} fallback="" />`.

- **Duración: 900ms**, más lenta que cualquier otra animación del dashboard (160-420ms) a propósito — un conteo que sube muy rápido no se lee como conteo, se lee como un parpadeo.

- **Entorno de test:** hoy no hay ningún mock de `window.matchMedia` en `frontend/src/test/setup.ts` (jsdom no lo implementa), así que sin un default explícito el hook animaría "de verdad" (con `requestAnimationFrame`) en cada test que monte una de estas 5 tarjetas, y los `getByText("5")`/`getByText("3000.00 USD")` de los tests ya existentes dejarían de ser inmediatos. Agregar en `setup.ts` un mock global de `matchMedia` que devuelva `matches: true` para `(prefers-reduced-motion: reduce)` (y `false` para cualquier otra query) dado que hoy no hay ninguno: así TODOS los tests existentes seguimos viendo el valor final de inmediato, sin tocarlos, y el conteo real se prueba aparte con un `matchMedia` mockeado a `matches: false` puntualmente en esos tests.

**Cómo se implementa:**
- `frontend/src/lib/useCountUp.ts` (nuevo): el hook.
- `frontend/src/design-system/AnimatedNumber.tsx` (nuevo): el componente.
- `frontend/src/features/dashboard/kpi.ts`: `KpiCard` con `numericValue`/`formatValue`, y el cálculo de cada `value` de `byKey` pasa a salir de `formatValue(numericValue)`.
- `frontend/src/features/dashboard/OpportunityKpiCards.tsx`: usar `AnimatedNumber` en el valor grande.
- `frontend/src/features/vehicle/VehicleSummaryCards.tsx`: usar `AnimatedNumber` en el valor grande.
- `frontend/src/test/setup.ts`: mock global de `matchMedia` (reduced motion por defecto) para que la suite existente no dependa de temporizadores.

**Tests:**
- `useCountUp.test.ts` (nuevo): con `matchMedia` mockeado a `matches: false` y timers/`requestAnimationFrame` controlados, verificar que devuelve `null` mientras `target` es `null`, que anima desde 0 hasta el `target` final, y que un cambio posterior de `target` NO vuelve a animar (salta directo). Con `matchMedia` mockeado a `matches: true`, verificar que salta directo al valor final sin pasos intermedios.
- `kpi.test.ts`: agregar aserciones de `numericValue`/`formatValue` por card (incluido el caso `winRate` con `numericValue: null` cuando no hay base de comparación), y confirmar que `formatValue(numericValue) === value` para no divergir del string ya probado.
- `OpportunityKpiCards.test.tsx`, `VehicleSummaryCards.test.tsx`: con el mock global de `matchMedia` (reduced motion) del `setup.ts`, las aserciones existentes sobre los valores finales no deberían necesitar cambiar. Sumar un test puntual, mockeando `matchMedia` a `matches: false` con timers controlados, que confirme que ANTES de que termine la animación el texto mostrado es distinto del valor final (está efectivamente contando) y que después de avanzar el tiempo total llega exacto al valor final.
- Correr la suite completa del frontend al final para confirmar que ningún test que dependía del valor apareciendo "instantáneo" se rompió por el cambio de `setup.ts`.

**Hallazgos al implementar:**

- **El `hasAnimatedRef` dentro del hook NO alcanzaba para "no volver a animar al cambiar de período", y era el corazón del pedido.** `useDashboardSummary` no usa `placeholderData`: al elegir un período todavía no visitado, `summary.data` pasa a `undefined`, las cards vuelven a "Cargando…" y el `<dd className="ds-kpi-value">` (con su `AnimatedNumber` adentro) se DESMONTA. Cuando llega el resumen semanal se monta una instancia nueva, con su ref en `false`, y habría contado otra vez desde 0. El plan solo funcionaba para períodos ya cacheados, donde el número no se desmonta. El "ya animó" tiene que vivir en quien sobrevive al cambio de período: `OpportunityKpiCards`, que `DashboardPage` no desmonta nunca. Se confirmó rompiéndolo a propósito: con `animate` fijo en `true`, fallan exactamente los tres tests de "no vuelve a contar" de `OpportunityKpiCards.test.tsx`.
- **Por el mismo motivo, "primera carga" es de la FILA y no de cada número.** Con la regla por instancia, una Tasa de cierre que en la primera carga es "—" (sin nada cerrado) y al pasar a Semanal tiene número habría contado ahí, porque es la primera vez que ESE número deja de ser `null`. Con el flag en el componente no cuenta. Tiene test propio.
- **ESLint (`react-hooks/set-state-in-effect`, del preset `recommended-latest` v7) rechaza la forma obvia de apagar el flag**: un `useEffect` que hace `setAnimateOnArrival(false)` cuando llega el primer resumen. Leer un ref durante el render tampoco pasa (`react-hooks/refs`). La solución fue ajustar estado durante el render (el patrón que documenta React para derivar estado de props): se guarda el primer resumen recibido y, en cuanto `summary.data` deja de ser ESE objeto (`undefined` al pedir otro período, u otro resumen), `arrivalDone` pasa a `true` y no vuelve. El cambio ocurre en ese mismo render, antes de que se monte ninguna instancia nueva; las de la primera llegada ya tomaron su decisión. Tiene que ser pegajoso: comparar solo "¿es el primer resumen?" fallaba al volver a Mensual mientras Semanal todavía cargaba, porque la caché devuelve la MISMA referencia del primer resumen y los números recién montados habrían vuelto a contar. Ese caso también tiene test.
- **La decisión de contar se toma durante el render, no en un efecto, también dentro del hook.** Si se decidiera en un `useEffect`, el primer render con dato devolvería el valor final y el conteo arrancaría un frame después: un parpadeo de "17000.00 USD → 0.00 USD → …". Con el estado `waiting | counting | settled` ajustado en el render, el primer frame que se pinta ya es el 0. El test del hook lo afirma (`toBe(0)` justo después del `rerender` con el número).
- **`theme.test.ts` afirmaba `typeof window.matchMedia === "undefined"`**, porque así era jsdom antes del mock global del §37. Ese test cubre el caso "navegador sin matchMedia" de `theme.ts`, que sigue siendo válido: ahora saca el mock a mano con `vi.stubGlobal("matchMedia", undefined)` antes de afirmarlo. `ThemeContext.test.tsx` no necesitó cambios: sus stubs se deshacen con `vi.unstubAllGlobals()`, que devuelve el valor de antes del stub, es decir el mock del setup y no el `undefined` original. El comentario de `AppLayout.test.tsx` que decía "sin matchMedia en jsdom resuelve Sistema a claro" se actualizó: sigue resolviendo a claro, pero porque el mock responde `matches: false` a `prefers-color-scheme: dark`.
- **`VehicleSummaryCards` también encabeza el listado de Stock (`VehicleListPage`)**, no solo el Dashboard. Aplicar el cambio tal como estaba escrito habría animado también ese listado, que no fue lo pedido (ver decisiones).
- **`VehicleSummaryCards.test.tsx` no existía.** El ítem lo nombraba como un test a completar, pero el componente solo se probaba de rebote desde `DashboardPage.test.tsx` y `VehicleListPage.test.tsx`. Se creó con los valores finales, el estado de error, el conteo con `countUp` y la ausencia de conteo sin él.
- **Los timers falsos se limitan a `requestAnimationFrame`/`cancelAnimationFrame`** (`vi.useFakeTimers({ toFake: [...] })`) en los tests de componente. Con el `setTimeout` real, MSW (`delay`), `waitFor` y `userEvent` siguen funcionando igual que en el resto de la suite, y el conteo avanza solo cuando el test llama a `vi.advanceTimersByTime`. Eso da un chequeo fuerte de "no volvió a contar": después del cambio de período se espera el valor final SIN avanzar ningún frame; si contara, se quedaría clavado en 0. En `useCountUp.test.ts` se falsea además `performance`.
- **`npm run format:check` marca 4 archivos de `frontend/dist/`** (`index.html`, `widget.js` y dos assets). Es salida local de `npm run build`, está en `.gitignore` pero no en `.prettierignore`, y ya pasaba antes de este ítem: en CI no hay `dist/`. Los fuentes están limpios.
- **Un comentario viejo de `DashboardPage.tsx` todavía hablaba de "la fila de 4 KPI comerciales"**, que son 3 desde el §36. Se corrigió al pasar por el archivo.
- **Verificación visual en la app real (`/browse`), no en un harness:** frontend en Vite contra el backend y el Supabase LOCAL, sesión de Rocco en la org `test-local` iniciada con un magic link generado por la API admin del Supabase local (sin tocar ninguna contraseña). Para ver la animación sin depender de la suerte de una captura se grabó el texto de las 5 `.ds-kpi-value` en cada `requestAnimationFrame` de la página:
  - **Entrar al Dashboard:** 55 frames distintos, de `0 | 0 | 0 | 0.00 USD | 0%` a `9 | 1 | 5 | 17000.00 USD | 50%` en ~915ms, con un valor nuevo cada ~16ms (un frame de pantalla) y el frenado del ease-out bien visible en el tramo final (`16976.75` → `16999.14` → `16999.89` → `17000.00`). Se ve fluido, sin saltos. La captura tomada a mitad del conteo muestra los números subiendo (`7`, `4`, `12370.39 USD`, `36%`) junto con la entrada con fundido que las cards ya tenían desde el §32; las dos animaciones conviven bien.
  - **Semanal y Diario (no visitados):** 2 frames cada uno, "Cargando…" y enseguida los números finales (`5 | 0.00 USD | —` y `0 | 0.00 USD | —`). Sin conteo.
  - **Volver a Mensual (en caché):** 1 frame, directo a `5 | 17000.00 USD | 50%`.
  - **Listado de Stock:** `9 | 1` directo, sin contar.
  - Consola sin errores.

**Decisiones tomadas al implementar:**

- **`useCountUp(target, { durationMs, animate })` en vez de `useCountUp(target, durationMs)`.** La opción `animate` es el canal por el que `OpportunityKpiCards` le dice a una instancia recién montada que la fila ya animó. `useCountUp` solo la lee la primera vez que llega un número; después la ignora, así que el cambio del prop no interrumpe un conteo en curso. `AnimatedNumber` la expone tal cual.
- **Un cambio de `target` a MITAD del conteo salta directo al valor nuevo**, igual que cualquier cambio posterior a la llegada. El ítem no lo cubría. Las alternativas eran reiniciar desde 0 (se leería como una segunda animación) o reencauzar el conteo hacia el nuevo valor (más estado para un caso que en la práctica es un refetch de fondo dentro de 900ms). Tiene test.
- **Sin `matchMedia` (navegador sin soporte) se ANIMA.** Es el mismo guard defensivo de `theme.ts`, pero leído como "no hay preferencia declarada", que es lo que significa ahí. En los tests no pasa nunca porque existe el mock global.
- **`VehicleSummaryCards` cuenta solo con `countUp` (opt-in, `false` por defecto), y `DashboardPage` es la única que lo pasa.** El pedido fue para el Dashboard, y el mismo componente encabeza el listado de Stock: animarlo también ahí habría sido un cambio de UX que nadie pidió. Si Rocco lo quiere también en el listado, alcanza con agregar `countUp` en `VehicleListPage.tsx`. Para el stock sí alcanza la regla por instancia de `AnimatedNumber`: esas cards no siguen al selector, así que el número no se desmonta después de la primera carga (un refetch de fondo no pasa por `isLoading`). Un flag único para las dos, como en `OpportunityKpiCards`, habría estado mal: son dos requests independientes, y el primero en llegar apagaría la animación del segundo.
- **Volver a entrar al Dashboard desde otra pantalla cuenta de nuevo.** La página se monta de cero y los datos salen de la caché. Se leyó "al entrar al Dashboard, los números cuentan la primera vez que cargan" como la primera carga de cada visita a la página, no de la sesión entera. Hacerlo por sesión requeriría estado global fuera del árbol del Dashboard.
- **`kpi.ts` arma las tres cards con un helper `card(numericValue, formatValue)`** que calcula `value = numericValue === null ? "—" : formatValue(numericValue)`. Así es literalmente imposible que el string final y el último frame del conteo diverjan, y el guion sale de un solo lugar. `won` pasa a formatear `String(Number(value))`, que da exactamente lo mismo que antes para cualquier `Decimal` del contrato: ningún test existente sobre `card.value` cambió, y hay un test nuevo que afirma `formatValue(numericValue) === value` en cada card, con varios resúmenes.
- **`COUNT_UP_DURATION_MS = 900` se exporta** para que los tests avancen "la duración" en vez de repetir el número mágico.
- **Sin CSS nuevo.** Durante el conteo el ancho del número varía (los dígitos de Public Sans no son de ancho fijo). Como el valor está alineado a la izquierda, solo se mueve el borde derecho y en la app no se percibe como salto. `font-variant-numeric: tabular-nums` en `.ds-kpi-value` lo eliminaría del todo, pero es un cambio de diseño que no fue pedido: queda anotado como candidato.
- **Tests nuevos:** `useCountUp.test.ts` (10 tests: null y conteo creciente y exacto, ease-out, cambio posterior y paso por null, cambio a mitad, reduced motion, el default del setup, `animate: false`, sin matchMedia, `durationMs`, cancelación al desmontar), 5 en `kpi.test.ts`, 4 en `OpportunityKpiCards.test.tsx` (conteo de llegada, período no visitado, volver al período en caché mientras el otro carga, "—" que después tiene número), `VehicleSummaryCards.test.tsx` (4, archivo nuevo) y uno de cableado en `DashboardPage.test.tsx` (stock y KPI cuentan al entrar; Semanal después no).
- **Suites completas en verde:** frontend 130 archivos y 1248 tests (en el §36 eran 128 y 1224). Typecheck (`tsc -b`), ESLint, Prettier sobre los fuentes y `npm run build` (app y widget) limpios. Solo frontend: sin cambios de backend, migraciones, dependencias ni CSS.

## 38. Achicar los puntos de datos del gráfico de ingresos

**Estado:** hecho

**Contexto:** Rocco pidió, mostrando una captura del Dashboard en vista Diario, que los puntos de datos del gráfico "Ingresos ganados por [período]" (`RevenueByMonthChart.tsx`) sean más chicos — hoy se ven grandes, sobre todo con muchos puntos juntos (la vista Diario tiene hasta 30). Hay dos círculos distintos en juego, ambos en `design-system.css`: `.ds-chart-point` (uno por cada punto de la serie, `r={4}` fijado inline en el componente, `stroke-width: 2`) y `.ds-chart-crosshair-point` (el círculo resaltado del punto activo al pasar el mouse, `r={6}` inline, mismo `stroke-width: 2` — el comentario del CSS ya dice que es "el mismo par fill/stroke que `.ds-chart-point`, más grande").

**Comportamiento deseado:** los puntos de la serie se ven notoriamente más chicos que hoy, sin dejar de ser visibles ni de tener área suficiente para el `<title>` (tooltip nativo) y el hit-testing del hover. El círculo resaltado del crosshair sigue siendo más grande que los puntos normales (es la señal de "este es el que estás mirando"), pero también achicado en la misma proporción.

**Decisiones de implementación (mías, con un default razonable y reversible — no hace falta volver a preguntarle a Rocco, pero verificalas visualmente antes de darlas por buenas):**

- Punto de partida sugerido, a ajustar viendo cómo se ve realmente en el navegador (no hay una medida "correcta" única, esto es una decisión de gusto visual):
  - `.ds-chart-point`: `r={4}` → `r={3}` en `RevenueByMonthChart.tsx` (es un atributo SVG inline, no CSS — está en el `<circle>` dentro de `ChartSvg`). `stroke-width` en `design-system.css`: `2` → `1.5`, para que el aro no quede grueso respecto del círculo más chico.
  - `.ds-chart-crosshair-point`: `r={6}` → `r={5}` en `RevenueByMonthChart.tsx` (dentro de `Crosshair`). Mismo `stroke-width: 1.5` en `design-system.css`, para que los dos círculos queden consistentes entre sí.
- Si al verlo en el navegador el punto queda demasiado chico para leerse cómodo (sobre todo en la vista Mensual, con menos puntos y más espaciados, donde SÍ hay lugar de sobra), ajustar el número hasta que se vea bien — priorizar que se vea bien por sobre seguir el número sugerido al pie de la letra.
- Probar las tres granularidades (Mensual, Semanal, Diario): la Diaria es la que motivó el pedido (más puntos, más juntos), pero el cambio es al mismo componente/CSS para las tres, así que hay que confirmar que también se ve bien con pocos puntos separados.
- Sin cambios de comportamiento: el hover, el crosshair, el `<title>` de cada punto y la animación de entrada escalonada (`ds-rise-in` por `--ds-chart-index`) siguen igual, solo cambia el tamaño.

**Cómo se implementa:**
- `frontend/src/features/dashboard/RevenueByMonthChart.tsx`: el `r={4}` del `<circle className="ds-chart-point">` dentro de `ChartSvg`, y el `r={6}` del `<circle className="ds-chart-crosshair-point">` dentro de `Crosshair`.
- `frontend/src/design-system/design-system.css`: `stroke-width` de `.ds-chart-point` y `.ds-chart-crosshair-point`.

**Tests:** ninguno nuevo necesario — es un cambio puramente visual (radio y grosor de trazo) sobre un elemento que los tests existentes (`RevenueByMonthChart.test.tsx`) verifican por presencia/estructura, no por tamaño en píxeles. Correr igual la suite completa del frontend para confirmar que nada se rompe, y hacer la verificación visual en el navegador en las tres granularidades (es lo único que realmente confirma si el tamaño quedó bien).

**Hallazgos al implementar:**

- **El tamaño del círculo no afecta el hover.** Desde el §33 los círculos no reciben eventos de puntero: hay un único `<rect className="ds-chart-hit">` encima de todo y el punto activo sale de `nearestPointIndex` por la X del mouse. Achicar el radio no reduce el área de hit-testing; solo el `<title>` nativo depende del círculo, y lo leen lectores de pantalla (el `<rect>` lo tapa para el mouse desde antes).
- **`tooltipLayout` no depende del radio.** El tooltip se ubica con `TOOLTIP_BOX.gap` fijo sobre el centro del punto, así que con el círculo resaltado más chico queda un poco más de aire arriba, sin tocar nada más.
- **Verificación visual con el componente real, no con la app logueada.** Generar el magic link con la API admin del Supabase local quedó bloqueado por el clasificador de permisos (leía la service-role key del `.env`), así que no se entró al Dashboard con sesión. En cambio se montó `RevenueByMonthChart` tal cual, con el CSS real (`tokens.css`, `global.css`, `design-system.css`), en una página temporal servida por el mismo Vite, con un `QueryClient` precargado con series de ejemplo de las tres granularidades (12 meses, 12 semanas, 30 días con ceros intercalados). La página se borró antes del commit. Recorrido con `/browse`:
  - **Atributos en el DOM:** `r="3"` y `stroke-width` computado `1.5px` en los 54 puntos; `r="5"` en el crosshair. Consola sin errores.
  - **Diario (30 puntos):** comparado lado a lado contra el mismo gráfico con `r=4`/`stroke 2` y `r=6`/`stroke 2` forzados por JS: el diámetro exterior baja de 10px a 7,5px y el cúmulo de puntos deja de dominar la curva. Con hover, el círculo resaltado (r=5) se distingue sin problema de los vecinos (r=3).
  - **Mensual y Semanal (12 puntos, bien espaciados):** los puntos siguen leyéndose cómodos, no quedan "perdidos" sobre la línea.
  - **Escala 1x y tema oscuro:** el aro de 1.5px se ve nítido a 1x (no se empasta) y en oscuro mantiene el contraste de `--color-accent` contra el fondo.

**Decisiones tomadas al implementar:**

- **Tamaño final = el punto de partida sugerido:** `.ds-chart-point` en `r=3` con `stroke-width: 1.5`, `.ds-chart-crosshair-point` en `r=5` con `stroke-width: 1.5`. Se miró si convenía bajar más (r=2.5) o quedarse en un intermedio, pero con r=3 la vista Diaria ya queda despejada y en Mensual/Semanal el punto sigue siendo claramente un marcador; más chico empezaría a perderse en la vista con pocos puntos. La proporción entre los dos círculos pasa de 6:4 a 5:3, así que el resaltado destaca incluso un poco más que antes.
- **Se actualizó el comentario de `.ds-chart-crosshair-point`** en `design-system.css`, que citaba los radios viejos ("r=6 contra r=4").
- **Sin tests nuevos:** `RevenueByMonthChart.test.tsx` no afirma radios ni grosores. Suites completas del frontend en verde: 130 archivos y 1248 tests (igual que en el §37), `tsc -b`, ESLint y Prettier sobre los fuentes limpios (`format:check` solo marca los 4 archivos de `dist/` local ya conocidos). Solo frontend: sin cambios de backend, migraciones ni dependencias.

## 39. Cotización: registrar la oferta de precio que se le hace al cliente, con historial

**Estado:** hecho

**Contexto:** Hoy no existe ninguna entidad que represente la cotización/presupuesto que se le ofrece al cliente por un vehículo — lo único que se llama "cotización" en el código es `ExchangeRate` (el tipo de cambio USD↔moneda local), que es un concepto completamente distinto. `Opportunity` tiene un `amount`/`currency` propio, pero es un número de gestión interna (lo que se espera cerrar), no el documento de oferta formal que se negocia con el cliente. Para una automotora, la cotización es una pieza central del proceso de venta: se ofrece un precio, el cliente pide un descuento, se vuelve a ofertar, y así hasta cerrar (o perderse).

**Comportamiento deseado (confirmado con Rocco):**
- Cada Oportunidad tiene, en un momento dado, **una sola cotización activa** — la que está vigente ahora mismo (el precio que el cliente tiene sobre la mesa).
- Al crear una cotización nueva sobre una Oportunidad que ya tenía una vigente (típico: "le bajo el precio"), la anterior pasa a **historial** — no se borra ni se edita, queda visible en una pestaña/lista de Historial de cotizaciones de esa Oportunidad, de más nueva a más vieja.
- Sin generación de PDF en esta vuelta: alcanza con una pantalla clara dentro de la Oportunidad que muestre el detalle y los montos de la cotización activa, imprimible desde el navegador (`window.print()` + CSS de impresión razonable) si hace falta — el PDF con membrete queda anotado como un ítem aparte para más adelante, no es parte de este.
- Sin efectos automáticos todavía: aceptar o rechazar una cotización no mueve la Oportunidad de etapa ni la marca ganada/perdida por sí solo — eso es responsabilidad del vendedor (o de una Automatización configurada más adelante, catálogo que hoy no cubre esto). Este ítem es la entidad y su pantalla, no un flujo automático.

**Decisiones de implementación (mías, con un default razonable y reversible — no hace falta volver a preguntarle a Rocco, pero verificalas contra el código real antes de aplicarlas):**

- **Nuevo modelo `Quote`** en `prisma/schema.prisma`, mismo patrón de aislamiento multi-tenant que el resto (organization-scoped, `@@unique([organizationId, id])`, RLS igual que las demás tablas de negocio — mirar cómo está resuelto en una migración reciente de una tabla nueva, p. ej. la de `Booking`, y replicar el mismo mecanismo, no inventar uno nuevo). Campos:
  - `opportunityId` (FK a `Opportunity`, obligatoria — una cotización siempre es de una Oportunidad).
  - `vehicleId` (FK a `Vehicle`, nullable — se completa con el vehículo de la Oportunidad al momento de crear la cotización, como una FOTO: si después cambia el vehículo de la Oportunidad, las cotizaciones viejas siguen apuntando al vehículo que tenían cuando se hicieron).
  - `amount`/`currency` (mismo tipo que `Opportunity.amount`/`currency`, `Decimal(14,2)`/`VarChar(3)`) — el precio ofertado, independiente del `priceListUsd`/`priceListLocal` del vehículo (la negociación puede terminar en cualquier número).
  - `lines` — lista simple de líneas adicionales (accesorios, descuentos), cada una con una descripción de texto libre y un monto (puede ser negativo para un descuento). Sin catálogo de accesorios ni impuestos: es texto + número, a propósito, para no construir un motor de facturación.
  - `validUntil` (fecha, nullable) — hasta cuándo es válida la oferta.
  - `status`: `DRAFT` (se está armando) → `SENT` (ya se le mostró/mandó al cliente) → `ACCEPTED` | `REJECTED` | `EXPIRED`. Además `SUPERSEDED`, que es el estado al que pasa automáticamente una cotización cuando se crea una nueva sobre la misma Oportunidad mientras la anterior seguía en `DRAFT` o `SENT` (no llegó a un estado final).
  - `createdBy` (`userId`, quién la armó), `createdAt`.
  - Índice `@@index([organizationId, opportunityId, createdAt])` para el historial (más nueva primero) y para resolver rápido "la activa" (la de `createdAt` más reciente que no esté en `SUPERSEDED`).
- **"La activa" se resuelve por consulta, no por un flag redundante**: es la cotización de esa Oportunidad con el `createdAt` más reciente entre las que NO están en `SUPERSEDED`. Evita un booleano `isActive` que se podría desincronizar.
- **Reglas de transición, en el service (`quote.service.ts`), no en la base:**
  - Crear una cotización nueva cuando la Oportunidad tiene una activa en `DRAFT` o `SENT`: la anterior pasa a `SUPERSEDED` en la misma transacción.
  - Crear una cotización nueva cuando la activa está en `ACCEPTED`: **bloqueado** (400) — una cotización aceptada es la que se usa para cerrar la venta; si hace falta volver a cotizar, es una decisión de negocio que este ítem no cubre (se puede reabrir más adelante si Rocco lo pide).
  - Crear una cotización nueva cuando la activa está en `REJECTED` o `EXPIRED`, o cuando no hay ninguna: permitido siempre.
  - `PATCH` de estado (`SENT`/`ACCEPTED`/`REJECTED`): solo transiciones hacia adelante desde el estado correcto (mismo criterio de `Invitation`, compare-and-swap: `updateMany` condicionado al estado esperado, no un `UPDATE` ciego). El monto/las líneas de una cotización ya `SENT` no se editan — corregir el precio es crear una cotización nueva (así el historial es honesto: lo que se le mostró al cliente no cambia por atrás).
  - Una `DRAFT` sí se puede editar libremente (todavía no se le mostró a nadie).
- **Backend:** `quote.controller.ts` (schemas Zod: `createQuoteSchema`, `updateQuoteStatusSchema`), `quote.service.ts` (`createQuote`, `updateQuoteStatus`, `listQuotesByOpportunity`, `getActiveQuote`), `quote.routes.ts` — mismo patrón que `activity.routes.ts`: `GET /quotes?opportunityId=`, `GET /quotes/:id`, `POST /quotes`, `PATCH /quotes/:id` (solo status). Sin `DELETE`: una cotización no se borra, se supera.
- **Frontend:** una sección "Cotización" dentro de la ficha de Oportunidad (`OpportunityDetailPage` o donde viva hoy el detalle), con la cotización activa arriba (monto, líneas, validez, estado, acciones según el estado — "Enviar", "Marcar aceptada", "Marcar rechazada", "Nueva cotización") y una pestaña/sección "Historial" con las anteriores en solo lectura. Vista imprimible razonable (CSS de impresión simple) para la cotización activa.

**Cómo se implementa:**
- `prisma/schema.prisma` + migración nueva (modelo `Quote`, enum `QuoteStatus`, RLS).
- `src/controllers/quote.controller.ts`, `src/services/quote.service.ts`, `src/routes/quote.routes.ts`, registrar la ruta en `src/routes/index.ts`.
- `frontend/src/features/quote/` (nuevo): tipos, `api.ts`, `queries.ts`, el componente de la sección de Cotización + Historial, integrados en la página de detalle de Oportunidad.

**Tests:**
- Backend: unitarios de `quote.service.ts` (crear activa, superar la anterior al crear una nueva, bloquear si la activa está `ACCEPTED`, transiciones de estado válidas/inválidas, aislamiento multi-tenant) y de integración contra Postgres real (RLS, el mismo criterio que el resto de las entidades de negocio).
- Frontend: la sección de Cotización (estados, acciones habilitadas según status) y el Historial, con MSW.

**Nota de alcance:** este ítem es la entidad y la pantalla. Quedan fuera a propósito, para ítems futuros si hacen falta: PDF exportable, envío por email, y cualquier automatización disparada por el estado de la cotización (mover de etapa, marcar la Oportunidad ganada).

**Hallazgos al implementar:**

- **No existe `OpportunityDetailPage`.** La "ficha" de una oportunidad es `OpportunityFormPage` en `/opportunities/:id/edit`, dentro del `AdminRoute`; el único detalle de solo lectura es el pop up "Ver detalle" del §28. La sección va en el formulario de edición, **debajo y fuera del `<form>`**: tiene sus propios formularios y botones, y un `<form>` no se puede anidar. En creación no se monta (una oportunidad que no existe no tiene a qué colgarle una cotización), y hay tests de las dos cosas en `OpportunityFormPage.test.tsx`.
- **El patrón de RLS de las tablas nuevas es el de M-5 (`20260901120000`), no algo propio de `bookings`.** `bookings` nació SIN RLS (`20260830120000`) y la recibió después, en esa migración. Lo que repiten las tablas nuevas desde entonces (`vehicles`, `automations`) es: `enable row level security` + política `<tabla>_isolation` `for all` con `USING`/`WITH CHECK` sobre `current_organization_id()`, FKs compuestas `(organization_id, x_id)`, y que en el MISMO cambio la tabla entre al diagnóstico: política a la fila 5, CHECK a la fila 8, FKs a la fila 16 (44 → 47) y los contadores de `scripts/verify-schema.ts` (24 CHECK, 47 FKs). `verify:schema` da 14/14 contra la base local con la migración aplicada, y `prisma migrate diff` no muestra drift en `quotes`. De paso: el comentario de `schema.prisma` sobre el módulo de agentes dice que `bookings`/`working_hours` "tampoco tienen políticas RLS", cosa que dejó de ser cierta con M-5. No se tocó (fuera de alcance); queda anotado.
- **El ítem se contradecía en el PATCH:** "`PATCH /quotes/:id` (solo status)" pero también "una DRAFT sí se puede editar libremente". Sin una segunda forma de PATCH no habría con qué editar un borrador. Se resolvió con dos formas excluyentes del mismo endpoint (ver decisiones).
- **El ítem no decía quién pone `EXPIRED`.** No está entre los estados del PATCH, y no hay jobs para esto. El proyecto ya tiene el mecanismo: el vencimiento perezoso de `Invitation` (`expireDueInvitations`), que se corre antes de cada operación que depende del estado. `expireDueQuotes` es el mismo molde sobre `valid_until`.
- **Carrera real encontrada al escribir los tests, que el compare-and-swap NO cubría.** El plan original ponía `lockOpportunityForUpdate` (ya existía, del trigger `opportunity.won`) solo en `createQuote`. Pero el PATCH que acepta hace su CAS sobre la fila de la cotización sin tomar el lock de la oportunidad. Si un "Marcar aceptada" comitea entre la lectura de la activa y el `supersedeOpenQuotes` de una creación concurrente, el `supersede` ya no la toca (filtra DRAFT/SENT) y la creación inserta una cotización nueva ENCIMA de una aceptada, que es exactamente lo que la regla bloquea. Arreglo: `updateQuoteStatus` también corre en una transacción bajo el mismo lock, así todas las escrituras que deciden sobre "la activa" se serializan en la fila de la oportunidad.
- **Los tests de carrera se comprobaron falsables**, con la técnica de `carreras.test-helper.ts` (transacción A con el lock real + `pg_blocking_pids`). Sacando a mano el lock de `createQuote` fallan "crear vs crear" y "aceptar vs crear". Pero "crear vs aceptar" seguía pasando sin el lock de `updateQuoteStatus`, porque el CAS se bloqueaba igual contra el lock de FILA que A ya había tomado al superar la cotización. Se agregó un cuarto caso donde A toma el lock de la oportunidad y todavía no tocó ninguna cotización: ese sí falla sin el lock en el PATCH. El service se restauró y se verificó después de cada prueba.
- **`Organization.timezone` existe (default `"UTC"`) pero ningún flujo lo cambia.** El vencimiento se decide contra la fecha de hoy en esa zona (`todayInTimeZone`), así que hoy, en la práctica, el día termina a la medianoche UTC: una cotización "válida hasta el 30" vence a las 21:00 del 30 en Montevideo. Queda bien el día que se configure la zona de la organización. Anotado como límite conocido.
- **Una cotización de una oportunidad eliminada seguía siendo alcanzable por id** (`GET /quotes/:id`, PATCH), aunque su historial ya daba 404. Se agregó `requireReachableQuote`: da el mismo 404 que un id inexistente. Tiene test.
- **Verificación visual real con `/browse`, en la app logueada:** frontend Vite + backend + Supabase LOCAL, sobre la oportunidad sembrada "[SEED] Corolla para Ana" (con unidad vinculada). Para no tocar la cuenta de Rocco ni generar magic links, se creó un usuario QA ADMIN con contraseña **solo en el Supabase local** (mismo freno por hostname que `seed:dev-data`). Al terminar se borraron sus 3 cotizaciones y el usuario. Recorrido:
  - Sin cotizaciones: estado vacío y solo "Nueva cotización".
  - **Crear la primera:** el panel arranca con el monto de la oportunidad (15.000,00 USD). Con validez 30/09, "Polarizado" +350 y "Descuento pago contado" −1.000 queda en Borrador, con total 14.350,00 USD, "Unidad: [SEED] Subaru Outback 2023 · STK-000006" (la foto del vehículo) y "Válida hasta el 30 sept 2026".
  - **Enviar** la deja Enviada, con "Marcar aceptada"/"Marcar rechazada". **Marcar rechazada** pide el `confirm` y la deja Rechazada.
  - **Segunda cotización** sobre la rechazada: arranca con los valores de la activa y **sin** el aviso de reemplazo (una rechazada no se supera). Guardada a 14.000, la primera pasa al historial como "Rechazada", no como "Reemplazada".
  - **Enviar la segunda y crear una tercera** encima: esta vez aparece el aviso "la cotización vigente pasa al historial como reemplazada". Al guardar, el historial queda "13.350,00 USD · Reemplazada" y "14.350,00 USD · Rechazada", más nueva primero, y cada entrada se abre con su desglose.
  - **Enviar y aceptar la tercera:** queda Aceptada y "Nueva cotización" se deshabilita con el motivo a la vista. Y no es solo el botón: un `POST /api/quotes` real hecho desde la página con la sesión devolvió **409**.
  - **Impresión:** aplicando las reglas `@media print` de la hoja real, en la página queda solo la cotización (título "Cotización", nombre de la oportunidad, estado, desglose y validez), sin sidebar, formulario, acciones ni historial.
  - **Bug visual encontrado y corregido:** la columna "Importe" salía alineada a la izquierda, porque `.ds-table th/td` le gana en especificidad a `.ds-quote-amount`. Pasó a `.ds-table .ds-quote-amount` y se confirmó en el navegador (`text-align: right`). Consola sin errores en todo el recorrido.

**Decisiones tomadas al implementar:**

- **Modelo `Quote` tal como lo proponía el ítem, más tres cosas:** `updatedAt` (para la edición de borradores y las transiciones), `createdById` con FK compuesta a `users` (NOT NULL → RESTRICT) y **ningún `deletedAt`** (no se borra, se supera). Un único índice `(organization_id, opportunity_id, created_at)` sirve al historial, a "la activa" y al lado referenciante de la FK a `opportunities`. Sin índices sobre `vehicle_id` ni `created_by_id`: no hay vistas por unidad ni por vendedor, y `vehicles`/`users` nunca se borran físicamente (mismo criterio que `vehicle_change_logs.changed_by_id`). CHECK `quotes_amount_non_negative_check (amount >= 0)`, el mismo de `opportunities`.
- **`lines` es una columna JSONB `[{ description, amount }]`, no una tabla hija.** Las líneas no se consultan ni se referencian solas: se leen y se escriben siempre con su cotización, y una vez SENT son inmutables junto con ella. Una tabla aparte habría sumado su propia RLS, FK compuesta y entradas al diagnóstico sin ninguna consulta que lo justifique. El importe de cada línea se guarda como **string con dos decimales** (`"-1000.00"`), la misma forma en que la API serializa un `Decimal`, para no pasar plata por un float de JSON. La forma la valida zod en el borde, como `automations.action_config`.
- **"La activa" se resuelve por consulta** (la más reciente no SUPERSEDED, desempatando por `id`) y **el listado la devuelve como `activeQuoteId`**, así el frontend no reimplementa la regla. `GET /quotes?opportunityId=` exige el `opportunityId` (400 sin él), pagina con `pageSize` hasta 100 (default 50) y devuelve 404 si la oportunidad no existe o está eliminada. El frontend pide una sola página de 100.
- **Crear con la activa ACCEPTED es 409, no 400** como decía el ítem. Es el criterio del código real para un conflicto con el estado actual (`UNIDAD_NO_DISPONIBLE`, los conflictos de `Invitation`), porque no es un dato inválido. Todas las transiciones inválidas también son 409, con un mensaje por estado (`transitionConflictError`, el equivalente de `revokeConflictError`), compartido entre el pre-check y la traducción post-CAS.
- **Máquina de estados estricta:** `SENT` solo desde `DRAFT`; `ACCEPTED` y `REJECTED` solo desde `SENT`. Una DRAFT no se acepta sin enviarse: no se le mostró a nadie, no hay nada que el cliente pueda aceptar. Crear sobre una REJECTED o EXPIRED **no la pasa a SUPERSEDED**: queda en el historial con su estado final, que es más honesto que "reemplazada".
- **PATCH con dos formas excluyentes:** `{ status }` (una transición) o `{ amount?, currency?, lines?, validUntil? }` (editar un borrador, con CAS condicionado a `status = DRAFT` en `updateDraftQuoteContent`). Los dos schemas son `.strict()` y mezclarlos es 400, mismo criterio que `confirmed` + `completedAt` en Activity (§29). Editar algo que no está en DRAFT es 409, con "para cambiar una ya enviada, creá una nueva".
- **Vencimiento perezoso solo para SENT.** `valid_until < hoy` (en la zona de la organización) la pasa a EXPIRED; el día de `valid_until` todavía vale entero. Una DRAFT con la fecha pasada no vence (no hay oferta que venza), pero **enviarla es 409** con "corregila antes de enviarla" (`assertSendable`), para no crear una cotización que nace vencida. `expireDueQuotes` corre antes de listar, leer, crear y cambiar de estado. Límite aceptado: el CAS de aceptar no vuelve a mirar la fecha (a diferencia de B-18 en Invitation, que compara contra `clock_timestamp()`). Con granularidad de día, la ventana son los milisegundos alrededor de la medianoche entre el vencimiento y el UPDATE.
- **Permisos iguales a `opportunity.routes.ts`:** lectura para cualquier autenticado de la organización, escritura `authorize("ADMIN")` con `businessWriteRateLimiter`, y sin `DELETE` (el test de montaje afirma que el DELETE cae en `notFound`). Sin gating por rol en el frontend, porque la sección vive en una ruta ADMIN-only.
- **Aceptar o rechazar pide `window.confirm`**, el mismo de los "Eliminar" de los listados: son transiciones finales, y la aceptada además bloquea crear otra. Enviar no pide confirmación.
- **Frontend: dos tarjetas, "Cotización" e "Historial de cotizaciones"**, con `aria-label` para que sean regiones con nombre. La activa y cada entrada del historial usan el mismo `QuoteDetail` (estado, quién y cuándo, unidad, desglose con total y validez), así lo que se imprime es lo que se ve. El historial es una lista de `<details>` nativos, colapsados, con "fecha · total · estado" en el resumen: solo lectura, sin estado ni botones.
- **Alta y edición en el panel lateral del sistema** (`Modal` variant "panel", acción principal por `formId`), que no se cierra con Escape ni clic afuera: acá eso protege lo tipeado. Una cotización nueva **arranca de la activa** si la hay (el caso típico es "le bajo el precio": mismos accesorios, otro número) o, si no, del monto y la moneda de la oportunidad. La validez arranca vacía siempre, porque es una oferta nueva. Cuando la activa está en DRAFT/SENT, el panel avisa que va a pasar al historial.
- **Las líneas se cargan como tipo (Accesorio/Descuento) + importe positivo**, con el `CurrencyInput` de siempre, que no admite signo. El negativo lo arma `toQuoteInput`: nadie tipea "−500" para un descuento. El total se suma **en centavos enteros** (`quoteTotal`) y se muestra con el formato uruguayo de `currencyFormat.ts`, más el signo menos tipográfico en los negativos (`formatMoney`).
- **Impresión con CSS, sin componente propio:** "Imprimir" llama a `window.print()`, y `@media print` oculta todo con `visibility` salvo `.ds-quote-printable`, que se saca del flujo y va arriba de la hoja. Se usa `visibility` y no `display` porque la cotización está anidada dentro del layout, y un `display: none` en un ancestro la ocultaría también. Un encabezado `.ds-print-only` (título + nombre de la oportunidad) aparece solo en papel. El PDF con membrete sigue fuera de alcance.
- **CSS nuevo en `design-system.css`**, en un bloque propio con tokens del sistema (mismo criterio que `.ds-mapping-rows`): `.ds-quote*`, las líneas del formulario en una grilla de dos columnas para el panel de 360px, y el bloque de impresión.
- **Tests nuevos del backend:**
  - `quote.service.test.ts` (10): crear sobre cada estado, origen de cada transición, conflicto por estado, `assertSendable`, `todayInTimeZone` con Montevideo y con zona inválida, y `normalizeLines`.
  - `quote.controller.test.ts` (9): schemas del borde, M-9, tope de Decimal(14,2), líneas negativas, 50 líneas y las dos formas del PATCH.
  - `quote.service.integration-test.ts` (19, contra Postgres real): activa y superación, bloqueo sobre ACCEPTED, REJECTED que no se supera, vencimiento perezoso, DRAFT vencida que no se envía, foto del vehículo, transiciones válidas e inválidas, aceptar y rechazar a la vez, edición solo en DRAFT, las cuatro carreras con lock real, aislamiento entre organizaciones en las cinco operaciones, las tres FKs compuestas rechazando referencias cross-tenant, y oportunidad eliminada.
  - `quote.controller.integration-test.ts` (4, por HTTP con GoTrue real): `createdById` sale del JWT, USER lee pero recibe 403 al escribir, y las dos formas del PATCH.
  - Las cuatro escrituras de `quote.repository.ts` en `tenant-isolation.integration-test.ts`, y el montaje en `routes/index.test.ts`.
- **Tests nuevos del frontend:**
  - `format.test.ts` (5) y `quoteForm.test.ts` (5).
  - `QuoteSection.test.tsx` (11, con MSW y un backend en memoria que aplica la misma regla de superación): vacío, crear con líneas y body exacto, validación, acciones por estado, editar sin `status`, `confirm` cancelado y aceptado, bloqueo tras aceptar, historial, 409 mostrado con refresco, e Imprimir.
  - 2 en `OpportunityFormPage.test.tsx`: la sección se monta en edición y fuera del `<form>`, y en creación no se pide ningún historial. `baseHandlers()` de ese archivo suma un GET de quotes vacío.
- **Suites completas en verde.** Backend: `typecheck`, ESLint, Prettier, **779** unitarios, **722** de integración contra el Supabase local, y `verify:schema` 14/14. Frontend: 133 archivos y **1271** tests (en el §38 eran 130 y 1248), `tsc -b`, ESLint, Prettier sobre los fuentes (`format:check` solo marca los 4 archivos de `dist/` local ya conocidos) y `npm run build` (app y widget). **Migración real** `20260916120000_quotes`, aplicada solo en local: **producción necesita `npm run migrate:deploy` después del merge.** Sin dependencias nuevas.

## 40. Entrega: registrar la entrega física del vehículo al cliente, con checklist

**Estado:** hecho

**Contexto:** Hoy, cuando una Oportunidad pasa a Ganada con una unidad vinculada, `Vehicle.status` salta directo a `SOLD` y ahí termina el rastro: no queda registrado si el auto salió de verdad de la agencia, cuándo, quién lo entregó, ni qué se le entregó al cliente (documentación de transferencia, llaves, manual, service al día). Para una automotora es una brecha real: "vendido" y "entregado" son dos eventos distintos, y el sistema hoy solo conoce el primero.

**Comportamiento deseado (confirmado con Rocco):**
- La Entrega es una entidad con checklist configurable de qué se entrega, no solo una fecha suelta. Hace falta trazabilidad real de qué faltó.
- `Vehicle.status` suma un valor nuevo, `DELIVERED`, distinto de `SOLD`. `SOLD` pasa a significar "vendido, pendiente de entregar" y `DELIVERED` es el cierre real del ciclo de vida de la unidad.
- El registro de Entrega nace SOLO cuando la Oportunidad gana con una unidad vinculada (no hay Entrega sin vehículo). Es automático: el vendedor no tiene que acordarse de crearlo.
- El vehículo pasa a `DELIVERED` por una acción explícita ("Confirmar entrega"), sin importar si quedaron ítems del checklist sin marcar. El checklist es informativo, no un bloqueo: a veces se entrega igual (falta un manual, por ejemplo) y no tiene sentido trabar la operación por eso.

**Decisiones de implementación (propuestas en el ítem, verificadas contra el código real):**

- **Nuevo modelo `Delivery`**, mismo patrón multi-tenant que `Quote`: organization-scoped, RLS igual que el resto, FKs compuestas `(organization_id, x_id)`, y la tabla entra al diagnóstico y a `verify-schema.ts` en el mismo cambio. A diferencia de Quote (que versiona con historial), una Entrega es UN evento real por Oportunidad: `@@unique([organizationId, opportunityId])`. Campos: `opportunityId` (obligatoria), `vehicleId` (nullable, FOTO al crear), `checklist` (JSONB `[{ label, checked }]` sembrado con un default fijo en código), `scheduledAt` (fecha), `deliveredAt`, `deliveredById`, `status` `PENDING` → `DELIVERED`, `createdAt`, `updatedAt`.
- **`VehicleStatus` suma `DELIVERED`**, también en `statusSchema` de `vehicle.controller.ts` y en `features/vehicle/labels.ts` y `types.ts`. `assertVehicleAvailable` no cambia: `DELIVERED` tampoco es `AVAILABLE`.
- **Creación automática en la MISMA transacción que mueve la unidad a SOLD**, en los dos call-sites de `opportunity.service.ts`. NO es una Automation ni cuelga del evento `opportunity.won` del outbox: es un efecto directo del código, como el propio SOLD.
- **"Confirmar entrega"** con `PATCH /deliveries/:id { status: "DELIVERED" }`, en una transacción con `lockOrganizationForUpdate`, compare-and-swap sobre `PENDING`, y `setVehicleStatusForOpportunityLink(..., "DELIVERED", tx)`. Si la unidad ya no está SOLD es 409. La otra forma del PATCH, `{ checklist?, scheduledAt? }`, edita solo mientras está PENDING.
- **Backend** `delivery.controller.ts` / `.service.ts` / `.repository.ts` / `.routes.ts` con los permisos de `quote.routes.ts`. Endpoints `GET /deliveries?opportunityId=`, `GET /deliveries/:id`, `PATCH /deliveries/:id`. Sin POST y sin DELETE.
- **Frontend:** tarjeta "Entrega" en `OpportunityFormPage.tsx`, debajo de Cotización, solo con la oportunidad ganada y una entrega existente.

**Nota de alcance:** fuera de este ítem: qué pasa si una Oportunidad Ganada se revierte a Abierta o Perdida después de tener una Entrega (anotado abajo como límite conocido, sin resolver), catálogo de checklist configurable por cuenta o sucursal, notificación al cliente o comprobante PDF, y cualquier automatización disparada por la entrega.

**Hallazgos al implementar:**

- **`Quote` (§39) ya estaba mergeado en `master`** (`a3d27e6`), así que `20260916120000_quotes` sirvió de plantilla directa del mecanismo RLS/FK. La migración nueva es `20260917120000_deliveries`. El `CREATE TABLE`, el índice y las FKs son exactamente lo que deriva `prisma migrate diff`: no hay drift en `deliveries`. Los `DROP INDEX ..._trgm_idx` que también muestra el diff son índices manuales preexistentes, no de este cambio.
- **Carrera real en la regla de creación tal como la describía el ítem ("cuando el nuevo status efectivo es SOLD y hay vehicleId").** En `updateOpportunity`, `needsVehicleSync` se decide con el status leído SIN lock. Dos PATCH `{ status: "WON" }` concurrentes entran los dos al bloque que pone la unidad en SOLD. Hoy el segundo es un no-op inofensivo (la unidad ya está SOLD), pero con la regla literal intentaría crear una segunda entrega, reventaría el `@@unique` y un "Marcar ganada" que hoy funciona daría 409. **Desviación:** la entrega nace cuando la oportunidad **pasa** a ganada (`pasaAWon`, que ya existía para el evento del outbox y se lee con la fila bloqueada) **o** cuando a una ganada se le **vincula** una unidad (`vehicleChanged`), siempre dentro del mismo bloque que la deja SOLD. Tiene test de carrera con lock real, y se comprobó falsable: con la regla literal el test falla con exactamente ese 409.
- **Caso que el ítem no mencionaba:** vincular una unidad a una oportunidad que ya estaba ganada sin unidad también la deja SOLD (`vehicleStatusForOpportunityStatus(WON)`). Es "gana con una unidad vinculada" en otro orden, así que también crea la entrega. Tiene test.
- **El `@@unique` no llega solo desde "algo roto en otro lado": hay dos caminos alcanzables hoy.** (1) Volver a ganar una oportunidad que se revirtió a OPEN/LOST después de ganar. (2) Cambiarle la unidad a una oportunidad ganada que ya tenía entrega. Los dos son el caso de reversión que el ítem deja fuera de alcance, y se respetó la indicación de no defenderlo con lógica previa. Lo único que se agregó es traducir el P2002 a un **409 legible** ("La oportunidad ya tiene una entrega registrada") en vez del **500** genérico: el `errorHandler` no traduce P2002 (`utils/prismaErrors.ts` lo deja a cada servicio), mismo patrón que `apiKey.service.ts` o `booking.service.ts`. Hay un test que fija que el 409 es atómico con todo el PATCH: la oportunidad no queda ganada, la unidad no queda SOLD y no sale el evento `opportunity.won`. **Consecuencia a tener presente:** antes, WON → OPEN → WON con unidad funcionaba; ahora el segundo WON es 409.
- **`setVehicleStatusForOpportunityLink` no mira el estado de origen** (hace el UPDATE sin condición). Por eso el "si la unidad ya no está SOLD, 409" se decide en `delivery.service.ts` (`assertConfirmable`) leyendo la unidad bajo el lock de organización, y la función se reutiliza sin cambios.
- **El lock de organización en "Confirmar entrega" protege una carrera real, no solo el requisito formal de la función.** Contra una reversión concurrente de la oportunidad, sin el lock la confirmación leería la unidad todavía SOLD, su CAS pasaría (la reversión no toca la entrega), y el UPDATE de la unidad esperaría la fila y después **pisaría el RESERVED con DELIVERED**: una unidad "entregada" de una oportunidad abierta. Hay test con la técnica de `carreras.test-helper.ts`, comprobado falsable sacando el lock a mano (la confirmación terminaba sin error). El service se restauró y se volvió a verificar. Dos "Confirmar entrega" a la vez se serializan en el mismo lock; el CAS queda como defensa de la fila.
- **La edición del checklist/fecha no toma el lock:** no toca la unidad, y el `updateMany` condicionado a `status = PENDING` alcanza. En READ COMMITTED, el UPDATE espera la fila de una confirmación en curso y reevalúa el WHERE contra la versión comiteada.
- **Una entrega de una oportunidad eliminada deja de ser alcanzable** (404 por listado, id, edición y confirmación), mismo criterio que `requireReachableQuote`. `deleteOpportunity` no toca la unidad SOLD (ya era así), así que la entrega simplemente queda inalcanzable.
- **`opportunityVehicle.integration-test.ts` necesitó borrar entregas antes que oportunidades** en su `after`: dos de sus casos ganan con unidad, y la FK RESTRICT de `deliveries` impedía la limpieza.
- **`seed:dev-data` no necesitó cambios:** siembra `Vehicle.status` ciclando `Object.values(VehicleStatus)`, así que `DELIVERED` queda cubierto solo y la verificación de cobertura sigue pasando. No se siembran entregas (§39 tampoco sembró cotizaciones).
- **Verificación visual real con `/browse`, en la app logueada** (frontend Vite + backend + Supabase LOCAL). Se usó el mismo truco del §39: un usuario QA ADMIN con contraseña solo en el Supabase local, borrado al final. Recorrido sobre "[SEED] Corolla para Ana" (abierta, con unidad RESERVED):
  - Marcarla Ganada desde "Estado y cierre" y guardar hace aparecer la tarjeta "Entrega", con "Pendiente de entrega", "Unidad: [SEED] Subaru Outback 2023 · STK-000006", fecha vacía y los cinco ítems sin tildar.
  - Tildar dos ítems, agregar "Patente provisoria" con Enter y fijar la fecha 25/09/2026: todo persiste al recargar.
  - "Confirmar entrega" mostró "…Quedan 4 ítems del checklist sin marcar.", y al aceptar quedó "Entregada el 16/9/2026, 9:01:19 p. m. por QA Entrega", con todo en solo lectura y el botón deshabilitado. En la base, la unidad quedó `DELIVERED` y el historial registró `RESERVED → SOLD` y `SOLD → DELIVERED`. Consola sin errores.
  - **Bug visual encontrado y corregido:** "Agregar" quedaba pegado al borde derecho de la tarjeta, lejos de su campo. `flex: 1` estiraba el campo a todo el ancho, pero el input tiene `max-width: 32rem`. Pasó a `flex: 0 1 32rem` y se confirmó en el navegador.
  - Una automatización sembrada reaccionó al `opportunity.won` y creó su actividad de seguimiento: es el motor funcionando, independiente de la entrega, como pedía el ítem.
  - Al terminar se restauraron los datos sembrados: oportunidad OPEN sin fecha de cierre, unidad RESERVED, y se borraron la entrega, las dos filas de historial, el evento del outbox, su ejecución, la actividad y el usuario QA.

**Decisiones tomadas al implementar:**

- **Modelo `Delivery` tal como lo proponía el ítem.** `deliveredById` es una FK compuesta a `users` (nullable → NO ACTION), sin `deletedAt` y sin `@@unique([organizationId, id])` (nada la referencia). El único índice es el UNIQUE `(organization_id, opportunity_id)`, que también cubre el lado referenciante de la FK a `opportunities`. No hay índices sobre `vehicle_id` ni `delivered_by_id`, mismo criterio que `quotes`. Enum nuevo `DeliveryStatus`.
- **Sin CHECK de consistencia** entre `status`, `delivered_at` y `delivered_by_id`. La sostiene `delivery.service.ts`, la única puerta de escritura, mismo criterio que `confirmed_at`/`confirmed_by_id` en `20260914120000`. Un CHECK manual entra al diagnóstico y a los contadores sin proteger ningún camino que el service no cubra. Por eso el diagnóstico suma la política a la fila 5 y 3 FKs a la fila 16 (47 → 50), y la fila 8 de CHECKs no cambia. `ALTER TYPE "VehicleStatus" ADD VALUE` no usa el valor en la misma migración, mismo molde que `OTHER` en `20260911120000`.
- **Checklist default fijo en código** (`DEFAULT_DELIVERY_CHECKLIST_LABELS`): "Documentación de transferencia", "Manual del vehículo", "Llave de repuesto", "Kit de herramientas / gato" y "Service al día". Se copia en cada entrega, así editar una no toca el default de las demás. En el borde, zod exige `label` recortado de 1 a 200 caracteres, `checked` booleano, objetos `.strict()` y hasta 50 ítems. Agregar o quitar un ítem es mandar la lista entera. Una lista vacía es válida.
- **`GET /deliveries?opportunityId=` devuelve `{ data: [] | [entrega] }`** y no un 404 cuando no hay entrega: una ganada sin unidad, o una abierta, no tiene entrega y eso es normal. Es 404 solo si la oportunidad no existe o está eliminada. `deliveryInclude` trae `deliveredBy { id, fullName }` y la unidad con su `status`, sin precios internos, mismo recorte que `quoteInclude`.
- **PATCH con dos formas excluyentes**, con los dos schemas `.strict()`: `{ status: "DELIVERED" }` o `{ checklist?, scheduledAt? }`. Mezclarlas es 400, y un `deliveredById` en el body también es 400. Quién confirmó sale siempre del JWT. Los conflictos son 409 con mensaje propio: `ENTREGA_YA_CONFIRMADA`, `ENTREGA_CONFIRMADA_INMUTABLE`, `UNIDAD_NO_VENDIDA` y `ENTREGA_YA_EXISTE`.
- **Frontend (`features/delivery/`):**
  - `DeliverySection` no pide nada si la oportunidad no está ganada (query con `enabled`). Mientras carga, o si la lista viene vacía, no muestra nada. Un error de carga sí se muestra, para no esconder una entrega que existe.
  - Cada cambio se guarda al instante con un PATCH, sin botón Guardar: el checklist se completa en el mostrador, de a un ítem. Los controles se deshabilitan mientras hay un PATCH en curso, para que dos cambios rápidos no se pisen mandando cada uno la lista entera.
  - La fecha se guarda **al salir del campo** y no en cada `onChange`: tipear un año dígito a dígito mandaría `0002-09-30`.
  - Las mutaciones escriben la respuesta del PATCH directo en la cache (para que la casilla no parpadee esperando el refetch) e invalidan en el error, como `useTransitionQuote` ante un 409. Confirmar además invalida `vehicleKeys.all`, porque la unidad pasa a "Entregado".
  - "Confirmar entrega" pide `window.confirm` con la cantidad de ítems sin marcar (`confirmQuestion.ts`, aparte del componente por react-refresh) y queda **deshabilitado** una vez entregada, con "Entregada el … por …". La unidad se muestra con `vehicleLabel` de `features/quote/format.ts`, reutilizado.
  - CSS nuevo `.ds-delivery*` en su propio bloque de `design-system.css`, con tokens del sistema, junto al de Cotización.
- **Etiqueta de la unidad:** `DELIVERED` se muestra como "Entregado" con Badge neutral, igual que "Vendido". El filtro de estado del listado de stock y el select de la ficha lo toman solos, porque se arman desde `STATUS_LABELS`.
- **Límites conocidos (fuera de alcance, sin resolver):**
  - **Reversión de una ganada con entrega:** la entrega queda como está. "Confirmar entrega" da 409 porque la unidad ya no está SOLD, y volver a ganar da 409 `ENTREGA_YA_EXISTE`.
  - **Reversión de una ganada ya ENTREGADA:** `updateOpportunity` mueve la unidad de `DELIVERED` a `RESERVED`/`AVAILABLE` sin mirar la entrega, porque `vehicleStatusForOpportunityStatus` no conoce ese estado.
  - **Cambiar la unidad de una ganada que ya tiene entrega:** 409 `ENTREGA_YA_EXISTE`. Antes el cambio se permitía, y la unidad anterior quedaba SOLD igual que hoy.
  - **Unidad pasada a mano:** si alguien lleva la unidad a DELIVERED desde el PATCH de `/vehicles/:id`, la entrega sigue PENDING y "Confirmar entrega" da 409.
- **Tests nuevos del backend:**
  - `delivery.service.test.ts` (9): el default y su copia por entrega, `normalizeChecklist`, edición solo en PENDING, y confirmar desde cada estado de entrega y de unidad.
  - `delivery.controller.test.ts` (8): las dos formas del PATCH, ítems inválidos, el tope de 50, `scheduledAt` null, y query obligatoria.
  - `delivery.service.integration-test.ts` (17, Postgres real):
    - Creación desde `createOpportunity` y `updateOpportunity`, vincular una unidad a una ganada, y los casos sin entrega.
    - PATCH WON sobre ganada, y volver a ganar una revertida (409 atómico).
    - Listado y oportunidad eliminada.
    - Edición, confirmación con historial de la unidad, inmutabilidad, confirmación con la oportunidad reabierta o perdida, y dos confirmaciones a la vez.
    - Las **dos carreras con lock real** (ganar vs ganar; confirmar vs reabrir), aislamiento entre organizaciones en las cuatro operaciones, y las tres FKs compuestas rechazando referencias cross-tenant.
  - `delivery.controller.integration-test.ts` (3, HTTP con GoTrue real): USER lee pero recibe 403 al escribir, la entrega nace del service real al crear ganada, `deliveredById` sale del JWT, y las dos formas del PATCH.
  - Las dos escrituras de `delivery.repository.ts` en `tenant-isolation.integration-test.ts`, y el montaje en `routes/index.test.ts` (sin POST ni DELETE).
- **Tests nuevos del frontend:**
  - `confirmQuestion.test.ts` (2).
  - `DeliverySection.test.tsx` (10, MSW con backend en memoria): abierta/perdida no pide nada, lista vacía sin tarjeta, pendiente, tildar con body exacto, agregar con Enter y quitar, fecha al salir del campo (y null), confirmar cancelado y aceptado con solo lectura, entregada al cargar, 409 mostrado con refresco, y error de carga.
  - 2 en `OpportunityFormPage.test.tsx`: la tarjeta se monta con la oportunidad ganada, debajo de Cotización y fuera del `<form>`, y con la oportunidad abierta no se pide. `baseHandlers()` suma un GET de deliveries vacío.
- **Suites completas en verde.** Backend: `typecheck`, ESLint, Prettier, **797** unitarios (779 en el §39), **744** de integración contra el Supabase local (722) y `verify:schema` 14/14. Frontend: 135 archivos y **1285** tests (133 y 1271), `tsc -b`, ESLint, Prettier y `npm run build`. **Migración real** `20260917120000_deliveries`, aplicada solo en local: **producción necesita `npm run migrate:deploy` después del merge.** Sin dependencias nuevas.

## 41. Permuta: vínculo explícito entre la venta y la unidad recibida

**Estado:** hecho

**Contexto:** `VehicleOrigin.TRADE_IN` marca que una unidad entró al stock por una permuta, pero hasta acá era un dato suelto: ningún campo decía EN QUÉ VENTA se había recibido. Desde la Oportunidad del auto que el cliente se lleva no había forma de ver qué auto entregó a cambio, y desde la ficha del auto recibido no había forma de ver de qué venta salió. Es la misma clase de brecha que Cotización (§39) y Entrega (§40) cerraron para otras partes del proceso.

**Comportamiento deseado (confirmado con Rocco):**
- Vínculo explícito Oportunidad ↔ Vehículo: desde la Oportunidad de venta se carga el auto que el cliente entrega (marca, modelo, año, km, valor acordado, patente si la tiene), y eso genera una unidad nueva en el stock con `origin = TRADE_IN`, vinculada a esa Oportunidad. Trazabilidad en los dos sentidos.
- Se puede cargar en cualquier momento de la negociación, incluso con la Oportunidad abierta. No depende de ganarla (a diferencia de la Entrega).
- El valor acordado es solo trazabilidad/inventario: NO resta automáticamente del monto de la Oportunidad ni de la Cotización activa. El vendedor sigue cargando el monto neto a mano, o como línea negativa en la Cotización (soportado desde §39).

**Decisiones de implementación (propuestas en el ítem, verificadas contra el código real):**

- **Un solo campo nuevo en `Vehicle`, sin entidad aparte:** `tradeInOpportunityId`, FK compuesta nullable `(organization_id, trade_in_opportunity_id) -> opportunities(organization_id, id)`, `NO ACTION` por la regla de `20260821140200`. La unidad ya es una entidad completa; lo único que faltaba era decir de qué venta salió.
- **Sin CHECK contra `origin`, a propósito** (a diferencia de los ocho campos de consignación): un `TRADE_IN` sin vínculo sigue siendo válido (datos anteriores, o una permuta que no pasó por el CRM). No se tocó `applyConsignmentRule` ni se escribió un equivalente: no hay nada que vaciar cuando cambia el origen.
- **Cero o más unidades por Oportunidad, sin UNIQUE.** "Las unidades de esta venta" se resuelve por filtro: `GET /vehicles?tradeInOpportunityId=`.
- **Validación:** con `tradeInOpportunityId` no nulo, la Oportunidad tiene que existir, ser de esta organización y no estar dada de baja. Cualquier estado vale (abierta, ganada o perdida).
- **Backend sin archivos nuevos de ruta, controller ni service:** el campo en `VehicleWritableFields` (y por ende opcional en `CreateVehicleInput`/`UpdateVehicleInput`), en `vehicleFields` del controller (UUID nullable, opcional en POST y PATCH), el filtro en `listVehiclesQuerySchema` → `ListVehiclesParams` → `VehicleFilters`/`buildWhere`, y la validación dentro de la transacción con lock de `createVehicle`/`updateVehicle`.
- **Diagnóstico:** la FK nueva entra a la fila 16 (50 → 51). Sin cambios en la fila 5 (RLS: la tabla ya la tiene) ni en la 8 (no hay CHECK nuevo).
- **Frontend:** tarjeta "Permuta" en `OpportunityFormPage.tsx` (edición, sin gating por estado), y lectura de `?tradeInOpportunityId=` en `VehicleFormPage.tsx`.

**Nota de alcance:** fuera de este ítem: cualquier efecto automático sobre el monto de la Oportunidad o de la Cotización; qué pasa con la unidad si la Oportunidad se pierde o se revierte (queda en stock igual, sin reversión: el auto existe físicamente); y cualquier regla especial para más de una unidad por venta (no hace falta, no hay restricción que lo impida).

**Hallazgos al implementar:**

- **Todo lo que el ítem daba por supuesto se confirmó en el código:** `TRADE_IN` no tenía ningún campo propio; el CHECK `vehicles_consignment_fields_require_origin_check` es solo de consignación; el comentario de `Branch.vehicles` en `schema.prisma` sigue diciendo "Contact, Company, Opportunity y Activity siguen sin branchId", así que la sucursal de la unidad recibida se elige a mano en el formulario, como en cualquier alta. `updateVehicle` y `createVehicle` ya toman `lockOrganizationForUpdate`, y `findOpportunityById` ya filtra `deletedAt: null` y acepta el `db` de la transacción, así que la validación nueva es una copia exacta del molde de `validateBranchId`.
- **Desvío obligado por Prisma: nombrar la relación existente.** `Opportunity.vehicleId` ya era una relación Opportunity → Vehicle ("la unidad por la que se interesó el cliente"). Con `Vehicle.tradeInOpportunityId` hay dos relaciones entre los mismos modelos, y Prisma exige nombrar las dos. La existente pasó a `@relation("OpportunityVehicle")` y la nueva es `"VehicleTradeInOpportunity"` (con `Opportunity.tradeInVehicles` como lado inverso). El nombre de relación no llega a la base: `prisma migrate diff` no muestra ningún cambio sobre `opportunities_organization_id_vehicle_id_fkey`, y los accesos del cliente (`opportunity.vehicle`, `vehicle.opportunities`) no cambian.
- **Desvío menor: la migración también crea un índice** `(organization_id, trade_in_opportunity_id)`, que el ítem no pedía (decía "columna + FK"). Es el lado referenciante de la FK, que Postgres no indexa solo, y es exactamente lo que consulta el filtro nuevo. Mismo criterio que `@@index([organizationId, assignedSalespersonId])` en la misma tabla. No lo afirma ninguna fila del diagnóstico (no es parcial ni de listado ALTO-6), igual que ese.
- **La migración `20260918120000_vehicle_trade_in_opportunity` es exactamente lo que deriva `prisma migrate diff`** contra la base local ya migrada: `ADD COLUMN`, `CREATE INDEX` y `ADD CONSTRAINT`. Después de aplicarla el diff queda solo con los `DROP INDEX ..._trgm_idx` preexistentes (índices manuales, ajenos a esto). Sin `CREATE TYPE` ni `ALTER TYPE`.
- **Comentario viejo corregido en el diagnóstico:** la cabecera de la fila 16 decía "las 29 FKs conocidas" desde antes de §39/§40, mientras la descripción ya decía 50. Quedó en 51 en los dos lugares (y en `verify-schema.ts`).
- **El vínculo entra al historial de la ficha.** No hubo que hacer nada: `computeChangeLogEntries` registra toda clave del PATCH que cambia, así que vincular, cambiar o desvincular (`null`) deja una fila `tradeInOpportunityId` con el id viejo y el nuevo. Tiene test.
- **Una venta dada de baja después de cargar la permuta no traba la unidad.** La validación corre solo si el body trae un id no nulo: un PATCH que no toca el vínculo (cambiar el kilometraje) no revalida la oportunidad, y la unidad sigue en stock con su vínculo. Tiene test. Desde la ficha, la nota dice "…en la oportunidad que no pudimos cargar", porque `GET /opportunities/:id` da 404.
- **Los "unitarios de createVehicle/updateVehicle" que pedía el ítem no existen como tales en este repo:** `vehicle.service.test.ts` solo prueba funciones puras (reglas de publicación, consignación, garantía, historial), sin mocks de Prisma, y la validación nueva es una lectura a la base. Los casos (válido, inexistente, de otra organización, dada de baja) están en integración contra Postgres real, y el borde Zod en `vehicle.controller.test.ts`.
- **El aislamiento multi-tenant de la escritura nueva no va en `tenant-isolation.integration-test.ts`:** no hay función de repository nueva. La escritura pasa por `createVehicle`/`updateVehicle` del repository de siempre. Lo nuevo es la constraint, y se prueba con el molde de "ApiKey de Organization A apuntando a una Source de Organization B: la base la rechaza": un `prisma.vehicle.update` directo, salteando el service, con una oportunidad de otra organización da `P2003`.
- **`OpportunityFormPage.test.tsx` corre MSW con `onUnhandledRequest: "error"`**, y la tarjeta nueva pide `GET /vehicles` en toda edición. `baseHandlers()` suma un handler que responde vacío SOLO si la URL trae `tradeInOpportunityId`; si no, devuelve `undefined` y MSW sigue al siguiente handler, así la búsqueda de `VehicleSelect` de `vehicleHandlers()` no se pisa. Los 35 tests previos no necesitaron cambios.
- **Intermitencia ajena a este cambio:** en una corrida completa de `test:integration` falló una vez "una fila con encabezados custom se traduce y promueve igual que el contrato fijo" (`import.controller.integration-test.ts`). Aislado pasa 31/31 y la corrida completa siguiente pasó 751/751. Es concurrencia entre archivos, no tiene relación con vehículos.
- **Verificación visual real con `/browse`, en la app logueada** (Vite + backend + Supabase LOCAL), con el mismo usuario QA ADMIN local de §39/§40, borrado al final. Sobre "[SEED] Corolla para Ana" (abierta):
  - La tarjeta "Permuta" aparece debajo de Cotización con "El cliente no entregó ningún auto en esta venta.", el aviso de que no se descuenta solo, y el botón.
  - "Agregar auto en permuta" lleva a `/vehicles/new?tradeInOpportunityId=…`, con Origen en "Permuta" y la nota "Se va a vincular a la oportunidad [SEED] Corolla para Ana" (el título es link).
  - Con año, marca, modelo, sucursal, kilometraje y precio, Guardar vuelve a la oportunidad, y la tarjeta lista "QA Fiat Uno 2012 · STK-000010" con link a su ficha. La ficha muestra "Recibida en permuta en la oportunidad [SEED] Corolla para Ana".
  - En la base: `origin = TRADE_IN`, `trade_in_opportunity_id` correcto, y el monto de la oportunidad intacto (15000, `updatedAt` anterior). Consola sin errores.
  - Al terminar se borraron la unidad, su historial y el usuario QA, y se restauró `nextVehicleStockNumber`.

**Decisiones tomadas al implementar:**

- **Mensaje del 400:** "La oportunidad indicada en tradeInOpportunityId no existe o no pertenece a tu organización". No distingue inexistente, ajena o dada de baja, igual que `validateBranchId`/`validateAssignedSalespersonId`. Corre dentro de la transacción después del lock, así que un rechazo no quema el `internalCode` (test del contador).
- **`tradeInOpportunityId` NO es un campo del formulario de la unidad.** En el frontend, `VehicleWritableFields` lo suma (espeja al backend), pero `toInput` devuelve `Omit<VehicleWritableFields, "tradeInOpportunityId">`: el id viaja solo en el POST que nace de la URL. Como el PATCH de la ficha manda el estado completo del formulario, dejarlo afuera es lo que garantiza que editar una unidad nunca pise ni borre su vínculo. Tiene test. Consecuencia: hoy no hay UI para vincular a posteriori una unidad ya cargada, ni para desvincularla. El backend sí lo acepta (`PATCH { tradeInOpportunityId }` o `null`).
- **El parámetro de la URL se ignora en edición.** El origen arranca en "Permuta" solo como valor inicial, y se puede cambiar. Si alguien lo cambia, el vínculo viaja igual: el campo no depende del origen, como en el backend.
- **Después de guardar una unidad que vino de una oportunidad, se vuelve a esa oportunidad** (`/opportunities/:id/edit`) y no al listado de stock. El ítem no lo decía; es el flujo natural ("agrego el auto y sigo con la venta"). `useCreateVehicle` ya invalida `vehicleKeys.lists()`, y la consulta de la tarjeta cuelga de esa key, así que la unidad nueva aparece sin refetch manual.
- **Desvío menor, en la dirección del "comportamiento deseado": la ficha de la unidad también muestra la venta.** Los bullets de frontend del ítem solo pedían la nota en el alta, pero "trazabilidad en los dos sentidos" pedía poder ver de qué venta salió un auto desde su ficha. El mismo componente local (`TradeInOpportunityNote`, en `VehicleFormPage.tsx`) cubre los dos casos: "Se va a vincular a la oportunidad …" en el alta y "Recibida en permuta en la oportunidad …" en edición, con el título como link. Sin título mientras carga ("…") o si no carga ("que no pudimos cargar"). En el alta, un id inválido lo rechaza el backend con su 400, que se muestra sin navegar.
- **`TradeInSection` vive en `features/vehicle/`**, sin api/queries/mutations propios: reutiliza `useVehicles` con el filtro nuevo (`pageSize` 100, el tope B-21, orden de carga) y `vehicleLabel` de `features/quote/format.ts`. Lista las unidades como links a `/vehicles/:id/edit`. Vacía, muestra un texto; con error, `ErrorState`; mientras carga, solo el aviso y el botón. El aviso "El valor de la permuta no se descuenta solo del monto ni de la cotización." está siempre, para que nadie lo asuma. El botón es un `<Link className="ds-link-button">`: es navegación, no una acción. Va después de Entrega, fuera del `<form>`.
- **CSS nuevo mínimo** `.ds-trade-in-section`/`.ds-trade-in`/`.ds-trade-in-list` en `design-system.css`, junto al bloque de Entrega y con los mismos tokens de espaciado.
- **Tests nuevos del backend:**
  - `vehicle.controller.test.ts` (2): el campo en POST/PATCH (UUID o null, opcional, independiente del origen) y el filtro del listado.
  - `vehicleTradeIn.integration-test.ts` (7, Postgres real): crear vinculada a una venta abierta, ganada y perdida, y TRADE_IN sin vínculo; crear con oportunidad inexistente, ajena o dada de baja (400, contador intacto); editar (historial, `null` desvincula, los tres rechazos sin escribir nada); venta dada de baja después de cargar la permuta; cambiar el origen no vacía el vínculo; el filtro del listado (cero, dos, sin mezclar otra venta, sin dadas de baja, nada desde otra organización); y la FK compuesta rechazando un vínculo cruzado aunque se saltee el service.
- **Tests nuevos del frontend:**
  - `OpportunityFormPage.test.tsx` (3): tarjeta con la oportunidad abierta y sin unidades (pide con `tradeInOpportunityId`, aviso, href del botón, fuera del `<form>`); con dos unidades (etiquetas y links a su ficha); y en creación no hay tarjeta ni se pide nada.
  - `VehicleFormPage.test.tsx` (4): alta con el parámetro (origen Permuta, nota con título, POST con el vínculo, vuelta a la oportunidad); alta sin el parámetro (sin nota, sin pedir la oportunidad, POST sin el campo); oportunidad que no carga y 400 del backend mostrado; y edición de una unidad recibida (nota con link, parámetro ignorado, PATCH sin el campo).
  - `api.test.ts` (1): el filtro viaja en la query.
- **Suites completas en verde.** Backend: `typecheck`, ESLint, Prettier, **799** unitarios (797 en el §40), **751** de integración contra el Supabase local (744) y `verify:schema` 14/14. Frontend: 135 archivos y **1293** tests (1285), `tsc -b`, ESLint, Prettier y `npm run build`. **Migración real** `20260918120000_vehicle_trade_in_opportunity`, aplicada solo en local: **producción necesita `npm run migrate:deploy` después del merge.** Sin dependencias nuevas.

## 42. Financiación: detalle real del plan, no solo una etiqueta

**Estado:** hecho

**Contexto:** `Opportunity.financingType` hoy es solo una categoría (Sin financiación / Cuotas 24 / Cuotas 36 / Financiación propia) sin ningún detalle real: no hay entidad financiera, entrega inicial, cantidad de cuotas real ni monto de cuota. Para una automotora esto importa: el vendedor arma un plan concreto con el cliente (con qué banco, cuánto entrega, en cuántas cuotas) y hoy no hay dónde cargarlo.

**Comportamiento deseado (confirmado con Rocco):**
- Se puede cargar: entidad financiera (banco/financiera, texto libre — vacío para financiación propia), entrega inicial, cantidad de cuotas (un número real, no atado a los 24/36 fijos del enum) y el monto de cada cuota.
- Es UN solo registro por Oportunidad que se edita in-place, sin historial de versiones — si cambia el banco o las condiciones, se corrige a mano. La Cotización (§39) ya cubre "probamos otro precio"; esto es el detalle de CÓMO se paga, no cuánto.
- `financingType` sigue existiendo tal cual (la categoría gruesa sigue siendo útil para filtrar/listar); el detalle nuevo es un complemento, no un reemplazo.

**Decisiones de implementación (propuestas en el ítem, verificadas contra el código real):**

- **Cuatro columnas nuevas directas en `Opportunity`, no una entidad aparte**, mismo criterio que `vehicleId`/`financingType`/`leadSource`: un registro único editable in-place no necesita el versionado de Quote ni la máquina de estados de Delivery.
  - `financingLender` (`String?`, `VarChar(255)`): banco o financiera. Sin relación con `financingType`: puede quedar vacío con cualquier valor del enum, y no se vacía si `financingType` cambia.
  - `financingDownPayment` (`Decimal?`, `Decimal(14,2)`, mismo tipo que `amount`): entrega inicial, en la moneda de la Oportunidad.
  - `financingInstallmentCount` (`Int?`): cantidad real de cuotas. Coexiste con `INSTALLMENT_24M`/`INSTALLMENT_36M`, que siguen siendo la categoría gruesa.
  - `financingInstallmentAmount` (`Decimal?`, `Decimal(14,2)`): monto de cada cuota, en la moneda de la Oportunidad.
- **Tres CHECK nuevos, con el molde de `opportunities_amount_non_negative_check`:** `financing_down_payment >= 0`, `financing_installment_amount >= 0` y `financing_installment_count > 0`. Los tres sin `OR ... IS NULL`.
- **Sin efectos:** cargar o vaciar estos campos no dispara automatizaciones, cambios de stage ni nada sobre la unidad. Son datos descriptivos, como `leadSource`.
- **Backend sin archivos nuevos de ruta, controller ni service:** los cuatro campos en `createOpportunitySchema`/`updateOpportunitySchema` (opcionales en POST, `.nullable()` en PATCH), y en `CreateOpportunityInput`/`UpdateOpportunityInput` del service y del repository.
- **Diagnóstico:** los tres CHECK entran a la fila 8 (24 → 27). Sin cambios en la fila 5 (RLS: la tabla ya la tiene) ni en la 16 (no hay FK nueva).
- **Frontend:** los cuatro campos dentro de la tarjeta "Vehículo vinculado" de `OpportunityFormPage.tsx`, solo cuando `financingType` no es `""` ni `"NONE"`.

**Nota de alcance:** fuera de este ítem: cualquier cálculo automático (monto financiado = amount − entrega inicial, o cuota = monto financiado / cuotas: el vendedor carga los números que le da el banco); tasa de interés o CFT; estado de aprobación del crédito; y cualquier validación cruzada entre estos campos y `financingType` (se puede cargar el detalle con cualquier valor del enum, incluido NONE, sin que el backend lo rechace).

**Hallazgos al implementar:**

- **El ítem decía que `Opportunity.amount` ya usaba `MAX_AMOUNT`, y no es así.** `MAX_AMOUNT` existía solo como constante local de `quote.controller.ts` (§39). El `amount` de Opportunity tiene `.min(0)` y ningún tope, así que un monto de 13 dígitos enteros hoy llega a Postgres y vuelve como 500 ("numeric field overflow"). **Desvío:** en vez de duplicar la constante, se mudó a `src/utils/validation.ts` (al lado de `currencySchema`, el otro validador compartido entre controllers), y `quote.controller.ts` la importa de ahí. `amount` NO se tocó: sumarle el tope cambia el comportamiento de un campo existente y queda fuera de alcance. Queda anotado como latente.
- **Confirmado que un CHECK nullable no necesita `OR ... IS NULL`:** `vehicles_specs_positive_check` (`mileage >= 0 AND doors > 0 AND ...`, las seis columnas nullables) y `contacts_lead_budget_amount_non_negative_check` están escritos así. Un CHECK solo se viola cuando la expresión da `false`; con NULL da NULL y pasa. Lo prueba también el test de integración nuevo.
- **Tres CHECK separados y no uno combinado** como `vehicles_amounts_non_negative_check`. Con uno solo por columna, el mensaje de Postgres nombra el campo que falló, y cada test afirma la constraint exacta.
- **`updateOpportunity` no necesitó cambios de lógica:** arma `data` con `{ ...input }` y lo pasa al repository, así que los cuatro campos viajan solos. `createOpportunity` sí mapea campo por campo al repository, y ahí se sumaron.
- **Las lecturas no tienen `select`:** `findOpportunityById` y el listado devuelven la fila completa, así que los cuatro campos salen en la API sin tocar nada. Los `Decimal` vuelven como string (`"5000.50"`), igual que `amount`. El tipo del frontend lo refleja.
- **La migración `20260919120000_opportunity_financing_detail` es exactamente lo que deriva `prisma migrate diff`** para las columnas (`ADD COLUMN` ×4 en el orden alfabético que elige Prisma). Después de aplicarla, el diff contra el schema queda solo con el `DROP INDEX opportunities_title_trgm_idx` preexistente (índice manual de ALTO-7, ajeno a esto). Los CHECK van a mano, como siempre, porque Prisma no los modela.
- **Comentario viejo corregido en el diagnóstico:** la cabecera de la fila 8 decía "Los 22 CHECK constraints" desde antes de los módulos de lead, agentes y cotización, mientras `verify-schema.ts` ya decía 24. Quedó en 27 en los dos lugares.
- **El formulario ya tenía el patrón exacto:** `isClosed(status)` con Motivo/Fecha real. La función nueva `hasFinancing(financingType)` hace lo mismo, pero con una diferencia deliberada (ver Decisiones).
- **Sin verificación visual con `/browse` en este ítem.** El cambio de UI son cuatro campos estándar (`FormField` + `input`/`CurrencyInput`) dentro de una grilla existente, sin CSS nuevo, y los tests cubren el gating y el payload. Si se quiere ver en la app antes de mergear, el truco del usuario QA local de §39–§41 sigue sirviendo.

**Decisiones tomadas al implementar:**

- **Ocultar no es vaciar.** Volver a "Sin especificar" o "Sin financiación" oculta los cuatro campos pero NO los limpia en el estado, y el guardado los reenvía tal cual. Es lo contrario de `handleStatusChange`, que al reabrir sí limpia Motivo y Fecha real. Tiene dos motivos: el ítem pide explícitamente no vaciar el detalle cuando cambia `financingType`, y así un cambio de categoría por error no borra lo cargado. Consecuencia aceptada: una oportunidad con `NONE` puede tener detalle persistido que el formulario no muestra hasta volver a elegir una financiación. Coincide con la regla del backend, donde el detalle no depende del enum. Tiene test.
- **Ubicación:** dentro de la tarjeta "Vehículo vinculado", debajo del par Financiación | Origen, y no en una tarjeta propia. Aparecen de a pares como el resto de la grilla (Entidad financiera | Entrega inicial, Cantidad de cuotas | Monto de cuota), con un hint a lo ancho: "Entidad vacía para financiación propia. Los importes van en la moneda de la oportunidad." El hint aclara la moneda, que el formulario no muestra al lado de estos campos. Una tarjeta aparte habría separado el detalle del selector que lo gobierna.
- **Tope de cuotas: 120** (`MAX_INSTALLMENT_COUNT` en el controller), entero y `> 0`. En el frontend, `<input type="number" min=1 max=120 step=1>`, que frena lo mismo de forma nativa antes del 400. Se usó un input numérico simple, como pedía el ítem, y no `IntegerInput` (ítem 23): para un número de hasta 3 dígitos el separador de miles no aporta nada.
- **`0` es un valor real en los importes:** una entrega inicial de 0 es un plan válido (y el CHECK la admite). El frontend convierte con un helper `optionalNumber` (`""` → ausente/`null`, cualquier otro texto → `Number`), en vez del chequeo truthy que usa `amount`, que acá no distinguiría "0" de vacío en el número. Tiene test (una entrega `"0.00"` persistida viaja como `0`, no como `null`).
- **Mensajes del 400** con el nombre del campo, en el mismo estilo que los existentes: "financingDownPayment debe ser mayor o igual a 0", "financingInstallmentAmount supera el máximo permitido", "financingInstallmentCount no puede superar las 120 cuotas", y "financingLender no puede superar los 255 caracteres". `z.number()` y no `z.coerce` en los tres numéricos, por el mismo motivo que `amount` (M-9). `financingLender` hace `trim()`, igual que `lostReason`.
- **Integración en un archivo nuevo**, `opportunityFinancing.integration-test.ts`, y no dentro de `opportunityVehicle.integration-test.ts`: aquel prueba el vínculo con la unidad, y esto no tiene nada que ver. Mismo montaje (`vehicle.test-helper` + pipeline/stage/company) que `opportunityDashboard.integration-test.ts`.
- **Tests nuevos del backend:**
  - `opportunity.controller.test.ts` (6): los cuatro en POST y PATCH (con trim); importes con piso 0, `MAX_AMOUNT` exacto aceptado y rechazo por encima, sin strings; cuotas enteras entre 1 y 120 (rechaza 0, −1, 121, 24.5 y `"24"`); `financingLender` hasta 255; `null` vacía en PATCH y se rechaza en POST; detalle aceptado con `financingType: "NONE"`.
  - `opportunityFinancing.integration-test.ts` (3, Postgres real): los tres CHECK rechazan entrega negativa, cuota negativa, cero y −3 cuotas escribiendo con Prisma directo (sin Zod en el camino); NULL y los bordes válidos pasan (entrega y cuota en 0, una cuota); y `createOpportunity` persiste el detalle, `updateOpportunity` cambia la categoría sin tocarlo, lo corrige y lo vacía con `null`.
- **Tests nuevos del frontend** (`OpportunityFormPage.test.tsx`, 4): en creación, los campos no aparecen con "Sin especificar" ni con "Sin financiación" y sí con Cuotas 24, y el POST manda lo cargado; sin tocar el detalle, el POST no manda ninguno de los cuatro; en edición, se hidrata lo persistido (`"5.000,50"`, `36`, `"812,25"`), y el PATCH manda lo corregido con el campo vaciado como `null`; y pasar a "Sin financiación" oculta el detalle, pero el PATCH lo reenvía (con la entrega en `0`). La fixture compartida `makeOpportunity` suma los cuatro campos en `null`. Los tests previos no necesitaron cambios.
- **Suites completas en verde.** Backend: `typecheck`, ESLint, Prettier, **805** unitarios (799 en el §41), **754** de integración contra el Supabase local (751) y `verify:schema` 14/14. Frontend: 135 archivos y **1297** tests (1293), `tsc -b`, ESLint, Prettier y `npm run build`. **Migración real** `20260919120000_opportunity_financing_detail`, aplicada solo en local: **producción necesita `npm run migrate:deploy` después del merge.** Sin dependencias nuevas.

## 43. Pago del cliente: historial de cobros, sin bloquear nada del flujo existente

**Estado:** hecho

**Contexto:** hasta acá la oportunidad sabía cuánto vale la venta (`amount`), cómo se financia (§42) y si la unidad se entregó (§40), pero no cuánto pagó el cliente. En una automotora el cobro llega en varios momentos: la seña o la entrega inicial al cerrar, y cuotas o saldos después. No había dónde registrar esos cobros ni ver cuánto falta.

**Comportamiento deseado (confirmado con Rocco):**
- Es un HISTORIAL de pagos, como Quote, y no un campo único como `financingType`. Un cliente paga en varios momentos (entrega inicial ahora, cuotas después), así que la entidad admite muchos registros por Oportunidad.
- Es puramente informativo, sin efectos: cargarlo NO bloquea "Confirmar entrega", NO bloquea el cierre de la Oportunidad y NO dispara automatizaciones. Mismo criterio que Permuta (§41) y Financiación (§42): capacidad, no regla de negocio forzada.
- Método de pago: enum cerrado (Efectivo / Transferencia / Tarjeta / Cheque / Otro), no texto libre.
- Los pagos se pueden editar y borrar después. No es un ledger contable append-only: es un dato cargado a mano que se corrige si está mal. Sin historial de cambios sobre cada pago.
- La ficha de la Oportunidad muestra un total: "Pagado: X de Y · Saldo: Z".
- La moneda de cada pago es una foto de la de la Oportunidad al crearlo. El total suma SOLO los pagos en la moneda actual de la Oportunidad; los de otra moneda se listan pero quedan afuera, con una nota. No se inventa conversión de cambio.

**Decisiones de implementación (propuestas en el ítem, verificadas contra el código real):**

- **Entidad nueva `Payment` con el molde de Quote** (historial, no registro único): `id`, `organizationId`, `opportunityId` (FK compuesta NOT NULL a `opportunities`, → RESTRICT), `amount` (`Decimal(14,2)`), `currency` (`VarChar(3)`, foto), `method` (enum nuevo `PaymentMethod { CASH TRANSFER CARD CHECK OTHER }`), `paidAt` (`@db.Date`, obligatorio: la fecha del cobro, no un timestamp del sistema) y `createdAt`/`updatedAt`.
- **Sin `deletedAt`:** DELETE físico, porque el ítem pide borrado real. Es la única de las tres entidades hijas de la oportunidad (Quote, Delivery, Payment) con `DELETE`.
- **CHECK `payments_amount_positive_check CHECK (amount > 0)`**, estricto. A diferencia de `financing_down_payment >= 0`, donde un 0 es información real, un pago de $0 no es un pago.
- **RLS** con la política uniforme de M-5 sobre `current_organization_id()`.
- **Índice `@@index([organizationId, opportunityId, paidAt])`:** sirve al historial y cubre el lado referenciante de la FK. Sin índice sobre `method` y sin `@@unique`: nada referencia a un pago.
- **Backend** con el esqueleto de `quote.*`: `payment.controller.ts`, `payment.service.ts`, `payment.repository.ts` y `payment.routes.ts`, montado en `routes/index.ts` junto a `quoteRouter`/`deliveryRouter`. `GET /payments?opportunityId=` (obligatorio, 400 si falta) y `GET /payments/:id` con `authenticate`; `POST`, `PATCH /:id` y `DELETE /:id` con `authenticate` + `businessWriteRateLimiter` + `authorize("ADMIN")`, en ese orden.
- **`currency` la pone el service** desde la oportunidad al crear. El cliente no la manda y el `PATCH` no la edita. `opportunityId` tampoco se edita.
- **Frontend:** `features/payment/` (types, api, queries, mutations, labels, `paymentForm.ts`, `totals.ts` y `PaymentSection.tsx`). La tarjeta "Pagos" se monta en `OpportunityFormPage.tsx` en edición, al final, después de `<TradeInSection />`, y sin gating por estado.
- **Diagnóstico:** `payments` entra a la fila 5 (RLS), el CHECK a la fila 8 (27 → 28) y la FK compuesta a la fila 16 (51 → 52). `verify-schema.ts` actualizado con los dos conteos.

**Nota de alcance:** fuera de este ítem: conversión entre monedas; cualquier vínculo automático con el detalle de financiación (§42), como "cuota 3 de 36" o un calendario de vencimientos; recibos o comprobantes imprimibles; un endpoint de agregación; y cualquier efecto del saldo sobre la entrega, el cierre o las automatizaciones.

**Hallazgos al implementar:**

- **El índice no tiene fila en el diagnóstico.** El ítem pedía sumar "nuevo índice" al diagnóstico, pero el .sql solo afirma tres familias de índices: los únicos parciales (fila 7), los `(organization_id, deleted_at, created_at)` de las entidades listables (ALTO-6) y los GIN de búsqueda (ALTO-7). Uno común como este no entra en ninguna, igual que `quotes_organization_id_opportunity_id_created_at_idx`. Quedó anotado en la cabecera de la migración.
- **La fila 16 solo lista las FKs compuestas.** La simple `payments_organization_id_fkey` no va, por el mismo criterio que quotes/deliveries: 51 → 52, no 53.
- **`Decimal(14, 2)` redondea antes del CHECK.** Con un `.positive()` de zod, un `amount: 0.004` pasaba el borde, llegaba a Postgres como `0.00` y el CHECK lo devolvía como 500. **Desvío:** el piso de zod es `.min(0.01)`, para que el borde y la base digan lo mismo. Tiene test en los dos lados (el de integración escribe 0.004 con Prisma directo y afirma el CHECK).
- **`new Date("2026-02-30")` no falla: corre la fecha al 2 de marzo.** Y `z.coerce.date()` convierte `null` en 1970. Por eso `paidAt` no usa `coerce`: exige `YYYY-MM-DD` con regex y comprueba que la fecha exista (ida y vuelta por `toISOString`). Tiene test con `2026-02-30`, `2026-13-01`, `null`, un timestamp con hora y `16/09/2026`.
- **No hay un helper compartido "valida que la oportunidad exista" para reusar tal cual.** `quote.service.ts` tiene `requireOpportunity`/`requireReachableQuote` como funciones privadas sobre `findOpportunityById` (repository). `payment.service.ts` usa el mismo `findOpportunityById` con sus propios `requireOpportunity`/`requireReachablePayment`, con la misma semántica: un pago de una oportunidad eliminada da 404, igual que sus cotizaciones. No se extrajo un helper común para no tocar `quote.service.ts` en este ítem.
- **Sin lock ni compare-and-swap,** a diferencia de Quote y Delivery. Payment no tiene estado ni invariante entre filas que dos escrituras concurrentes puedan romper. `update` y `delete` son `updateMany`/`deleteMany` con `organizationId` en el WHERE, y `count === 0` se traduce a 404.
- **Los tests de `OpportunityFormPage` pasaban igual sin handler para `/api/payments`.** Con `onUnhandledRequest: "error"`, la request sin handler hace fallar la query, pero no el test. Se agregó el handler a `baseHandlers()` explícitamente, igual que quotes/deliveries/permuta.
- **La migración `20260920120000_payments` es exactamente lo que deriva `prisma migrate diff`** entre el schema de `master` y el nuevo (CREATE TYPE, CREATE TABLE, índice y dos FKs). El CHECK y el RLS van a mano, como siempre. Después de aplicarla, `prisma migrate diff` contra la base local no menciona `payments`: solo quedan los `DROP INDEX` de los GIN manuales preexistentes (ALTO-7).
- **Falsabilidad comprobada a mano:** con el CHECK recreado como `>= 0` en la base local, `verify:schema` falla en la fila 8 (`payments_amount_positive_check → CHECK ((amount >= (0)::numeric))`). Se restauró y volvió a 14/14. Del lado del frontend, con el filtro de moneda de `totals.ts` roto a propósito, fallan los dos tests de moneda mezclada.
- **Sin verificación visual con `/browse` en este ítem.** El comportamiento lo cubren los tests de componente con MSW. Si se quiere ver la tarjeta antes de mergear, sirve el truco del usuario QA local de §39–§41.

**Decisiones tomadas al implementar:**

- **`createPaymentSchema` es `.strict()`**, a diferencia de `createQuoteSchema`, que descarta en silencio las claves de más. Mandar `currency` es 400, no un campo ignorado, para que nadie crea que eligió la moneda. `updatePaymentSchema` es `.strict()` por lo mismo con `opportunityId`/`currency`, y exige al menos un campo.
- **Listado paginado como Quote** (`page`/`pageSize`, tope 100, B-21). El frontend pide una página de 100 y, si `pagination.total` supera lo cargado, lo avisa ("el total solo suma esos") en vez de sumar de menos en silencio.
- **Orden del historial:** `paidAt desc`, después `createdAt desc` e `id desc`, para que dos pagos del mismo día tengan un orden estable.
- **Tarjeta "Pagos":** cada pago en una fila (fecha · monto con su código de moneda · método) con "Editar" y "Borrar". Alta y edición en el mismo formulario inline (`PaymentForm`: `CurrencyInput`, `<select>` de método y `input type="date"` precargado con `todayIsoDate()`, el "hoy" local ya usado por el embudo). Un solo formulario abierto a la vez. Borrar pide `window.confirm("¿Borrar este pago de 5.000,00 USD?")`, sin `confirmQuestion.ts`. El total va debajo de la lista y la nota de moneda es "N pago(s) en otra moneda no incluido(s) en el total.".
- **Montos formateados con `formatMoney` de `quote/format.ts`** ("5.000,00 USD"), el mismo formato que Cotización. El total suma en centavos enteros (`toCents`); para eso se exportó `centsToCanonical`, que era privada en ese archivo. El saldo puede dar negativo (cobrado de más) y se muestra tal cual.
- **Tipos en `features/payment/types.ts` y no en `opportunity/types.ts`:** los pagos no viajan embebidos en la Opportunity, se piden aparte, igual que Quote/Delivery.
- **CSS nuevo `.ds-payment-*`** en `design-system.css`, al lado de Permuta y con su mismo ritmo (margen de sección, grilla con `--space-3`). Monto/Método/Fecha van en una grilla `auto-fit` que se apila en el celular, y no en `.ds-field-row` (dos columnas fijas).
- **Mutaciones:** las tres invalidan `paymentKeys.byOpportunity`. Borrar invalida en `onSettled` (un 404 porque otro lo borró también refresca la lista). Ninguna toca `opportunityKeys`: el pago no escribe sobre la oportunidad.
- **Tests nuevos del backend (unitarios, 13):**
  - `payment.controller.test.ts` (12): lo mínimo válido y `paidAt` a medianoche UTC; los cuatro campos obligatorios; `amount` 0, negativo, string y `null` rechazados; 0.004 rechazado y 0.01 aceptado; tope de `Decimal(14,2)`; `method` solo del enum; `paidAt` inválido en cinco formas; `currency` en el body rechazada; edición parcial de cada campo; las mismas reglas en update; `opportunityId`/`currency` inmutables; body vacío.
  - `routes/index.test.ts` (1): las cinco rutas montadas bajo `/api`, DELETE incluido.
- **Tests nuevos del backend (integración contra Postgres real, 16):**
  - `payment.service.integration-test.ts` (9): el CHECK rechaza 0, −100 y 0.004 escribiendo con Prisma directo, y 0.01 entra; crear toma la moneda de la oportunidad y no le cambia ni el estado ni `updatedAt`; historial más nuevo primero, con paginación; editar monto, método y fecha sin tocar moneda ni oportunidad; DELETE físico (la fila desaparece) y 404 al repetirlo; snapshot de moneda (crear en USD, pasar la oportunidad a UYU, el pago viejo sigue en USD aun después de editarlo); otra organización (listar, leer, crear, editar y borrar dan 404/400, y la fila de B queda intacta); FK compuesta cross-tenant rechazada por la base (P2003); y oportunidad eliminada, con historial y pagos inalcanzables.
  - `payment.controller.integration-test.ts` (4, HTTP con GoTrue): POST como ADMIN (201, moneda de la oportunidad, monto como string, `currency` en el body es 400); GET como USER (200, y 400 sin `opportunityId`); POST/PATCH/DELETE como USER dan 403 y el pago no cambia; y PATCH/DELETE como ADMIN (200, `opportunityId` es 400, 204 y después 404).
  - `tenant-isolation.integration-test.ts` (2): `updatePayment` y `deletePayment` del repository con el id de B y la organización de A no afectan filas.
  - `schema-diagnostic.integration-test.ts` (1): el normalizador de la fila 8 distingue `CHECK (amount > 0)` de `CHECK (amount >= 0)`.
- **Tests nuevos del frontend (15):**
  - `totals.test.ts` (4): sin pagos; suma en centavos sin restos; pagos en otra moneda excluidos y contados; saldo negativo.
  - `PaymentSection.test.tsx` (9): tarjeta vacía con total en cero; lista más nuevo primero con fecha, monto y método; Pagado/Saldo; un pago en UYU listado con su moneda, fuera del total y con la nota visible; alta (fecha precargada en hoy, POST sin moneda, lista y total actualizados, formulario cerrado); alta sin monto no llama al backend; edición inline hidratada y PATCH sin `opportunityId`; borrado con confirm (cancelar no borra, aceptar manda DELETE y actualiza el total); error de carga visible.
  - `OpportunityFormPage.test.tsx` (2): en edición, la tarjeta se monta con la oportunidad PERDIDA, pide `?opportunityId=op1` y queda después de Permuta; en creación, no hay tarjeta ni request.
- **Suites completas en verde.** Backend: `typecheck`, ESLint, Prettier, **818** unitarios (805 en el §42), **770** de integración contra el Supabase local (754) y `verify:schema` 14/14. Frontend: 137 archivos y **1312** tests (1297), `tsc -b`, ESLint, Prettier y `npm run build`. **Migración real** `20260920120000_payments`, aplicada solo en local: **producción necesita `npm run migrate:deploy` después del merge.** Sin dependencias nuevas.
