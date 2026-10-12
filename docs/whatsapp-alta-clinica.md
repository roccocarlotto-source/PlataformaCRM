# Alta del WhatsApp de una clínica

Cada clínica manda sus mensajes de WhatsApp (recordatorios de turno, QR de
reseña, control, seguimientos) **desde su propio número**, que vive en **su
propia cuenta de WhatsApp Business (WABA)**. La clínica **no nos da
contraseñas ni tokens**: nos agrega como **socio** de su cuenta, y la
plataforma la opera con su propia conexión.

Este documento tiene tres partes: lo que hace la clínica, lo que nos pasa y lo
que hace la plataforma. Los números de ejemplo son ficticios.

> Decisión de Rocco del 2026-10-12. Sin la cuenta propia conectada, una
> clínica **no puede activar** reglas que mandan WhatsApp: el sistema responde
> "Conectá el número de WhatsApp de la clínica". Las automotoras siguen con la
> cuenta de la plataforma, como hasta ahora.

---

## 1. Lo que hace la clínica

Todo se hace en **Meta Business** (business.facebook.com), con una persona que
sea administradora del negocio de la clínica.

### Paso 1: tener una cuenta de WhatsApp Business con sus números

1. En **Configuración del negocio → Cuentas → Cuentas de WhatsApp**, crear la
   cuenta de WhatsApp Business de la clínica (si no la tiene).
2. Agregar **el número de cada sede** a esa cuenta.
   - Tiene que ser un número que **no esté en uso en la app de WhatsApp** (ni
     la común ni WhatsApp Business del celular). Si hoy se usa en la app, hay
     que darlo de baja ahí o migrarlo antes.
   - Meta manda un código por SMS o llamada para verificar el número.
3. Cargar el **nombre visible** de cada número (el que ve el paciente, por
   ejemplo "Clínica Ejemplo"). Meta lo tiene que **aprobar**.

### Paso 2: cargar un medio de pago

En **WhatsApp Manager → Configuración de la cuenta → Pagos**, agregar una
tarjeta. Meta le cobra a la clínica los mensajes que manda (por ejemplo, los
recordatorios).

### Paso 3: agregarnos como socio de la cuenta

1. En **Configuración del negocio → Cuentas → Cuentas de WhatsApp**, elegir la
   cuenta de la clínica.
2. Ir a la pestaña **Socios** y tocar **Asignar socio**.
3. Pegar el **ID de negocio de la plataforma**: `<ID DEL NEGOCIO DE LA
   PLATAFORMA>` (te lo pasamos nosotros).
4. Dar **control total** de la cuenta y confirmar.

Si la opción **Asignar socio** no aparece, avisanos: Meta a veces la muestra
distinto, y lo resolvemos juntos.

### Paso 4 (recomendado): verificar el negocio

En **Configuración del negocio → Centro de seguridad → Verificación del
negocio**, verificar la clínica con sus datos legales. No es obligatorio para
empezar, pero **sin verificar, Meta limita cuántos mensajes se pueden mandar
por día**.

---

## 2. Lo que la clínica nos pasa

Solo estos datos. **Nunca** contraseñas, códigos ni tokens.

| Dato | Dónde lo encuentra | Ejemplo (ficticio) |
|---|---|---|
| **ID de la cuenta de WhatsApp (WABA ID)** | WhatsApp Manager → Configuración de la cuenta | `111111111111111` |
| **ID del número de cada sede (Phone Number ID)**, y a qué sede corresponde | WhatsApp Manager → Números de teléfono → el número → su ID | `222222222222222` → Sede Centro |
| **ID del negocio de la clínica** (para confirmar que el socio es el correcto) | Configuración del negocio → Información del negocio | `333333333333333` |

---

## 3. Lo que hace la plataforma

1. **Aceptar la cuenta compartida.** En el Meta Business de la plataforma,
   aceptar la cuenta de WhatsApp que compartió la clínica y **asignársela al
   System User de la plataforma** con control total.
2. **Permisos de la app (una sola vez).** En el panel de la app de Meta
   (App Review → Permissions), `whatsapp_business_management` y
   `whatsapp_business_messaging` tienen que tener **Advanced Access**. Sin eso
   no se puede operar la cuenta de otro negocio. Si falta, se pide y Meta lo
   revisa.
3. **Conectar la cuenta en el CRM.** En **Plataforma → WhatsApp de una
   clínica**, elegir la clínica, pegar el **WABA ID** y tocar **Conectar**.
   - El sistema suscribe la app a la cuenta de la clínica (para que lleguen
     sus mensajes y las aprobaciones de sus plantillas) y manda de nuevo a
     aprobación las plantillas de sus reglas, ahora en la cuenta de la
     clínica.
   - Si Meta no deja (la clínica todavía no nos agregó como socio, o la cuenta
     no está asignada al System User), no se guarda nada y la pantalla dice
     por qué.
4. **Asignar el número de cada sede.** En **Plataforma → Número de WhatsApp**,
   elegir la clínica y el agente de cada sede y pegar su **Phone Number ID**.
   El sistema verifica que el número sea de la cuenta conectada; si no, no lo
   asigna.
5. **Activar las reglas.** Cuando WhatsApp aprueba los mensajes, la clínica ya
   puede activar sus reglas (recordatorio, QR de reseña, control).

Para desconectar la cuenta, primero hay que desactivar las reglas de la
clínica que mandan WhatsApp.
