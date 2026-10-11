# Campos de paciente

La ficha de un paciente trae los datos de siempre: nombre, apellido, email,
teléfono. Los **campos de paciente** son los datos administrativos que
necesita tu clínica y que la ficha no tiene: la obra social o prepaga, el
número de socio, cómo nos conoció, el horario en que prefiere que lo llamen.

> **No cargues datos de salud en estos campos.** Nada de diagnósticos,
> síntomas, tratamientos, medicación, alergias ni motivos de consulta. Estos
> campos los lee el agente de IA y los ve todo el equipo: son para datos
> administrativos, no para la historia clínica. El sistema no puede impedir
> que alguien los cargue, así que depende de cómo armes los campos.

- **Solo un administrador** define los campos (cuáles hay, de qué tipo, con
  qué opciones), desde **Campos de paciente**, en **Administración**.
- En la ficha de cada paciente aparecen en la tarjeta **Campos
  personalizados**, y los completan un administrador o Recepción.
- El **agente de IA** los lee todos cuando atiende al paciente, y puede
  completar los que estén marcados como editables por él.

## Campos de paciente {#campos}

La pantalla [Campos de paciente](/contact-custom-fields) (arriba dice **Campos
de contacto**) lista los campos definidos por la clínica. Puede haber **hasta
30 campos**; la pantalla dice cuántos hay en uso y, al llegar al tope, el
botón **Nuevo campo** desaparece.

Cada fila muestra:

- **Etiqueta**: el nombre que se ve en la ficha.
- **Clave**: el nombre corto con el que el agente de IA identifica el campo.
  Sale de la etiqueta al crearlo y no cambia después, aunque renombres la
  etiqueta.
- **Tipo**: ver [Tipos de campo](#tipos).
- **Opciones**: las opciones de una lista, separadas por comas; "—" en los
  demás tipos.
- **Agente**: **Puede editar** o **Solo lee**. Ver
  [Editable por el agente](#editable-por-el-agente).

El menú de cada fila ofrece **Editar** y **Eliminar**.

> **Eliminar** un campo lo saca de las fichas, pero **no borra los valores**
> que los pacientes ya tenían cargados: quedan guardados, aunque dejen de
> verse. Pide confirmación.

### Cómo se ven en la ficha {#en-la-ficha}

En la [ficha de cada paciente](/ayuda/contactos-y-consultas#ficha-de-contacto),
debajo de los datos, aparece la tarjeta **Campos personalizados** con un
control por campo, en el orden en que se crearon. Si no hay campos definidos,
la tarjeta no aparece.

- **Texto**: un renglón de hasta 500 caracteres.
- **Número**: un número, con decimales si hace falta.
- **Fecha**: un selector de fecha.
- **Sí / No**: una casilla.
- **Lista de opciones**: un desplegable con las opciones y la opción
  **Sin cargar**.
- **Selección múltiple**: una casilla por opción; se pueden marcar varias.

Para borrar un valor, vaciá el campo (o elegí **Sin cargar**, o desmarcá
todas las casillas) y guardá la ficha. Los campos se guardan junto con el
resto de la ficha, con el botón **Guardar**.

## Nuevo campo {#nuevo-campo}

Solo para administradores.

1. En [Campos de paciente](/contact-custom-fields), tocá **Nuevo campo**.
2. Escribí la **Etiqueta**: el nombre que va a ver el equipo en la ficha,
   hasta 100 caracteres. Por ejemplo "Obra social".
3. Elegí el **Tipo**. Pensalo bien: salvo entre los dos tipos de lista, el
   tipo no se puede cambiar después (ver
   [Cambiar el tipo de un campo](#cambiar-el-tipo)).
4. Si el tipo es **Lista de opciones** o **Selección múltiple**, cargá las
   **Opciones**. Ver [Opciones de una lista](#opciones).
5. Marcá **Editable por el agente de IA** si querés que el agente pueda
   completar este campo con lo que le cuente el paciente. Ver
   [Editable por el agente](#editable-por-el-agente).
6. Tocá **Guardar**.

El campo aparece de inmediato en la ficha de todos los pacientes, vacío.

> Antes de guardar, revisá la etiqueta: si un campo invita a escribir algo de
> salud ("Motivo de consulta", "Antecedentes", "Observaciones médicas"), no lo
> crees. Las indicaciones para antes o después de una prestación no van acá.

> La clave del campo (la que usa el agente) sale de la etiqueta y **no
> cambia después**, aunque renombres la etiqueta. Si te equivocaste de
> etiqueta, podés corregirla con **Editar**; la clave sigue siendo la
> original, y eso no afecta nada en la ficha.

### Editar un campo {#editar-campo}

Desde **Editar** se puede cambiar la etiqueta, las opciones de una lista y
si es editable por el agente. El tipo, solo entre los dos tipos de lista.

## Tipos de campo {#tipos}

| Tipo | Para qué sirve | Ejemplo |
|---|---|---|
| **Texto** | Un dato corto en texto libre | Número de socio: "123456/01" |
| **Número** | Una cantidad | Cantidad de sesiones del paquete: 6 |
| **Fecha** | Un día del calendario | Vencimiento del carnet: 15/03/2027 |
| **Sí / No** | Algo que es cierto o no | Acepta recibir novedades: Sí |
| **Lista de opciones** | Elegir **una** entre opciones fijas | Cobertura: Particular / Obra social / Prepaga |
| **Selección múltiple** | Elegir **varias** entre opciones fijas | Horario preferido: Mañana, Tarde, Sábados |

Cuándo conviene una lista en vez de texto libre: cuando después vas a querer
contar o filtrar por ese dato. "Particular", "particular" y "es particular"
escritos a mano son tres cosas distintas; en una lista son una sola opción.

### Cambiar el tipo de un campo {#cambiar-el-tipo}

Los valores que los pacientes ya tienen cargados son del tipo del campo, y
por eso el tipo casi nunca se puede cambiar. Al editar un campo:

- Si es **Texto**, **Número**, **Fecha** o **Sí / No**, el tipo aparece
  bloqueado, con el aviso de que ya hay valores cargados de ese tipo. Para
  cambiarlo, eliminá el campo y creá otro.
- Si es **Lista de opciones** o **Selección múltiple**, se puede pasar de
  uno al otro:
  - **De lista a selección múltiple**: siempre se puede. Cada paciente
    conserva la opción que tenía, ahora como única marcada.
  - **De selección múltiple a lista**: solo si ningún paciente tiene más de
    una opción marcada. Si alguno tiene dos o más, el sistema rechaza el
    cambio: primero hay que dejarle una sola opción a esos pacientes.

## Opciones de una lista {#opciones}

Para los tipos **Lista de opciones** y **Selección múltiple**, el formulario
muestra el bloque **Opciones**: una opción por fila.

### Cargar opciones {#cargar-opciones}

- Escribí una opción en cada fila. **Enter** pasa a la fila siguiente (y la
  crea si no existe); en el celular, la tecla "siguiente" hace lo mismo.
- **Agregar opción** suma una fila vacía al final.
- Si pegás una lista separada por comas o por renglones (por ejemplo,
  "Particular, Obra social, Prepaga"), se reparte sola en varias filas.
- Las filas vacías no se guardan.
- Las flechas **Subir** y **Bajar** cambian el orden, que es el orden en que
  se ven en la ficha. El tacho **Borrar** saca la fila.

Reglas que el sistema controla al guardar:

- al menos una opción;
- hasta **50 opciones**, de hasta 100 caracteres cada una;
- sin repetidas. "Prepaga" y "prepaga" cuentan como la misma opción: no se
  distinguen mayúsculas ni acentos.

Si algo no cumple, el formulario marca las filas a corregir y dice por qué.

### Renombrar una opción {#renombrar-opcion}

Editá el texto de la fila y guardá. Los pacientes que tenían esa opción
elegida pasan al texto nuevo: si "Prepaga" pasa a llamarse "Medicina
prepaga", todos los que tenían "Prepaga" quedan con "Medicina prepaga". Antes
de guardar, una ventana te lo informa con la cantidad de pacientes.

> Partir una opción no es renombrarla. Si en la fila "Mañana, tarde, sábados"
> pegás ese texto para separarlo en tres, el sistema la trata como una opción
> **eliminada** y tres **nuevas**, y te pregunta qué hacer con los pacientes
> que la tenían (ver abajo).

### Eliminar una opción que ya está en uso {#eliminar-opcion}

Al borrar una fila y guardar, si algún paciente tiene esa opción elegida, se
abre la ventana **Opciones que ya usan contactos**. Por cada opción eliminada
dice cuántos pacientes la tienen y te pide decidir **Qué hacer con «la
opción»**:

- **Dejar sin cargar** (lo que viene por defecto): a esos pacientes se les
  quita la opción y el campo les queda vacío.
- **Pasar a: (otra opción)**: a esos pacientes se les reemplaza por la opción
  que elijas, entre las que quedan en la lista.
- **Pasar a todas las nuevas**: solo en **Selección múltiple**, y solo cuando
  en este mismo guardado agregaste dos o más opciones. Es el caso de partir
  "Mañana, tarde, sábados" en tres: los pacientes que tenían la opción vieja
  quedan con las tres nuevas marcadas.
- **Conservar como opción eliminada**: el paciente se queda con el texto
  viejo. En su ficha se ve marcado como "(opción eliminada)" y se puede
  seguir viendo, pero una vez que se cambie por otra opción no se puede
  volver a elegir.

Tocá **Guardar** en la ventana para aplicar todo junto. Si ningún paciente
tenía la opción, no se pregunta nada.

## Editable por el agente {#editable-por-el-agente}

Cada campo tiene la casilla **Editable por el agente de IA**. Define qué
puede hacer el agente con ese campo cuando habla con el paciente:

- **Sin marcar** (**Solo lee** en la lista): el agente ve el valor y lo usa
  para atender mejor (por ejemplo, sabe qué obra social tiene el paciente),
  pero no lo modifica. Lo carga solo el equipo.
- **Marcado** (**Puede editar** en la lista): además, cuando el paciente le
  da ese dato en la conversación, el agente lo guarda en la ficha. Si Ana
  Pérez escribe "tengo prepaga, mi número de socio es 123456/01", el agente
  completa "Número de socio".

El agente respeta el tipo del campo: en una lista solo puede elegir una de
las opciones definidas, en un número solo puede guardar un número. Lo que no
encaja, no se guarda.

Para que el agente pueda escribir, además de marcar el campo hace falta que
ese agente tenga habilitada la acción **Guardar campos personalizados** en
su configuración. Ver [Agentes de IA](/ayuda/agentes-de-ia#acciones).

> Marcá como editables solo los campos administrativos que el paciente puede
> responder en un chat (su cobertura, su número de socio, en qué horario
> prefiere venir). Nunca marques uno que invite a contar algo de salud: lo
> que el paciente escriba ahí queda guardado en su ficha. Lo que decide la
> clínica (una categoría interna, una nota de Recepción) conviene dejarlo en
> **Solo lee**, para que el agente no lo pise con algo que entendió mal.
