# Actividades y agenda

El menú **Actividades** junta dos cosas:

- Las **actividades**: llamadas, reuniones, emails, tareas y notas que el
  equipo registra o tiene pendientes, siempre relacionadas con una empresa,
  un contacto o una oportunidad. Se trabajan desde **Mis tareas** (cada uno
  las suyas) y **Actividades** (el listado completo, solo administradores).
- La **agenda**: los turnos que los clientes reservan con un recurso (una
  persona, una sala, una clase), ya sea desde el chat con el agente de IA o a
  mano desde el panel. Se ve en **Reservas** y **Calendario**, y se configura
  en **Recursos** y **Tipos de servicio** (solo administradores).

## Actividades {#actividades}

**Actividades → Actividades** es el listado completo de la organización. Lo
ve solo un administrador; un usuario trabaja desde [Mis tareas](#mis-tareas).

Filtros:

- **Buscar** por asunto o notas.
- **Tipo**: Llamada, Reunión, Email, Tarea o Nota.
- **Confirmación**: Pendiente de confirmar o Confirmada (ver más abajo).
- **Empresa**.
- **Ordenar por**: fecha, fecha de creación, última actualización,
  vencimiento, completada o asunto.

Columnas: **Asunto**, **Tipo**, **Empresa**, **Contacto**, **Oportunidad**,
**Autor** (quien la creó), **Asignado a**, **Vencimiento**, **Completada** y
**Confirmación**. Una actividad con vencimiento pasado y sin completar lleva
la marca **Vencida**.

### Completar y confirmar

Una tarea pasa por tres momentos:

1. **Pendiente**: no se hizo todavía.
2. **Pendiente de confirmar**: quien la tenía asignada la marcó como hecha
   (desde Mis tareas) y espera que un administrador la revise.
3. **Confirmada**: un administrador la dio por buena.

Cuando un administrador completa una tarea propia, queda confirmada en el
acto. En el menú de acciones de una actividad pendiente de confirmar:

- **Confirmar**: la da por hecha.
- **Rechazar**: la devuelve a pendiente; vuelve a aparecer en Mis tareas de
  la persona asignada.

Una vez confirmada, para volver atrás hay que editarla a mano.

### Otras acciones

- **Ver detalle**: todos los datos, y si está confirmada, quién y cuándo.
- **Editar**: abre el formulario.
- **Eliminar**: pide confirmación y no se deshace.

Las actividades no solo las carga el equipo: las automatizaciones y el agente
de IA también crean tareas (un seguimiento, una derivación a un vendedor). Ver
[Automatizaciones](/ayuda/automatizaciones) y
[Agentes de IA](/ayuda/agentes-de-ia).

## Mis tareas {#mis-tareas}

**Actividades → Mis tareas** muestra las actividades asignadas a vos que
todavía te conciernen, con o sin vencimiento. La ven todos los roles.

Están agrupadas por vencimiento, en este orden: **Vencidas**, **Hoy**, **Esta
semana**, **Más adelante**, **Sin fecha** y, al final, **Esperando
confirmación**. Un bloque sin tareas no se muestra. Cada fila tiene el tipo,
el asunto, con qué está relacionada (empresa · contacto · oportunidad) y la
fecha de vencimiento ("Hoy, 11:00", "jue 3 sep").

Se puede **buscar** por asunto y filtrar por **Tipo**. Al pie se lee cuántas
tareas pendientes quedan y cuántas esperan confirmación, contando solo lo que
está en pantalla.

### Completar una tarea

1. Tildá la casilla de la tarea.
2. La fila pasa al bloque **Esperando confirmación**, con la fecha en que la
   completaste, hasta que un administrador la confirme (entonces desaparece
   de acá) o la rechace (vuelve a su bloque).

Si sos administrador, al tildarla queda confirmada y desaparece directamente.

### Crear y editar

- **Nueva tarea** crea una actividad asignada a vos (ver
  [Nueva actividad](#nueva-actividad)).
- Tocando el asunto se abre la actividad para editarla. Un usuario solo puede
  editar las que **creó él, tiene asignadas y todavía no completó**. Las que
  le asignó un administrador solo las puede completar. Un administrador edita
  cualquiera.

## Nueva actividad {#nueva-actividad}

Se llega desde **Nueva actividad** (listado de Actividades, administradores)
o **Nueva tarea** (Mis tareas, todos). Algunas pantallas la abren con datos ya
cargados, por ejemplo **Crear tarea de seguimiento** en
[Consultas sin identificar](/ayuda/contactos-y-consultas).

1. Elegí el **Tipo**: Llamada, Reunión, Email, Tarea o Nota.
2. Escribí el **Asunto** (obligatorio) y, si hace falta, **Notas**.
3. Relacionala con una **Empresa**, un **Contacto** o una **Oportunidad**
   (o más de uno). Al menos uno es obligatorio; cada selector tiene su botón
   **Quitar**.
4. **Asignado a**: un administrador elige a quién (o la deja sin asignar);
   para un usuario, el campo es fijo con su propio nombre.
5. **Vencimiento**: fecha y hora para cuándo tiene que estar hecha. Opcional;
   sin vencimiento va al bloque "Sin fecha".
6. **Completada**: fecha y hora en que se hizo, si ya se hizo. Dejalo vacío
   para una tarea pendiente.
7. Tocá **Guardar**. Un administrador vuelve a Actividades; un usuario, a Mis
   tareas.

> Si cargás **Completada** desde el formulario, la tarea queda completada con
> esa fecha y hora exactas (por eso es un campo y no una casilla). Si solo
> querés tildarla como hecha, usá la casilla de Mis tareas.

## Reservas {#reservas}

**Actividades → Reservas** es la lista de todos los turnos: los que viene
reservando el agente de IA por chat y los que carga el equipo desde el
calendario. La ven todos los roles. Acá no se crean reservas: para eso está
el [Calendario](#calendario).

La lista **arranca filtrada desde hoy** (campo **Desde**): lo primero que se
busca es lo que viene. Vaciá ese campo para ver el historial completo.

Filtros: **Sucursal**, **Recurso**, **Tipo de servicio** (los selectores de
abajo se acotan a lo elegido arriba), **Estado**, **Desde**, **Hasta** y
**Ordenar por** fecha del turno o fecha de reserva.

Columnas: **Turno** (día y hora, en la zona horaria de la sucursal),
**Contacto**, **Servicio**, **Recurso**, **Sucursal** y **Estado**.

Estados de una reserva:

| Estado | Qué significa |
|---|---|
| Confirmada | El turno está tomado. |
| Cancelada | Se canceló; el horario quedó libre. |
| Completada | El cliente vino. |
| No se presentó | El cliente no vino. |

### Cancelar una reserva

Solo una reserva **Confirmada** se puede cancelar:

1. Tocá **Cancelar** en la fila.
2. Confirmá con **Cancelar reserva** (o **Volver** para no hacerlo).

> Cancelar una reserva **no se deshace** y el turno queda libre para otra
> persona. No existe "reprogramar": si el cliente quiere otro horario, se
> cancela esta y se crea una nueva desde el calendario.

## Calendario {#calendario}

**Actividades → Calendario** es la agenda del día: una sucursal, un día, y
una columna por cada recurso de esa sucursal. La ven todos los roles.

- **Sucursal**: si no elegís una, se muestra la primera.
- **Recurso**: Todos, o uno solo para ver una columna.
- **Fecha**, con los botones **Día anterior**, **Día siguiente** y **Hoy**.

La grilla va de 00:00 a 24:00 en renglones de media hora y arranca
desplazada a las 7 de la mañana. Todo se muestra en la **zona horaria de la
sucursal**, no en la de tu computadora.

Qué se ve en cada columna:

- Los horarios en que el recurso **atiende** (según su
  [horario de trabajo](#horario-de-trabajo)) se ven abiertos; el resto,
  cerrado.
- Cada reserva confirmada es un bloque con el horario, el contacto y el
  servicio. Si el servicio admite más de una persona por turno, las reservas
  que se superponen se ven una al lado de la otra.
- Tocar un bloque abre el detalle de la reserva (contacto, servicio, recurso,
  horario) con el botón **Cancelar reserva**, igual que en la lista.
- Tocar un horario libre y abierto empieza una [nueva reserva](#nueva-reserva).
- Un horario que **ya empezó** no se puede tocar: no se reserva en el pasado.

Un administrador puede tocar también los horarios cerrados (se ven rayados):
es forzar un turno fuera de horario; ver abajo.

Si la sucursal tiene Google Calendar conectado, las reservas se reflejan en
ese calendario y los eventos que ya tenga ocupan esos horarios. Se configura
en [Sucursales](/ayuda/organizacion-y-sucursales).

## Nueva reserva {#nueva-reserva}

1. En el **Calendario**, tocá el horario libre en la columna del recurso.
2. Se abre **Nueva reserva** con el recurso, la fecha y la hora ya fijos.
3. Elegí el **Tipo de servicio** entre los que ofrece ese recurso. La hora de
   fin se calcula con la duración del servicio. Si el recurso todavía no tiene
   tipos de servicio, no se puede reservar: un administrador tiene que
   crearlos.
4. Elegí el **Contacto** (se busca por nombre o email).
5. Tocá **Reservar**.

El sistema rechaza el turno si se pisa con otra reserva y el servicio no tiene
cupo, si cae fuera del horario del recurso o si no coincide con la grilla de
turnos del servicio (por ejemplo, un servicio de 30 minutos que arranca a las
9:00 ofrece 9:00, 9:30, 10:00…).

**Forzar fuera de horario** (solo administradores): si el turno elegido queda
fuera del horario de trabajo del recurso o no coincide con sus turnos,
aparece esta casilla y hay que tildarla para poder reservar. Lo que no se
saltea es el **cupo**: si se pisa con otra reserva, se rechaza igual.

El agente de IA también reserva turnos por chat, con el mismo criterio de
horarios y cupos. Antes de reservar necesita el nombre y el apellido del
cliente (y, si escribe desde el sitio web, un teléfono o un email), y desde el
chat cada contacto puede tener como máximo dos reservas futuras activas; para
más, deriva la conversación a una persona.

## Recursos {#recursos}

**Actividades → Recursos** (solo administradores) es la lista de lo que se
reserva: una **Persona** (un asesor), una **Sala** (un box de entrega) o una
**Clase** (una actividad grupal con cupo). Cada recurso pertenece a una
sucursal.

La lista se filtra por nombre, **Sucursal** y **Tipo**, y se ordena por fecha
de creación, nombre o tipo. En el menú de cada fila: **Editar** y
**Eliminar**.

### Crear un recurso

1. Tocá **Nuevo recurso**.
2. Poné el **Nombre** (obligatorio), por ejemplo "Box de entrega 1" o "Ana
   Pérez".
3. Elegí el **Tipo** (obligatorio).
4. Elegí la **Sucursal** (obligatoria).
5. Tocá **Guardar**. Volvés a la lista; el horario en que atiende se carga
   después, editándolo.

> La **sucursal de un recurso no se puede cambiar** después de crearlo. Si
> quedó en la equivocada, creá uno nuevo en la sucursal correcta. El nombre
> y el tipo sí se pueden cambiar.

> No se puede eliminar un recurso que tiene tipos de servicio: el sistema lo
> rechaza y muestra el motivo. Eliminá o reasigná esos servicios primero.

## Horario de trabajo {#horario-de-trabajo}

Al **editar** un recurso aparece la tarjeta **Horario laboral**: en qué días
y horas se puede reservar, en la zona horaria de su sucursal. Es lo que el
calendario muestra como abierto y lo que el agente de IA ofrece como turnos.

Para cada día de la semana, de lunes a domingo:

- Si no tiene franjas, dice **No atiende.**
- **Agregar franja** suma una franja **Desde**–**Hasta**. En un día vacío
  propone 09:00–18:00; si ya hay una, propone la hora siguiente a la última
  (por ejemplo, una tarde después de una mañana). Son solo un punto de
  partida: escribí las horas que correspondan.
- Un día puede tener varias franjas (mañana y tarde). **Quitar** saca una.
- Las horas van como HH:MM, entre 00:00 y 24:00 (24:00 vale como "hasta la
  medianoche"). Cada franja tiene que empezar antes de terminar, y dos
  franjas del mismo día no pueden superponerse (09:00–13:00 y 13:00–18:00
  sí conviven). Máximo 50 franjas en total.

El horario se guarda con el mismo botón **Guardar** del recurso. Si el horario
tiene un error, la pantalla dice en qué día está y no guarda nada hasta que lo
corrijas.

> Un recurso **sin ninguna franja no atiende**: no se le ofrecen turnos ni por
> el calendario ni por el agente. Un administrador igual puede forzarle una
> reserva.

## Tipos de servicio {#tipos-de-servicio}

**Actividades → Tipos de servicio** (solo administradores) define qué se
puede reservar con cada recurso, cuánto dura y cuántas personas entran por
turno. Por ejemplo: "Test drive" de 45 minutos con el asesor Juan, o "Charla
de financiación" de 60 minutos con cupo para 10 en la sala de reuniones.

La lista muestra **Nombre**, **Recurso**, **Sucursal**, **Duración** y
**Cupo**, se filtra por nombre, sucursal y recurso, y se ordena por fecha de
creación, nombre o duración. En el menú de cada fila: **Editar** y
**Eliminar**.

### Crear un tipo de servicio

1. Tocá **Nuevo tipo de servicio**.
2. Poné el **Nombre** (obligatorio).
3. Elegí la **Sucursal** y después el **Recurso** (los dos obligatorios): solo
   se ofrecen los recursos de la sucursal elegida. Si cambiás la sucursal, hay
   que volver a elegir el recurso.
4. Cargá la **Duración (minutos)** (obligatoria): un número entero entre 1 y
   1440 (un día). Es lo que dura cada turno y lo que define la grilla de
   horarios que se ofrecen.
5. **Cupo**: cuántas personas pueden reservar el mismo turno. **1** es un
   turno exclusivo (una consulta, un test drive); más de 1, una clase con
   cupo. Si lo dejás vacío al crearlo, queda en 1.
6. Tocá **Guardar**.

> No se puede eliminar un tipo de servicio que tiene reservas activas: el
> sistema lo rechaza y muestra el motivo. Cancelá o esperá a que pasen esas
> reservas.
