# Contactos y consultas

Un **contacto** es una persona: alguien que escribió por WhatsApp, Instagram,
Messenger o el chat del sitio, alguien que vino al salón, alguien que cargaste
a mano o que llegó de una planilla importada. Toda la actividad comercial
cuelga de los contactos: las conversaciones con el agente de IA, las
oportunidades de venta, las tareas, los cupones.

Una **empresa** es una organización a la que pueden pertenecer varios
contactos (por ejemplo, una flota o una concesionaria amiga). Las empresas
son opcionales: la mayoría de los contactos no tienen ninguna.

## Contactos {#contactos}

La pantalla [Contactos](/contacts) tiene dos pestañas:

- **Clientes**: las personas que ya sabemos quiénes son. Es la pestaña que se
  abre por defecto.
- **Consultas sin identificar**: las personas que escribieron por algún canal
  y todavía no dijeron cómo se llaman. Se explica más abajo, en
  [Consultas sin identificar](#consultas-sin-identificar).

### Qué muestra la lista de clientes

Cada fila es un contacto con su **Nombre**, **Empresa**, **Email**,
**Teléfono**, **Etapa** y **Origen** (por dónde llegó: WhatsApp, Instagram,
una planilla, lo que haya cargado quien lo creó). Si sos administrador, ves
además la columna **Asignado**: el vendedor que tiene a cargo ese contacto.

Tocar el nombre abre la ficha del contacto. Si el contacto está asignado a
otra persona y vos no sos administrador, la ficha se abre igual pero en solo
lectura.

### Filtros

Arriba de la lista están los filtros. Cada cambio vuelve a la primera página.

- **Buscar**: por nombre, apellido o email.
- **Etapa**: en qué punto del camino comercial está el contacto. Las etapas
  son **Nuevo** (acaba de llegar), **Calificado (Marketing)**, **Calificado
  (Ventas)**, **Cliente** (ya compró) y **Perdido**.
- **Empresa**: escribí parte del nombre de la empresa y elegila de la lista.
  La ✕ de la píldora quita el filtro.
- **Ordenar por**: fecha de creación, nombre, apellido o etapa, y el orden
  (ascendente o descendente).

### Acciones de cada fila

El menú de tres puntos de cada fila ofrece:

- **Ver detalle**: una ventana con los datos del contacto en solo lectura,
  incluido el vehículo de interés si tiene uno. Sirve para mirar rápido sin
  salir de la lista.
- **Editar**: abre la ficha. Aparece solo si podés editar ese contacto
  (ver abajo).
- **Eliminar**: solo para administradores. Pide confirmación.

> Un contacto eliminado deja de verse en todas las pantallas, pero sus
> conversaciones, oportunidades y tareas no se borran: quedan en el historial.
> El sistema no deja eliminar un contacto que tenga **oportunidades
> abiertas**, **conversaciones abiertas** o **turnos confirmados**: primero
> hay que cerrarlas (o pasar las oportunidades a otro contacto) y cancelar
> los turnos.

### Quién puede hacer qué

- **Crear** un contacto puede cualquiera. Lo que crea un usuario queda
  asignado a él.
- **Editar** un contacto puede un administrador o el vendedor que lo tiene
  asignado. Si abrís la ficha de un contacto de otro vendedor, vas a ver el
  aviso "Está asignado a otra persona: solo quien lo tiene asignado o un
  administrador puede editarlo" y el botón **Guardar** deshabilitado.
- **Reasignar**, **eliminar** y **unir** contactos puede solo un
  administrador.

## Nuevo contacto {#nuevo-contacto}

1. En [Contactos](/contacts), tocá **Nuevo contacto**.
2. Completá **Nombre** y **Apellido**. Son los únicos campos obligatorios
   (los marcados con asterisco).
3. Si los tenés, cargá **Email**, **Teléfono** y **Puesto** (el cargo de la
   persona si representa a una empresa).
4. **Empresa**: escribí parte del nombre y elegila de la lista. Si todavía no
   existe, primero creala en [Empresas](/companies).
5. **Fuente**: por dónde llegó el contacto, en texto libre. Por ejemplo
   "Salón", "Recomendado" o "Feria". Los contactos que crean los canales de
   chat ya traen la suya.
6. **Etapa**: arranca en **Nuevo**. Cambiala a medida que avance la relación.
7. **Asignado** (solo administradores): el vendedor que lo va a atender. Viene
   preseleccionado en vos; cambialo si corresponde. Un usuario no ve este
   campo: el contacto queda a su nombre.
8. Tocá **Guardar**. Volvés a la lista.

> Antes de crear un contacto a mano, buscalo en la lista: si la persona ya
> escribió por algún canal, es probable que exista. Si igual terminás con dos
> fichas de la misma persona, se pueden [unir](#unir-contactos).

El teléfono conviene cargarlo con código de país (por ejemplo,
+54 11 2345 6789). Si lo cargás sin código, el sistema usa el país
configurado para la organización.

## Ficha de contacto {#ficha-de-contacto}

Se abre tocando el nombre en la lista, o desde **Editar**. Es la misma
pantalla que "Nuevo contacto" con todo lo que ya se sabe del contacto, más
lo que se fue sumando: el vehículo de interés, los campos personalizados y
sus cupones.

### Botones de arriba

- **Crear cupón**: le manda un cupón de descuento por WhatsApp. Se explica en
  [Cupones y QR](/ayuda/cupones-y-qr#enviar-cupon).
- **Marcar sin interés** / **Quitar «sin interés»**: ver
  [Marca «sin interés»](#sin-interes).
- **Unir con otro contacto** (solo administradores): ver
  [Unir contactos](#unir-contactos).

### Datos del contacto

Los mismos campos que al crearlo. Algunas cosas a tener en cuenta:

- **Empresa** y **Asignado** se pueden cambiar por otra empresa u otro
  vendedor, pero no se pueden dejar vacíos una vez cargados.
- Si el contacto vino de una importación de otro sistema, debajo de
  **Fuente** se muestra "Cliente desde el …" con la fecha de alta que tenía
  allá. Es un dato de consulta: no se edita.
- Los contactos que crean los canales de chat vienen con un nombre
  provisorio (por ejemplo "WhatsApp +54 11 …" o "Visitante a1b2c3d4"). Si la
  persona le dice su nombre al agente, el agente lo reemplaza. Si lo cargás
  vos a mano, el agente ya no lo toca.

### Lo que anota el agente de IA

Cuando el agente de IA habla con el contacto, va dejando en la ficha lo que
aprende: el vehículo que le interesa, y una calificación del interés
(puntaje, intención, servicio de interés, urgencia, presupuesto, zona y
notas). Esa calificación no se edita desde la ficha: se ve al
[unir contactos](#unir-contactos) y la usa el agente para atender mejor la
próxima vez. Las notas se van acumulando conversación tras conversación, y
nunca se pisan.

Si definieron [campos personalizados](/ayuda/campos-personalizados), el
agente los lee todos y puede completar los que el administrador marcó como
editables por él.

### Campos personalizados

Debajo de los datos aparece la tarjeta **Campos personalizados**, con los
datos propios del negocio que definió un administrador (por ejemplo "Patente
del auto actual" o "Forma de pago preferida"). Si la organización no definió
ninguno, la tarjeta no aparece. Cómo se crean y qué tipos hay está en
[Campos personalizados](/ayuda/campos-personalizados).

### Cupones

Al pie de la ficha, la tarjeta **Cupones** lista todos los cupones del
contacto: los que mandó alguien a mano y los que salieron por una regla
automática (marcados "por regla"), cada uno con su estado y hasta cuándo
vence o cuándo se canjeó.

### Dónde ver lo demás

- **Conversaciones**: en [Conversaciones](/conversations), buscá al contacto
  por nombre. Ver [Conversaciones](/ayuda/conversaciones#bandeja).
- **Oportunidades**: en [Oportunidades](/opportunities), con la columna
  Contacto. Ver
  [Oportunidades y procesos de venta](/ayuda/oportunidades-y-procesos-de-venta).
- **Tareas**: desde Actividades. Ver
  [Actividades y agenda](/ayuda/actividades-y-agenda).

## Vehículo de interés {#vehiculo-de-interes}

En la ficha (solo cuando el contacto ya existe) está el campo **Vehículo de
interés**: la unidad del stock que la persona quiere. Es información para el
vendedor, nada más.

> Marcar un vehículo de interés **no lo reserva**: la unidad sigue
> disponible para otros clientes. Reservar es otra cosa y se hace desde la
> oportunidad.

Para elegirlo:

1. Escribí en el campo parte de la marca, el modelo, la patente, el VIN o el
   código interno de la unidad. Solo aparecen unidades disponibles.
2. Elegila de la lista.
3. Tocá **Guardar**.

Para quitarlo, tocá **Quitar** al lado de la unidad y guardá.

Debajo del campo hay una nota que dice quién lo cargó:

- "La anotó el agente por lo que habló el cliente": lo anotó el agente de IA
  a partir de la conversación. Mientras sea así, el agente lo va actualizando
  si el cliente cambia de idea. **Si lo cambiás o lo elegís vos, el agente ya
  no lo toca.**
- "La unidad del stock que le interesa": lo eligió una persona.

Si la unidad se vendió o se dio de baja del stock, la ficha la sigue
mostrando, con su estado y la aclaración "dada de baja del stock", para que
no se pierda el dato. Ya no se puede volver a elegir esa unidad: solo
cambiarla por otra o quitarla.

## Marca «sin interés» {#sin-interes}

Es la forma de decir "esta persona no quiere que la sigamos contactando".
Sirve para que ningún seguimiento automático le vuelva a escribir: las reglas
de [Automatizaciones](/ayuda/automatizaciones) que mandan mensajes a los
contactos que dejaron de responder se saltean a los que tienen la marca.

La marca la puede poner:

- **El agente de IA**, si el administrador le habilitó esa acción, cuando el
  cliente lo dice claramente ("no gracias", "ya compré en otro lado", "no me
  escribas más"). El agente anota el motivo con las palabras del cliente.
- **Una persona**, desde la ficha, con el botón **Marcar sin interés**. Pide
  confirmación. Lo puede hacer quien puede editar el contacto: un
  administrador o el vendedor asignado.

Con la marca puesta, arriba de la ficha se ve "**Sin interés** desde el
(fecha)" y, si el agente anotó un motivo, el motivo entre comillas.

Para quitarla, tocá **Quitar «sin interés»**. No pide confirmación. A partir
de ahí los seguimientos automáticos vuelven a tenerlo en cuenta.

> La marca no cierra conversaciones ni oportunidades, y el agente sigue
> atendiendo al contacto si vuelve a escribir. Solo frena los mensajes
> automáticos.

## Consultas sin identificar {#consultas-sin-identificar}

La segunda pestaña de [Contactos](/contacts?vista=consultas). Acá están las
personas que escribieron por WhatsApp, Instagram, Messenger o el chat del
sitio y todavía **no dijeron cómo se llaman**: el sistema las creó con un
nombre provisorio ("WhatsApp +54 11 …", "Visitante a1b2c3d4", "Instagram
…1234", "@usuario") o con un nombre a medias (solo "Martín", sin apellido),
y no tienen ninguna oportunidad de venta.

No hay que hacer nada para que una consulta pase a Clientes: cuando la persona
le dice su nombre y apellido al agente, o cuando alguien se lo completa en la
ficha, o cuando se le crea una oportunidad, pasa sola a la otra pestaña.

### Qué muestra

Cada fila tiene la **Consulta** (el nombre provisorio; tocarlo abre la
ficha), el **Canal** por el que escribió, su **Último mensaje**, hace cuánto
**Escribió**, el **Vehículo de interés** que anotó el agente y, para
administradores, el **Vendedor** asignado.

Los filtros son **Buscar** (por nombre, email o teléfono), **Canal** y, para
administradores, **Vendedor**.

### Acciones de cada fila

- **Abrir la conversación**: va al hilo con el agente, para leer qué
  preguntó. Ver [Conversaciones](/ayuda/conversaciones#detalle).
- **Asignar vendedor** (solo administradores): elegí quién la va a atender.
  Es lo mismo que cambiar **Asignado** en la ficha, sin abrirla.
- **Crear tarea de seguimiento**: abre una tarea nueva ya vinculada a esta
  persona, para llamarla o escribirle más tarde.
- **Unir con un contacto existente** (solo administradores): si te das
  cuenta de que esta consulta es un cliente que ya tenés cargado, unilas.
  Ver [Unir contactos](#unir-contactos).
- **Descartar** (solo administradores): para consultas que no van a ningún
  lado (spam, alguien que escribió por error). Pide confirmación.

> **Descartar** cierra las conversaciones de la consulta y da de baja el
> contacto. Si la persona vuelve a escribir, entra como una consulta nueva,
> sin el historial anterior a la vista. No se puede descartar una consulta
> con un turno confirmado.

### Identificar una consulta

Cuando sabés quién es la persona (te lo dijo por teléfono, lo reconociste
por el número), hay dos caminos:

- **Si no la tenías cargada**: tocá el nombre provisorio para abrir la ficha,
  reemplazalo por el nombre y el apellido reales y guardá. La consulta pasa a
  Clientes y conserva su conversación, su vehículo de interés y todo lo que
  anotó el agente.
- **Si ya existía como cliente**: usá **Unir con un contacto existente**.
  Así no quedan dos fichas de la misma persona.

## Unir contactos {#unir-contactos}

Solo para administradores. Sirve cuando la misma persona quedó cargada dos
veces: por ejemplo, Ana Pérez existe desde una planilla y además escribió
por WhatsApp y el sistema le creó otra ficha.

Se puede unir desde dos lugares, y la diferencia importa:

- **Desde la ficha de un contacto**, con **Unir con otro contacto**: el
  contacto de la ficha es el que **queda**. El que elijas (el duplicado) se
  da de baja y todo lo suyo pasa a este.
- **Desde Consultas sin identificar**, con **Unir con un contacto
  existente**: la consulta es la que **se da de baja**. El contacto que
  elijas es el que queda y recibe todo lo de la consulta.

Pasos:

1. Tocá el botón. Se abre una ventana.
2. En el buscador, escribí el nombre o el email del otro contacto y elegilo.
   No podés elegir el mismo contacto de la ficha.
3. El sistema muestra, campo por campo (nombre, apellido, email, teléfono,
   puesto, empresa, asignado, etapa, fuente y la calificación que anotó el
   agente), los dos valores: el de este contacto y el del otro. Viene
   preseleccionado el más reciente que no esté vacío; cambiá el que quieras
   con las casillas.
4. Más abajo, **Pasan a este contacto** lista lo que se va a mover, con
   cantidades: conversaciones (con sus mensajes), oportunidades (con sus
   cotizaciones, pagos y entregas), actividades y tareas, reservas, cupones,
   seguimientos, identidades de Messenger e Instagram. Si el duplicado no
   tiene nada, lo dice.
5. Tocá **Unir** y confirmá en la ventana que resume lo que va a pasar.

Al terminar, la ficha muestra "Contactos unidos: N registros pasaron a este
contacto".

Qué más tener en cuenta:

- Las notas y los datos extra que juntó el agente de IA **no se eligen: se
  suman**. Las notas del duplicado quedan agregadas a las del que queda, con
  la aclaración de qué contacto venían.
- Si el duplicado tenía un chat abierto en el sitio web, ese chat se corta:
  quien escribía desde ese navegador no va a ver esta conversación y, si
  vuelve a escribir, entra como un visitante nuevo. La ventana lo avisa
  cuando aplica.

> Asegurate de que los dos son la misma persona antes de unir. **No se puede
> deshacer desde la pantalla.**

## Empresas {#empresas}

La pantalla [Empresas](/companies) lista las empresas de la organización con
**Nombre**, **Industria**, **Dominio** (el sitio web, por ejemplo
example.com) y, para administradores, **Asignado**.

Filtros: **Buscar** por nombre, **Industria** (texto libre), **Ordenar por**
fecha de creación, nombre o industria, y el orden.

Qué puede hacer cada rol:

- Un **usuario** ve la lista y, tocando el nombre, una ventana con los datos
  de la empresa en solo lectura (nombre, dominio, industria, teléfono, ciudad
  y país). No ve la columna Asignado ni el menú de acciones.
- Un **administrador** puede además crear, editar y eliminar empresas. El
  menú de cada fila ofrece **Ver detalle**, **Editar** y **Eliminar** (pide
  confirmación).

> El sistema no deja eliminar una empresa con oportunidades abiertas: primero
> hay que cerrarlas o pasarlas a otra empresa. Eliminar una empresa no
> elimina sus contactos.

Para vincular un contacto a una empresa, se hace desde la ficha del contacto
con el campo **Empresa**.

## Nueva empresa {#nueva-empresa}

Solo para administradores.

1. En [Empresas](/companies), tocá **Nueva empresa**.
2. Completá el **Nombre**. Es el único campo obligatorio.
3. Si los tenés, cargá **Dominio** (el sitio web), **Industria**,
   **Teléfono**, **Ciudad** y **País**.
4. **Asignado**: el vendedor a cargo de la cuenta. Viene preseleccionado en
   vos.
5. Tocá **Guardar**. Volvés a la lista.

Editar una empresa es la misma pantalla con los datos ya cargados. Igual que
en los contactos, **Asignado** se puede cambiar por otra persona pero no
dejar vacío.
