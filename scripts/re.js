const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../src/controllers/movimientos');
const files = ['efectivoController.ts', 'bancoController.ts', 'pagosPendientesController.ts', '../movimientosController.ts'];

for (const file of files) {
  const filePath = path.join(srcDir, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // Agregamos comentarios, descripcion_id, proveedor_id a las queries
    // Es mejor que yo lo edite manualmente...
  }
}
