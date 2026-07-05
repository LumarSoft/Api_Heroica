import OpenAI from 'openai'

/**
 * Cliente único de OpenAI para HeroicAI.
 *
 * La API key vive SOLO en el backend (nunca se expone al frontend).
 * Se acepta `OPENAI_API_KEY` (nombre estándar) y, por compatibilidad con el
 * `.env` existente, también `OPEN_AI_APY_KEY` (typo heredado). Preferí migrar
 * la variable al nombre estándar cuando puedas.
 */
const apiKey = process.env.OPENAI_API_KEY || process.env.OPEN_AI_APY_KEY

if (!apiKey) {
  console.warn('⚠️  HeroicAI: no se encontró OPENAI_API_KEY (ni OPEN_AI_APY_KEY). El asistente no funcionará.')
}

export const openai = new OpenAI({ apiKey: apiKey ?? '' })

// Modelo por defecto: rápido y económico, suficiente para routing + redacción.
// Subir a un modelo mayor solo si el razonamiento lo requiere.
export const HEROICAI_MODEL = process.env.HEROICAI_MODEL || 'gpt-4o-mini'

// Límite de vueltas de tool-calling por mensaje (evita loops infinitos).
export const HEROICAI_MAX_TOOL_ROUNDS = 5

export const heroicaiHabilitado = (): boolean => Boolean(apiKey)
