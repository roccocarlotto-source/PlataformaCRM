# Automatizaciones

Una automatización es una regla del tipo "cuando pasa tal cosa, hacé tal
otra": cuando se gana una venta, mandarle al cliente un cupón; cuando una
oportunidad lleva una semana sin movimiento, dejarle al vendedor un borrador
de mensaje para retomarla; cuando alguien consultó y no volvió a escribir,
escribirle de nuevo. El sistema las ejecuta solo, sin que nadie las dispare.

Esta sección es para administradores: está dentro de **Agentes de IA** en el
menú.

## Reglas {#reglas}

La pantalla [Automatizaciones](/automations) lista las reglas de la
organización. Para cada una se ve:

- **Nombre**: el que le pusiste, solo para reconocerla en esta lista.
- **Cuándo**: el evento que la dispara.
- **Qué hace**: la acción.
- **Estado de la regla**: **Activa** o **Inactiva**. Una regla inactiva no se
  ejecuta pero conserva su configuración.
- **Aprobación de WhatsApp**: solo en las reglas que mandan un WhatsApp, si
  WhatsApp ya aprobó el mensaje (ver [Aprobación de WhatsApp](#aprobacion)).
  Una regla activa cuyo mensaje todavía está pendiente no le manda nada a
  nadie.

Podés buscar por nombre, filtrar por estado y ordenar. El menú de cada fila
ofrece **Editar** y **Eliminar**.

> **Eliminar** una regla la deja de ejecutar de inmediato. Lo que ya generó
> (tareas creadas, mensajes mandados, cupones emitidos) no se toca. Para
> pausarla unos días sin perder la configuración, editala y desmarcá
> **Activa**.

## Crear una regla {#nueva-regla}

1. En [Automatizaciones](/automations), tocá **Nueva automatización**.
2. Escribí un **Nombre** (por ejemplo, "Cupón post-venta"). Es solo para vos:
   no lo ve el cliente ni nadie más.
3. Dejá **Activa** marcada para que empiece a funcionar al guardar, o
   desmarcala para dejarla preparada.
4. En **Cuándo se ejecuta**, elegí el **Evento** y completá sus datos (ver
   [Eventos](#eventos)).
5. En **Qué hace**, elegí la **Acción** y completá sus datos (ver
   [Acciones](#acciones)). El desplegable ofrece solo las acciones que tienen
   sentido con el evento elegido.
6. Si la acción manda un WhatsApp, aparece la tarjeta **Mensaje de
   WhatsApp** para escribir el texto (ver
   [Mensaje de WhatsApp](#mensaje-de-whatsapp)).
7. Tocá **Guardar**.

Al editar una regla se puede cambiar cualquier cosa, incluido el evento o la
acción; al cambiarlos, los datos de la configuración anterior se vacían
porque no significan lo mismo para la nueva.

## Eventos {#eventos}

Hoy hay tres eventos. Para los dos que se revisan una vez por día, solo puede
haber una regla activa con ese evento.

### Oportunidad ganada

Se dispara en el momento en que una oportunidad pasa al estado **Ganada**, ya
sea porque alguien la mueve en el embudo o la cierra desde su ficha (ver
[Oportunidades](/ayuda/oportunidades-y-procesos-de-venta)). No tiene datos
propios. Admite las acciones **Crear actividad de seguimiento**, **Enviar QR
por WhatsApp** y **Enviar cupón de descuento**.

### Oportunidad sin movimiento

Se dispara con las oportunidades abiertas que no tuvieron ningún cambio en
la cantidad de **Días sin movimiento** que indiques (de 0 a 365). El sistema
las revisa una vez por día, y cada oportunidad dispara la regla una sola vez
hasta que vuelva a tener movimiento. Admite la acción **Redactar seguimiento
con IA**.

### Consulta sin avance

Se dispara con los contactos (identificados o no) que escribieron por algún
canal y llevan la cantidad de **Días sin respuesta** que indiques sin volver
a escribir, siempre que no tengan una oportunidad abierta ni la marca
**sin interés** (ver [Contactos](/ayuda/contactos-y-consultas)). Se revisa
una vez por día.

**Seguimientos como máximo** es cuántas veces se le vuelve a escribir por
cada vez que el cliente escribió: con 1, un solo seguimiento; con 2, otro más
si sigue sin contestar. Si el cliente responde, la cuenta arranca de cero.
Viene en 3 días y 1 seguimiento. Admite la acción **Retomar la consulta**.

Un cuarto caso previsto, el recordatorio de turno por WhatsApp, todavía no
está disponible.

## Acciones {#acciones}

### Crear actividad de seguimiento

Crea una tarea para el dueño de la oportunidad, en
[Actividades](/ayuda/actividades-y-agenda).

- **Título de la tarea**: por ejemplo, "Llamar para coordinar la entrega".
- **Vence en (días)**: contados desde que se dispara la regla, de 0 a 365.
  Con 0 vence el mismo día.
- **Notas** (opcional): quedan en el campo **Notas** de la tarea.

### Redactar seguimiento con IA

La inteligencia artificial redacta un mensaje breve para retomar el contacto
con el cliente, usando los datos de la oportunidad y su última conversación
si la hay, y lo deja como una tarea para el dueño de la oportunidad, que
vence ese mismo día. No tiene datos propios: cuántos días sin movimiento es
del evento.

> El mensaje no se le manda a nadie. Lo revisa y lo envía el vendedor, si le
> parece bien.

### Enviar QR por WhatsApp

Cuando la oportunidad se gana, agenda un WhatsApp al contacto con un
[código QR](/ayuda/cupones-y-qr#qr), típicamente el de reseñas de Google.

- **QR a enviar**: uno de los QR de la organización. Si todavía no hay
  ninguno, la pantalla te manda a crearlo.
- **Esperar** y **Unidad**: cuánto esperar desde que se gana la venta, en
  minutos, horas o días, hasta 30 días. Con 0, sale apenas se gana. Un par de
  horas suele ser el mejor momento para pedir una reseña: después de la
  entrega, pero el mismo día.

El mensaje sale desde el número de WhatsApp de la sucursal del QR. Los
envíos agendados se revisan cada 5 minutos, así que puede salir hasta 5
minutos después de lo pedido. Si para entonces la oportunidad ya no está
ganada, no se manda.

### Enviar cupón de descuento

Cuando la oportunidad se gana, agenda un WhatsApp al contacto con un
[cupón de un solo uso](/ayuda/cupones-y-qr#cupones).

- **Descuento**: el texto que el cliente ve en su cupón, por ejemplo "15% de
  descuento en el taller".
- **Sucursal**: desde cuyo número de WhatsApp sale el mensaje.
- **Esperar** y **Unidad**: cuánto esperar desde que se gana la venta, hasta
  30 días.
- **Vence a los (días)**: de 1 a 365, contados desde que se manda.

El cupón nace en el momento en que se manda el mensaje (no antes), vence a
los días indicados y aparece en la ficha del contacto como **por regla**. Se
canjea en el mostrador escaneando su QR desde
[Canjear cupón](/ayuda/cupones-y-qr#canjear-cupon). Igual que con el QR, el
envío puede salir hasta 5 minutos después de lo pedido.

### Retomar la consulta

Le vuelve a escribir al cliente que consultó y no siguió. Qué pasa depende
del canal por el que escribió:

- **Por WhatsApp**, se le manda el mensaje de la tarjeta de abajo, dentro del
  horario de la sucursal. Si el cliente escribió hace menos de 24 horas, en
  vez del mensaje fijo el agente de IA redacta uno con el contexto de la
  conversación.
- **Por Messenger, Instagram o el chat del sitio web**, o si una persona del
  equipo ya está atendiendo la conversación, no se le escribe: se crea una
  tarea para el vendedor asignado con el resumen de lo que preguntó.

Si el cliente responde, el agente de IA sigue la conversación.

## Mensaje de WhatsApp {#mensaje-de-whatsapp}

Las acciones que mandan un WhatsApp (**Enviar QR por WhatsApp**, **Enviar
cupón de descuento** y **Retomar la consulta**) muestran la tarjeta
**Mensaje de WhatsApp**, donde escribís lo que le llega al cliente. La regla
arranca con un texto sugerido que podés usar tal cual o cambiar.

### Formato

Solo para el QR y el cupón:

- **Solo link**: el link va dentro del texto.
- **Solo imagen**: la imagen del QR arriba del texto, sin link.
- **Imagen y link**: la imagen arriba y el link en el texto.

Al cambiar de formato, si no tocaste el texto sugerido, se reemplaza por la
versión con o sin link que corresponde; si ya lo escribiste vos, no se toca.

### Variables

Dentro del texto se escriben marcas que el sistema reemplaza por el dato de
cada cliente. Los botones **Insertar** las agregan donde está el cursor.

| Acción | Variable | Qué va ahí |
|---|---|---|
| QR y cupón | `{nombre}` | El nombre del cliente. Obligatoria, una sola vez. |
| QR y cupón (con link) | `{link}` | El link del QR o del cupón. Obligatoria, una sola vez, después de `{nombre}`. Con **Solo imagen** no va. |
| Retomar la consulta | `{saludo}` | El saludo con el nombre del cliente ("Hola Ana"), o "Hola" a secas si no lo dio. Obligatoria. |
| Retomar la consulta | `{vehiculo}` | El vehículo que consultó, o "el vehículo que consultaste" si no se sabe. Opcional, a lo sumo una vez, después de `{saludo}`. |

Ninguna variable puede ir al principio ni al final del texto: es una regla de
WhatsApp. "Hola {nombre}, gracias por tu compra…" está bien; "{nombre},
gracias…" no.

La **Vista previa** muestra cómo le llega al cliente, con datos de ejemplo
(Ana, un link de muestra, una Toyota Hilux SRV 2022) y la imagen del QR si el
formato la lleva.

## Aprobación de WhatsApp {#aprobacion}

WhatsApp no deja escribirle a un cliente que no escribió en las últimas 24
horas con cualquier texto: solo con mensajes que revisó y aprobó de antemano.
Por eso, al guardar una regla que manda WhatsApp, el sistema le manda el
texto a WhatsApp para que lo apruebe. Vos no tenés que hacer nada más que
guardar.

- La aprobación suele tardar de unos minutos a un día. Hasta entonces, la
  regla no le manda nada a nadie, aunque esté activa.
- El estado se ve en la tarjeta **Mensaje de WhatsApp** de la regla y en la
  columna **Aprobación de WhatsApp** de la lista:
  - **Sin enviar**: todavía no se mandó a aprobar; se manda al guardar.
  - **Pendiente**: WhatsApp lo está revisando. El botón **Consultar estado**
    pregunta si ya hay novedades.
  - **Aprobada**: el mensaje ya puede salir.
  - **Rechazada**: WhatsApp no lo aceptó, con el motivo entre paréntesis
    cuando lo informa. Cambiá el texto y guardá la regla para mandarlo de
    nuevo.
- Si cambiás el texto de una regla cuyo mensaje ya estaba aprobado, el nuevo
  se manda a aprobar y, mientras WhatsApp lo revisa, se sigue mandando el
  anterior. Guardar la regla sin tocar el texto no pide una aprobación nueva.

> Si al guardar aparece "La regla se guardó, pero el mensaje no se pudo
> mandar a aprobación de WhatsApp", la regla existe pero el mensaje no llegó
> a WhatsApp (por ejemplo, por un problema de conexión o de configuración
> del número). Leé el motivo y tocá **Guardar** de nuevo para reintentar.

### Horario de la sucursal

Los mensajes automáticos (QR, cupones, seguimientos) solo se mandan dentro
del horario de atención de la sucursal que se configura en
[Sucursales](/ayuda/organizacion-y-sucursales). Si la espera de una regla
vence a las 23:00, el mensaje sale cuando la sucursal abre. Si no cargaste un
horario, se usa el de siempre: lunes a sábado de 9:00 a 20:00. Esto vale
para los mensajes que inicia el negocio; las respuestas del agente de IA a
un cliente que escribe salen a cualquier hora.
