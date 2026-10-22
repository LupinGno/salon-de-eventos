const bcryptjs = require('bcryptjs')

const password = process.argv[2]
if (!password) {
    console.log('Uso: npm run generar-hash -- MiContraseña123')
    process.exit(1)
}
console.log(bcryptjs.hashSync(password, 10))
