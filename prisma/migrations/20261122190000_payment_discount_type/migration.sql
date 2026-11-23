-- ADJUSTMENT pasa a llamarse DISCOUNT y solo baja el saldo, con el monto
-- guardado en positivo. Los ajustes viejos que bajaban el saldo se guardaron
-- con monto negativo: se pasan a positivo y el efecto en el saldo es el mismo.
-- Un ajuste positivo (que subía el saldo) no tiene equivalente como descuento:
-- si existe, la migración se detiene para revisarlo a mano.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Payment" WHERE type = 'ADJUSTMENT' AND amount > 0) THEN
    RAISE EXCEPTION 'Hay ajustes positivos (subían el saldo): revisarlos antes de migrar';
  END IF;
END $$;

-- AlterEnum
ALTER TYPE "PaymentType" RENAME VALUE 'ADJUSTMENT' TO 'DISCOUNT';

-- Descuentos en positivo
UPDATE "Payment" SET amount = -amount WHERE type = 'DISCOUNT' AND amount < 0;
