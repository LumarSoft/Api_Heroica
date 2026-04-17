-- Tabla para almacenar tokens de dispositivos de confianza (2FA "Recordar dispositivo")
-- El token crudo NUNCA se almacena; solo su hash SHA-256.
CREATE TABLE IF NOT EXISTS dispositivos_confianza (
  id            INT          NOT NULL AUTO_INCREMENT,
  usuario_id    INT          NOT NULL,
  token_hash    VARCHAR(64)  NOT NULL,          -- SHA-256 hex del token crudo (256 bits)
  user_agent    VARCHAR(512) DEFAULT NULL,      -- User-Agent del navegador (truncado a 512)
  ip_address    VARCHAR(45)  DEFAULT NULL,      -- IPv4 o IPv6
  expires_at    DATETIME     NOT NULL,          -- NOW() + 30 días al crear
  revocado      TINYINT(1)   NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at  DATETIME     DEFAULT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_token_hash (token_hash),
  INDEX idx_usuario_id (usuario_id),
  INDEX idx_expires_revocado (expires_at, revocado),

  CONSTRAINT fk_dc_usuario
    FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id)
    ON DELETE CASCADE
);
