import bcrypt from 'bcryptjs';

// Script para generar hash de contraseñas
const password = process.argv[2] || 'admin123';

bcrypt.hash(password, 10, (err, hash) => {
  if (err) {
    console.error('Error generando hash:', err);
    process.exit(1);
  }
  
  console.log('\n🔐 Hash generado:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Password: ${password}`);
  console.log(`Hash: ${hash}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  process.exit(0);
});
