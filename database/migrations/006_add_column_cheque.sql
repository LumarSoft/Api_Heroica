-- Migración 006: Ampliación de campos de cheque en movimientos
ALTER TABLE `movimientos`
  ADD COLUMN `numero_cheque` varchar(50) DEFAULT NULL;
    