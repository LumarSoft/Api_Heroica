-- =====================================================
-- MIGRACIÓN DE DATOS INICIALES
-- Base de datos: heroica3
-- Fecha: 2026-02-13
-- Descripción: Inserción de datos de ejemplo
-- =====================================================

USE heroica3;

-- =====================================================
-- DATOS BASE: Usuarios
-- =====================================================

INSERT INTO usuarios (id, email, password, nombre, rol, activo) 
VALUES 
  (1, 'admin@heroica.com', '$2b$10$1N3jqPq8SlQUZ1FLlou3HuICC765NA8d5UDBnHUZR1SileI9Svqm2', 'Administrador', 'admin', 1),
  (2, 'empleado@heroica.com', '$2b$10$1N3jqPq8SlQUZ1FLlou3HuICC765NA8d5UDBnHUZR1SileI9Svqm2', 'Juan Pérez', 'empleado', 1),
  (3, 'contador@heroica.com', '$2b$10$1N3jqPq8SlQUZ1FLlou3HuICC765NA8d5UDBnHUZR1SileI9Svqm2', 'María García', 'contador', 1)
ON DUPLICATE KEY UPDATE email = email;

-- =====================================================
-- DATOS BASE: Sucursales
-- =====================================================

INSERT INTO sucursales (id, nombre, razon_social, cuit, direccion, activo, email_correspondencia) 
VALUES 
  (1, 'Sucursal Central', 'Heroica S.A.', '20-12345678-9', 'Av. Principal 123, CABA', 1, 'central@heroica.com'),
  (2, 'Sucursal Norte', 'Heroica S.A.', '20-12345678-9', 'Av. Libertador 456, Vicente López', 1, 'norte@heroica.com')
ON DUPLICATE KEY UPDATE nombre = nombre;

-- =====================================================
-- DATOS BASE: Categorías
-- =====================================================

INSERT INTO categorias (nombre, descripcion, activo) 
VALUES 
  ('Ventas', 'Ingresos por ventas de productos y servicios', 1),
  ('Gastos Operativos', 'Gastos relacionados con la operación diaria', 1),
  ('Servicios', 'Pago de servicios (luz, agua, internet, etc.)', 1),
  ('Salarios', 'Pago de salarios y honorarios', 1),
  ('Proveedores', 'Pagos a proveedores', 1)
ON DUPLICATE KEY UPDATE nombre = nombre;

-- =====================================================
-- DATOS BASE: Bancos
-- =====================================================

INSERT INTO bancos (nombre, codigo, activo) 
VALUES 
  ('Banco Nación', '011', 1),
  ('Banco Galicia', '007', 1),
  ('Banco Santander', '072', 1),
  ('Banco BBVA', '017', 1)
ON DUPLICATE KEY UPDATE nombre = nombre;

-- =====================================================
-- MOVIMIENTOS CAJA EFECTIVO
-- =====================================================

INSERT INTO movimientos_caja_efectivo 
  (sucursal_id, user_id, fecha, concepto, monto, descripcion, prioridad, tipo_movimiento, estado) 
VALUES 
  -- Saldo Real (movimientos completados)
  (1, 1, '2026-02-01', 'Venta de contado', 15000.00, 'Venta de productos del día', 'media', 'saldo_real', 'completado'),
  (1, 1, '2026-02-02', 'Cobro de cliente', 12000.00, 'Cobro de factura pendiente', 'media', 'saldo_real', 'completado'),
  (1, 1, '2026-02-03', 'Ingreso por servicios', 8500.00, 'Pago de servicios prestados', 'baja', 'saldo_real', 'completado'),
  (1, 1, '2026-02-04', 'Venta mostrador', 6200.00, 'Venta directa en efectivo', 'media', 'saldo_real', 'completado'),
  (1, 1, '2026-02-05', 'Pago a proveedor', -8000.00, 'Pago a proveedor de bebidas', 'alta', 'saldo_real', 'completado'),
  (1, 1, '2026-02-06', 'Gastos varios', -1500.00, 'Compra de insumos menores', 'baja', 'saldo_real', 'completado'),
  (1, 1, '2026-02-07', 'Cobro adelanto', 5000.00, 'Adelanto de cliente mayorista', 'media', 'saldo_real', 'completado'),
  
  -- Saldo Necesario (gastos programados)
  (1, 1, '2026-02-10', 'Pago de servicios', 5000.00, 'Pago de luz y agua', 'alta', 'saldo_necesario', 'pendiente'),
  (1, 1, '2026-02-12', 'Compra de insumos', 7500.00, 'Compra de insumos de cocina', 'media', 'saldo_necesario', 'pendiente'),
  (1, 1, '2026-02-15', 'Pago de salarios', 25000.00, 'Pago de salarios del personal', 'alta', 'saldo_necesario', 'pendiente'),
  (1, 1, '2026-02-18', 'Mantenimiento', 3500.00, 'Reparación de equipos', 'media', 'saldo_necesario', 'pendiente'),
  (1, 1, '2026-02-20', 'Compra de mercadería', 12000.00, 'Stock para el mes', 'alta', 'saldo_necesario', 'aprobado'),
  (1, 1, '2026-02-22', 'Gastos administrativos', 2800.00, 'Papelería y suministros', 'baja', 'saldo_necesario', 'pendiente'),
  (1, 1, '2026-02-25', 'Pago de impuestos', 8900.00, 'Impuestos municipales', 'alta', 'saldo_necesario', 'pendiente')
ON DUPLICATE KEY UPDATE concepto = concepto;

-- =====================================================
-- MOVIMIENTOS CAJA BANCO
-- =====================================================

INSERT INTO movimientos_caja_banco 
  (sucursal_id, user_id, fecha, concepto, monto, descripcion, prioridad, tipo_movimiento, estado, 
   numero_cheque, banco, cuenta, cbu, tipo_operacion) 
VALUES 
  -- Saldo Real (movimientos bancarios completados)
  (1, 1, '2026-02-01', 'Transferencia recibida', 45000.00, 'Pago de cliente por transferencia', 'alta', 'saldo_real', 'completado',
   NULL, 'Banco Nación', '1234567890', '0110123456789012345678', 'transferencia'),
  
  (1, 1, '2026-02-03', 'Cobro de cheque', 18500.00, 'Cheque de cliente depositado', 'media', 'saldo_real', 'completado',
   'CH-00123456', 'Banco Galicia', '9876543210', '0070987654321098765432', 'cheque'),
  
  (1, 1, '2026-02-05', 'Débito automático', -2300.00, 'Pago de servicios bancarios', 'baja', 'saldo_real', 'completado',
   NULL, 'Banco Nación', '1234567890', '0110123456789012345678', 'debito'),
  
  (1, 1, '2026-02-07', 'Transferencia enviada', -15000.00, 'Pago a proveedor principal', 'alta', 'saldo_real', 'completado',
   NULL, 'Banco Nación', '1234567890', '0110123456789012345678', 'transferencia'),
  
  (1, 1, '2026-02-08', 'Depósito en efectivo', 8000.00, 'Depósito de recaudación', 'media', 'saldo_real', 'completado',
   NULL, 'Banco Nación', '1234567890', '0110123456789012345678', 'otro'),
  
  -- Saldo Necesario (pagos bancarios programados)
  (1, 1, '2026-02-12', 'Pago a proveedor', 22000.00, 'Transferencia programada a proveedor', 'alta', 'saldo_necesario', 'pendiente',
   NULL, 'Banco Nación', '1234567890', '0110123456789012345678', 'transferencia'),
  
  (1, 1, '2026-02-15', 'Emisión de cheque', 35000.00, 'Cheque para pago de alquiler', 'alta', 'saldo_necesario', 'aprobado',
   'CH-00789012', 'Banco Galicia', '9876543210', '0070987654321098765432', 'cheque'),
  
  (1, 1, '2026-02-18', 'Pago de impuestos', 12500.00, 'Transferencia para AFIP', 'alta', 'saldo_necesario', 'pendiente',
   NULL, 'Banco Nación', '1234567890', '0110123456789012345678', 'transferencia'),
  
  (1, 1, '2026-02-20', 'Pago con tarjeta', 4800.00, 'Compra de equipamiento', 'media', 'saldo_necesario', 'pendiente',
   NULL, 'Banco Santander', '5555666677', '0720555566667777888899', 'credito'),
  
  (1, 1, '2026-02-25', 'Transferencia programada', 9200.00, 'Pago de servicios mensuales', 'media', 'saldo_necesario', 'pendiente',
   NULL, 'Banco Nación', '1234567890', '0110123456789012345678', 'transferencia')
ON DUPLICATE KEY UPDATE concepto = concepto;

-- =====================================================
-- PAGOS PENDIENTES
-- =====================================================

INSERT INTO pagos_pendientes 
  (sucursal_id, user_id, fecha, concepto, monto, descripcion, prioridad, tipo_movimiento, estado, 
   motivo_rechazo, usuario_revisor_id) 
VALUES 
  -- Pagos pendientes de aprobación
  (1, 2, '2026-02-10', 'Compra de equipamiento', 18500.00, 'Compra de computadoras para oficina', 'alta', 'saldo_necesario', 'pendiente',
   NULL, NULL),
  
  (1, 2, '2026-02-11', 'Pago a proveedor urgente', 12000.00, 'Proveedor de materias primas', 'alta', 'saldo_necesario', 'pendiente',
   NULL, NULL),
  
  (1, 2, '2026-02-12', 'Gastos de marketing', 5500.00, 'Campaña publicitaria en redes', 'media', 'saldo_necesario', 'aprobado',
   NULL, 1),
  
  (1, 2, '2026-02-13', 'Reparación de vehículo', 8900.00, 'Mantenimiento de camioneta de reparto', 'media', 'saldo_necesario', 'pendiente',
   NULL, NULL),
  
  (1, 2, '2026-02-09', 'Compra no autorizada', 3200.00, 'Compra de insumos sin presupuesto', 'baja', 'saldo_necesario', 'rechazado',
   'No hay presupuesto disponible para este gasto en el mes actual', 1),
  
  (1, 2, '2026-02-14', 'Capacitación del personal', 6700.00, 'Curso de capacitación técnica', 'media', 'saldo_necesario', 'pendiente',
   NULL, NULL),
  
  (1, 2, '2026-02-15', 'Renovación de licencias', 4200.00, 'Licencias de software anual', 'alta', 'saldo_necesario', 'aprobado',
   NULL, 1),
  
  (1, 2, '2026-02-08', 'Gasto excesivo', 15000.00, 'Compra de mobiliario de lujo', 'baja', 'saldo_necesario', 'rechazado',
   'El monto solicitado excede el presupuesto aprobado. Se debe presentar una justificación detallada', 1),
  
  (1, 2, '2026-02-16', 'Pago de honorarios', 9500.00, 'Honorarios de asesor contable', 'media', 'saldo_necesario', 'pendiente',
   NULL, NULL),
  
  (1, 2, '2026-02-17', 'Compra de insumos críticos', 7800.00, 'Insumos para producción urgente', 'alta', 'saldo_necesario', 'aprobado',
   NULL, 1)
ON DUPLICATE KEY UPDATE concepto = concepto;

-- =====================================================
-- Fin de la migración de datos
-- =====================================================
