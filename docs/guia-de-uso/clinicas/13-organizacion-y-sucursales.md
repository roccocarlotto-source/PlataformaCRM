# Organización y sedes

Todo lo que está en esta sección es **solo para administradores**: las
pantallas **Organización** y **Sedes** viven en el menú **Administración** y
Recepción no las ve. Lo que se configura acá lo usan después las demás
pantallas: los horarios de la agenda, los mensajes automáticos, los
recordatorios de turno y el asistente.

## Organización {#organizacion}

En el menú: **Administración → Organización**. Es una sola pantalla con los
datos generales de la clínica, agrupados en tarjetas. Los cambios de
**Moneda**, **Teléfonos**, **Zona horaria**, **Cómo llamar a los contactos** y
**Aviso de privacidad** se guardan todos juntos con el botón **Guardar** del
final; el resto es informativo.

### Moneda

- **Moneda de preferencia**: la moneda principal de la clínica.
- **Moneda alternativa**: la segunda moneda en la que se muestran los
  precios.

Las opciones son **USD** y **UYU**, o **Sin configurar**. No pueden ser la
misma: si elegís la misma en las dos, el sistema lo rechaza al guardar.

### Teléfonos

**Código de país por defecto**: el código con el que el sistema completa los
teléfonos que se cargan sin código de país, en formato local. Por ejemplo,
con **598** cargado, un paciente con el teléfono "099 123 456" se guarda con
un número de Uruguay. Va sin el signo "+", de 1 a 3 dígitos.

> Sin un código de país configurado, un teléfono cargado en formato local
> (sin el código adelante) se rechaza.

### Zona horaria

La zona con la que el dashboard calcula "hoy", "esta semana" y "este mes".
Elegí tu ciudad (Montevideo, Buenos Aires, Santiago, São Paulo, etc.). No
confundir con la zona horaria de cada sede (ver
[Crear o editar una sede](#nueva-sucursal)): esa define los horarios de los
turnos y del horario de atención.

### Rubro y edición

Muestra el **Rubro** (**Clínica**) y la **Edición** de la organización. Los
dos los define el equipo de la plataforma; si hace falta cambiarlos,
pedíselo.

En esta tarjeta está además **Cómo llamar a los contactos**: la palabra con
la que el sistema nombra a las personas que atiende la clínica en el menú y
en las pantallas. Viene elegido **Paciente**; si preferís la otra opción del
desplegable, elegila y tocá **Guardar**.

### Aviso de privacidad

El mensaje que el asistente le manda una sola vez a cada paciente, antes de
su primera respuesta. Tiene dos campos:

- **Texto del aviso**: hasta 1000 caracteres. Si está vacío, el botón
  **Usar el texto de ejemplo** carga un borrador para empezar.
- **Link a la política de privacidad**: una dirección que empiece con
  `https://`. Va abajo del texto, en el mismo mensaje.

> Sin el aviso y el link no se puede activar un agente, y mientras haya
> agentes activos no se pueden borrar. El texto de ejemplo **no es
> asesoramiento legal**: revisalo con un profesional antes de usarlo. El
> detalle está en [Aviso de privacidad](/ayuda/agentes-de-ia#aviso-de-privacidad).

### Cotización vigente

Solo lectura. Muestra la cotización del dólar que usa el sistema (por
ejemplo, "1 USD = 40,50 UYU") y de qué fecha es. Se actualiza sola una vez
por día; hasta que eso pase, la tarjeta dice **"Todavía no hay cotización
cargada."**

### Facebook e Instagram

Solo informativa. Con la página de Facebook de la clínica conectada, los
agentes que la tengan asignada contestan por Messenger y, si la página tiene
una cuenta de Instagram vinculada, también por Instagram.

- **Conectada**: muestra el nombre de la página y la cuenta de Instagram
  (o "sin Instagram vinculado"), y debajo sus números de identificación.
- **Sin conectar**: todavía no se conectó ninguna página.
- Si la conexión dejó de funcionar, la tarjeta lo avisa con el motivo.

> La conexión con Facebook e Instagram **la configura el equipo de la
> plataforma**, no se hace desde esta pantalla. Si está sin conectar o dejó
> de funcionar, avisales. Qué agente atiende por esa página se elige en
> [Agentes de IA](/ayuda/agentes-de-ia#agentes).

## Sedes {#sucursales}

En el menú: **Administración → Sedes**. Una sede es cada consultorio o punto
de atención de la clínica ("Sede Centro", "Sede Norte"). De una sede cuelgan
la agenda y sus profesionales y prestaciones, los agentes y su base de
conocimiento, los QR, el horario de atención, los recordatorios de turno y
el calendario de Google. También las personas de Recepción trabajan por sede
(ver [Sedes de cada persona de recepción](/ayuda/usuarios-y-permisos#sedes)).

**El listado.** Muestra **Nombre** y **Zona horaria** de cada sede. Podés
buscar por nombre y ordenar por **Fecha de creación** o por **Nombre**. El
menú de acciones de cada fila tiene **Editar** y **Eliminar**.

**Nueva sede**, arriba a la derecha, abre el formulario (ver
[Crear o editar una sede](#nueva-sucursal)).

> Una sede no se puede eliminar mientras tenga profesionales o prestaciones
> activos, QR activos, agentes, entradas en la base de conocimiento,
> conversaciones abiertas, turnos confirmados o Google Calendar conectado. Al
> intentarlo, el sistema te dice qué hay que sacar primero. Si a una persona
> de Recepción se le borra la única sede que tenía, queda **Sin sedes**.

## Crear o editar una sede {#nueva-sucursal}

1. En [Sedes](/branches), tocá **Nueva sede** (o **Editar** en una
   existente). El título dice **Nueva sede** o **Editar sede**.
2. Completá los datos de abajo.
3. Tocá **Guardar**, al final del formulario. Volvés al listado.

Los campos con asterisco son obligatorios.

### Datos de la sede

- **Nombre** (obligatorio): como la va a ver el equipo en los selectores,
  por ejemplo "Sede Centro".
- **Zona horaria** (obligatorio): viene elegida Montevideo; también hay
  Santiago y Asunción. Define en qué hora se interpretan los turnos de los
  profesionales de esta sede y su horario de atención. Si tu ciudad no está,
  elegí la que tenga el mismo horario (Buenos Aires y Montevideo, por
  ejemplo, funcionan igual).
- **Responsable por defecto**: la persona a la que el agente le asigna un
  paciente que todavía no tiene responsable (por ejemplo, alguien que
  escribe por primera vez por WhatsApp). Si es de Recepción, también recibe
  primero los avisos de la sede como tarea. Podés dejar **Sin responsable
  por defecto**.

### Cobro

La tarjeta **Cobro** tiene dos campos opcionales: **Link de pago** (una
dirección que empiece con `https://`) y **Datos para transferencia** (texto
libre, hasta 2000 caracteres).

> En una clínica el asistente no manda links de pago ni datos para
> transferencia a los pacientes, aunque estén cargados acá.

### Después de crearla

Las tarjetas **Horario de atención**, **Google Calendar**, **Turnos por
chat** y **Recordatorios** aparecen solo al editar una sede ya creada,
porque dependen de ella. Cada una se guarda con sus propios botones, aparte
del **Guardar** del formulario.

## Horario de atención {#horario}

Está en el formulario de la sede, al editarla. Es la franja en la que la
clínica atiende, y el sistema la usa para:

- mandar los mensajes automáticos (por ejemplo, el pedido de reseña después
  del turno) solo dentro de ese horario;
- decirle al paciente cuándo le van a escribir, cuando el asistente le pasa
  la conversación a una persona y nadie responde fuera de hora (ver
  [Derivar a una persona](/ayuda/agentes-de-ia#derivar)).

El asistente responde a los pacientes a cualquier hora: este horario no lo
limita. Tampoco es el horario de cada profesional, que se carga en
[Profesionales](/ayuda/actividades-y-agenda#profesionales).

**El horario por defecto.** Si nunca cargaste uno, la sede usa lunes a
sábado de 9:00 a 20:00 y la tarjeta lo avisa. Cargar uno propio es
opcional.

**Cargar un horario propio.**

1. En la tarjeta, cada día de la semana tiene sus franjas. Un día sin
   franjas dice **"No atiende."**
2. Tocá **Agregar franja** en el día que quieras. Corregí **Desde** y
   **Hasta** escribiendo la hora como `HH:MM` (por ejemplo, `09:00`; `24:00`
   vale como fin del día).
3. Un día puede tener varias franjas (mañana y tarde, por ejemplo). Para
   sacar una, tocá **Quitar**.
4. Tocá **Guardar horario**.

El sistema revisa que cada hora tenga el formato correcto, que cada franja
empiece antes de terminar y que las franjas de un mismo día no se pisen; si
algo no cierra, te dice qué día y qué franja.

**Volver al horario por defecto.** Si la sede tiene horario propio, aparece
el botón **Volver al horario por defecto**: borra el horario cargado (previa
confirmación) y vuelve a lunes a sábado de 9:00 a 20:00.

> El horario se guarda con **Guardar horario**, no con el **Guardar** del
> final del formulario. Si cambiás franjas y te vas con el otro botón, el
> horario queda como estaba.

## Google Calendar {#google-calendar}

Está en el formulario de la sede, al editarla. Con Google Calendar
conectado:

- cada turno que se da en la agenda de esta sede aparece también en ese
  calendario de Google;
- los eventos que ese calendario ya tenga ocupan esos horarios, así que no
  se ofrecen turnos encima de ellos.

Los botones de esta tarjeta actúan al momento, sin pasar por el **Guardar**
del formulario. El calendario de cada profesional se explica en
[Calendario de Google](/ayuda/actividades-y-agenda#calendario-de-google).

**Conectar.**

1. Tocá **Conectar con Google Calendar**. Se abre una pestaña nueva con la
   pantalla de autorización de Google.
2. En esa pestaña, ingresá con la cuenta de Google cuyo calendario quieras
   usar para la sede y aceptá los permisos. Al terminar, Google te devuelve
   al formulario de la sede con el aviso **"Google Calendar quedó
   conectado."**
3. En la pestaña original, tocá **Volver a consultar** para ver el estado
   actualizado. Si la pestaña de Google no se abrió (algunos navegadores
   bloquean las ventanas nuevas), usá el link **"Si no se abrió, abrila
   acá."**

**Los estados.**

- **Sin conectar**: no hay calendario.
- **Conectado**: muestra qué calendario está vinculado y el botón
  **Desconectar**.
- **La conexión dejó de funcionar**: Google dejó de aceptar la autorización
  (por ejemplo, se cambió la contraseña o se retiró el permiso). Se muestra
  el motivo; volvé a conectarla con el botón.
- Si al volver de Google ves **"No pudimos conectar Google Calendar"** con
  un motivo, repetí el proceso desde el paso 1.

**Desconectar.** Tocá **Desconectar** y confirmá. Los turnos nuevos de la
sede dejan de aparecer en el calendario; lo que ya estaba cargado en Google
no se borra.

> No se puede eliminar una sede con Google Calendar conectado: desconectalo
> primero.

## Recordatorios {#recordatorios}

Está en el formulario de la sede, al editarla, en la tarjeta
**Recordatorios**. Antes de cada turno, el paciente recibe un WhatsApp para
confirmar o cancelar. Acá elegís cuándo sale en esta sede:

1. En **Horas de anticipación del recordatorio**, escribí con cuántas horas
   de anticipación sale (de 1 a 72; viene en 24).
2. En **Si el turno se da con menos anticipación**, elegí qué pasa con un
   turno que se da más cerca que eso:
   - **No mandar recordatorio** (viene así);
   - **Mandarlo en el momento**;
   - **Mandarlo unas horas antes del turno**: aparece **Horas antes del
     turno**, de 1 a 23.
3. Tocá **Guardar recordatorios**. Vas a ver **"Los recordatorios quedaron
   guardados."**

Cambiarlo no mueve los recordatorios que ya están programados.

> Esta tarjeta sola no manda nada: hace falta una regla activa
> **Recordatorio antes del turno** en Automatizaciones, con su texto
> aprobado. Cómo se arma y qué pasa con la respuesta del paciente está en
> [Recordatorio antes del turno](/ayuda/automatizaciones#recordatorio-de-turno).

## Turnos por chat {#turnos-por-chat}

Está en el formulario de la sede, al editarla, en la tarjeta **Turnos por
chat**. Es el plazo mínimo para que el asistente reprograme o cancele un
turno cuando el paciente se lo pide por chat.

1. Completá **Anticipación mínima para cambiar un turno (horas)**. Por
   ejemplo, con 24 el asistente no cambia un turno que empieza en menos de
   24 horas: le pasa la conversación a Recepción.
2. Tocá **Guardar plazo**. Vas a ver **"El plazo quedó guardado."**

Si lo dejás vacío (dice **Sin plazo**) o ponés 0, no hay plazo: el
asistente puede cambiar el turno hasta que empieza. Es lo que tiene una
sede nueva. El detalle está en
[Anticipación mínima para cambiar un turno](/ayuda/agentes-de-ia#anticipacion-minima).
