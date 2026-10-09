import cron from 'node-cron'
import { enviarReportesProgramadosPendientes } from './reportesProgramadosService'
import { procesarPendientes } from './sincronizacionService'

/**
 * Fuera de Vercel (local o un servidor propio) la API corre como proceso largo: cada
 * 15 minutos avanza las sincronizaciones de Hiopos y revisa los envíos por mail.
 * En Vercel no se usa: ahí lo hace Vercel Cron (vercel.json) y el sync bajo demanda.
 */
export function startVentasCron(): void {
  if (process.env.VERCEL === '1' || process.env.VENTAS_SYNC_DISABLED === 'true') return
  cron.schedule('*/15 * * * *', async () => {
    try {
      let vueltas = 0
      while (vueltas++ < 20) {
        const r = await procesarPendientes({ crearAutomatica: vueltas === 1 })
        if (!r.ejecutada || !r.quedanPendientes) break
      }
      const envios = await enviarReportesProgramadosPendientes()
      if (envios.enviados || envios.errores.length) console.log('[Ventas] Envíos programados:', envios)
    } catch (err: unknown) {
      console.error('[Ventas] Error en el cron de ventas:', err instanceof Error ? err.message : err)
    }
  })
}
