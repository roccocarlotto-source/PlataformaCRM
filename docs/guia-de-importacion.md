# Guía de importación para el alta de un cliente

Cómo pasar los datos que un cliente nuevo trae de su sistema anterior: empresas,
contactos, historial y stock. Es para quien hace el alta. El diseño completo y
sus decisiones están en `docs/importacion-de-datos.md`.

Se hace en **Plataforma → Importar datos**, solo como platform admin. Arriba se
elige la organización del cliente.

---

## 1. Preparar el archivo

- **Formato:** `.xlsx` o `.csv`, hasta 10 MB, 10.000 filas y 200 columnas. Un
  `.xls` o un `.ods` no se pueden leer: hay que guardarlo como `.xlsx` o `.csv`.
  En un `.xlsx` con varias hojas se elige cuál leer.
- **Encabezados en la primera fila.** Los nombres no tienen que coincidir con
  los del CRM, porque el mapeo se arma en el asistente, que además sugiere los
  obvios ("Mail" → Email, "Razón social" → Nombre).
- **Un CSV se lee solo:** el asistente detecta el separador (`,` `;` tab o `|`)
  y la codificación (UTF-8 o la de Excel en Windows), y los muestra para
  corregirlos.
- **Fechas y números:** el formato de fecha (`dd/mm/aaaa`, `mm/dd/aaaa` o
  `aaaa-mm-dd`) y el separador decimal se eligen en el mapeo, con la sugerencia
  que sale del propio archivo.
- **Un identificador por fila**, si el sistema anterior lo tiene: "Id en el
  sistema de origen" para cualquier tipo, o "Código de stock" para las
  unidades. Con eso, volver a subir el archivo actualiza lo que ya se importó en
  vez de duplicarlo. Sin id, se identifica a un contacto por email o teléfono, a
  una empresa por nombre, y a una unidad por patente o VIN.
- **Un archivo de ejemplo de cada tipo**, con datos inventados, está en
  `tests/fixtures/importacion/`.

## 2. El orden

1. **Empresas** y **stock**, en cualquier orden.
2. **Contactos**: así encuentran su empresa y su vehículo de interés (por
   código o patente). Las empresas que no existen se crean, salvo que se elija
   lo contrario.
3. **Historial** (notas, llamadas y tareas): cada fila tiene que encontrar su
   contacto, por el id del origen, el email o el teléfono. Si no lo encuentra,
   falla.

Usar **el mismo sistema de origen** para todos los archivos del mismo cliente:
es lo que permite que un contacto encuentre la empresa que vino del otro
archivo.

## 3. El asistente, paso a paso

1. **Qué se importa, de qué sistema de origen, y el archivo.** El stock también
   puede venir de un **link de Google Sheets**, compartido como "Cualquier
   persona con el enlace puede ver". Contactos, empresas e historial, no: tienen
   datos personales y se suben como archivo.
2. **El mapeo:** a qué campo va cada columna. Una columna sin destino se ignora.
   Los valores que dependen del CRM (etapas, tipos de historial, estados,
   combustible, caja) se asignan valor por valor. También se eligen:
   - qué hacer con lo que ya existe;
   - para el historial, el autor;
   - para el stock, la sucursal, el responsable y la moneda.
3. **La vista previa:** qué se va a crear, actualizar, omitir o fallar, fila por
   fila y campo por campo, sin haber tocado nada todavía.
4. **Confirmar.** La importación corre en segundo plano y se puede cerrar la
   pantalla.

### Qué pasa con lo que ya existe

| Opción | Qué hace |
| --- | --- |
| Completar lo vacío sin pisar | Solo escribe los campos que el CRM tiene vacíos. Lo distinto queda anotado en el informe. Es lo más seguro. |
| Pisar con lo del archivo | El archivo manda. El antes y el después quedan en el informe. |
| Omitir | No toca lo que ya existe; solo crea lo nuevo. |

Se puede cambiar fila por fila en la vista previa. Con cualquier opción, hay
cosas que **nunca** se pisan:

- el email y el teléfono que identifican a un contacto;
- una etapa que retrocedería (de Cliente a Lead, por ejemplo);
- el estado de una unidad que maneja el CRM: reservada, vendida o con una
  oportunidad.

### Stock

- **Precios y monedas:** el precio va a la moneda que dice el archivo (o la
  elegida por defecto). El costo y el precio mínimo en moneda local se pasan a
  dólares con la cotización vigente, que la vista previa muestra. Sin
  cotización cargada, esas filas fallan.
- **Estados del origen:** una unidad reservada en el origen entra como **No
  disponible**: el agente no la ofrece, pero se puede vincular a una
  oportunidad. Las vendidas se omiten, salvo que se marque "Importar también
  las vendidas".
- **Fotos:** van en una columna con uno o varios links (también de Google
  Drive). Se bajan en segundo plano, hasta 20 por unidad, de hasta 5 MB cada
  una. El informe dice cuántas se bajaron y cuáles no, con el motivo.

## 4. Leer el informe

- **Los números:** cuántas filas se crearon, se actualizaron, quedaron igual,
  se omitieron y fallaron.
- **"Descargar filas fallidas":** un CSV con las columnas originales y una
  columna **Motivo** al final. Se corrige ahí mismo y se vuelve a subir con el
  mismo sistema de origen; lo que ya entró no se duplica.
- **"Descargar cambios":** cada campo que se actualizó, con el valor de antes y
  el de después.
- **"Descargar fotos sin bajar"** (stock): cada link que no se pudo bajar, con
  el motivo (no es una imagen, el archivo de Drive no está compartido, pasa el
  tope de fotos).

Los CSV salen con `;` y en UTF-8 con BOM, para que Excel en español los abra
bien.

## 5. Deshacer

Desde el informe, **"Deshacer lo creado"** da de baja lo que esa
importación **creó**. No borra lo que tuvo uso propio después (una oportunidad,
una nota nueva, una foto subida a mano): eso se deja y el informe dice qué se
dejó y por qué. Lo que la importación **actualizó** no vuelve atrás; para eso
está el CSV de cambios.

## 6. Sincronizar el stock con una planilla

Si el stock vino de un link de Google Sheets, al confirmar se puede marcar
**"Mantener sincronizado con la planilla"** cada N horas (6 sugeridas, mínimo
1). Cada corrida se importa sola, sin vista previa, y se ve en **Sincronizaciones**.

- **La planilla manda sobre los campos mapeados:** los actualiza en cada
  corrida. Lo que no está mapeado no se toca.
- **Nunca borra**, y el estado que maneja el CRM no se pisa.
- **Las unidades que desaparecen de la planilla** se informan. Pasan a No
  disponible solo si se marcó esa opción al confirmar.
- **Si falla tres veces seguidas** (la planilla dejó de estar compartida, le
  borraron una columna mapeada), se pausa sola y queda resaltada con el error.
  Se corrige la planilla y se reanuda.
- **Desde la lista** se puede pausar, reanudar o borrar una sincronización.
  Borrarla no toca lo ya importado.
