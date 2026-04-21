-- Migración 017: Agregar tipo, categoria_id y subcategoria_id a la tabla descripciones
-- Fecha: 2026-04-20
-- Descripción: Las descripciones ahora se asocian a un tipo de movimiento (ingreso/egreso)
--              y pueden tener una categoría y subcategoría por defecto para auto-completar
--              el formulario de nuevo movimiento.

-- ============================================================
-- Paso 1: Agregar columna tipo (ingreso | egreso | NULL para legacy)
-- ============================================================

ALTER TABLE `descripciones`
  ADD COLUMN `tipo` ENUM('ingreso', 'egreso') NULL DEFAULT NULL
    COMMENT 'Tipo de movimiento al que aplica esta descripción'
  AFTER `nombre`;

-- ============================================================
-- Paso 2: Agregar columna categoria_id (FK opcional)
-- ============================================================

ALTER TABLE `descripciones`
  ADD COLUMN `categoria_id` INT NULL DEFAULT NULL
    COMMENT 'Categoría sugerida al seleccionar esta descripción'
  AFTER `tipo`;

ALTER TABLE `descripciones`
  ADD CONSTRAINT `fk_descripciones_categoria`
  FOREIGN KEY (`categoria_id`) REFERENCES `categorias` (`id`) ON DELETE SET NULL;

-- ============================================================
-- Paso 3: Agregar columna subcategoria_id (FK opcional)
-- ============================================================

ALTER TABLE `descripciones`
  ADD COLUMN `subcategoria_id` INT NULL DEFAULT NULL
    COMMENT 'Subcategoría sugerida al seleccionar esta descripción'
  AFTER `categoria_id`;

ALTER TABLE `descripciones`
  ADD CONSTRAINT `fk_descripciones_subcategoria`
  FOREIGN KEY (`subcategoria_id`) REFERENCES `subcategorias` (`id`) ON DELETE SET NULL;
