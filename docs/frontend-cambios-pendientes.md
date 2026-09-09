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

**Estado:** pendiente

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

