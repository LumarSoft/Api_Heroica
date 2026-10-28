/**
 * Validación de los datos de un proveedor, compartida por el ABM y la importación por Excel.
 * El CUIT y el teléfono se aceptan con guiones, espacios o puntos y se guardan solo con números.
 */

export interface DatosProveedor {
  nombre: string
  razon_social: string | null
  cuit: string | null
  cbu_alias: string | null
  telefono: string | null
  email: string | null
  direccion: string | null
}

const texto = (valor: unknown) => String(valor ?? '').trim()

export function normalizarCuit(valor: unknown): string {
  return texto(valor).replace(/[\s.-]/g, '')
}

export function normalizarTelefono(valor: unknown): string {
  return texto(valor).replace(/[\s().+-]/g, '')
}

/** Devuelve los datos limpios o el primer error encontrado */
export function validarDatosProveedor(
  body: Record<string, unknown>,
): { datos: DatosProveedor; error: null } | { datos: null; error: string } {
  const nombre = texto(body.nombre)
  const cuit = normalizarCuit(body.cuit)
  const telefono = normalizarTelefono(body.telefono)
  const email = texto(body.email)

  if (!nombre) return { datos: null, error: 'El nombre es requerido' }
  if (cuit && !/^\d{11}$/.test(cuit)) {
    return { datos: null, error: 'El CUIT/CUIL debe tener 11 números (con o sin guiones)' }
  }
  if (telefono && !/^\d+$/.test(telefono)) return { datos: null, error: 'El teléfono debe contener solo números' }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { datos: null, error: 'El email no tiene un formato válido' }
  }

  return {
    datos: {
      nombre,
      razon_social: texto(body.razon_social) || null,
      cuit: cuit || null,
      cbu_alias: texto(body.cbu_alias) || null,
      telefono: telefono || null,
      email: email || null,
      direccion: texto(body.direccion) || null,
    },
    error: null,
  }
}
