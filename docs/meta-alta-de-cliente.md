# Alta de un cliente en Messenger e Instagram

Cómo se conecta la página de Facebook (y su Instagram) de una organización
nueva. Desde el 02/10/2026 **lo hace solo el platform admin**, no el ADMIN del
negocio: el diálogo de Meta le muestra a quien conecta los portfolios y
negocios de su cuenta de Facebook, y para un cliente eso es confuso y riesgoso.
El cliente comparte su página con la plataforma y la plataforma la conecta por
él. Es el mismo criterio que el número de WhatsApp, el modelo de IA y la página
del agente.

El diseño de fondo (modelo, OAuth, webhook, envío) está en
`docs/frontend-cambios-pendientes.md`, ítems 169 a 173; el cambio de quién
conecta, en el ítem 182.

## Lo que hace el cliente (una vez)

1. Tener la página de Facebook del negocio en un portfolio comercial de Meta
   (Meta Business Suite), y, si quiere Instagram, la cuenta profesional de
   Instagram **vinculada a esa página**. Sin el vínculo, la conexión queda con
   Messenger solo ("Instagram: sin cuenta vinculada").
2. Desde la configuración de su portfolio, **darle acceso a la página al
   portfolio de la plataforma como socio** (le pasamos el ID del portfolio de
   la plataforma). Con permiso para administrar mensajes y la página; si hay
   Instagram, también sobre la cuenta de Instagram.

El cliente no entra al CRM para esto, ni ve nunca el diálogo de Meta.

## Lo que hace la plataforma

1. **Asignar la página a una persona del portfolio de la plataforma.** En el
   portfolio de la plataforma, la página compartida aparece entre los activos
   de socios: hay que asignársela a la persona de la plataforma que va a
   conectar (la misma cuenta de Facebook con la que va a iniciar sesión en el
   paso siguiente). Si no, el diálogo de Meta no la lista.
2. **Organización.** Si todavía no existe: Plataforma → Nueva organización.
3. **Conectar.** Plataforma → Página de Facebook → elegir la organización en el
   selector → **Conectar con Facebook**. La pestaña va a Meta:
   - entrar con la cuenta de Facebook del paso 1;
   - en el portfolio, elegir el de la plataforma;
   - **en páginas, marcar UNA sola: la del cliente.** Con más de una, la
     conexión se rechaza ("Autorizaste más de una página") y hay que repetir.

   Meta vuelve a la misma pantalla con la organización elegida y la tarjeta
   queda en **Conectada**, con el ID de la página y el del Instagram.
4. **Asignar la página al agente.** En la misma pantalla, debajo: el ID del
   agente y el ID de la página (el que quedó a la vista en la tarjeta).
5. **Canales del agente.** En la ficha del agente, habilitar Messenger y/o
   Instagram.
6. **Probar.** Mandarle un mensaje a la página por Messenger (y por Instagram,
   si corresponde) y ver que el agente contesta y que la conversación aparece
   en la bandeja del cliente.

El ADMIN del cliente ve el estado en Configuración → Organización ("Conectada"
con la página y el Instagram, o "Sin conectar"), sin botones.

## Detalles que conviene saber

- **Una página por organización.** Reconectar con otra página reemplaza la
  anterior; los clientes que le escribieron a la anterior ya no se pueden
  responder (el id de cada cliente es por página).
- **Una página, una organización.** Si la página ya está conectada a otra
  organización, la conexión se rechaza hasta que la otra la desconecte.
- **Quién termina la conexión.** El intento de conexión queda atado al platform
  admin que tocó "Conectar" y a la organización elegida, vence a los 10 minutos
  y sirve una sola vez. Si sale "la empezó otro usuario" o "ya se usó", basta
  con volver a tocar "Conectar con Facebook".
- **Desconectar** (Plataforma → Página de Facebook → Desconectar) da de baja la
  suscripción de la página y borra el token: los agentes de esa organización
  dejan de contestar por Messenger e Instagram. La página queda libre para
  volver a conectarla.
- **Si la tarjeta del cliente dice que la conexión dejó de funcionar**, Meta
  rechazó el token (por ejemplo, el cliente le quitó el acceso al portfolio de
  la plataforma, o la persona que conectó perdió el acceso a la página). Se
  resuelve revisando el acceso y volviendo a conectar desde la pantalla de
  plataforma.
