# 📋 Instrucciones para crear la tabla de usuarios

## Opción 1: Usando MySQL Workbench o phpMyAdmin

1. Abre MySQL Workbench o phpMyAdmin
2. Conéctate a tu servidor MySQL con las credenciales:
   - Host: `200.58.106.236`
   - Puerto: `3306`
   - Usuario: `Lumar`
   - Contraseña: `lumar123`
   - Base de datos: `heroica`

3. Abre el archivo `crear_tabla_usuarios.sql`
4. Ejecuta el script completo

## Opción 2: Usando línea de comandos

```bash
mysql -h 200.58.106.236 -P 3306 -u Lumar -plumar123 heroica < database/crear_tabla_usuarios.sql
```

## 📊 Estructura de la tabla

La tabla `usuarios` contiene los siguientes campos:

- **id**: INT AUTO_INCREMENT PRIMARY KEY
- **email**: VARCHAR(255) UNIQUE NOT NULL
- **password**: VARCHAR(255) NOT NULL (hasheado con bcrypt)
- **nombre**: VARCHAR(255) NOT NULL
- **rol**: ENUM('admin', 'empleado', 'contador') DEFAULT 'empleado'
- **activo**: BOOLEAN DEFAULT TRUE
- **created_at**: TIMESTAMP DEFAULT CURRENT_TIMESTAMP
- **updated_at**: TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP

## 👤 Usuario de prueba

Después de ejecutar el script, tendrás un usuario administrador:

- **Email**: admin@heroica.com
- **Password**: admin123
- **Rol**: admin

## ✅ Verificar que funcionó

Ejecuta esta query para verificar:

```sql
SELECT id, email, nombre, rol, activo FROM usuarios;
```

Deberías ver el usuario administrador creado.

## 🔐 Generar hash para nuevos usuarios

Si necesitas crear más usuarios, genera el hash de la contraseña con:

```bash
pnpm run hash <contraseña>
```

Ejemplo:
```bash
pnpm run hash micontraseña123
```

Luego usa el hash generado en tu INSERT:

```sql
INSERT INTO usuarios (email, password, nombre, rol) 
VALUES ('nuevo@heroica.com', '$2a$10$...hash...', 'Nombre Usuario', 'empleado');
```
