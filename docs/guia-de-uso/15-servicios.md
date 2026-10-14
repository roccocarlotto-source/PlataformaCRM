# Taller

El **Taller** es el módulo de postventa: registra los autos de los clientes que
pasan por el service, para que el taller sepa qué auto es de quién, cuándo le
toca el próximo service y qué se le hizo cada vez.

Solo aparece si la organización tiene el módulo **Servicios** activado. Lo
activa el equipo de la plataforma; si no lo ves en el menú, tu organización no
lo tiene.

Está en el menú **Taller**.

- Todos los usuarios ven, cargan y editan los vehículos de clientes, y pueden
  cambiar su dueño.
- Eliminar un vehículo: solo un administrador.

## Vehículos de clientes {#vehiculos-de-clientes}

Un **vehículo de cliente** es el auto que un cliente trae al taller. No es una
unidad del [Stock](/ayuda/stock): el stock es lo que la concesionaria tiene a la
venta; un vehículo de cliente ya es de alguien.

El listado está en **Taller → Vehículos de clientes**. Muestra la matrícula, la
marca y el modelo, el dueño, el próximo service y si tiene una orden abierta.

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

## La ficha del vehículo {#ficha-del-vehiculo}

Al abrir un vehículo se ve:

- sus datos y su **dueño**, con link a la ficha del contacto;
- la **sucursal de referencia**: de dónde salen los avisos al cliente;
- el **próximo service** y si está marcado **No recordar**;
- la **fecha de compra**, si se sabe, y de dónde salió el vehículo;
- los **cambios de dueño**;
- el **historial de órdenes**, de la más nueva a la más vieja.

Con **Editar** se cambian los datos. El dueño no se edita: se cambia con
**Cambiar dueño**.

### Próximo service y "No recordar" {#proximo-service}

El **próximo service** es la fecha en que al cliente le toca volver. Se puede
cargar o corregir a mano desde **Editar**.

**No recordar** es para el cliente que pidió no recibir recordatorios del
service: el vehículo queda, pero no se le avisa.

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

### Eliminar un vehículo {#eliminar-vehiculo}

Solo un administrador, desde la ficha. No se puede eliminar un vehículo con una
orden abierta. Para un auto que el cliente vendió no hace falta eliminarlo: se
usa **Cambiar dueño → Ya no es de un cliente nuestro**, y queda el historial.

## En la ficha del contacto {#en-la-ficha-del-contacto}

La ficha de cada contacto tiene una tarjeta **Vehículos** con los autos que son
suyos, su próximo service y su orden abierta, si tiene. Desde ahí se abre cada
vehículo o se agrega uno nuevo con ese contacto como dueño.

Al **unir dos contactos**, los vehículos del duplicado pasan al que queda. Al
**borrar los datos personales** de un contacto, sus vehículos quedan, pero sin
matrícula, chasis ni notas.
