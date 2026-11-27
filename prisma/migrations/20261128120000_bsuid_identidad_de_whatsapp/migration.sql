-- PR0 (docs/mensajes-con-opciones.md §10.1): el BSUID de WhatsApp se guarda
-- como identidad del contacto en contact_channel_identities (canal WHATSAPP).
-- Su forma es el código de país, un punto y hasta 128 alfanuméricos (el padre
-- suma "ENT."): hasta 135 caracteres, más que los 128 de la columna. Solo se
-- agranda: no toca datos ni índices (el UNIQUE sigue igual).
ALTER TABLE "contact_channel_identities" ALTER COLUMN "external_id" TYPE VARCHAR(160);
