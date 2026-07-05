import { query } from '../config/database'
import type { ChatTurn } from './heroicaiService'

export interface ConversacionResumen {
  id: number
  titulo: string
  created_at: string
  updated_at: string
}

interface InsertResult {
  insertId: number
}

const MAX_TITULO = 80

function derivarTitulo(mensaje: string): string {
  const limpio = mensaje.replace(/\s+/g, ' ').trim()
  if (limpio.length <= MAX_TITULO) return limpio || 'Nueva consulta'
  return `${limpio.slice(0, MAX_TITULO).trim()}…`
}

/** Lista las conversaciones (no eliminadas) de un usuario, más recientes primero. */
export async function listarConversaciones(usuarioId: number): Promise<ConversacionResumen[]> {
  return (await query(
    `SELECT id, titulo, created_at, updated_at
     FROM heroicai_conversaciones
     WHERE usuario_id = ? AND deleted_at IS NULL
     ORDER BY updated_at DESC
     LIMIT 100`,
    [usuarioId],
  )) as ConversacionResumen[]
}

/** Verifica que la conversación exista y pertenezca al usuario. */
export async function conversacionPertenece(conversacionId: number, usuarioId: number): Promise<boolean> {
  const rows = (await query(
    `SELECT 1 FROM heroicai_conversaciones WHERE id = ? AND usuario_id = ? AND deleted_at IS NULL LIMIT 1`,
    [conversacionId, usuarioId],
  )) as unknown[]
  return rows.length > 0
}

/** Devuelve los mensajes de una conversación como turnos de chat (orden cronológico). */
export async function obtenerMensajes(conversacionId: number): Promise<ChatTurn[]> {
  const rows = (await query(
    `SELECT rol, contenido
     FROM heroicai_mensajes
     WHERE conversacion_id = ?
     ORDER BY id ASC`,
    [conversacionId],
  )) as Array<{ rol: 'user' | 'assistant'; contenido: string }>
  return rows.map(r => ({ role: r.rol, content: r.contenido }))
}

/** Crea una conversación nueva y devuelve su id. El título se deriva del primer mensaje. */
export async function crearConversacion(usuarioId: number, primerMensaje: string): Promise<number> {
  const result = (await query(`INSERT INTO heroicai_conversaciones (usuario_id, titulo) VALUES (?, ?)`, [
    usuarioId,
    derivarTitulo(primerMensaje),
  ])) as InsertResult
  return result.insertId
}

/** Inserta un mensaje en una conversación. */
export async function agregarMensaje(
  conversacionId: number,
  rol: 'user' | 'assistant',
  contenido: string,
): Promise<void> {
  await query(`INSERT INTO heroicai_mensajes (conversacion_id, rol, contenido) VALUES (?, ?, ?)`, [
    conversacionId,
    rol,
    contenido,
  ])
}

/** Actualiza updated_at (para reordenar la lista). */
export async function tocarConversacion(conversacionId: number): Promise<void> {
  await query(`UPDATE heroicai_conversaciones SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [conversacionId])
}

/** Soft-delete de una conversación del usuario. Devuelve true si borró algo. */
export async function eliminarConversacion(conversacionId: number, usuarioId: number): Promise<boolean> {
  const result = (await query(
    `UPDATE heroicai_conversaciones SET deleted_at = CURRENT_TIMESTAMP
     WHERE id = ? AND usuario_id = ? AND deleted_at IS NULL`,
    [conversacionId, usuarioId],
  )) as { affectedRows: number }
  return result.affectedRows > 0
}
