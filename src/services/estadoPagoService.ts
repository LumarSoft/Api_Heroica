export function estadoPagoAprobado(value: unknown): 'aprobado' | 'completado' | null {
  if (value === undefined || value === 'aprobado') return 'aprobado'
  return value === 'completado' ? 'completado' : null
}
