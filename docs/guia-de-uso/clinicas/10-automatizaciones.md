# Automatizaciones

## Retomar la consulta {#retomar-la-consulta}

La regla **Consulta sin avance → Retomar la consulta** le escribe a un paciente
que consultó y lleva unos días sin responder. En una clínica funciona igual que
en cualquier organización, con tres diferencias:

- **No le escribe a quien ya tiene un turno.** Si el paciente tiene un turno
  confirmado para más adelante, o fue **atendido** en los últimos días (los mismos
  días de la regla), no recibe el mensaje. Si sacó un turno después de que se
  programó el mensaje, el mensaje se cancela antes de salir. Un turno marcado
  como **No vino** o uno cancelado no lo frenan.
- **Habla de la prestación, no de un vehículo.** En el texto del mensaje usá
  `{prestacion}`: va la prestación que consultó (por ejemplo, "limpieza facial")
  o, si no se sabe, "lo que consultaste". `{saludo}` sigue siendo obligatorio y
  va primero.
- **Siempre sale el mensaje aprobado por WhatsApp**, aunque el asistente esté en
  el nivel Autónomo y el paciente haya escrito hace menos de 24 horas. El
  asistente nunca redacta este mensaje por su cuenta.

| Variable | Qué va | |
|---|---|---|
| `{saludo}` | El saludo con el nombre del paciente ("Hola Ana"), o "Hola" a secas si no lo dio. | Obligatoria. |
| `{prestacion}` | La prestación que consultó, o "lo que consultaste". | Opcional, a lo sumo una vez, después de `{saludo}`. |

El texto con el que arranca una regla nueva es:

> ¡{saludo}! Te escribimos por tu consulta sobre {prestacion}. ¿Querés que te
> ayudemos a coordinar un turno?

Si el seguimiento le toca a una conversación de Messenger, Instagram o la web, o
a una que ya atiende una persona, en lugar del mensaje se crea una tarea, que
dice qué prestación le interesa.
