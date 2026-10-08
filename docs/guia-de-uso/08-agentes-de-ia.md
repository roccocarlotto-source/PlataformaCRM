# Agentes de IA

Un agente de IA es un asistente automático que atiende a los clientes por
WhatsApp, por el chat del sitio web, por Messenger o por Instagram: contesta
consultas, busca unidades en el stock, califica al interesado, crea
oportunidades y, cuando hace falta, deriva la conversación a una persona del
equipo. Todo lo que hace queda registrado en
[Conversaciones](/ayuda/conversaciones).

Toda la configuración de esta sección es para administradores. La sección
**Agentes de IA** del menú solo la ven ellos, e incluye también la
[Base de conocimiento](/ayuda/base-de-conocimiento), las
[Automatizaciones](/ayuda/automatizaciones) y la configuración del
[agente interno](#agente-interno).

## Los agentes {#agentes}

La pantalla [Agentes de IA](/agents) lista los agentes de la organización.
Cada agente pertenece a una sucursal: atiende con los datos, el horario y el
stock de esa sucursal. Lo habitual es un agente por sucursal.

Para cada agente se ve:

- **Nombre**.
- **Sucursal**.
- **Estado**: **Activo** o **Inactivo**. Un agente inactivo no responde ningún
  mensaje.
- **Canales**: por dónde atiende. Si no tiene ninguno, aparece un guion: el
  agente no atiende por ningún lado.
- **Modelo**: el modelo de inteligencia artificial que usa. Lo elige el
  equipo de la plataforma.

Podés buscar por nombre y filtrar por sucursal y por estado. El menú de cada
fila ofrece:

- **Editar**: la configuración completa (ver abajo).
- **Instalar en un sitio**: el código para poner el chat en una página web
  (ver [Instalar el chat en un sitio web](#instalar-en-un-sitio)).
- **Probar agente**: una pantalla para conversar con él como si fueras el
  cliente (ver [Probar el agente](#probar)).
- **Eliminar**.

> **Eliminar** un agente lo deja de responder de inmediato y desactiva el
> chat de los sitios web donde esté instalado. Las conversaciones que ya
> atendió quedan en el historial. Si solo querés pausarlo, desmarcá
> **Activo** en su configuración.

## Crear o editar un agente {#nuevo-agente}

En [Agentes de IA](/agents), tocá **Nuevo agente**, o **Editar** en la fila de
uno existente. La configuración está repartida en tarjetas; estas son las de
**Datos del agente**:

- **Nombre**: cómo lo ves en la lista. También es el nombre con el que se
  presenta en el probador.
- **Sucursal**: la sucursal a la que pertenece. Se elige al crearlo y no se
  puede cambiar después, porque las conversaciones que ya atendió quedaron
  registradas con esa sucursal. Si necesitás un agente en otra sucursal, creá
  uno nuevo.
- **Objetivo**: un resumen corto, para vos, de para qué está este agente (por
  ejemplo, "Atender consultas de usados y agendar visitas"). El agente no lo
  lee: lo que lo guía son las [Instrucciones](#instrucciones).
- **Tono**: una o dos palabras ("formal", "cercano"). Es solo informativo; el
  tono real se lo das escribiéndolo en las instrucciones.
- **Avisar al cliente si nadie responde en (minutos)** y **Mensaje cuando no
  hay nadie disponible**: qué pasa cuando el agente deriva a una persona y
  nadie contesta. Ver [Derivar a una persona](#derivar).
- **Activo**: si está desmarcado, el agente no responde.

La tarjeta **Modelo** es de solo lectura: el proveedor y el modelo de
inteligencia artificial los elige el equipo de la plataforma. Si este agente
necesita otro, pedíselo.

Para guardar, tocá **Guardar** al pie. Si escribiste o cambiaste las
[Reglas del agente](#reglas), antes de guardar se te muestra qué entendió el
sistema para que lo confirmes.

## Instrucciones {#instrucciones}

Es el campo más importante: el texto que el agente lee antes de cada
conversación. Es obligatorio y no tiene límite de largo. Escribilo como le
explicarías el trabajo a alguien que entra a atender el mostrador:

- **Qué es el negocio**: qué vende, en qué zona, qué lo distingue.
- **Qué tiene que lograr**: por ejemplo, responder consultas sobre unidades,
  conseguir nombre y teléfono del interesado, ofrecer una visita o un test
  drive.
- **Cómo tiene que hablar**: tuteo o voseo, formal o cercano, corto o
  detallado, si usa emojis.
- **De qué temas no puede hablar**: por ejemplo, de la competencia, de
  política, de rumores sobre modelos nuevos.
- **Qué promesas no puede hacer**: descuentos, plazos de entrega, tasas de
  financiación, disponibilidad que no confirmó.
- **Cuándo tiene que derivar la conversación a una persona**: reclamos,
  negociación de precio, un cliente enojado, cualquier cosa que preferís que
  maneje un vendedor.

Cosas que no hace falta escribir acá:

- Los horarios, las formas de pago, las promociones y las preguntas
  frecuentes de la sucursal van mejor en la
  [Base de conocimiento](/ayuda/base-de-conocimiento): el agente la lee junto
  con las instrucciones, y se puede mantener sin tocar al agente.
- El stock: el agente lo consulta solo si tiene habilitada la acción
  **Buscar vehículos en stock** (ver [Acciones habilitadas](#acciones)) o si
  sincronizaste el stock en la base de conocimiento.
- Las prohibiciones que querés que se cumplan sí o sí sobre lo que el agente
  *hace* (no lo que dice) van en [Reglas del agente](#reglas).

> Todo lo que está en las instrucciones puede terminar, de una u otra forma,
> en lo que el agente le dice al cliente. No pongas datos internos que no
> querés que se compartan.

## Canales {#canales}

En la tarjeta **Capacidades**, el campo **Canales** define por dónde atiende
el agente. Sin canales, no atiende por ningún lado. Cada canal necesita algo
más para funcionar:

| Canal | Qué hace falta |
|---|---|
| **WhatsApp** | Un número de WhatsApp asignado a este agente. Lo configura el equipo de la plataforma: el campo **ID del número de WhatsApp** es de solo lectura y muestra si ya lo tiene. Si este agente tiene que atender por WhatsApp y el campo está vacío, pedíselo a la plataforma. Ese número es también el que usan las automatizaciones y los cupones de esa sucursal. |
| **Web** | Instalar el chat en el sitio: ver [Instalar el chat en un sitio web](#instalar-en-un-sitio). |
| **Messenger** e **Instagram** | La página de Facebook de la organización conectada por el equipo de la plataforma, y asignada a este agente. Ver [Configuración de la organización](/ayuda/organizacion-y-sucursales). Instagram requiere que la página tenga una cuenta de Instagram vinculada. |

Un cliente puede escribir por más de un canal: cada canal es una conversación
distinta en [Conversaciones](/ayuda/conversaciones).

## Acciones habilitadas {#acciones}

Además de conversar, el agente puede *hacer* cosas en el sistema. Cada una es
una acción que habilitás o no en **Acciones habilitadas**. Un agente sin
acciones solo conversa (y aun así puede derivar a una persona: eso está
siempre disponible).

> Habilitar una acción es necesario pero no alcanza: antes de ejecutar
> cualquiera, el sistema la vuelve a revisar contra las
> [Reglas del agente](#reglas). Si una regla la prohíbe, no se ejecuta aunque
> esté habilitada.

Qué hace cada acción y cuándo la usa el agente:

**Crear oportunidad.** Crea una oportunidad de venta para el contacto de la
conversación, asignada a su vendedor, en la primera etapa del proceso de
venta por defecto. La usa solo cuando el cliente toma la iniciativa de
avanzar: pide un test drive, quiere reservar o señar, pide financiación o una
cotización formal, quiere coordinar una visita, ofrece su auto en permuta o
pide que lo llame un vendedor. No la usa por una consulta de información
("¿cuánto sale?", "¿tiene fotos?", "me interesa") ni por un "lo voy a
pensar": en esos casos contesta y el interés queda anotado en la ficha. Antes
de crearla necesita el nombre y el apellido del cliente; si no los tiene, se
los pide. El motivo queda como nota en la oportunidad. Si el contacto ya tiene
una oportunidad abierta, no crea otra: le anota el motivo nuevo a esa.

**Modificar oportunidad.** Cambia el título, el monto, la moneda o el vehículo
de la oportunidad abierta del contacto, o la marca como perdida con el motivo
que dio el cliente. No puede ganarla, reabrirla, moverla de etapa ni cambiarle
el vendedor o el proceso de venta: eso lo hace una persona.

**Reservar unidad.** Reserva una unidad del stock para el contacto, ligada a
su oportunidad abierta. Esto saca la unidad del stock para cualquier otro
cliente hasta que el equipo la libere. La usa solo cuando el cliente confirmó
que quiere avanzar con esa unidad puntual ("quiero reservar la Hilux",
"apartámela"), nunca por una pregunta de precio o un "me interesa". Si el
contacto no tiene oportunidad abierta, primero la crea. Hasta que la reserva
no se confirma, no se lo asegura al cliente; si la unidad ya no está
disponible, no la presenta como disponible. Ningún agente la trae habilitada:
la prendés vos si querés que el agente reserve.

**Consultar disponibilidad.** Busca los turnos libres de un recurso (una
persona, una sala, una clase) para un servicio, en un rango de fechas. La usa
antes de reservar un turno.

**Reservar turno.** Agenda un turno para el contacto en un recurso y un
servicio, en uno de los horarios que encontró libres. La duración la define
el tipo de servicio.

**Ver tipos de servicio.** Lista los servicios que ofrece la sucursal, con su
duración y el recurso al que pertenecen. La usa antes de consultar
disponibilidad, para saber qué servicio pide el cliente.

**Calificar el lead.** Registra la calificación inicial del contacto: puntaje,
intención, servicio de interés, urgencia, presupuesto, zona y notas. La usa
la primera vez que reúne datos de calificación en la conversación. Todos los
datos son opcionales: guarda los que conoce.

**Actualizar la calificación.** Actualiza esa calificación cuando aparece
información nueva o cambia algo (subió el presupuesto, cambió la urgencia).
Las notas se agregan a las anteriores. También es la acción con la que guarda
el nombre y el apellido del cliente.

**Guardar campos personalizados.** Completa en la ficha del contacto los
[campos personalizados](/ayuda/campos-personalizados) que marcaste como
editables por el agente, en el momento en que el cliente le da ese dato. Los
campos que no son editables por el agente los lee pero no los toca.

**Compartir datos de cobro.** Entrega el link de pago o los datos para
transferencia que cargaste en la sucursal. La usa cuando el cliente
concretamente quiere pagar o señar, o pide el link o los datos de la cuenta.
Si solo pregunta qué medios de pago aceptan, nombra los que hay sin compartir
los datos. Si no hay ningún medio cargado, se lo dice al cliente, no inventa
uno.

**Ver datos del contacto.** Consulta los datos que el sistema ya tiene del
contacto (nombre, apellido, email, teléfono). La usa para no preguntar el
nombre dos veces, y antes de derivar, para que quien retome tenga contexto.

**Buscar vehículos en stock.** Busca unidades disponibles y publicadas para
mostrar a clientes, con los filtros que el cliente dio (precio, marca,
modelo, año, carrocería, 0 km o usado, transmisión, combustible, color,
kilometraje, financiación, permuta, o un texto libre). Solo usa los filtros
que el cliente dijo: nunca completa uno por su cuenta, porque un filtro de
más esconde autos que sí hay. Devuelve hasta 10 resultados, de más barato a
más caro. La usa cuando el cliente pregunta por autos disponibles o pide
opciones dentro de un presupuesto o con ciertas características.

**Ver tareas pendientes del contacto.** Lista las tareas o actividades que el
equipo ya tiene agendadas para ese contacto (llamados de seguimiento,
recordatorios). La usa antes de prometer un seguimiento o de derivar, para no
duplicar algo que ya está agendado.

**Marcar sin interés.** Marca al contacto como "sin interés" cuando dice
claramente que no quiere seguir ("no gracias", "ya compré en otro lado", "no
me escribas más"). Desde ese momento ningún seguimiento automático le vuelve
a escribir, y el vendedor lo ve en la ficha. No la usa por un "lo voy a
pensar", un "después te aviso" o un silencio. Después de marcarlo se despide
con cortesía y no insiste; si más adelante el cliente pide algo, lo atiende
normalmente. Ningún agente la trae habilitada.

> **Crear oportunidad**, **Reservar turno** y **Reservar unidad** exigen el
> nombre y el apellido del cliente antes de actuar, y el agente los guarda
> con **Actualizar la calificación** o **Calificar el lead**. Si habilitás
> alguna de las tres sin ninguna de esas dos, el agente va a pedir el nombre
> pero no va a poder guardarlo, y esas acciones nunca se van a ejecutar. La
> pantalla te lo avisa.

## Reglas del agente {#reglas}

La tarjeta **Reglas del agente** es para las prohibiciones que el sistema
hace cumplir sí o sí, con un control propio, antes de dejar pasar cada
acción. El agente no puede saltearlas. Se escriben en tus palabras, y
sirven para tres cosas:

- **Qué acciones no puede ejecutar nunca**, aunque estén habilitadas arriba.
  Por ejemplo: "No marques ninguna oportunidad como perdida sin que un humano
  lo confirme."
- **Qué datos no puede modificar.** Por ejemplo: "No modifiques el email ni el
  teléfono de un contacto."
- **Qué tiene que saber antes de ejecutar una acción.** Por ejemplo: "Antes de
  reservar un turno, asegurate de tener el nombre y el teléfono del cliente."

Lo demás (los temas de los que no querés que hable, las promesas que no puede
hacer y cuándo tiene que derivar a una persona) va en
[Instrucciones](#instrucciones): son indicaciones que el agente sigue, no
candados que el sistema verifica.

Si dejás el campo vacío, el agente no tiene ninguna restricción además de las
acciones que habilitaste.

### Confirmar lo que se entendió

Como las reglas se escriben en lenguaje natural, al tocar **Guardar** el
sistema las interpreta y te muestra, en un panel llamado **Esto es lo que
entendimos**, la lista de reglas tal como van a regir. Por ejemplo:

- No puede ejecutar estas acciones: Modificar oportunidad.
- No puede modificar estos datos: email, teléfono.
- Antes de "Reservar turno" tiene que conocer: nombre, teléfono.

Revisala. Si coincide con lo que quisiste decir, tocá **Confirmar y
guardar**. Si no, tocá **Volver a editar**, corregí el texto y guardá de
nuevo. El panel no se cierra tocando afuera: hay que elegir una de las dos.

Si escribiste algo que el sistema no puede hacer cumplir (una acción que no
existe, un dato que ninguna acción toca, una frase demasiado larga), aparece
en rojo bajo **Esto no se puede aplicar y no va a quedar configurado**. No se
descarta nada en silencio: si te importa, reescribilo o pasalo a las
instrucciones.

El panel tiene al final un desplegable **Ver JSON** con el detalle técnico de
lo mismo que se lista arriba. Podés ignorarlo.

Si la interpretación falla (por ejemplo, por un problema de conexión), el
agente no se guarda: aparece el error y un botón **Reintentar**. Nunca queda
guardado con las reglas vacías por accidente. Si guardás sin haber tocado el
texto de las reglas, no se vuelve a interpretar nada.

> Al editar un agente viejo, el panel puede mostrar líneas de reglas que ya no
> se escriben acá (temas prohibidos, promesas, condiciones de derivación)
> porque fueron configuradas antes. Siguen valiendo; para cambiarlas, usá las
> instrucciones.

## Derivar a una persona {#derivar}

Derivar siempre está disponible, con o sin acciones habilitadas. El agente
deriva cuando el cliente lo pide, cuando las instrucciones se lo indican o
cuando no puede resolver algo. Al derivar:

1. La conversación queda marcada como derivada en
   [Conversaciones](/ayuda/conversaciones), y se crea una tarea para el
   vendedor asignado al contacto. Si el contacto no tiene vendedor, se le
   asigna el vendedor por defecto de la sucursal (se configura en
   [Sucursales](/ayuda/organizacion-y-sucursales)).
2. Mientras nadie del equipo escribe, el agente sigue contestando al cliente
   para no dejarlo sin respuesta.
3. Cuando una persona responde en la conversación, el agente se calla: esa
   conversación la atiende la persona hasta que toque **Devolver al agente**.

Dos campos del agente definen qué pasa si nadie responde:

- **Avisar al cliente si nadie responde en (minutos)**: si pasan esos minutos
  sin que nadie del equipo le escriba, el cliente recibe un único aviso de
  que no hay nadie disponible, la conversación vuelve al agente y la tarea
  para contactarlo queda pendiente. Viene en 15. Vacío o 0: no se avisa. El
  máximo es un día (1440 minutos).
- **Mensaje cuando no hay nadie disponible**: el texto de ese aviso. Es
  también lo que recibe el cliente si alguien toca **Devolver al agente** sin
  haberle respondido. Si lo dejás vacío se usa el de siempre: "Por el momento
  no hay nadie del equipo disponible. Te vamos a contactar más tarde.
  Mientras tanto, si querés, puedo seguir ayudándote."

> No escribas el horario en ese mensaje. Si la sucursal tiene horario cargado
> en [Sucursales](/ayuda/organizacion-y-sucursales) y está cerrada cuando se
> manda, el sistema agrega solo al final cuándo atiende el equipo y cuándo le
> van a escribir, por ejemplo "Te vamos a escribir mañana a partir de las 9".

## Instalar el chat en un sitio web {#instalar-en-un-sitio}

Para que el agente atienda por el canal **Web**, hay que pegar un código en
el sitio de la empresa. Desde la lista de agentes, **Instalar en un sitio**
abre una pantalla con tres pasos, en el orden en que hay que hacerlos. Es
para administradores; el pegado del código lo hace quien administra el
sitio web.

### 1. Dominios permitidos

El chat solo funciona desde los sitios que estén en esta lista. Es a
propósito: aunque alguien copie el código, no sirve en un sitio que no esté
autorizado.

1. Escribí el dominio en el campo y tocá **Agregar** (o Enter). Solo el
   dominio, con `https://` y sin ninguna ruta después: `https://tusitio.com`,
   no `https://tusitio.com/contacto`.
2. Si el sitio también se abre con `www` (`https://www.tusitio.com`),
   agregalo también: para el navegador son dos sitios distintos.
3. Tocá **Guardar dominios**. Hasta que no guardes, la lista no vale.

Para sacar un dominio, tocá la cruz en su etiqueta y guardá. Se pueden cargar
hasta 50.

### 2. Tokens de embed

El **token** es una clave que identifica a este agente en el código que se
pega en el sitio. Tocá **Generar token nuevo**: aparece una sola vez, en ese
momento, con un botón para copiarlo.

> Esta es la única vez que vas a ver el token completo. El sistema no lo
> guarda: si lo perdés, hay que revocarlo y generar otro. En la tabla queda
> solo su prefijo (los primeros caracteres), para saber cuál es cuál, con la
> fecha de creación y de último uso.

**Revocar** un token deja de funcionar el chat que lo esté usando, de
inmediato: habrá que pegar el código de nuevo con un token nuevo. Usalo si
sospechás que el token se filtró o si cambiás de sitio.

### 3. Código para instalar en el sitio

Es el texto que hay que pegar en el sitio, antes del cierre de la página
(justo antes de `</body>`), en todas las páginas donde tenga que aparecer el
chat. **Copiar código** lo copia entero.

- Si acabás de generar un token en el paso 2, el código ya lo tiene puesto.
- Si volviste a esta pantalla otro día, el código trae la marca
  `PEGÁ_ACÁ_TU_TOKEN` en lugar del token, porque no se puede volver a ver.
  Generá uno nuevo (el código se completa solo) o reemplazá la marca a mano
  por el token que tengas guardado.
- Si todavía no hay ningún dominio guardado, la pantalla avisa que el código
  no va a funcionar hasta que agregues uno.

## Probar el agente {#probar}

**Probar agente** abre una pantalla para conversar con el agente escribiendo
como si fueras el cliente, y ver qué contesta y qué hace.

> No es un entorno de prueba aislado. Los mensajes generan una conversación
> real con el contacto que elijas, y si el agente tiene acciones habilitadas
> puede crear oportunidades, calificar al contacto, reservar una unidad o
> derivar la conversación a un vendedor de verdad. Usá un contacto de prueba
> propio (por ejemplo, uno con tu nombre), nunca un cliente real.

1. Elegí el **Contacto** con el que vas a conversar.
2. Si el agente atiende por más de un canal, elegí el **Canal**. Si tiene uno
   solo, ya está elegido. Si no tiene ninguno, la pantalla te manda a editar
   el agente: sin canales no hay nada que probar. Lo mismo si el agente está
   desactivado.
3. Escribí en el cuadro de abajo como si fueras el cliente y tocá **Enviar**
   (Enter manda; Shift+Enter hace un salto de línea).

En la transcripción ves tus mensajes, las respuestas del agente y, entre
medio, lo que hizo en cada turno:

- Cada acción que intentó, con el nombre (por ejemplo, **Buscar vehículos en
  stock**), los datos que usó y el resultado. Si una regla la bloqueó, dice
  **Bloqueada por las reglas del agente** y por qué. Si falló, el motivo.
- **Se derivó esta conversación a un humano**, con un link a la tarea de la
  derivación si se creó una.
- **El agente no respondió** cuando una persona del equipo ya está atendiendo
  esa conversación: el mensaje quedó registrado pero el agente no contesta
  mientras atienda una persona.

Lo que se ve es solo lo que pasó desde que abriste la pantalla. El hilo
completo, con lo de otras veces, está en
[Conversaciones](/ayuda/conversaciones). Cambiar de contacto limpia la
pantalla.

## Agente interno del equipo {#agente-interno}

Además de los agentes que hablan con los clientes, la organización tiene un
agente interno: un asistente de IA para el propio equipo, que se usa desde el
chat **Agente interno** del menú principal. Sirve para pedirle cosas en
lenguaje natural, como "agendame una tarea para llamar a Ana Pérez el jueves"
o "¿qué turnos hay mañana en Sucursal Centro?".

Quién lo puede usar:

- Un administrador, siempre.
- Un usuario, solo si un administrador le habilita **Acceso al agente
  interno** en [Usuarios](/ayuda/usuarios-y-permisos).

Hasta que no esté configurado, el chat avisa que todavía no hay un agente
interno. Lo configura un administrador en **Configurar agente interno**,
dentro de la sección **Agentes de IA**. Hay uno solo por organización.

- **Nombre**: como se presenta en el chat.
- **Instrucciones**: lo que lee antes de cada respuesta. Qué es el negocio,
  cómo tiene que contestar y qué no tiene que hacer. Tené en cuenta que acá
  del otro lado está un empleado, no un cliente.
- **Modelo**: lo elige el equipo de la plataforma; si necesitás otro,
  pedíselo.
- **Acciones habilitadas**: sin acciones, el agente solo conversa. Las dos
  disponibles:
  - **Crear tarea**: crea una tarea en el sistema, ligada a un contacto o a
    una oportunidad que ya existen, asignada a la persona que se la pidió. Si
    no le dijiste a quién o a qué va ligada, pregunta antes de crearla. Si
    mencionás una fecha límite, la carga.
  - **Ver agenda**: lista los turnos agendados en un rango de fechas, de toda
    la organización o de una sucursal, con fecha, hora, contacto, servicio,
    sucursal y estado. Si no indicás hasta cuándo, mira las 24 horas
    siguientes; el rango máximo es de 62 días. Si no hay turnos, lo dice tal
    cual.

Tocá **Guardar**. Cada persona tiene su propio hilo con el agente interno:
lo que vos le preguntás no lo ve otro usuario.
