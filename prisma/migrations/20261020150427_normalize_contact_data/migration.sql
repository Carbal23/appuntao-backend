-- Normaliza los correos y teléfonos ya guardados al mismo formato que ahora
-- aplica el backend al recibirlos: correo en minúsculas y sin espacios;
-- teléfono con solo dígitos y sin el indicativo 57 (10 dígitos).
-- Si al normalizar dos usuarios quedaran con el mismo correo o teléfono, la
-- migración falla sin cambiar nada (son columnas únicas): hay que resolver
-- esos duplicados a mano antes de aplicarla.

UPDATE "User" SET "email" = lower(trim("email"))
WHERE "email" IS NOT NULL AND "email" <> lower(trim("email"));

UPDATE "Invitation" SET "email" = lower(trim("email"))
WHERE "email" IS NOT NULL AND "email" <> lower(trim("email"));

UPDATE "User" SET "phone" = CASE
    WHEN regexp_replace("phone", '\D', '', 'g') ~ '^57\d{10}$'
      THEN substr(regexp_replace("phone", '\D', '', 'g'), 3)
    ELSE regexp_replace("phone", '\D', '', 'g')
  END
WHERE "phone" IS NOT NULL AND ("phone" ~ '\D' OR "phone" ~ '^57\d{10}$');

UPDATE "Debtor" SET "phone" = CASE
    WHEN regexp_replace("phone", '\D', '', 'g') ~ '^57\d{10}$'
      THEN substr(regexp_replace("phone", '\D', '', 'g'), 3)
    ELSE regexp_replace("phone", '\D', '', 'g')
  END
WHERE "phone" IS NOT NULL AND ("phone" ~ '\D' OR "phone" ~ '^57\d{10}$');

UPDATE "Invitation" SET "phone" = CASE
    WHEN regexp_replace("phone", '\D', '', 'g') ~ '^57\d{10}$'
      THEN substr(regexp_replace("phone", '\D', '', 'g'), 3)
    ELSE regexp_replace("phone", '\D', '', 'g')
  END
WHERE "phone" IS NOT NULL AND ("phone" ~ '\D' OR "phone" ~ '^57\d{10}$');
