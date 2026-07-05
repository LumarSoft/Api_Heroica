import type OpenAI from 'openai'
import { openai, HEROICAI_MODEL, HEROICAI_MAX_TOOL_ROUNDS } from '../config/heroicai/openai'
import { HEROICAI_TOOLS, TOOL_EXECUTORS } from '../config/heroicai/tools'
import { construirSystemPrompt } from '../config/heroicai/systemPrompt'
import type { HeroicaiUser } from '../utils/heroicaiGuards'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

interface StreamOptions {
  user: HeroicaiUser
  historial: ChatTurn[]
  mensaje: string
  onToken: (token: string) => void
  /** Se invoca al iniciar la ejecución de cada herramienta (para mostrar estado en la UI). */
  onTool?: (nombre: string) => void
  signal?: AbortSignal
}

// Acumulador para reconstruir tool_calls que llegan fragmentados en el stream.
interface AccTool {
  id: string
  name: string
  args: string
}

/**
 * Ejecuta el loop de chat con function calling y hace streaming del texto final.
 * - El LLM elige herramientas; nosotros las ejecutamos como el usuario (permisos + scoping).
 * - `onToken` se invoca con cada fragmento de texto para reenviarlo por SSE.
 */
export async function streamHeroicaiChat({
  user,
  historial,
  mensaje,
  onToken,
  onTool,
  signal,
}: StreamOptions): Promise<void> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: construirSystemPrompt() },
    ...historial.map(t => ({ role: t.role, content: t.content })),
    { role: 'user', content: mensaje },
  ]

  for (let ronda = 0; ronda < HEROICAI_MAX_TOOL_ROUNDS; ronda++) {
    const stream = await openai.chat.completions.create(
      {
        model: HEROICAI_MODEL,
        messages,
        tools: HEROICAI_TOOLS,
        tool_choice: 'auto',
        stream: true,
        temperature: 0.2,
      },
      { signal },
    )

    let contenido = ''
    const toolsAcc = new Map<number, AccTool>()
    let finishReason: string | null = null

    for await (const chunk of stream) {
      const choice = chunk.choices[0]
      if (!choice) continue
      const delta = choice.delta

      if (delta?.content) {
        contenido += delta.content
        onToken(delta.content)
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index
          const acc = toolsAcc.get(idx) ?? { id: '', name: '', args: '' }
          if (tc.id) acc.id = tc.id
          if (tc.function?.name) acc.name = tc.function.name
          if (tc.function?.arguments) acc.args += tc.function.arguments
          toolsAcc.set(idx, acc)
        }
      }

      if (choice.finish_reason) finishReason = choice.finish_reason
    }

    // Sin tool calls → la respuesta final ya se transmitió: terminamos.
    if (finishReason !== 'tool_calls' || toolsAcc.size === 0) return

    // Registrar el mensaje del asistente con los tool_calls solicitados.
    const toolCalls = [...toolsAcc.values()]
    messages.push({
      role: 'assistant',
      content: contenido || null,
      tool_calls: toolCalls.map(t => ({
        id: t.id,
        type: 'function',
        function: { name: t.name, arguments: t.args || '{}' },
      })),
    })

    // Ejecutar cada herramienta como el usuario y adjuntar el resultado.
    for (const tc of toolCalls) {
      onTool?.(tc.name)
      const resultado = await ejecutarTool(user, tc.name, tc.args)
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(resultado),
      })
    }
  }

  // Se alcanzó el tope de rondas de herramientas.
  onToken('\n\n_(No pude completar la consulta: demasiados pasos. Probá reformular la pregunta.)_')
}

async function ejecutarTool(user: HeroicaiUser, nombre: string, argsRaw: string): Promise<unknown> {
  const executor = TOOL_EXECUTORS[nombre]
  if (!executor) {
    return { error: `Herramienta desconocida: ${nombre}` }
  }

  let args: Record<string, unknown> = {}
  try {
    args = argsRaw ? (JSON.parse(argsRaw) as Record<string, unknown>) : {}
  } catch {
    return { error: 'No se pudieron interpretar los argumentos de la consulta.' }
  }

  try {
    return await executor(user, args)
  } catch (err: unknown) {
    // Los errores de permiso/sucursal se devuelven al modelo como texto controlado,
    // sin filtrar detalles técnicos.
    if (err instanceof Error) {
      return { error: err.message }
    }
    return { error: 'No se pudo obtener la información solicitada.' }
  }
}
