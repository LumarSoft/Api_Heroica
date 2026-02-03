-- =====================================================
-- Script SQL para crear tabla de usuarios
-- Base de datos: heroica
-- =====================================================

USE heroica;

-- Crear tabla de usuarios
CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    rol ENUM('admin', 'empleado', 'contador') DEFAULT 'empleado',
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_rol (rol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insertar usuario administrador de prueba
-- Email: admin@heroica.com
-- Password: admin123 (hasheado con bcrypt)
INSERT INTO usuarios (email, password, nombre, rol) 
VALUES (
    'admin@heroica.com',
    '$2b$10$k2TtGC6VUDx0EBMTn3qnbOhhK5N6R0P/7L3p/AoiTEKed2Lg8DRCu',
    'Administrador',
    'admin'
) ON DUPLICATE KEY UPDATE email = email;

-- =====================================================
-- Fin del script
-- =====================================================
