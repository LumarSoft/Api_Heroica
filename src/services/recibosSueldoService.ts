/** Códigos del período en el campo mes: 1–12 mensual, 13 SAC 1er semestre, 14 SAC 2do semestre. */
export function isPeriodoRecibo(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 14
}
