import { query } from '../database'

/**
 * Crea las tablas de HeroicAI si no existen (idempotente).
 * Se llama al arrancar la API, igual que syncPermisos/syncModulos, para que
 * la persistencia del historial funcione sin correr migraciones a mano.
 */
export async function ensureHeroicaiTables(): Promise<void> {
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS heroicai_conversaciones (
         id         INT AUTO_INCREMENT PRIMARY KEY,
         usuario_id INT NOT NULL,
         titulo     VARCHAR(255) NOT NULL DEFAULT 'Nueva consulta',
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         deleted_at TIMESTAMP NULL DEFAULT NULL,
         INDEX idx_heroicai_conv_usuario (usuario_id, deleted_at),
         CONSTRAINT heroicai_conv_usuario_fk FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    await query(
      `CREATE TABLE IF NOT EXISTS heroicai_mensajes (
         id              INT AUTO_INCREMENT PRIMARY KEY,
         conversacion_id INT NOT NULL,
         rol             ENUM('user', 'assistant') NOT NULL,
         contenido       TEXT NOT NULL,
         created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         INDEX idx_heroicai_msg_conv (conversacion_id),
         CONSTRAINT heroicai_msg_conv_fk FOREIGN KEY (conversacion_id) REFERENCES heroicai_conversaciones (id) ON DELETE CASCADE
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    )

    console.log('  ✅ HeroicAI: tablas de historial verificadas.')
  } catch (error) {
    console.error('  ❌ Error al verificar tablas de HeroicAI:', error)
    // No bloqueamos el arranque; el chat puede funcionar sin historial persistido.
  }
}
