import { Request, Response } from 'express'
import { query } from '../config/database'

const TIPOS_VALIDOS = ['Incentivo', 'Premio']
const METODOS_VALIDOS = ['porcentaje_escala', 'monto_fijo', 'multiplicador_valor_hora']

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  return true
}

function normalizePayload(body: Record<string, unknown>) {
  const mes = normalizeNumber(body.mes)
  const anio = normalizeNumber(body.anio)
  const escalaSalarialId = normalizeNumber(body.escala_salarial_id)
  const valor = normalizeNumber(body.valor)
  const tipo = typeof body.tipo === 'string' ? body.tipo.trim() : 'Incentivo'
  const metodoCalculo = typeof body.metodo_calculo === 'string' ? body.metodo_calculo.trim() : 'porcentaje_escala'

  return {
    sucursal_id: normalizeNumber(body.sucursal_id),
    escala_salarial_id: escalaSalarialId,
    nombre: typeof body.nombre === 'string' ? body.nombre.trim() : '',
    tipo,
    descripcion: normalizeOptionalText(body.descripcion),
    mes,
    anio,
    metodo_calculo: metodoCalculo,
    valor,
    activo: normalizeBoolean(body.activo),
  }
}

function validatePayload(payload: ReturnType<typeof normalizePayload>): string | null {
  if (!payload.sucursal_id) return 'Sucursal requerida'
  if (!payload.nombre) return 'Nombre requerido'
  if (!TIPOS_VALIDOS.includes(payload.tipo)) return 'Tipo inválido'
  if (!payload.mes || payload.mes < 1 || payload.mes > 12) return 'Mes inválido'
  if (!payload.anio || payload.anio < 2000) return 'Año inválido'
  if (!METODOS_VALIDOS.includes(payload.metodo_calculo)) return 'Método de cálculo inválido'
  if (payload.valor === null || payload.valor < 0) return 'Valor inválido'
  if (!payload.escala_salarial_id) return 'La escala salarial es obligatoria'
  return null
}

const selectIncentivosSql = `
  SELECT i.id, i.sucursal_id, s.nombre AS sucursal_nombre, i.escala_salarial_id,
         pu.nombre AS escala_puesto, e.sueldo_base AS escala_sueldo_base, e.valor_hora AS escala_valor_hora,
         i.nombre, i.tipo, i.descripcion, i.mes, i.anio, i.metodo_calculo, i.valor, i.activo,
         CASE
           WHEN i.metodo_calculo = 'porcentaje_escala' THEN ROUND(COALESCE(e.sueldo_base, 0) * i.valor / 100, 2)
           WHEN i.metodo_calculo = 'multiplicador_valor_hora' THEN ROUND(COALESCE(e.valor_hora, 0) * i.valor, 2)
           ELSE i.valor
         END AS monto_calculado,
         i.fecha_ultima_actualizacion, i.created_at, i.updated_at
  FROM rrhh_incentivos_premios i
  INNER JOIN sucursales s ON i.sucursal_id = s.id
  LEFT JOIN escalas_salariales e ON i.escala_salarial_id = e.id AND e.deleted_at IS NULL
  LEFT JOIN puestos pu ON e.puesto_id = pu.id AND pu.deleted_at IS NULL
`

// GET /api/rrhh/incentivos
export const getIncentivos = async (req: Request, res: Response) => {
  try {
    const { sucursal_id, mes, anio, activo } = req.query
    const conditions = ['i.deleted_at IS NULL']
    const params: Array<string | number> = []

    if (sucursal_id) {
      conditions.push('i.sucursal_id = ?')
      params.push(Number(sucursal_id))
    }

    if (mes) {
      conditions.push('i.mes = ?')
      params.push(Number(mes))
    }

    if (anio) {
      conditions.push('i.anio = ?')
      params.push(Number(anio))
    }

    if (activo === 'true' || activo === 'false') {
      conditions.push('i.activo = ?')
      params.push(activo === 'true' ? 1 : 0)
    }

    const result = await query(
      `${selectIncentivosSql}
       WHERE ${conditions.join(' AND ')}
       ORDER BY i.anio DESC, i.mes DESC, i.activo DESC, i.nombre ASC`,
      params,
    )

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Error al obtener incentivos de RRHH:', error)
    res.status(500).json({ success: false, message: 'Error al obtener incentivos y premios' })
  }
}

// POST /api/rrhh/incentivos
export const createIncentivo = async (req: Request, res: Response) => {
  try {
    const payload = normalizePayload(req.body)
    const validationError = validatePayload(payload)
    if (validationError) return res.status(400).json({ success: false, message: validationError })

    const result: any = await query(
      `INSERT INTO rrhh_incentivos_premios
       (sucursal_id, escala_salarial_id, nombre, tipo, descripcion, mes, anio, metodo_calculo, valor, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.sucursal_id,
        payload.escala_salarial_id,
        payload.nombre,
        payload.tipo,
        payload.descripcion,
        payload.mes,
        payload.anio,
        payload.metodo_calculo,
        payload.valor,
        payload.activo ? 1 : 0,
      ],
    )

    const created: any = await query(`${selectIncentivosSql} WHERE i.id = ? AND i.deleted_at IS NULL`, [result.insertId])
    res.status(201).json({ success: true, data: created[0] })
  } catch (error) {
    console.error('Error al crear incentivo de RRHH:', error)
    res.status(500).json({ success: false, message: 'Error al crear incentivo o premio' })
  }
}

// PUT /api/rrhh/incentivos/:id
export const updateIncentivo = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const payload = normalizePayload(req.body)
    const validationError = validatePayload(payload)
    if (validationError) return res.status(400).json({ success: false, message: validationError })

    const existing: any = await query('SELECT id FROM rrhh_incentivos_premios WHERE id = ? AND deleted_at IS NULL', [id])
    if (!Array.isArray(existing) || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Incentivo o premio no encontrado' })
    }

    await query(
      `UPDATE rrhh_incentivos_premios
       SET sucursal_id = ?, escala_salarial_id = ?, nombre = ?, tipo = ?, descripcion = ?, mes = ?, anio = ?,
           metodo_calculo = ?, valor = ?, activo = ?, fecha_ultima_actualizacion = NOW(), updated_at = NOW()
       WHERE id = ? AND deleted_at IS NULL`,
      [
        payload.sucursal_id,
        payload.escala_salarial_id,
        payload.nombre,
        payload.tipo,
        payload.descripcion,
        payload.mes,
        payload.anio,
        payload.metodo_calculo,
        payload.valor,
        payload.activo ? 1 : 0,
        id,
      ],
    )

    const updated: any = await query(`${selectIncentivosSql} WHERE i.id = ? AND i.deleted_at IS NULL`, [id])
    res.json({ success: true, data: updated[0] })
  } catch (error) {
    console.error('Error al actualizar incentivo de RRHH:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar incentivo o premio' })
  }
}

// DELETE /api/rrhh/incentivos/:id
export const deactivateIncentivo = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const existing: any = await query('SELECT id FROM rrhh_incentivos_premios WHERE id = ? AND deleted_at IS NULL', [id])
    if (!Array.isArray(existing) || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Incentivo o premio no encontrado' })
    }

    await query('UPDATE rrhh_incentivos_premios SET activo = 0, fecha_ultima_actualizacion = NOW(), updated_at = NOW() WHERE id = ?', [id])

    const updated: any = await query(`${selectIncentivosSql} WHERE i.id = ? AND i.deleted_at IS NULL`, [id])
    res.json({ success: true, data: updated[0], message: 'Incentivo o premio desactivado' })
  } catch (error) {
    console.error('Error al desactivar incentivo de RRHH:', error)
    res.status(500).json({ success: false, message: 'Error al desactivar incentivo o premio' })
  }
}
