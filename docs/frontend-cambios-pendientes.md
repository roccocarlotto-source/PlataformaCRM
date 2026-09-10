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
