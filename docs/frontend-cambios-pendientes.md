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
