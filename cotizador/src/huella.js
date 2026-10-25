// Huella (hash) del documento: SHA-256 sobre el JSON canónico (claves ordenadas).
// Cualquier cambio en la versión, aunque sea un peso o una coma, cambia la huella.
const crypto = require('node:crypto');

function canonico(valor) {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  if (Array.isArray(valor)) return '[' + valor.map(canonico).join(',') + ']';
  const claves = Object.keys(valor).filter((k) => valor[k] !== undefined).sort();
  return '{' + claves.map((k) => JSON.stringify(k) + ':' + canonico(valor[k])).join(',') + '}';
}

const sha256 = (texto) => crypto.createHash('sha256').update(texto, 'utf8').digest('hex');
const huella = (objeto) => sha256(canonico(objeto));

// Código aleatorio para enlaces: 24 bytes = 192 bits = 32 caracteres base64url.
const tokenAleatorio = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

// Código numérico de 6 dígitos para la aprobación.
const codigoNumerico = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

module.exports = { canonico, sha256, huella, tokenAleatorio, codigoNumerico };
