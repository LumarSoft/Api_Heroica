-- =====================================================
-- Script SQL para crear tabla de sucursales
-- Base de datos: heroica
-- =====================================================

USE heroica;

-- Crear tabla de sucursales
CREATE TABLE IF NOT EXISTS sucursales (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    razon_social VARCHAR(255) NOT NULL,
    cuit VARCHAR(13) NOT NULL UNIQUE,
    direccion VARCHAR(500) NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cuit (cuit),
    INDEX idx_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insertar sucursales de ejemplo
INSERT INTO sucursales (nombre, razon_social, cuit, direccion) 
VALUES 
    ('Heroica Centro', 'Heroica Bar S.A.', '20-12345678-9', 'Av. Principal 123, Centro'),
    ('Heroica Norte', 'Heroica Bar S.A.', '20-12345678-0', 'Calle Norte 456, Zona Norte'),
    ('Heroica Sur', 'Heroica Bar S.A.', '20-12345678-1', 'Av. Sur 789, Zona Sur')
ON DUPLICATE KEY UPDATE nombre = nombre;

-- =====================================================
-- Fin del script
-- =====================================================
