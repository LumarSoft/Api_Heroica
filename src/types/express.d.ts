import 'express-serve-static-core'

declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      id: number
      email: string
      nombre?: string
      rol_id: number
      rol: string
    }
  }
}
