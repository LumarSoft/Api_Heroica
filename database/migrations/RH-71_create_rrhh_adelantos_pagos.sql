-- Circuito de adelantos: solicitud pendiente → aprobación RRHH → pago Tesorería.
-- La fila se crea con movimiento_id NULL al pedir el adelanto.
-- Los registros anteriores sin fila conservan su historial; no se generan pagos retroactivos.
CREATE TABLE rrhh_adelantos_pagos (
  solicitud_id INT NOT NULL PRIMARY KEY,
  movimiento_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_adelantos_movimiento (movimiento_id),
  CONSTRAINT fk_adelantos_solicitud FOREIGN KEY (solicitud_id)
    REFERENCES rrhh_solicitudes(id) ON DELETE CASCADE,
  CONSTRAINT fk_adelantos_movimiento FOREIGN KEY (movimiento_id)
    REFERENCES movimientos(id) ON DELETE RESTRICT
);
