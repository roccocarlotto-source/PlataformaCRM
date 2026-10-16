# Taller

El **Taller** es el módulo de postventa: registra los autos de los clientes que
pasan por el service, para que el taller sepa qué auto es de quién, cuándo le
toca el próximo service y qué se le hizo cada vez.

Solo aparece si la organización tiene el módulo **Servicios** activado. Lo
activa el equipo de la plataforma; si no lo ves en el menú, tu organización no
lo tiene.

Está en el menú **Taller**, con cinco entradas: **Resumen**, **Órdenes**,
**Vehículos de clientes**, **Recambios** y **Configuración**.

- Todos los usuarios ven, cargan y editan los vehículos de clientes y las
  órdenes, cambian su estado, registran aprobaciones y pueden cambiar el dueño
  de un vehículo.
- Eliminar un vehículo y la **Configuración**: solo un administrador.

## Resumen del taller {#resumen}

En **Taller → Resumen** está lo que hay que mirar cada día. Arriba se puede
elegir una **Sucursal** (o todas).

- **Autos en el taller**: cuántas órdenes hay en Recibido, En trabajo y
  Esperando aprobación.
- **Listos para retirar**: las órdenes terminadas, desde la que espera hace más
  tiempo.
- **Esperando aprobación hace más de 24 h**: las que el cliente todavía no
  respondió, para que no queden colgadas.
- **Services vencidos**: los vehículos cuya fecha de próximo service ya pasó.
  Es la lista para llamar.
- **Services en los próximos 30 días**: los que vencen pronto.
- **Agendados con el turno cancelado**: órdenes agendadas cuyo turno de la
  agenda se canceló; revisalas.
- **Recambios en los próximos 90 días**: cuántos clientes cumplen pronto los
  años de su compra (ver [Recambios](#recambios)). Si hay vehículos sin fecha
  de compra, un link los muestra: sin ella no se calcula el recambio.
- **Recambios vencidos sin contactar**: cuántos hay en la lista de
  [Recambios](#recambios), con un link a ella.

En las listas de services solo aparecen los vehículos que siguen siendo del
cliente, sin una orden abierta y sin **No recordar**. "Hoy" es el día de la
zona horaria de la organización.

Cada lista muestra hasta 10, con un link a la orden o al vehículo. Si hay más,
abajo dice **y N más**.

En el [Dashboard](/ayuda/primeros-pasos#dashboard-taller) de inicio hay un
bloque **Taller** con los tres primeros totales y un link a este resumen.

## Órdenes de servicio {#ordenes}

Una **orden de servicio** es cada vez que un auto entra al taller: qué auto,
de quién, qué se le hace, quién la lleva y cuánto se cobra. Cada orden tiene un
número consecutivo, como **OS-0042**.

Está en **Taller → Órdenes**, con dos vistas que se eligen arriba (y quedan
recordadas en tu navegador, igual que la sucursal):

- **Tablero**: una columna por estado abierto, de Agendado a Listo para
  retirar. Cada tarjeta muestra el número, el vehículo, el cliente, el
  encargado y hace cuánto está en ese estado. **Arrastrar una tarjeta** a otra
  columna abre el paso a ese estado; mientras se arrastra, las columnas a las
  que no se puede pasar se ven apagadas y no la aceptan. Al confirmar, la
  tarjeta queda en la columna nueva enseguida; si el paso no se pudo hacer,
  vuelve a la de antes con el aviso. En una pantalla de computadora entran las
  cinco columnas; en el celular se ven de a una, deslizando hacia el costado.
- **Lista**: todas las órdenes, también las entregadas y canceladas, con
  búsqueda por número (`OS-42` o `42`), matrícula o cliente. Por defecto
  muestra las **abiertas**; las entregadas y canceladas aparecen eligiendo
  **Todas** (o ese estado) en **Estado**.

### Estados {#estados}

| Estado | Qué significa |
|---|---|
| Agendado | Se acordó que el auto viene, con fecha. |
| Recibido | El auto está en el taller. Se cargan los km y los daños al ingreso. |
| En trabajo | Se está trabajando. |
| Esperando aprobación | Apareció un trabajo extra y se le consultó al cliente. |
| Listo para retirar | Terminado; falta que el cliente lo retire. |
| Entregado | El cliente lo retiró. Se fija el próximo service. **Final.** |
| Cancelado | No se hizo. **Final.** |

Los pasos posibles:

- de **Agendado**: a Recibido o Cancelado;
- de **Recibido**: a En trabajo, Esperando aprobación, Listo para retirar o
  Cancelado;
- de **En trabajo**: a Esperando aprobación, Listo para retirar o Cancelado;
- de **Esperando aprobación**: a En trabajo o Listo para retirar **siempre que
  se haya registrado la respuesta del cliente** (ver
  [Aprobaciones](#aprobaciones)), o a Cancelado, que solo pide el motivo;
- de **Listo para retirar**: a Entregado, o de vuelta a En trabajo si el cliente
  reclamó algo antes de retirarlo.

Una orden **Entregada** o **Cancelada** ya no se mueve ni se edita. Si se
entregó por error, se corrige el próximo service en la ficha del vehículo.

Si dos personas mueven la misma orden a la vez, la segunda ve el aviso "La
orden cambió de estado mientras tanto": hay que volver a abrirla.

**Tareas automáticas por estado.** En
[Automatizaciones](/ayuda/automatizaciones#evento-orden-cambia-de-estado) se
puede pedir una tarea cuando una orden pasa a un estado (por ejemplo, "Avisarle
al cliente que el auto está listo" al pasar a **Listo para retirar**) o cuando
se entrega. Va al encargado de la orden.

## Nueva orden {#nueva-orden}

Con **Nueva orden** (en Órdenes, o en la ficha de un vehículo):

1. Se busca el vehículo por matrícula, chasis o dueño. Si no está, se ofrece
   **Crear vehículo con esta matrícula**.
2. El cliente de la orden es el dueño del vehículo.
3. Se elige la **sucursal** (por defecto, la del vehículo) y cómo empieza:
   - **Recibido**: el auto ya está en el taller. Se cargan los **km al
     ingreso** (obligatorio) y los daños, si hay. Los km del vehículo se
     actualizan si son más que los que tenía.
   - **Agendado**: viene más adelante, con la fecha en que se lo espera.
4. Opcional: los **tipos de service**, el **encargado** (viene elegido quien
   crea la orden; se puede cambiar por cualquier usuario activo o dejar sin
   encargado), las **notas** y el **valor**. La **moneda** viene elegida con la
   de la organización (si la organización no configuró ninguna, USD) y se
   puede cambiar.

**Desde un turno de la agenda**: en el detalle del turno (Agenda → tocar el
turno), **Crear orden de servicio** abre Nueva orden con el turno: se elige uno
de los vehículos del cliente del turno (o **Cargar un vehículo de este
cliente**) y la orden nace **Agendada** para el horario del turno, en su
sucursal y [vinculada a él](#turno-de-la-orden).

**Un auto no puede estar dos veces en el taller**: si ya tiene una orden de
Recibido a Listo para retirar, no se puede recibir otra y el aviso ofrece
**Abrir la orden**. Sí se puede agendar el próximo turno mientras está adentro.

## La ficha de la orden {#ficha-de-la-orden}

Arriba, el número y los botones de los pasos posibles desde el estado actual
(por ejemplo, **Pasar a En trabajo** o **Entregar**), más **Editar**. El paso a
En trabajo dice **Volver a trabajo** solo si la orden ya estuvo en trabajo
antes. En los diálogos de cada paso, **Cancelar** cierra sin cambiar nada (en
el de cancelar la orden, ese botón dice **No cancelar**).

- **Orden**: estado, vehículo (con link a su ficha), cliente, sucursal,
  encargado, cuándo se espera, el [turno](#turno-de-la-orden) y quién la creó.
- **Ingreso**: cuándo se recibió, km y daños al ingreso.
- **Trabajo**: tipos de service, notas y valor.
- **Aprobaciones** y **Historial**: cada cambio de estado, con quién y cuándo.

Con **Editar** se cambian el encargado, la fecha esperada o los km, los daños,
las notas, los tipos y el valor. El estado se cambia solo con los botones.

### El turno de la agenda {#turno-de-la-orden}

Una orden puede estar vinculada a un turno de la agenda. En la ficha, **Turno**
muestra su horario, el servicio y el recurso:

- **Vincular turno** ofrece los turnos confirmados y futuros del cliente. Al
  vincular uno, la orden pasa a esperar el auto en ese horario. Un turno tiene
  una sola orden abierta a la vez.
- **Desvincular** saca el turno de la orden. El turno sigue en la agenda y la
  orden conserva su fecha.

El turno y la orden **no se mueven juntos**:

- Si el turno se cancela en la agenda (o en Google Calendar), la orden queda
  como estaba y la ficha avisa **El turno vinculado fue cancelado**, con
  **Vincular otro turno** y **Desvincular**. Si el cliente no vino, avisa **El
  cliente no vino al turno**.
- Si se cancela la orden, el turno sigue en la agenda: el diálogo lo recuerda,
  y se cancela desde la agenda si corresponde (cancelar un turno lo libera para
  otro cliente).

### Aprobaciones {#aprobaciones}

Cuando aparece un trabajo extra, la orden pasa a **Esperando aprobación** y
alguien le consulta al cliente por teléfono, WhatsApp o en persona. Lo que
respondió se anota con **Registrar aprobación**: qué se le consultó, si aprobó
o rechazó, quién respondió, por dónde y cuándo, y el monto si se habló de uno.

- Con **Sumar al valor de la orden**, el monto aprobado se suma al valor, en la
  misma moneda. La casilla se activa al cargar el monto.
- **Para pasar de Esperando aprobación a En trabajo o a Listo para retirar
  hay que registrar la respuesta.** Mientras falte, esos botones están
  apagados y el aviso de arriba de la ficha trae **Registrar aprobación**. Si
  vuelve a ese estado, hace falta una respuesta nueva.
- **Cancelar no la pide**: si el cliente nunca respondió, se cancela con el
  motivo.

### Avisar al cliente {#avisar-al-cliente}

Con la orden en **Recibido**, **Esperando aprobación** o **Listo para
retirar**, la ficha tiene **Avisar al cliente**. Abre un cuadro con un texto
sugerido para ese estado (por ejemplo, "Hola Ana, tu Fiat Uno ya está listo.
Podés pasar a retirarlo por Centro."), que podés cambiar.

- Si el cliente tiene una conversación de WhatsApp y escribió en las últimas
  24 horas, **Abrir la conversación** la abre con el texto ya escrito en el
  cuadro de respuesta. Lo revisás y lo mandás como cualquier respuesta, y el
  aviso queda registrado solo en la orden.
- Si pasaron más de 24 horas desde su último mensaje, o no tiene conversación,
  WhatsApp no deja mandar texto libre: **Copiar el texto** y **Llamar** (si
  tiene teléfono).
- **Marcar como avisado** registra el aviso cuando le avisaste por otro medio:
  elegí **Teléfono**, **WhatsApp** o **En persona**.

Los avisos quedan en la tarjeta **Avisos al cliente** de la ficha, con quién
avisó y cuándo, y también en las actividades del contacto.

### Entregar y el próximo service {#entregar}

Al entregar, el diálogo propone la fecha del **próximo service**: la fecha de
hoy más el intervalo **más corto** entre los tipos de service de la orden (si
dos trabajos piden plazos distintos, manda el que vence antes). Si ningún tipo
tiene intervalo, se usa el de la [Configuración](#configuracion), y el diálogo
lo aclara. La fecha se puede cambiar, o marcar **Sin próximo service**.

Lo que se confirma queda en el vehículo: es la fecha de la que van a salir los
recordatorios al cliente.

## Configuración {#configuracion}

En **Taller → Configuración** (solo administradores):

- **Intervalo por defecto**: los meses hasta el próximo service para una orden
  sin tipos con intervalo. Vacío: no se propone fecha.
- **Primer service de un auto vendido**: los meses desde la venta.
- **Tipos de service**: se agregan con **Nombre del service** ("Service 10.000
  km", "Alineación") y **Cada cuántos meses** vuelve el auto (vacío: el tipo no
  fija fecha), y el botón **Agregar tipo**. Un tipo inactivo no
  se ofrece en las órdenes nuevas; uno eliminado desaparece del catálogo pero
  las órdenes que lo tuvieron lo siguen mostrando.

## Vehículos de clientes {#vehiculos-de-clientes}

Un **vehículo de cliente** es el auto que un cliente trae al taller. No es una
unidad del [Stock](/ayuda/stock): el stock es lo que la concesionaria tiene a la
venta; un vehículo de cliente ya es de alguien.

El listado está en **Taller → Vehículos de clientes**. Muestra la matrícula, la
marca y el modelo, el dueño, el próximo service y si tiene una orden abierta.
Con **Solo los que no tienen fecha de compra** se ven los que todavía no tienen
[recambio](#recambios).

### Buscar por matrícula {#buscar-por-matricula}

El buscador de arriba encuentra un vehículo por:

- el **principio de la matrícula**: no importan mayúsculas, espacios ni guiones,
  así que "abc 12", "ABC-12" y "abc12" encuentran lo mismo;
- el **principio del chasis**;
- el **nombre o el apellido del dueño**.

Si no hay ningún resultado, el listado ofrece **Crear vehículo con esta
matrícula**, con la matrícula ya escrita.

Por defecto el listado muestra solo los vehículos que siguen siendo de un
cliente. Con **Mostrar los que ya no son de un cliente** aparecen también esos,
con su marca.

### Cargar un vehículo {#nuevo-vehiculo}

Con **Nuevo vehículo** se carga a mano. Se pide:

- **Dueño**: el contacto. Se busca por nombre o email; un contacto con los datos
  personales borrados no se puede elegir.
- **Marca** y **Modelo**.

Lo demás es opcional: año, matrícula, chasis, kilómetros, sucursal de
referencia, fecha de compra, próximo service y notas. La matrícula puede quedar
vacía (un 0 km todavía no la tiene) y completarse después.

**Matrícula y chasis no se repiten.** Si ya hay otro vehículo de cliente con esa
matrícula o ese chasis, el sistema no deja guardar y ofrece **Abrir el
vehículo** que ya la tiene. Un vehículo que ya no es de un cliente no cuenta: el
mismo auto puede volver a cargarse para su dueño nuevo.

### Los autos que vende la concesionaria {#vehiculos-vendidos}

No hace falta cargarlos: cada **venta ganada** con una unidad del
[Stock](/ayuda/stock) y un contacto se convierte sola en un vehículo de ese
cliente, en los 15 minutos siguientes. Lleva la marca, el modelo, el año, la
matrícula, el chasis, los kilómetros y la sucursal de la unidad, y la **fecha
de compra** es la de la venta. En su ficha, **Origen** dice **Vendido por
nosotros**, con link a la oportunidad.

- **Primer service**: las ventas desde que se activó el módulo nacen con el
  próximo service a los meses de **Primer service de un auto vendido** (en
  [Configuración](#configuracion)). Las ventas de antes entran sin fecha.
- **Si el cliente ya traía el auto** (con esa matrícula o ese chasis), no se
  crea otro: se le completan la venta y la fecha de compra, y no se le cambia
  un próximo service que ya tenga.
- **Si la matrícula o el chasis ya son de un vehículo de otro cliente**, no se
  toca nada: revisalo y usá [Cambiar dueño](#cambiar-dueno) si corresponde.
- **Si la venta deja de estar ganada** (se reabre, se pierde o se borra), el
  vehículo se borra. Si ya tiene órdenes, o el cliente lo traía desde antes,
  queda, y el contacto recibe una nota que lo explica.

## La ficha del vehículo {#ficha-del-vehiculo}

Al abrir un vehículo se ve:

- sus datos y su **dueño**, con link a la ficha del contacto;
- la **sucursal de referencia**: de dónde salen los avisos al cliente;
- el **próximo service** y si está marcado **No recordar**;
- la **fecha de compra**, si se sabe, y de dónde salió el vehículo;
- los **cambios de dueño**;
- el **historial de órdenes**, de la más nueva a la más vieja, con link a
  cada una;
- **Nueva orden**, para abrirle una orden a ese vehículo.

Con **Editar** se cambian los datos. El dueño no se edita: se cambia con
**Cambiar dueño**.

### Próximo service y "No recordar" {#proximo-service}

El **próximo service** es la fecha en que al cliente le toca volver. Se puede
cargar o corregir a mano desde **Editar**.

**No recordar** es para el cliente que pidió no recibir recordatorios del
service: el vehículo queda, pero no se le avisa.

Para avisarle al cliente cuando se acerca la fecha, se crea una regla en
[Automatizaciones](/ayuda/automatizaciones#evento-proximo-service) con el
evento **Próximo service**: un WhatsApp unos días antes (o después), o una
tarea para llamarlo. No se avisa a los vehículos con una orden abierta ni a
los marcados **No recordar**.

### Cambiar dueño {#cambiar-dueno}

Cuando el auto cambia de manos, en la ficha está **Cambiar dueño**, con dos
opciones:

- **Pasa a otro contacto**: el cliente se lo vendió a alguien que también es
  contacto. El vehículo pasa al dueño nuevo y conserva su próximo service.
- **Ya no es de un cliente nuestro**: lo vendió a alguien que no conocemos, o
  por otro motivo (robo, se mudó…). El vehículo queda con la marca **Ya no es
  del cliente** y deja de recibir avisos.

En los dos casos:

- se borra la **fecha de compra**, porque era del dueño anterior;
- el cambio queda registrado en la ficha, con quién lo hizo, cuándo y la nota;
- no se puede hacer si el vehículo tiene una **orden abierta**: primero hay que
  entregarla o cancelarla.

No hay "deshacer": un cambio hecho por error se corrige con otro cambio, y el
registro muestra los dos.

**Parte de pago.** Cuando un auto con la matrícula o el chasis de un vehículo de
cliente entra al [Stock](/ayuda/stock) (el cliente lo entregó como parte de
pago), el vehículo pasa solo a **Ya no es del cliente**. El registro de cambios
lo muestra como **Entró a nuestro stock (permuta)** y el contacto recibe una
nota con la unidad. Si tiene una orden abierta, espera a que se entregue o se
cancele. Si fue un error de carga (una matrícula equivocada en el stock), se
corrige la matrícula y se vuelve a cargar el vehículo para su dueño.

### Eliminar un vehículo {#eliminar-vehiculo}

Solo un administrador, desde la ficha. No se puede eliminar un vehículo con una
orden abierta. Para un auto que el cliente vendió no hace falta eliminarlo: se
usa **Cambiar dueño → Ya no es de un cliente nuestro**, y queda el historial.

## Recambios {#recambios}

El **recambio** es cuando un cliente cumple los años de la compra de su auto y
puede querer cambiarlo. Se calcula con la **fecha de compra** del vehículo más
los meses de la regla [Se acerca el recambio](/ayuda/automatizaciones#evento-recambio)
(48 si no hay regla). Esa regla le crea la tarea al vendedor unos días antes.

En **Taller → Recambios** están los **recambios vencidos sin contactar**: los
que ya pasaron sin aviso. Sobre todo, las ventas viejas que se cargaron al
activar el módulo. Arriba se puede elegir una **Sucursal** (o todas).

- Muestra el cliente, el vehículo, la fecha de compra, la del recambio, el
  vendedor y hace cuántos días venció, del más viejo al más nuevo, de a 50.
- No aparecen los clientes con una oportunidad abierta, los marcados **sin
  interés**, ni los que tuvieron una oportunidad nueva después de la fecha de
  aviso (ya hubo una conversación de venta).
- **Crear tarea al vendedor**: una tarea "Contactar a {cliente}: se acerca el
  recambio de su {vehículo}", para el vendedor del cliente (o el de la venta, el
  responsable de la sucursal o el administrador más antiguo).
- **Marcar como contactado**: si ya se habló con el cliente por otro lado.

Las dos acciones sirven para una fila o para varias marcadas con la casilla.
El vehículo sale de la lista apenas tocás la acción, y la regla no le vuelve a
avisar por ese recambio. Si alguno no se pudo registrar, vuelve a la lista con
el motivo arriba.

## En la ficha del contacto {#en-la-ficha-del-contacto}

La ficha de cada contacto tiene una tarjeta **Vehículos** con los autos que son
suyos, su próximo service y su orden abierta, si tiene. Desde ahí se abre cada
vehículo o se agrega uno nuevo con ese contacto como dueño.

Al **unir dos contactos**, los vehículos del duplicado pasan al que queda. Al
**borrar los datos personales** de un contacto, sus vehículos quedan, pero sin
matrícula, chasis ni notas.
