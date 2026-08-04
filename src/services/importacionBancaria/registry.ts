import type { Workbook } from 'exceljs'
import { galiciaAdapter } from './adapters/galiciaAdapter'
import { BancoAdapter, ErrorDeFormato } from './types'

/**
 * Registro de adapters de bancos.
 *
 * Para sumar un banco: implementar `BancoAdapter` en `adapters/` y agregarlo acá.
 * El orden importa solo para la autodetección — poné los adapters con firma más
 * específica primero.
 */
export const ADAPTERS: BancoAdapter[] = [
  galiciaAdapter,
  // TODO: santanderAdapter
  // TODO: bbvaAdapter
  // TODO: <4to banco>Adapter
]

export function obtenerAdapter(clave: string): BancoAdapter {
  const adapter = ADAPTERS.find(a => a.clave === clave)
  if (!adapter) {
    throw new ErrorDeFormato(
      `No hay un importador configurado para "${clave}". ` + `Disponibles: ${ADAPTERS.map(a => a.clave).join(', ')}.`,
    )
  }
  return adapter
}

/**
 * Intenta reconocer el banco a partir del contenido del archivo.
 * Devuelve null si ninguno lo reconoce o si más de uno lo hace (ambiguo: que elija
 * el usuario antes que arriesgar un parseo incorrecto).
 */
export function detectarAdapter(workbook: Workbook, nombreArchivo: string): BancoAdapter | null {
  const candidatos = ADAPTERS.filter(a => {
    try {
      return a.detectar(workbook, nombreArchivo)
    } catch {
      return false
    }
  })
  return candidatos.length === 1 ? candidatos[0] : null
}

/** Lista para poblar el selector de banco en la UI. */
export function listarAdapters(): Array<{ clave: string; nombre: string }> {
  return ADAPTERS.map(a => ({ clave: a.clave, nombre: a.nombre }))
}
