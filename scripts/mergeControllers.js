const fs = require('fs');
const path = require('path');

const dir = 'c:/Users/Bodin/OneDrive/Desktop/Heroica/Api_Heroica/src/controllers';
const mC = fs.readFileSync(path.join(dir, 'movimientosController.ts'), 'utf8');
const cBC = fs.readFileSync(path.join(dir, 'cajaBancoController.ts'), 'utf8');
const pPC = fs.readFileSync(path.join(dir, 'pagosPendientesController.ts'), 'utf8');

// remove imports from the second and third
const removeImports = (content) => content.replace(/import \{ Request, Response \} [^\n]+\n/g, '').replace(/import \{ query \} [^\n]+\n/g, '');

let cbcClean = removeImports(cBC);
cbcClean = cbcClean.replace('export const moverAReal =', 'export const moverARealBanco =');

let ppcClean = removeImports(pPC);

const combined = mC + '\n' + cbcClean + '\n' + ppcClean;

fs.writeFileSync(path.join(dir, 'movimientosController.ts'), combined);
fs.unlinkSync(path.join(dir, 'cajaBancoController.ts'));
fs.unlinkSync(path.join(dir, 'pagosPendientesController.ts'));

// Now update routes
const routesDir = 'c:/Users/Bodin/OneDrive/Desktop/Heroica/Api_Heroica/src/routes';
let cbR = fs.readFileSync(path.join(routesDir, 'cajaBancoRoutes.ts'), 'utf8');
cbR = cbR.replace("'../controllers/cajaBancoController'", "'../controllers/movimientosController'");
cbR = cbR.replace("moverAReal,", "moverARealBanco as moverAReal,");
fs.writeFileSync(path.join(routesDir, 'cajaBancoRoutes.ts'), cbR);

let ppR = fs.readFileSync(path.join(routesDir, 'pagosPendientesRoutes.ts'), 'utf8');
ppR = ppR.replace("'../controllers/pagosPendientesController'", "'../controllers/movimientosController'");
fs.writeFileSync(path.join(routesDir, 'pagosPendientesRoutes.ts'), ppR);

console.log("Merge completed successfully.");
