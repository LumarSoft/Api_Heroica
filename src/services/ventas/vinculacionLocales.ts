import { query } from '../../config/database'

/**
 * Vinculación automática entre los locales que informa el punto de venta (ej. Bistrosoft
 * "HEROICA GUEMES") y las sucursales de Heroica (ej. "Heroica Güemes").
 *
 *  - Nombre equivalente (sin tildes, mayúsculas ni la palabra "Heroica", y tolerando un
 *    error de tipeo por palabra: "Codroba" = "Córdoba") → se vincula solo.
 *  - Parecido pero no idéntico (ej. "HEROICA CORDOBA SHOPPING" vs "Heroica Alto Córdoba"
 *    y "Heroica Centro Cordoba") → solo se SUGIERE: vincular mal mezclaría las ventas
 *    de dos sucursales, así que lo confirma una persona una única vez.
 *  - Si alguien lo cambia a mano (`asignacion = 'manual'`), no se vuelve a tocar.
 */

interface SucursalNombre {
  id: number
  nombre: string
}

export interface CoincidenciaSucursal {
  sucursalId: number
  nombre: string
  exacta: boolean
}

const PALABRAS_IGNORADAS = new Set(['heroica', 'sucursal', 'local'])

function tokens(nombre: string): string[] {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(t => t && !PALABRAS_IGNORADAS.has(t))
}

/**
 * Distancia de edición con transposición (Damerau-Levenshtein restringida): cuántas
 * letras hay que agregar, quitar, cambiar o intercambiar para pasar de una palabra a otra.
 */
function distancia(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[a.length][b.length]
}

/** Misma palabra, o un error de tipeo en palabras de 4+ letras ("codroba" ≈ "cordoba"). */
function mismaPalabra(a: string, b: string): boolean {
  if (a === b) return true
  return Math.min(a.length, b.length) >= 4 && distancia(a, b) <= 1
}

/** Mismas palabras (en cualquier orden), cada una igual o con un error de tipeo. */
function mismoNombre(externo: string[], propio: string[]): boolean {
  if (externo.length !== propio.length) return false
  const libres = [...propio]
  return externo.every(palabra => {
    const i = libres.findIndex(p => mismaPalabra(palabra, p))
    if (i === -1) return false
    libres.splice(i, 1)
    return true
  })
}

/** Busca la sucursal que corresponde a un nombre externo. */
export function buscarSucursal(
  nombreExterno: string | null,
  sucursales: SucursalNombre[],
): CoincidenciaSucursal | null {
  if (!nombreExterno) return null
  const externo = tokens(nombreExterno)
  if (externo.length === 0) return null
  const claveExterna = externo.join(' ')

  // Primero idéntico; si no hay, tolerando errores de tipeo. Nunca se elige entre dos.
  const identicas = sucursales.filter(s => tokens(s.nombre).join(' ') === claveExterna)
  const exactas = identicas.length > 0 ? identicas : sucursales.filter(s => mismoNombre(externo, tokens(s.nombre)))
  if (exactas.length === 1) return { sucursalId: exactas[0].id, nombre: exactas[0].nombre, exacta: true }

  // Sugerencia: la sucursal que comparte más palabras, solo si no hay empate.
  const puntajes = sucursales
    .map(s => {
      const propios = tokens(s.nombre)
      const comunes = propios.filter(t => externo.some(e => mismaPalabra(e, t))).length
      return { s, puntaje: comunes / new Set([...propios, ...externo]).size }
    })
    .filter(p => p.puntaje > 0)
    .sort((a, b) => b.puntaje - a.puntaje)

  if (puntajes.length === 0) return null
  if (puntajes.length > 1 && puntajes[0].puntaje === puntajes[1].puntaje) return null
  return { sucursalId: puntajes[0].s.id, nombre: puntajes[0].s.nombre, exacta: false }
}

export async function obtenerSucursalesActivas(): Promise<SucursalNombre[]> {
  return (await query('SELECT id, nombre FROM sucursales WHERE deleted_at IS NULL')) as SucursalNombre[]
}

/**
 * Vincula los locales sin sucursal cuyo nombre coincide exactamente con una sucursal y
 * pasa a esa sucursal las ventas que ya tenían importadas. Devuelve cuántos vinculó.
 */
export async function vincularLocalesAutomaticamente(): Promise<number> {
  const pendientes = (await query(
    `SELECT id, nombre_externo FROM ventas_locales_externos WHERE sucursal_id IS NULL AND asignacion IS NULL`,
  )) as Array<{ id: number; nombre_externo: string | null }>
  if (pendientes.length === 0) return 0

  const sucursales = await obtenerSucursalesActivas()
  let vinculados = 0
  for (const local of pendientes) {
    const coincidencia = buscarSucursal(local.nombre_externo, sucursales)
    if (!coincidencia?.exacta) continue
    await query(
      `UPDATE ventas_locales_externos SET sucursal_id = ?, asignacion = 'automatica'
       WHERE id = ? AND sucursal_id IS NULL AND asignacion IS NULL`,
      [coincidencia.sucursalId, local.id],
    )
    await query('UPDATE ventas_lineas SET sucursal_id = ?, observada = 0 WHERE local_externo_id = ?', [
      coincidencia.sucursalId,
      local.id,
    ])
    vinculados++
  }
  return vinculados
}
