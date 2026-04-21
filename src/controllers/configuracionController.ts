import { Request, Response } from 'express'
import { query } from '../config/database'
import bcrypt from 'bcryptjs'

// ========== CATEGORÍAS ==========

// GET /api/configuracion/categorias
export const getCategorias = async (req: Request, res: Response) => {
  try {
    const { activo, tipo } = req.query

    let sql = 'SELECT * FROM categorias WHERE deleted_at IS NULL'
    const params: any[] = []

    if (activo !== undefined) {
      sql += ' AND activo = ?'
      params.push(activo === 'true' ? 1 : 0)
    }

    if (tipo) {
      sql += ' AND tipo = ?'
      params.push(tipo)
    }

    sql += ' ORDER BY nombre ASC'

    const result: any = await query(sql, params)

    res.json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('Error al obtener categorías:', error)
    res.status(500).json({
      success: false,
      message: 'Error al obtener categorías',
    })
  }
}

// POST /api/configuracion/categorias
export const createCategoria = async (req: Request, res: Response) => {
  try {
    const { nombre, descripcion, tipo } = req.body

    if (!nombre) {
      return res.status(400).json({
        success: false,
        message: 'El nombre es requerido',
      })
    }

    const result: any = await query('INSERT INTO categorias (nombre, descripcion, tipo) VALUES (?, ?, ?)', [
      nombre,
      descripcion || null,
      tipo || 'egreso',
    ])

    const created: any = await query('SELECT * FROM categorias WHERE id = ?', [result.insertId])

    res.status(201).json({
      success: true,
      message: 'Categoría creada exitosamente',
      data: created[0],
    })
  } catch (error: any) {
    console.error('Error al crear categoría:', error)
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'Ya existe una categoría con ese nombre',
      })
    }
    res.status(500).json({
      success: false,
      message: 'Error al crear categoría',
    })
  }
}

// PUT /api/configuracion/categorias/:id
export const updateCategoria = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { nombre, descripcion, activo, tipo } = req.body

    await query('UPDATE categorias SET nombre = ?, descripcion = ?, activo = ?, tipo = ? WHERE id = ?', [
      nombre,
      descripcion || null,
      activo !== undefined ? activo : true,
      tipo || 'egreso',
      id,
    ])

    const updated: any = await query('SELECT * FROM categorias WHERE id = ?', [id])

    res.json({
      success: true,
      message: 'Categoría actualizada exitosamente',
      data: updated[0],
    })
  } catch (error) {
    console.error('Error al actualizar categoría:', error)
    res.status(500).json({
      success: false,
      message: 'Error al actualizar categoría',
    })
  }
}

// DELETE /api/configuracion/categorias/:id
export const deleteCategoria = async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    await query('UPDATE categorias SET deleted_at = NOW() WHERE id = ?', [id])
    await query('UPDATE subcategorias SET deleted_at = NOW() WHERE categoria_id = ? AND deleted_at IS NULL', [id])

    res.json({
      success: true,
      message: 'Categoría eliminada exitosamente',
    })
  } catch (error) {
    console.error('Error al eliminar categoría:', error)
    res.status(500).json({
      success: false,
      message: 'Error al eliminar categoría',
    })
  }
}

// ========== SUBCATEGORÍAS ==========

// GET /api/configuracion/subcategorias
export const getSubcategorias = async (req: Request, res: Response) => {
  try {
    const { categoria_id, activo } = req.query

    let sql = `
      SELECT s.*, c.nombre as categoria_nombre
      FROM subcategorias s
      LEFT JOIN categorias c ON s.categoria_id = c.id
      WHERE s.deleted_at IS NULL
    `
    const params: any[] = []

    if (categoria_id) {
      sql += ' AND s.categoria_id = ?'
      params.push(categoria_id)
    }

    if (activo !== undefined) {
      sql += ' AND s.activo = ?'
      params.push(activo === 'true' ? 1 : 0)
    }

    sql += ' ORDER BY c.nombre, s.nombre ASC'

    const result: any = await query(sql, params)

    res.json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('Error al obtener subcategorías:', error)
    res.status(500).json({
      success: false,
      message: 'Error al obtener subcategorías',
    })
  }
}

// POST /api/configuracion/subcategorias
export const createSubcategoria = async (req: Request, res: Response) => {
  try {
    const { categoria_id, nombre, descripcion } = req.body

    if (!categoria_id || !nombre) {
      return res.status(400).json({
        success: false,
        message: 'La categoría y el nombre son requeridos',
      })
    }

    const result: any = await query('INSERT INTO subcategorias (categoria_id, nombre, descripcion) VALUES (?, ?, ?)', [
      categoria_id,
      nombre,
      descripcion || null,
    ])

    const created: any = await query('SELECT * FROM subcategorias WHERE id = ?', [result.insertId])

    res.status(201).json({
      success: true,
      message: 'Subcategoría creada exitosamente',
      data: created[0],
    })
  } catch (error: any) {
    console.error('Error al crear subcategoría:', error)
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'Ya existe una subcategoría con ese nombre en esta categoría',
      })
    }
    res.status(500).json({
      success: false,
      message: 'Error al crear subcategoría',
    })
  }
}

// PUT /api/configuracion/subcategorias/:id
export const updateSubcategoria = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { categoria_id, nombre, descripcion, activo } = req.body

    await query('UPDATE subcategorias SET categoria_id = ?, nombre = ?, descripcion = ?, activo = ? WHERE id = ?', [
      categoria_id,
      nombre,
      descripcion || null,
      activo !== undefined ? activo : true,
      id,
    ])

    const updated: any = await query('SELECT * FROM subcategorias WHERE id = ?', [id])

    res.json({
      success: true,
      message: 'Subcategoría actualizada exitosamente',
      data: updated[0],
    })
  } catch (error) {
    console.error('Error al actualizar subcategoría:', error)
    res.status(500).json({
      success: false,
      message: 'Error al actualizar subcategoría',
    })
  }
}

// DELETE /api/configuracion/subcategorias/:id
export const deleteSubcategoria = async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    await query('UPDATE subcategorias SET deleted_at = NOW() WHERE id = ?', [id])

    res.json({
      success: true,
      message: 'Subcategoría eliminada exitosamente',
    })
  } catch (error) {
    console.error('Error al eliminar subcategoría:', error)
    res.status(500).json({
      success: false,
      message: 'Error al eliminar subcategoría',
    })
  }
}

// ========== BANCOS ==========

// GET /api/configuracion/bancos
export const getBancos = async (req: Request, res: Response) => {
  try {
    const { activo } = req.query

    let sql = 'SELECT * FROM bancos WHERE deleted_at IS NULL'
    const params: any[] = []

    if (activo !== undefined) {
      sql += ' AND activo = ?'
      params.push(activo === 'true' ? 1 : 0)
    }

    sql += ' ORDER BY nombre ASC'

    const result: any = await query(sql, params)

    res.json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('Error al obtener bancos:', error)
    res.status(500).json({
      success: false,
      message: 'Error al obtener bancos',
    })
  }
}

// POST /api/configuracion/bancos
export const createBanco = async (req: Request, res: Response) => {
  try {
    const { nombre, codigo } = req.body

    if (!nombre) {
      return res.status(400).json({
        success: false,
        message: 'El nombre es requerido',
      })
    }

    const result: any = await query('INSERT INTO bancos (nombre, codigo) VALUES (?, ?)', [nombre, codigo || null])

    const created: any = await query('SELECT * FROM bancos WHERE id = ?', [result.insertId])

    res.status(201).json({
      success: true,
      message: 'Banco creado exitosamente',
      data: created[0],
    })
  } catch (error: any) {
    console.error('Error al crear banco:', error)
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'Ya existe un banco con ese nombre',
      })
    }
    res.status(500).json({
      success: false,
      message: 'Error al crear banco',
    })
  }
}

// PUT /api/configuracion/bancos/:id
export const updateBanco = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { nombre, codigo, activo } = req.body

    await query('UPDATE bancos SET nombre = ?, codigo = ?, activo = ? WHERE id = ?', [
      nombre,
      codigo || null,
      activo !== undefined ? activo : true,
      id,
    ])

    const updated: any = await query('SELECT * FROM bancos WHERE id = ?', [id])

    res.json({
      success: true,
      message: 'Banco actualizado exitosamente',
      data: updated[0],
    })
  } catch (error) {
    console.error('Error al actualizar banco:', error)
    res.status(500).json({
      success: false,
      message: 'Error al actualizar banco',
    })
  }
}

// DELETE /api/configuracion/bancos/:id
export const deleteBanco = async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    await query('UPDATE bancos SET deleted_at = NOW() WHERE id = ?', [id])

    res.json({
      success: true,
      message: 'Banco eliminado exitosamente',
    })
  } catch (error) {
    console.error('Error al eliminar banco:', error)
    res.status(500).json({
      success: false,
      message: 'Error al eliminar banco',
    })
  }
}

// ========== MEDIOS DE PAGO ==========

// GET /api/configuracion/medios-pago
export const getMediosPago = async (req: Request, res: Response) => {
  try {
    const { activo } = req.query

    let sql = 'SELECT * FROM medios_pago WHERE deleted_at IS NULL'
    const params: any[] = []

    if (activo !== undefined) {
      sql += ' AND activo = ?'
      params.push(activo === 'true' ? 1 : 0)
    }

    sql += ' ORDER BY nombre ASC'

    const result: any = await query(sql, params)

    res.json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('Error al obtener medios de pago:', error)
    res.status(500).json({
      success: false,
      message: 'Error al obtener medios de pago',
    })
  }
}

// POST /api/configuracion/medios-pago
export const createMedioPago = async (req: Request, res: Response) => {
  try {
    const { nombre, descripcion } = req.body

    if (!nombre) {
      return res.status(400).json({
        success: false,
        message: 'El nombre es requerido',
      })
    }

    const result: any = await query('INSERT INTO medios_pago (nombre, descripcion) VALUES (?, ?)', [
      nombre,
      descripcion || null,
    ])

    const created: any = await query('SELECT * FROM medios_pago WHERE id = ?', [result.insertId])

    res.status(201).json({
      success: true,
      message: 'Medio de pago creado exitosamente',
      data: created[0],
    })
  } catch (error: any) {
    console.error('Error al crear medio de pago:', error)
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'Ya existe un medio de pago con ese nombre',
      })
    }
    res.status(500).json({
      success: false,
      message: 'Error al crear medio de pago',
    })
  }
}

// PUT /api/configuracion/medios-pago/:id
export const updateMedioPago = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { nombre, descripcion, activo } = req.body

    await query('UPDATE medios_pago SET nombre = ?, descripcion = ?, activo = ? WHERE id = ?', [
      nombre,
      descripcion || null,
      activo !== undefined ? activo : true,
      id,
    ])

    const updated: any = await query('SELECT * FROM medios_pago WHERE id = ?', [id])

    res.json({
      success: true,
      message: 'Medio de pago actualizado exitosamente',
      data: updated[0],
    })
  } catch (error) {
    console.error('Error al actualizar medio de pago:', error)
    res.status(500).json({
      success: false,
      message: 'Error al actualizar medio de pago',
    })
  }
}

// DELETE /api/configuracion/medios-pago/:id
export const deleteMedioPago = async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    await query('UPDATE medios_pago SET deleted_at = NOW() WHERE id = ?', [id])

    res.json({
      success: true,
      message: 'Medio de pago eliminado exitosamente',
    })
  } catch (error) {
    console.error('Error al eliminar medio de pago:', error)
    res.status(500).json({
      success: false,
      message: 'Error al eliminar medio de pago',
    })
  }
}

// ========== USUARIOS ==========

// GET /api/configuracion/usuarios
export const getUsuarios = async (req: Request, res: Response) => {
  try {
    const { activo } = req.query

    let sql = `
            SELECT u.id, u.email, u.nombre, u.activo, u.rol_id, r.nombre as rol, u.two_factor_enabled
            FROM usuarios u
            LEFT JOIN roles r ON u.rol_id = r.id
            WHERE u.deleted_at IS NULL
        `
    const params: any[] = []

    if (activo !== undefined) {
      sql += ' AND u.activo = ?'
      params.push(activo === 'true' ? 1 : 0)
    }

    sql += ' ORDER BY u.nombre ASC'

    const result: any = await query(sql, params)

    res.json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('Error al obtener usuarios:', error)
    res.status(500).json({
      success: false,
      message: 'Error al obtener usuarios',
    })
  }
}

// PUT /api/configuracion/usuarios/:id/rol
export const updateUsuarioRol = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { rol_id } = req.body

    if (!rol_id) {
      return res.status(400).json({
        success: false,
        message: 'El rol_id es requerido',
      })
    }

    // Verificar que el rol existe en la DB (dinámico)
    const rolExiste: any = await query('SELECT id FROM roles WHERE id = ?', [rol_id])
    if (!rolExiste || rolExiste.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'El rol especificado no existe',
      })
    }

    const usuario: any = await query('SELECT email FROM usuarios WHERE id = ?', [id])

    if (!usuario || usuario.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado',
      })
    }

    if (usuario[0].email === 'admin@heroica.com') {
      return res.status(403).json({
        success: false,
        message: 'No se puede modificar el usuario administrador principal',
      })
    }

    await query('UPDATE usuarios SET rol_id = ? WHERE id = ?', [rol_id, id])

    const updated: any = await query(
      `SELECT u.id, u.email, u.nombre, u.activo, u.rol_id, u.must_change_password, r.nombre as rol
             FROM usuarios u
             LEFT JOIN roles r ON u.rol_id = r.id
             WHERE u.id = ?`,
      [id],
    )

    res.json({
      success: true,
      message: 'Rol del usuario actualizado exitosamente',
      data: updated[0],
    })
  } catch (error) {
    console.error('Error al actualizar rol del usuario:', error)
    res.status(500).json({
      success: false,
      message: 'Error al actualizar rol del usuario',
    })
  }
}

// PUT /api/configuracion/usuarios/:id/toggle-activo
export const toggleUsuarioActivo = async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const usuario: any = await query('SELECT email, activo FROM usuarios WHERE id = ?', [id])

    if (!usuario || usuario.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado',
      })
    }

    if (usuario[0].email === 'admin@heroica.com') {
      return res.status(403).json({
        success: false,
        message: 'No se puede desactivar el usuario administrador principal',
      })
    }

    const nuevoEstado = usuario[0].activo ? 0 : 1

    await query('UPDATE usuarios SET activo = ? WHERE id = ?', [nuevoEstado, id])

    const updated: any = await query(
      `SELECT u.id, u.email, u.nombre, u.activo, u.rol_id, r.nombre as rol
             FROM usuarios u
             LEFT JOIN roles r ON u.rol_id = r.id
             WHERE u.id = ?`,
      [id],
    )

    res.json({
      success: true,
      message: `Usuario ${nuevoEstado ? 'activado' : 'desactivado'} exitosamente`,
      data: updated[0],
    })
  } catch (error) {
    console.error('Error al cambiar estado del usuario:', error)
    res.status(500).json({
      success: false,
      message: 'Error al cambiar estado del usuario',
    })
  }
}

// DELETE /api/configuracion/usuarios/:id
export const deleteUsuario = async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const usuario: any = await query('SELECT email FROM usuarios WHERE id = ? AND deleted_at IS NULL', [id])

    if (!usuario || usuario.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado',
      })
    }

    if (usuario[0].email === 'admin@heroica.com') {
      return res.status(403).json({
        success: false,
        message: 'No se puede eliminar el usuario administrador principal',
      })
    }

    await query('UPDATE usuarios SET deleted_at = NOW() WHERE id = ?', [id])

    res.json({
      success: true,
      message: 'Usuario eliminado exitosamente',
    })
  } catch (error) {
    console.error('Error al eliminar usuario:', error)
    res.status(500).json({
      success: false,
      message: 'Error al eliminar usuario',
    })
  }
}

// POST /api/configuracion/usuarios
export const createUsuario = async (req: Request, res: Response) => {
  try {
    const { email, password, nombre, rol_id, sucursal_ids, must_change_password } = req.body

    if (!email || !password || !nombre || !rol_id) {
      return res.status(400).json({
        success: false,
        message: 'Email, contraseña, nombre y rol son requeridos',
      })
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'La contraseña debe tener al menos 6 caracteres',
      })
    }

    // Verificar que el rol existe en la DB (dinámico)
    const rolExiste: any = await query('SELECT id FROM roles WHERE id = ?', [rol_id])
    if (!rolExiste || rolExiste.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'El rol especificado no existe',
      })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const forcePwdChange = must_change_password ? 1 : 0

    const activo: any = await query('SELECT id FROM usuarios WHERE email = ? AND deleted_at IS NULL', [email])
    if (activo && activo.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Ya existe un usuario activo con ese email',
      })
    }

    const eliminado: any = await query('SELECT id FROM usuarios WHERE email = ? AND deleted_at IS NOT NULL', [email])

    let newUserId: number

    if (eliminado && eliminado.length > 0) {
      newUserId = eliminado[0].id
      await query(
        `UPDATE usuarios SET
          password = ?,
          nombre = ?,
          rol_id = ?,
          must_change_password = ?,
          deleted_at = NULL,
          activo = 1,
          two_factor_enabled = 0,
          two_factor_secret = NULL
        WHERE id = ?`,
        [hashedPassword, nombre, rol_id, forcePwdChange, newUserId],
      )
      await query('DELETE FROM usuarios_sucursales WHERE usuario_id = ?', [newUserId])
    } else {
      const result: any = await query(
        'INSERT INTO usuarios (email, password, nombre, rol_id, must_change_password) VALUES (?, ?, ?, ?, ?)',
        [email, hashedPassword, nombre, rol_id, forcePwdChange],
      )
      newUserId = result.insertId
    }

    // Asignar sucursales si se proporcionaron
    if (Array.isArray(sucursal_ids) && sucursal_ids.length > 0) {
      const placeholders = sucursal_ids.map(() => '(?, ?)').join(', ')
      const flatParams = sucursal_ids.flatMap((sid: number) => [newUserId, sid])
      await query(`INSERT IGNORE INTO usuarios_sucursales (usuario_id, sucursal_id) VALUES ${placeholders}`, flatParams)
    }

    const created: any = await query(
      `SELECT u.id, u.email, u.nombre, u.activo, u.rol_id, u.must_change_password, r.nombre as rol
             FROM usuarios u
             LEFT JOIN roles r ON u.rol_id = r.id
             WHERE u.id = ?`,
      [newUserId],
    )

    res.status(201).json({
      success: true,
      message: 'Usuario creado exitosamente',
      data: created[0],
    })
  } catch (error: any) {
    console.error('Error al crear usuario:', error)
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'Ya existe un usuario con ese email',
      })
    }
    res.status(500).json({
      success: false,
      message: 'Error al crear usuario',
    })
  }
}

// ========== ROLES ==========

// GET /api/configuracion/roles
export const getRoles = async (req: Request, res: Response) => {
  try {
    const roles: any = await query(
      `SELECT r.id, r.nombre, r.descripcion, r.es_sistema,
                GROUP_CONCAT(p.clave SEPARATOR ',') as permisos_claves,
                GROUP_CONCAT(p.id SEPARATOR ',') as permisos_ids
             FROM roles r
             LEFT JOIN roles_permisos rp ON r.id = rp.rol_id
             LEFT JOIN permisos p ON rp.permiso_id = p.id
             GROUP BY r.id
             ORDER BY r.id ASC`,
      [],
    )

    const result = roles.map((rol: any) => ({
      ...rol,
      permisos_ids: rol.permisos_ids ? rol.permisos_ids.split(',').map(Number) : [],
      permisos_claves: rol.permisos_claves ? rol.permisos_claves.split(',') : [],
    }))

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Error al obtener roles:', error)
    res.status(500).json({ success: false, message: 'Error al obtener roles' })
  }
}

// POST /api/configuracion/roles
export const createRol = async (req: Request, res: Response) => {
  try {
    const { nombre, descripcion, permiso_ids } = req.body

    if (!nombre) {
      return res.status(400).json({
        success: false,
        message: 'El nombre del rol es requerido',
      })
    }

    const result: any = await query('INSERT INTO roles (nombre, descripcion, es_sistema) VALUES (?, ?, 0)', [
      nombre.toLowerCase().trim(),
      descripcion || null,
    ])

    const rolId = result.insertId

    // Asignar permisos
    if (Array.isArray(permiso_ids) && permiso_ids.length > 0) {
      const placeholders = permiso_ids.map(() => '(?, ?)').join(', ')
      const flatParams = permiso_ids.flatMap((pid: number) => [rolId, pid])
      await query(`INSERT IGNORE INTO roles_permisos (rol_id, permiso_id) VALUES ${placeholders}`, flatParams)
    }

    const creado: any = await query(
      `SELECT r.id, r.nombre, r.descripcion, r.es_sistema,
                GROUP_CONCAT(p.id SEPARATOR ',') as permisos_ids
             FROM roles r
             LEFT JOIN roles_permisos rp ON r.id = rp.rol_id
             LEFT JOIN permisos p ON rp.permiso_id = p.id
             WHERE r.id = ?
             GROUP BY r.id`,
      [rolId],
    )

    res.status(201).json({
      success: true,
      message: 'Rol creado exitosamente',
      data: {
        ...creado[0],
        permisos_ids: creado[0]?.permisos_ids ? creado[0].permisos_ids.split(',').map(Number) : [],
      },
    })
  } catch (error: any) {
    console.error('Error al crear rol:', error)
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'Ya existe un rol con ese nombre',
      })
    }
    res.status(500).json({ success: false, message: 'Error al crear rol' })
  }
}

// PUT /api/configuracion/roles/:id
export const updateRol = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { nombre, descripcion, permiso_ids } = req.body

    const rol: any = await query('SELECT * FROM roles WHERE id = ?', [id])
    if (!rol || rol.length === 0) {
      return res.status(404).json({ success: false, message: 'Rol no encontrado' })
    }

    // Actualizar nombre/descripción
    await query('UPDATE roles SET nombre = ?, descripcion = ? WHERE id = ?', [
      nombre || rol[0].nombre,
      descripcion ?? rol[0].descripcion,
      id,
    ])

    // Reemplazar permisos
    await query('DELETE FROM roles_permisos WHERE rol_id = ?', [id])
    if (Array.isArray(permiso_ids) && permiso_ids.length > 0) {
      const placeholders = permiso_ids.map(() => '(?, ?)').join(', ')
      const flatParams = permiso_ids.flatMap((pid: number) => [Number(id), pid])
      await query(`INSERT IGNORE INTO roles_permisos (rol_id, permiso_id) VALUES ${placeholders}`, flatParams)
    }

    const actualizado: any = await query(
      `SELECT r.id, r.nombre, r.descripcion, r.es_sistema,
                GROUP_CONCAT(p.id SEPARATOR ',') as permisos_ids
             FROM roles r
             LEFT JOIN roles_permisos rp ON r.id = rp.rol_id
             LEFT JOIN permisos p ON rp.permiso_id = p.id
             WHERE r.id = ?
             GROUP BY r.id`,
      [id],
    )

    res.json({
      success: true,
      message: 'Rol actualizado exitosamente',
      data: {
        ...actualizado[0],
        permisos_ids: actualizado[0]?.permisos_ids ? actualizado[0].permisos_ids.split(',').map(Number) : [],
      },
    })
  } catch (error) {
    console.error('Error al actualizar rol:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar rol' })
  }
}

// DELETE /api/configuracion/roles/:id
export const deleteRol = async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const rol: any = await query('SELECT * FROM roles WHERE id = ?', [id])
    if (!rol || rol.length === 0) {
      return res.status(404).json({ success: false, message: 'Rol no encontrado' })
    }

    if (rol[0].es_sistema) {
      return res.status(403).json({
        success: false,
        message: 'No se puede eliminar un rol del sistema',
      })
    }

    const usuarios: any = await query(
      'SELECT COUNT(*) as total FROM usuarios WHERE rol_id = ? AND deleted_at IS NULL',
      [id],
    )
    if (usuarios[0].total > 0) {
      return res.status(400).json({
        success: false,
        message: `No se puede eliminar el rol porque tiene ${usuarios[0].total} usuario(s) asignado(s)`,
      })
    }

    await query('DELETE FROM roles WHERE id = ?', [id])

    res.json({ success: true, message: 'Rol eliminado exitosamente' })
  } catch (error) {
    console.error('Error al eliminar rol:', error)
    res.status(500).json({ success: false, message: 'Error al eliminar rol' })
  }
}

// ========== DESCRIPCIONES ==========

export const getDescripciones = async (req: Request, res: Response) => {
  try {
    const { activo, tipo } = req.query
    let sql = `
      SELECT d.*, c.nombre AS categoria_nombre, s.nombre AS subcategoria_nombre
      FROM descripciones d
      LEFT JOIN categorias c ON d.categoria_id = c.id AND c.deleted_at IS NULL
      LEFT JOIN subcategorias s ON d.subcategoria_id = s.id
      WHERE 1=1`
    const params: any[] = []
    if (activo !== undefined) {
      sql += ' AND d.activo = ?'
      params.push(activo === 'true' ? 1 : 0)
    }
    if (tipo) {
      sql += ' AND d.tipo = ?'
      params.push(tipo)
    }
    sql += ' ORDER BY d.nombre ASC'
    const result: any = await query(sql, params)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Error al obtener descripciones:', error)
    res.status(500).json({ success: false, message: 'Error al obtener descripciones' })
  }
}

export const createDescripcion = async (req: Request, res: Response) => {
  try {
    const { nombre, tipo, categoria_id, subcategoria_id } = req.body
    if (!nombre) return res.status(400).json({ success: false, message: 'El nombre es requerido' })
    if (!tipo || !['ingreso', 'egreso'].includes(tipo))
      return res.status(400).json({ success: false, message: 'El tipo es requerido (ingreso o egreso)' })
    const result: any = await query(
      'INSERT INTO descripciones (nombre, tipo, categoria_id, subcategoria_id) VALUES (?, ?, ?, ?)',
      [nombre, tipo, categoria_id || null, subcategoria_id || null],
    )
    const created: any = await query(
      `SELECT d.*, c.nombre AS categoria_nombre, s.nombre AS subcategoria_nombre
       FROM descripciones d
       LEFT JOIN categorias c ON d.categoria_id = c.id
       LEFT JOIN subcategorias s ON d.subcategoria_id = s.id
       WHERE d.id = ?`,
      [result.insertId],
    )
    res.status(201).json({ success: true, message: 'Descripción creada', data: created[0] })
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY')
      return res.status(400).json({ success: false, message: 'Ya existe una descripción con ese nombre' })
    res.status(500).json({ success: false, message: 'Error al crear descripción' })
  }
}

export const updateDescripcion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { nombre, activo, tipo, categoria_id, subcategoria_id } = req.body
    await query(
      'UPDATE descripciones SET nombre = ?, activo = ?, tipo = ?, categoria_id = ?, subcategoria_id = ? WHERE id = ?',
      [nombre, activo !== undefined ? activo : true, tipo || null, categoria_id || null, subcategoria_id || null, id],
    )
    const updated: any = await query(
      `SELECT d.*, c.nombre AS categoria_nombre, s.nombre AS subcategoria_nombre
       FROM descripciones d
       LEFT JOIN categorias c ON d.categoria_id = c.id
       LEFT JOIN subcategorias s ON d.subcategoria_id = s.id
       WHERE d.id = ?`,
      [id],
    )
    res.json({ success: true, message: 'Descripción actualizada', data: updated[0] })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al actualizar descripción' })
  }
}

export const deleteDescripcion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    await query('DELETE FROM descripciones WHERE id = ?', [id])
    res.json({ success: true, message: 'Descripción eliminada' })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al eliminar descripción' })
  }
}

// ========== PROVEEDORES ==========

export const getProveedores = async (req: Request, res: Response) => {
  try {
    const { activo } = req.query
    let sql = 'SELECT * FROM proveedores WHERE 1=1'
    const params: any[] = []
    if (activo !== undefined) {
      sql += ' AND activo = ?'
      params.push(activo === 'true' ? 1 : 0)
    }
    sql += ' ORDER BY nombre ASC'
    const result: any = await query(sql, params)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Error al obtener proveedores:', error)
    res.status(500).json({ success: false, message: 'Error al obtener proveedores' })
  }
}

export const createProveedor = async (req: Request, res: Response) => {
  try {
    const { nombre, razon_social, cuit, cbu_alias, telefono, email, direccion } = req.body
    const nombreLimpio = String(nombre || '').trim()
    const razonSocialLimpia = String(razon_social || '').trim()
    const cuitLimpio = String(cuit || '').trim()
    const cbuAliasLimpio = String(cbu_alias || '').trim()
    const telefonoLimpio = String(telefono || '').trim()
    const emailLimpio = String(email || '').trim()
    const direccionLimpia = String(direccion || '').trim()

    if (!nombreLimpio) {
      return res.status(400).json({ success: false, message: 'El nombre es requerido' })
    }
    if (cuitLimpio && !/^\d+$/.test(cuitLimpio)) {
      return res.status(400).json({
        success: false,
        message: 'El CUIT/CUIL debe contener solo números y sin guiones',
      })
    }
    if (telefonoLimpio && !/^\d+$/.test(telefonoLimpio)) {
      return res.status(400).json({
        success: false,
        message: 'El teléfono debe contener solo números',
      })
    }
    if (emailLimpio && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpio)) {
      return res.status(400).json({
        success: false,
        message: 'El email no tiene un formato válido',
      })
    }
    const result: any = await query(
      `INSERT INTO proveedores
      (nombre, razon_social, cuit, cbu_alias, telefono, email, direccion)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        nombreLimpio,
        razonSocialLimpia || null,
        cuitLimpio || null,
        cbuAliasLimpio || null,
        telefonoLimpio || null,
        emailLimpio || null,
        direccionLimpia || null,
      ],
    )
    const created: any = await query('SELECT * FROM proveedores WHERE id = ?', [result.insertId])
    res.status(201).json({ success: true, message: 'Proveedor creado', data: created[0] })
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY')
      return res.status(400).json({ success: false, message: 'Ya existe un proveedor con ese nombre' })
    res.status(500).json({ success: false, message: 'Error al crear proveedor' })
  }
}

export const updateProveedor = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { nombre, razon_social, cuit, cbu_alias, telefono, email, direccion, activo } = req.body
    const nombreLimpio = String(nombre || '').trim()
    const razonSocialLimpia = String(razon_social || '').trim()
    const cuitLimpio = String(cuit || '').trim()
    const cbuAliasLimpio = String(cbu_alias || '').trim()
    const telefonoLimpio = String(telefono || '').trim()
    const emailLimpio = String(email || '').trim()
    const direccionLimpia = String(direccion || '').trim()

    if (!nombreLimpio) {
      return res.status(400).json({ success: false, message: 'El nombre es requerido' })
    }
    if (cuitLimpio && !/^\d+$/.test(cuitLimpio)) {
      return res.status(400).json({
        success: false,
        message: 'El CUIT/CUIL debe contener solo números y sin guiones',
      })
    }
    if (telefonoLimpio && !/^\d+$/.test(telefonoLimpio)) {
      return res.status(400).json({
        success: false,
        message: 'El teléfono debe contener solo números',
      })
    }
    if (emailLimpio && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpio)) {
      return res.status(400).json({
        success: false,
        message: 'El email no tiene un formato válido',
      })
    }

    await query(
      `UPDATE proveedores
      SET nombre = ?, razon_social = ?, cuit = ?, cbu_alias = ?, telefono = ?, email = ?, direccion = ?, activo = ?
      WHERE id = ?`,
      [
        nombreLimpio,
        razonSocialLimpia || null,
        cuitLimpio || null,
        cbuAliasLimpio || null,
        telefonoLimpio || null,
        emailLimpio || null,
        direccionLimpia || null,
        activo !== undefined ? activo : true,
        id,
      ],
    )
    const updated: any = await query('SELECT * FROM proveedores WHERE id = ?', [id])
    res.json({ success: true, message: 'Proveedor actualizado', data: updated[0] })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al actualizar proveedor' })
  }
}

export const deleteProveedor = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    await query('DELETE FROM proveedores WHERE id = ?', [id])
    res.json({ success: true, message: 'Proveedor eliminado' })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al eliminar proveedor' })
  }
}

// ========== PERMISOS ==========

// GET /api/configuracion/permisos
export const getPermisos = async (req: Request, res: Response) => {
  try {
    const result: any = await query('SELECT * FROM permisos ORDER BY categoria, descripcion ASC', [])
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Error al obtener permisos:', error)
    res.status(500).json({ success: false, message: 'Error al obtener permisos' })
  }
}

// ========== SUCURSALES POR USUARIO ==========

// GET /api/configuracion/usuarios/:id/sucursales
export const getUsuarioSucursales = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const result: any = await query(
      `SELECT s.id, s.nombre
             FROM sucursales s
             INNER JOIN usuarios_sucursales us ON s.id = us.sucursal_id
             WHERE us.usuario_id = ? AND s.activo = 1
             ORDER BY s.nombre ASC`,
      [id],
    )
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Error al obtener sucursales del usuario:', error)
    res.status(500).json({
      success: false,
      message: 'Error al obtener sucursales del usuario',
    })
  }
}

// PUT /api/configuracion/usuarios/:id/sucursales
export const updateUsuarioSucursales = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { sucursal_ids } = req.body

    // Eliminar todas las asignaciones previas
    await query('DELETE FROM usuarios_sucursales WHERE usuario_id = ?', [id])

    // Insertar las nuevas
    if (Array.isArray(sucursal_ids) && sucursal_ids.length > 0) {
      const placeholders = sucursal_ids.map(() => '(?, ?)').join(', ')
      const flatParams = sucursal_ids.flatMap((sid: number) => [Number(id), sid])
      await query(`INSERT IGNORE INTO usuarios_sucursales (usuario_id, sucursal_id) VALUES ${placeholders}`, flatParams)
    }

    const result: any = await query(
      `SELECT s.id, s.nombre
             FROM sucursales s
             INNER JOIN usuarios_sucursales us ON s.id = us.sucursal_id
             WHERE us.usuario_id = ?
             ORDER BY s.nombre ASC`,
      [id],
    )

    res.json({
      success: true,
      message: 'Sucursales del usuario actualizadas',
      data: result,
    })
  } catch (error) {
    console.error('Error al actualizar sucursales del usuario:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar sucursales' })
  }
}
