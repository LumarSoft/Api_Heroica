import { Request, Response } from 'express'
import { streamHeroicaiChat } from '../services/heroicaiService'
import { heroicaiHabilitado } from '../config/heroicai/openai'
import type { HeroicaiUser } from '../utils/heroicaiGuards'
import {
  listarConversaciones,
  conversacionPertenece,
  obtenerMensajes,
  crearConversacion,
  agregarMensaje,
  tocarConversacion,
  eliminarConversacion,
} from '../services/heroicaiConversacionesService'

const MAX_MENSAJE_LEN = 2000
const MAX_CONTEXTO = 12 // últimos N turnos que se envían como contexto al modelo

/**
 * POST /api/heroicai/chat
 * Responde por streaming (SSE). El contexto se reconstruye desde la BD (no se
 * confía en el cliente). Persiste el mensaje del usuario y la respuesta.
 *
 * Eventos SSE:
 *   data: {"conversacion_id": N}   (al inicio)
 *   data: {"tool": "nombre"}       (al iniciar una herramienta — estado en la UI)
 *   data: {"token": "..."}         (por cada fragmento)
 *   data: {"done": true}           (al finalizar)
 *   data: {"error": "..."}         (si algo falla)
 */
export const chatHeroicai = async (req: Request, res: Response): Promise<void> => {
  if (!heroicaiHabilitado()) {
    res.status(503).json({ success: false, message: 'HeroicAI no está configurado en este entorno.' })
    return
  }

  const user = req.user as HeroicaiUser
  const mensaje = typeof req.body?.mensaje === 'string' ? req.body.mensaje.trim() : ''
  if (!mensaje) {
    res.status(400).json({ success: false, message: 'El mensaje es requerido.' })
    return
  }
  if (mensaje.length > MAX_MENSAJE_LEN) {
    res.status(400).json({ success: false, message: `El mensaje supera los ${MAX_MENSAJE_LEN} caracteres.` })
    return
  }

  // Resolver la conversación: usar la provista (si es del usuario) o crear una nueva.
  let conversacionId = Number(req.body?.conversacion_id) || 0
  if (conversacionId) {
    const pertenece = await conversacionPertenece(conversacionId, user.id)
    if (!pertenece) {
      res.status(404).json({ success: false, message: 'Conversación no encontrada.' })
      return
    }
  }

  // Contexto previo desde la BD (antes de insertar el mensaje nuevo).
  const historialCompleto = conversacionId ? await obtenerMensajes(conversacionId) : []
  const historial = historialCompleto.slice(-MAX_CONTEXTO)

  // Crear la conversación recién ahora (si es nueva) y persistir el mensaje del usuario.
  if (!conversacionId) {
    conversacionId = await crearConversacion(user.id, mensaje)
  }
  await agregarMensaje(conversacionId, 'user', mensaje)

  // Cabeceras SSE
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const controller = new AbortController()
  req.on('close', () => controller.abort())

  const send = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  // Avisar al cliente el id de la conversación (para nuevas conversaciones).
  send({ conversacion_id: conversacionId })

  let respuesta = ''
  try {
    await streamHeroicaiChat({
      user,
      historial,
      mensaje,
      signal: controller.signal,
      onToken: token => {
        respuesta += token
        send({ token })
      },
      onTool: nombre => send({ tool: nombre }),
    })

    // Persistir la respuesta del asistente (solo si hubo contenido).
    if (respuesta.trim()) {
      await agregarMensaje(conversacionId, 'assistant', respuesta)
    }
    await tocarConversacion(conversacionId)
    send({ done: true })
  } catch (err: unknown) {
    if (controller.signal.aborted) {
      // Cliente cortó: guardar lo parcial para no perder contexto.
      if (respuesta.trim()) await agregarMensaje(conversacionId, 'assistant', respuesta).catch(() => {})
      res.end()
      return
    }
    const message = err instanceof Error ? err.message : 'Error inesperado en HeroicAI.'
    console.error('[HeroicAI] error:', message)
    send({ error: 'Ocurrió un error al procesar tu consulta. Intentá de nuevo.' })
  } finally {
    res.end()
  }
}

/** GET /api/heroicai/conversaciones — lista las conversaciones del usuario. */
export const getConversaciones = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user as HeroicaiUser
    const conversaciones = await listarConversaciones(user.id)
    res.json({ success: true, data: conversaciones })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al listar conversaciones.'
    console.error('[HeroicAI] listar:', message)
    res.status(500).json({ success: false, message: 'Error al listar conversaciones.' })
  }
}

/** GET /api/heroicai/conversaciones/:id — devuelve los mensajes de una conversación. */
export const getConversacion = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user as HeroicaiUser
    const id = Number(req.params.id)
    if (!id || !(await conversacionPertenece(id, user.id))) {
      res.status(404).json({ success: false, message: 'Conversación no encontrada.' })
      return
    }
    const mensajes = await obtenerMensajes(id)
    res.json({ success: true, data: { id, mensajes } })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al obtener la conversación.'
    console.error('[HeroicAI] obtener:', message)
    res.status(500).json({ success: false, message: 'Error al obtener la conversación.' })
  }
}

/** DELETE /api/heroicai/conversaciones/:id — elimina (soft) una conversación del usuario. */
export const deleteConversacion = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user as HeroicaiUser
    const id = Number(req.params.id)
    const eliminada = id ? await eliminarConversacion(id, user.id) : false
    if (!eliminada) {
      res.status(404).json({ success: false, message: 'Conversación no encontrada.' })
      return
    }
    res.json({ success: true, message: 'Conversación eliminada.' })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al eliminar la conversación.'
    console.error('[HeroicAI] eliminar:', message)
    res.status(500).json({ success: false, message: 'Error al eliminar la conversación.' })
  }
}
