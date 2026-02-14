# Migraciones de Base de Datos - Heroica

Este directorio contiene las migraciones SQL para la base de datos del sistema Heroica.

## 📋 Orden de Ejecución

Ejecutar las migraciones en el siguiente orden:

### 1. `01_crear_tablas.sql`

Crea la base de datos `heroica3` y todas las tablas necesarias:

- **usuarios**: Usuarios del sistema (admin, empleado, contador)
- **sucursales**: Sucursales de la empresa
- **categorias**: Categorías para clasificar movimientos
- **subcategorias**: Subcategorías relacionadas con categorías
- **bancos**: Catálogo de bancos
- **movimientos_caja_efectivo**: Movimientos de caja en efectivo
- **movimientos_caja_banco**: Movimientos bancarios
- **pagos_pendientes**: Pagos pendientes de aprobación

### 2. `02_insertar_datos.sql`

Inserta datos de ejemplo en todas las tablas para comenzar a trabajar.

## 🚀 Cómo ejecutar

### Opción 1: Desde MySQL CLI

```bash
mysql -u root -p < 01_crear_tablas.sql
mysql -u root -p < 02_insertar_datos.sql
```

### Opción 2: Desde MySQL Workbench o phpMyAdmin

1. Abrir el archivo `01_crear_tablas.sql`
2. Ejecutar todo el contenido
3. Abrir el archivo `02_insertar_datos.sql`
4. Ejecutar todo el contenido

## 📊 Estructura Unificada

Las tres tablas de movimientos (`movimientos_caja_efectivo`, `movimientos_caja_banco`, `pagos_pendientes`) comparten la misma estructura base:

- `sucursal_id`: Referencia a la sucursal
- `user_id`: Usuario que creó el movimiento
- `fecha`: Fecha del movimiento
- `concepto`: Concepto del movimiento
- `monto`: Monto (positivo para ingresos, negativo para egresos)
- `descripcion`: Descripción detallada
- `prioridad`: baja | media | alta
- `tipo_movimiento`: saldo_real | saldo_necesario
- `estado`: pendiente | aprobado | rechazado | completado

### Campos Específicos

**`pagos_pendientes`** incluye además:

- `motivo_rechazo`: Razón del rechazo (si aplica)
- `usuario_revisor_id`: Usuario que revisó el pago

**`movimientos_caja_banco`** incluye además:

- `numero_cheque`, `banco`, `cuenta`, `cbu`, `tipo_operacion`
- `pago_pendiente_id`: Relación con pago pendiente

## 🔐 Usuarios de Ejemplo

- **Admin**: admin@heroica.com
- **Empleado**: empleado@heroica.com
- **Contador**: contador@heroica.com

(Password: hasheado de ejemplo)
