// Usuarios del panel: contraseñas con scrypt y sesiones en cookie HttpOnly.
const crypto = require('node:crypto');
const { sha256 } = require('./huella');

const COOKIE = 'cotiza_sesion';
const DURACION = 30 * 864e5;

function hashClave(clave) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(clave), sal, 64);
  return `scrypt$${sal.toString('hex')}$${h.toString('hex')}`;
}

function verificarClave(clave, guardada) {
  const [, salHex, hHex] = String(guardada).split('$');
  if (!salHex || !hHex) return false;
  const h = crypto.scryptSync(String(clave), Buffer.from(salHex, 'hex'), 64);
  return crypto.timingSafeEqual(h, Buffer.from(hHex, 'hex'));
}

function leerCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

function crearAuth(db, { seguro = false } = {}) {
  const intentos = new Map(); // límite de intentos de login por IP

  function iniciar(req, res, correo, clave) {
    const ip = req.ip;
    const r = intentos.get(ip) || { n: 0, desde: Date.now() };
    if (Date.now() - r.desde > 15 * 60e3) { r.n = 0; r.desde = Date.now(); }
    if (r.n >= 10) return { error: 'Demasiados intentos. Espera 15 minutos.', status: 429 };
    const u = db.uno('SELECT * FROM usuarios WHERE correo = ?', String(correo || '').trim().toLowerCase());
    if (!u || !verificarClave(clave, u.clave)) {
      r.n++; intentos.set(ip, r);
      return { error: 'Correo o contraseña incorrectos', status: 401 };
    }
    intentos.delete(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    db.ejecutar('INSERT INTO sesiones (token_hash, usuario_id, expira) VALUES (?,?,?)', sha256(token), u.id, Date.now() + DURACION);
    db.ejecutar('DELETE FROM sesiones WHERE expira < ?', Date.now());
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DURACION / 1000}${seguro ? '; Secure' : ''}`);
    return { usuario: { id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol } };
  }

  function usuarioDe(req) {
    const token = leerCookies(req)[COOKIE];
    if (!token) return null;
    return db.uno(
      'SELECT u.id, u.nombre, u.correo, u.rol FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ? AND s.expira > ?',
      sha256(token), Date.now(),
    ) || null;
  }

  function cerrar(req, res) {
    const token = leerCookies(req)[COOKIE];
    if (token) db.ejecutar('DELETE FROM sesiones WHERE token_hash = ?', sha256(token));
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  const requerir = (req, res, next) => {
    const u = usuarioDe(req);
    if (!u) return res.status(401).json({ error: 'Inicia sesión' });
    req.usuario = u;
    next();
  };

  return { iniciar, usuarioDe, cerrar, requerir };
}

module.exports = { crearAuth, hashClave, verificarClave };
