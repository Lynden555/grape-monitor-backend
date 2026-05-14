const crypto = require('crypto');

/**
 * Genera una apiKey criptográficamente segura
 * Formato: emp_<48 caracteres hex>
 */
function generarApiKey() {
  return 'emp_' + crypto.randomBytes(24).toString('hex');
}

module.exports = { generarApiKey };
