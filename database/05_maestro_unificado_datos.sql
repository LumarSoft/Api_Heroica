-- =====================================================
-- SCRIPT DE DATOS INICIALES UNIFICADOS - DB HEROICA
-- Datos iniciales y de prueba adaptados para la nueva 
-- tabla unificada 'movimientos'.
-- =====================================================

-- --------------------------------------------------------
-- DATOS DE USUARIOS Y SUCURSALES
-- --------------------------------------------------------
INSERT INTO `usuarios` (`id`, `email`, `password`, `nombre`, `rol`, `activo`) VALUES
(1, 'admin@heroica.com', '$2b$10$1N3jqPq8SlQUZ1FLlou3HuICC765NA8d5UDBnHUZR1SileI9Svqm2', 'Administrador', 'admin', 1),
(2, 'empleado@heroica.com', '$2b$10$1N3jqPq8SlQUZ1FLlou3HuICC765NA8d5UDBnHUZR1SileI9Svqm2', 'Juan Pérez', 'empleado', 1),
(3, 'contador@heroica.com', '$2b$10$1N3jqPq8SlQUZ1FLlou3HuICC765NA8d5UDBnHUZR1SileI9Svqm2', 'María García', 'contador', 1);

INSERT INTO `sucursales` (`id`, `nombre`, `razon_social`, `cuit`, `direccion`, `activo`, `email_correspondencia`) VALUES
(1, 'Sucursal Central', 'Heroica S.A.', '20-12345678-9', 'Av. Principal 123, CABA', 1, 'central@heroica.com');

-- --------------------------------------------------------
-- DATOS DE CATÁLOGOS (Categorías, Bancos, Medios de Pago)
-- --------------------------------------------------------
INSERT INTO categorias (id, nombre, descripcion) VALUES
(1, 'Ventas', 'Ingresos por ventas de productos y servicios'),
(2, 'Gastos Operativos', 'Gastos relacionados con la operación diaria'),
(3, 'Servicios', 'Pago de servicios (luz, agua, internet, etc.)'),
(4, 'Salarios', 'Pago de salarios y honorarios'),
(5, 'Proveedores', 'Pagos a proveedores'),
(6, 'Impuestos', 'Pagos de impuestos y tasas'),
(7, 'Mantenimiento', 'Gastos de mantenimiento'),
(8, 'Otros', 'Otros gastos');

INSERT INTO subcategorias (categoria_id, nombre, descripcion) VALUES
(3, 'Luz', 'Servicio eléctrico'),
(3, 'Agua', 'Servicio de agua'),
(3, 'Gas', 'Servicio de gas'),
(3, 'Internet', 'Servicio de internet'),
(4, 'Sueldos Personal', 'Sueldos del personal'),
(4, 'Cargas Sociales', 'Cargas sociales'),
(5, 'Mercadería', 'Compra de mercadería'),
(5, 'Insumos', 'Compra de insumos'),
(6, 'IVA', 'Impuesto al Valor Agregado'),
(6, 'Ganancias', 'Impuesto a las Ganancias'),
(7, 'Reparaciones', 'Reparaciones varias'),
(7, 'Limpieza', 'Servicios de limpieza');

INSERT INTO bancos (id, nombre, codigo) VALUES
(1, 'Banco Nación', '011'),
(2, 'Banco Provincia', '014'),
(3, 'Banco Galicia', '007'),
(4, 'Banco Santander', '072'),
(5, 'Banco BBVA', '017'),
(6, 'Banco Macro', '285'),
(7, 'Banco ICBC', '015'),
(8, 'Mercado Pago', 'MP'),
(9, 'Brubank', 'BRUN'),
(10, 'Otro', 'OTRO');

INSERT INTO medios_pago (id, nombre, descripcion) VALUES
(1, 'Transferencia', 'Transferencia bancaria'),
(2, 'Cheque', 'Pago con cheque'),
(3, 'Débito Automático', 'Débito automático de cuenta'),
(4, 'Tarjeta de Crédito', 'Pago con tarjeta de crédito'),
(5, 'Tarjeta de Débito', 'Pago con tarjeta de débito'),
(6, 'Efectivo', 'Pago en efectivo'),
(7, 'Otro', 'Otro medio de pago');

-- --------------------------------------------------------
-- DATOS DE MOVIMIENTOS UNIFICADOS
-- --------------------------------------------------------

-- Movimientos de Banco (Caja Banco Original)
-- Saldo Real (completados) y Saldo Necesario (pendientes/aprobados)
INSERT INTO `movimientos` (`sucursal_id`, `user_id`, `fecha`, `concepto`, `monto`, `descripcion`, `prioridad`, `tipo_movimiento`, `saldo`, `estado`, `numero_cheque`, `banco`, `cuenta`, `cbu`, `tipo_operacion`) VALUES
(1, 1, '2026-02-01', 'Transferencia recibida', 45000.00, 'Pago de cliente', 'alta', 'banco', 'saldo_real', 'completado', NULL, 'Banco Nación', '1234567890', '0110123456789012345678', 'transferencia'),
(1, 1, '2026-02-03', 'Cobro de cheque', 18500.00, 'Cheque depositado', 'media', 'banco', 'saldo_real', 'completado', 'CH-00123456', 'Banco Galicia', '9876543210', '0070987654321098765432', 'cheque'),
(1, 1, '2026-02-05', 'Débito automático', -2300.00, 'Pago de servicios bancarios', 'baja', 'banco', 'saldo_real', 'completado', NULL, 'Banco Nación', '1234567890', '0110123456789012345678', 'debito'),
(1, 1, '2026-02-07', 'Transferencia enviada', -15000.00, 'Pago a proveedor', 'alta', 'banco', 'saldo_real', 'completado', NULL, 'Banco Nación', '1234567890', '0110123456789012345678', 'transferencia'),
(1, 1, '2026-02-12', 'Pago a proveedor', 22000.00, 'Transferencia programada a proveedor', 'alta', 'banco', 'saldo_necesario', 'pendiente', NULL, 'Banco Nación', '1234567890', '0110123456789012345678', 'transferencia'),
(1, 1, '2026-02-15', 'Emisión de cheque', 35000.00, 'Cheque para alquiler', 'alta', 'banco', 'saldo_necesario', 'aprobado', 'CH-00789012', 'Banco Galicia', '9876543210', '0070987654321098765432', 'cheque');

-- Movimientos de Efectivo (Caja Efectivo Original)
INSERT INTO `movimientos` (`sucursal_id`, `user_id`, `fecha`, `concepto`, `monto`, `descripcion`, `prioridad`, `tipo_movimiento`, `saldo`, `estado`) VALUES
(1, 1, '2026-02-01', 'Venta de contado', 15000.00, 'Venta de productos del día', 'media', 'efectivo', 'saldo_real', 'completado'),
(1, 1, '2026-02-04', 'Venta mostrador', 6200.00, 'Venta directa en efectivo', 'media', 'efectivo', 'saldo_real', 'pendiente'),
(1, 1, '2026-02-05', 'Pago a proveedor', -8000.00, 'Pago a proveedor bebidas', 'alta', 'efectivo', 'saldo_real', 'pendiente'),
(1, 1, '2026-02-10', 'Pago de servicios', 5000.00, 'Pago de luz y agua', 'alta', 'efectivo', 'saldo_necesario', 'pendiente'),
(1, 1, '2026-02-12', 'Compra de insumos', 7500.00, 'Compra insumos de cocina', 'media', 'efectivo', 'saldo_necesario', 'pendiente'),
(1, 1, '2026-02-15', 'Pago de salarios', 25000.00, 'Salarios del personal', 'alta', 'efectivo', 'saldo_necesario', 'pendiente');

-- Pagos Pendientes Originales
-- El tipo de caja se migra a tipo_movimiento = 'pendiente' y estado 'pendiente' o 'aprobado'. 
-- El usuario que autoriza está en usuario_revisor_id.
INSERT INTO `movimientos` (`sucursal_id`, `user_id`, `fecha`, `concepto`, `monto`, `descripcion`, `prioridad`, `tipo_movimiento`, `saldo`, `estado`, `proveedor`, `usuario_revisor_id`, `motivo_rechazo`) VALUES
(1, 2, '2026-02-10', 'Compra de equipamiento', 18500.00, 'Computadoras para oficina', 'alta', 'pendiente', NULL, 'pendiente', 'Casa de Computación', NULL, NULL),
(1, 2, '2026-02-11', 'Pago a proveedor urgente', 12000.00, 'Proveedor de materias primas', 'alta', 'pendiente', NULL, 'pendiente', 'Insumos Industriales', NULL, NULL),
(1, 2, '2026-02-12', 'Gastos de marketing', 5500.00, 'Campaña publicitaria en redes', 'media', 'pendiente', NULL, 'aprobado', 'Agencia Social Media', 1, NULL),
(1, 2, '2026-02-13', 'Reparación de vehículo', 8900.00, 'Mantenimiento de camioneta', 'media', 'pendiente', NULL, 'pendiente', 'Taller Automotor', NULL, NULL),
(1, 2, '2026-02-09', 'Compra no autorizada', 3200.00, 'Insumos sin presupuesto', 'baja', 'pendiente', NULL, 'rechazado', 'Papelería Comercial', 1, 'No hay presupuesto disponible');
