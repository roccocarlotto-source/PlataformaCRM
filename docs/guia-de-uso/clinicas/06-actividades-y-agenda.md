# Actividades y agenda

## Profesionales {#profesionales}

Un profesional es una persona que atiende turnos en una sede: tiene su nombre
(el que ve el paciente, por ejemplo "Dra. Lucía Ejemplo"), su sede y su
horario.

En [Profesionales](/clinica/profesionales) ves la lista, en qué sede atiende
cada uno y qué prestaciones hace. Solo un administrador puede verla.

- Para **dar de alta** un profesional, tocá **Nuevo profesional**, elegí la
  sede y el tipo **Persona**.
- Para **cambiarle el nombre o cargar su horario**, tocá **Editar y horario**
  en su fila. Sin horario cargado, ese profesional no ofrece ningún turno.

## Prestaciones y quién las atiende {#prestaciones}

Una prestación (por ejemplo "Limpieza facial") la pueden hacer varios
profesionales. En [Prestaciones](/clinica/prestaciones) ves cada prestación con
quiénes la atienden.

Para elegir quiénes la atienden:

1. En la fila de la prestación, abrí el menú y tocá **Elegir profesionales**.
2. Marcá los profesionales que la hacen. Solo aparecen las personas de la
   misma sede que la prestación.
3. Tocá **Guardar**.

El profesional **principal** (el que se eligió al crear la prestación) queda
siempre marcado: para cambiarlo, editá la prestación en **Configurar
prestaciones**. Crear, cambiar la duración o eliminar una prestación también se
hace ahí.

## Turnos con el profesional que elige el paciente o el primero libre {#primero-libre}

Cuando el asistente de IA ofrece turnos para una prestación, muestra los
horarios libres de **todos** sus profesionales, cada uno con el nombre de quien
atiende. El paciente puede pedir un profesional en particular, o que le den
**el primero libre**.

Con "el primero libre", el sistema asigna a un profesional que tenga ese
horario disponible y, si hay varios, al que tenga **menos turnos ese día**.

> Si dos pacientes piden el mismo horario al mismo tiempo, el sistema no da el
> mismo turno dos veces: el segundo queda con otro profesional libre, o se le
> avisa que ese horario ya no está.
