-- Migración RH-99: Datos de ejemplo para el módulo de Recursos Humanos
-- Fecha: 2026-04-27
-- Descripción: Inserta puestos, escalas salariales, personal e incentivos/premios
--              de ejemplo para las sucursales activas del sistema.

-- ============================================================
-- PUESTOS
-- Sucursal 4 → Heroica Alto Córdoba
-- Sucursal 5 → Heroica Güemes
-- Sucursal 7 → Heroica Florida
-- Sucursal 2 → Heroica Alto Rosario
-- Sucursal 16 → Heroica Nueva Córdoba
-- (id=1 ya existe: 'Marvitoooooo' en sucursal 4)
-- ============================================================

INSERT INTO `puestos` (`id`, `nombre`, `sucursal_id`, `created_at`, `updated_at`) VALUES
-- Heroica Alto Córdoba (4)
(2,  'Encargado/a de Turno',    4, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
(3,  'Mozo/a',                  4, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
(4,  'Cocinero/a',              4, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
(5,  'Cajero/a',                4, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
(6,  'Ayudante de Cocina',      4, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
-- Heroica Güemes (5)
(7,  'Encargado/a de Turno',    5, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
(8,  'Bartender',               5, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
(9,  'Mozo/a',                  5, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
(10, 'Pastelero/a',             5, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
(11, 'Repositor/a',             5, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
-- Heroica Florida (7)
(12, 'Encargado/a de Turno',    7, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
(13, 'Cocinero/a',              7, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
(14, 'Mozo/a',                  7, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
(15, 'Panadero/a',              7, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
-- Heroica Alto Rosario (2)
(16, 'Encargado/a de Turno',    2, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
(17, 'Mozo/a',                  2, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
(18, 'Cocinero/a',              2, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
(19, 'Limpieza',                2, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
-- Heroica Nueva Córdoba (16)
(20, 'Encargado/a de Turno',   16, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
(21, 'Mozo/a',                 16, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
(22, 'Bartender',              16, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
(23, 'Cocinero/a',             16, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
(24, 'Administrativo/a',       16, '2026-04-01 08:00:00', '2026-04-01 08:00:00');

-- ============================================================
-- ESCALAS SALARIALES — mes 4, año 2026
-- (id=1 ya existe para puesto_id=1)
-- ============================================================

INSERT INTO `escalas_salariales` (`id`, `puesto_id`, `sueldo_base`, `mes`, `anio`, `valor_hora`, `created_at`, `updated_at`) VALUES
-- Alto Córdoba (puestos 2-6)
(2,  2,  950000.00,  4, 2026, 19000.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Encargado
(3,  3,  680000.00,  4, 2026, 13600.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Mozo
(4,  4,  780000.00,  4, 2026, 15600.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Cocinero
(5,  5,  620000.00,  4, 2026, 12400.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Cajero
(6,  6,  570000.00,  4, 2026, 11400.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Ayudante cocina
-- Güemes (puestos 7-11)
(7,  7,  960000.00,  4, 2026, 19200.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Encargado
(8,  8,  720000.00,  4, 2026, 14400.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Bartender
(9,  9,  680000.00,  4, 2026, 13600.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Mozo
(10, 10, 820000.00,  4, 2026, 16400.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Pastelero
(11, 11, 580000.00,  4, 2026, 11600.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Repositor
-- Florida (puestos 12-15)
(12, 12, 940000.00,  4, 2026, 18800.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Encargado
(13, 13, 770000.00,  4, 2026, 15400.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Cocinero
(14, 14, 670000.00,  4, 2026, 13400.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Mozo
(15, 15, 800000.00,  4, 2026, 16000.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Panadero
-- Alto Rosario (puestos 16-19)
(16, 16, 930000.00,  4, 2026, 18600.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Encargado
(17, 17, 660000.00,  4, 2026, 13200.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Mozo
(18, 18, 760000.00,  4, 2026, 15200.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Cocinero
(19, 19, 530000.00,  4, 2026, 10600.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Limpieza
-- Nueva Córdoba (puestos 20-24)
(20, 20, 970000.00,  4, 2026, 19400.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Encargado
(21, 21, 690000.00,  4, 2026, 13800.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Mozo
(22, 22, 730000.00,  4, 2026, 14600.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Bartender
(23, 23, 790000.00,  4, 2026, 15800.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),  -- Cocinero
(24, 24, 710000.00,  4, 2026, 14200.00, '2026-04-01 08:00:00', '2026-04-01 08:00:00'); -- Administrativo

-- ============================================================
-- PERSONAL — empleados de ejemplo (legajos HER-001 en adelante)
-- carnet_manipulacion_alimentos: 1 = sí, 0 = no
-- ============================================================

INSERT INTO `personal` (`legajo`, `nombre`, `dni`, `puesto_id`, `sucursal_id`, `fecha_incorporacion`, `carnet_manipulacion_alimentos`, `activo`, `created_at`, `updated_at`) VALUES

-- Heroica Alto Córdoba (sucursal 4)
('HER-001', 'Valentina Ruiz',        '32145678', 2,  4, '2023-03-01', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-002', 'Marcos Giménez',        '35201456', 3,  4, '2024-01-15', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-003', 'Lucía Fernández',       '36589012', 3,  4, '2024-06-01', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-004', 'Santiago Ríos',         '33478901', 4,  4, '2022-08-10', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-005', 'Florencia Torres',      '37890234', 5,  4, '2025-02-01', 0, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-006', 'Nicolás Herrera',       '34012345', 6,  4, '2024-11-15', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-007', 'Camila Sosa',           '38123456', 3,  4, '2025-03-10', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

-- Heroica Güemes (sucursal 5)
('HER-008', 'Rodrigo Medina',        '31234567', 7,  5, '2022-05-20', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-009', 'Agustina Pereyra',      '36012345', 8,  5, '2023-09-01', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-010', 'Tomás Villanueva',      '37456789', 9,  5, '2024-04-15', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-011', 'Marina Delgado',        '35678901', 10, 5, '2023-01-10', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-012', 'Juan Pablo Acosta',     '34567890', 11, 5, '2025-01-05', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-013', 'Sofía Ramírez',         '38901234', 9,  5, '2025-04-01', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-014', 'Ezequiel Navarro',      '33890123', 8,  5, '2023-07-20', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

-- Heroica Florida (sucursal 7)
('HER-015', 'Paola Ibáñez',          '32890123', 12, 7, '2022-11-01', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-016', 'Gabriel Ortiz',         '35345678', 13, 7, '2023-06-15', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-017', 'Romina Castro',         '37234567', 14, 7, '2024-02-20', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-018', 'Diego Morales',         '34234567', 15, 7, '2023-03-05', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-019', 'Natalia Suárez',        '36789012', 14, 7, '2025-01-15', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-020', 'Leandro Molina',        '33901234', 13, 7, '2022-09-01', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

-- Heroica Alto Rosario (sucursal 2)
('HER-021', 'Analía Vega',           '31789012', 16, 2, '2023-02-10', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-022', 'Carlos Domínguez',      '35123456', 17, 2, '2024-05-01', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-023', 'Verónica Blanco',       '37012345', 18, 2, '2024-08-15', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-024', 'Hernán Fuentes',        '32456789', 19, 2, '2025-03-01', 0, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-025', 'Daniela Paz',           '38456789', 17, 2, '2025-04-10', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

-- Heroica Nueva Córdoba (sucursal 16)
('HER-026', 'Sebastián Aguirre',     '33567890', 20, 16,'2024-03-01', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-027', 'Jimena Quiroga',        '36901234', 21, 16,'2024-10-15', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-028', 'Matías Cáceres',        '37678901', 22, 16,'2025-01-20', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-029', 'Luciana Mendoza',       '35890123', 23, 16,'2024-07-01', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-030', 'Facundo Alvarez',       '34789012', 24, 16,'2024-09-10', 0, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),
('HER-031', 'Rocío Paredes',         '38234567', 21, 16,'2025-02-15', 1, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

-- Empleado inactivo (baja lógica) — ejemplo de deleted_at
('HER-032', 'Roberto Guzmán',        '30123456', 3,  4, '2021-06-01', 1, 0, '2026-04-01 08:00:00', '2026-04-01 08:00:00');

-- Marcar deleted_at del empleado inactivo
UPDATE `personal` SET `deleted_at` = '2026-03-31 18:00:00' WHERE `legajo` = 'HER-032';

-- ============================================================
-- INCENTIVOS Y PREMIOS — mes 4, año 2026
-- metodo_calculo: porcentaje_escala | monto_fijo | multiplicador_valor_hora
-- escala_salarial_id se puede dejar NULL para incentivos de monto fijo
-- ============================================================

INSERT INTO `rrhh_incentivos_premios`
  (`sucursal_id`, `escala_salarial_id`, `nombre`, `tipo`, `descripcion`, `mes`, `anio`, `metodo_calculo`, `valor`, `activo`, `created_at`, `updated_at`)
VALUES

-- ---- Alto Córdoba (sucursal 4) ----
(4, 2,  'Premio Presentismo Abril',
    'Premio', 'Bono por asistencia perfecta durante el mes de abril.',
    4, 2026, 'porcentaje_escala', 8.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(4, 3,  'Incentivo Ventas Mozo/a',
    'Incentivo', 'Porcentaje adicional por superar la meta de ventas individuales mensual.',
    4, 2026, 'porcentaje_escala', 5.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(4, 4,  'Incentivo Calidad Cocina',
    'Incentivo', 'Reconocimiento mensual al equipo de cocina por puntaje de calidad >= 90.',
    4, 2026, 'monto_fijo', 50000.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(4, NULL, 'Bono Antigüedad > 2 años',
    'Premio', 'Bono fijo para empleados con más de 2 años de antigüedad en la empresa.',
    4, 2026, 'monto_fijo', 35000.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(4, 6,  'Incentivo Turno Noche',
    'Incentivo', 'Multiplicador de valor hora por trabajar turnos nocturnos (21-06 hs).',
    4, 2026, 'multiplicador_valor_hora', 1.50, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

-- ---- Heroica Güemes (sucursal 5) ----
(5, 7,  'Premio Presentismo Abril',
    'Premio', 'Bono por asistencia perfecta durante el mes de abril.',
    4, 2026, 'porcentaje_escala', 8.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(5, 8,  'Incentivo Cocktail del Mes',
    'Incentivo', 'Premio al bartender por mejor coctelería del mes según encuesta de clientes.',
    4, 2026, 'monto_fijo', 60000.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(5, 10, 'Premio Innovación Pastelería',
    'Premio', 'Reconocimiento al pastelero/a por incorporar nueva receta al menú.',
    4, 2026, 'monto_fijo', 45000.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(5, 9,  'Incentivo Ventas Mozo/a',
    'Incentivo', 'Comisión adicional por ventas de combos premium superando el 20% del ticket promedio.',
    4, 2026, 'porcentaje_escala', 6.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(5, NULL, 'Bono Feriado Trabajado',
    'Premio', 'Monto fijo por cada día feriado efectivamente trabajado.',
    4, 2026, 'monto_fijo', 25000.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(5, 11, 'Incentivo Stock Perfecto',
    'Incentivo', 'Bono para reposición sin diferencias de inventario durante el mes.',
    4, 2026, 'monto_fijo', 20000.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

-- ---- Heroica Florida (sucursal 7) ----
(7, 12, 'Premio Presentismo Abril',
    'Premio', 'Bono por asistencia perfecta durante el mes de abril.',
    4, 2026, 'porcentaje_escala', 8.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(7, 15, 'Incentivo Producción Panadería',
    'Incentivo', 'Bono por superar el volumen de producción diaria acordado sin mermas.',
    4, 2026, 'porcentaje_escala', 7.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(7, 13, 'Premio Cero Desperdicio',
    'Premio', 'Reconocimiento mensual al equipo de cocina por mantener el desperdicio < 3%.',
    4, 2026, 'monto_fijo', 40000.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(7, 14, 'Incentivo Turno Madrugada',
    'Incentivo', 'Recargo horario para turnos de producción entre las 04 y 07 hs.',
    4, 2026, 'multiplicador_valor_hora', 2.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(7, NULL, 'Bono Antigüedad > 3 años',
    'Premio', 'Bono fijo para empleados con más de 3 años continuos en la sucursal.',
    4, 2026, 'monto_fijo', 50000.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

-- ---- Heroica Alto Rosario (sucursal 2) ----
(2, 16, 'Premio Presentismo Abril',
    'Premio', 'Bono por asistencia perfecta durante el mes de abril.',
    4, 2026, 'porcentaje_escala', 8.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(2, 17, 'Incentivo Ventas Mozo/a',
    'Incentivo', 'Comisión adicional por superar el ticket promedio de la sucursal.',
    4, 2026, 'porcentaje_escala', 5.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(2, 18, 'Premio Higiene y Manipulación',
    'Premio', 'Bono mensual por renovación/vigencia del carnet de manipulación de alimentos.',
    4, 2026, 'monto_fijo', 15000.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(2, NULL, 'Incentivo Capacitación',
    'Incentivo', 'Bonificación por completar al menos un módulo de capacitación interna en el mes.',
    4, 2026, 'monto_fijo', 30000.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

-- ---- Heroica Nueva Córdoba (sucursal 16) ----
(16, 20, 'Premio Presentismo Abril',
    'Premio', 'Bono por asistencia perfecta durante el mes de abril.',
    4, 2026, 'porcentaje_escala', 8.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(16, 22, 'Incentivo Cocktail Signature',
    'Incentivo', 'Premio al bartender cuyo cóctel de autor reciba la mejor valoración del mes.',
    4, 2026, 'monto_fijo', 55000.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(16, 21, 'Incentivo Ventas Mozo/a',
    'Incentivo', 'Comisión por cada venta de menú degustación completo cerrada por el mozo/a.',
    4, 2026, 'porcentaje_escala', 6.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(16, 23, 'Premio Plato Estrella del Mes',
    'Premio', 'Reconocimiento al cocinero/a cuyo plato sea el más vendido según el sistema.',
    4, 2026, 'monto_fijo', 45000.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(16, 24, 'Incentivo Gestión Administrativa',
    'Incentivo', 'Bono por cierre sin errores de la gestión contable mensual.',
    4, 2026, 'porcentaje_escala', 4.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00'),

(16, NULL, 'Bono Apertura Nueva Sucursal',
    'Premio', 'Premio único para todo el equipo fundador de Heroica Nueva Córdoba.',
    4, 2026, 'monto_fijo', 100000.00, 1, '2026-04-01 08:00:00', '2026-04-01 08:00:00');
