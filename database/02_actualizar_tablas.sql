-- =====================================================
-- ACTUALIZACIÓN DE TABLAS EXISTENTES
-- =====================================================

-- ========== ACTUALIZAR SUCURSALES ==========
-- Agregar email y campos para documentación
ALTER TABLE sucursales 
ADD COLUMN IF NOT EXISTS email_correspondencia VARCHAR(255),
ADD COLUMN IF NOT EXISTS documentacion_path VARCHAR(500),
ADD COLUMN IF NOT EXISTS documentacion_nombre VARCHAR(255);

-- ========== ACTUALIZAR MOVIMIENTOS_CAJA_EFECTIVO ==========
-- Agregar categorías y usuario creador
ALTER TABLE movimientos_caja_efectivo
ADD COLUMN IF NOT EXISTS categoria_id INT,
ADD COLUMN IF NOT EXISTS subcategoria_id INT,
ADD COLUMN IF NOT EXISTS usuario_creador_id INT,
ADD FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE SET NULL,
ADD FOREIGN KEY (subcategoria_id) REFERENCES subcategorias(id) ON DELETE SET NULL,
ADD FOREIGN KEY (usuario_creador_id) REFERENCES usuarios(id) ON DELETE SET NULL;

-- ========== ACTUALIZAR MOVIMIENTOS_CAJA_BANCO ==========
-- Agregar todos los nuevos campos
ALTER TABLE movimientos_caja_banco
ADD COLUMN IF NOT EXISTS categoria_id INT,
ADD COLUMN IF NOT EXISTS subcategoria_id INT,
ADD COLUMN IF NOT EXISTS usuario_creador_id INT,
ADD COLUMN IF NOT EXISTS banco_id INT,
ADD COLUMN IF NOT EXISTS medio_pago_id INT,
ADD FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE SET NULL,
ADD FOREIGN KEY (subcategoria_id) REFERENCES subcategorias(id) ON DELETE SET NULL,
ADD FOREIGN KEY (usuario_creador_id) REFERENCES usuarios(id) ON DELETE SET NULL,
ADD FOREIGN KEY (banco_id) REFERENCES bancos(id) ON DELETE SET NULL,
ADD FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id) ON DELETE SET NULL;

-- Eliminar campos antiguos que ya no se usan
ALTER TABLE movimientos_caja_banco
DROP COLUMN IF EXISTS banco,
DROP COLUMN IF EXISTS tipo_operacion;

-- ========== ACTUALIZAR PAGOS_PENDIENTES ==========
-- Agregar campos de categoría y banco/medio de pago para cuando se apruebe
ALTER TABLE pagos_pendientes
ADD COLUMN IF NOT EXISTS categoria_id INT,
ADD COLUMN IF NOT EXISTS subcategoria_id INT,
ADD COLUMN IF NOT EXISTS banco_id INT,
ADD COLUMN IF NOT EXISTS medio_pago_id INT,
ADD FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE SET NULL,
ADD FOREIGN KEY (subcategoria_id) REFERENCES subcategorias(id) ON DELETE SET NULL,
ADD FOREIGN KEY (banco_id) REFERENCES bancos(id) ON DELETE SET NULL,
ADD FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id) ON DELETE SET NULL;

-- =====================================================
-- VERIFICACIÓN
-- =====================================================
SELECT 'Tablas actualizadas exitosamente!' AS resultado;

-- Verificar estructura de sucursales
DESCRIBE sucursales;

-- Verificar estructura de movimientos_caja_efectivo
DESCRIBE movimientos_caja_efectivo;

-- Verificar estructura de movimientos_caja_banco
DESCRIBE movimientos_caja_banco;

-- Verificar estructura de pagos_pendientes
DESCRIBE pagos_pendientes;
