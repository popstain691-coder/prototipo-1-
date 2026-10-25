// Aplicación Express: API del panel, página pública del cliente y verificación.
const express = require('express');
const path = require('node:path');
const { abrir } = require('./db');
const { crearMensajeria } = require('./mensajeria');
const { crearServicio, ErrorNegocio, ETIQUETA_ESTADO } = require('./cotizaciones');
const { crearAuth, hashClave, verificarClave } = require('./auth');
const { generarPdf } = require('./pdf');
const { calcular } = require('./calc');
const V = require('./vista-publica');
const { sembrarDemo } = require('./semilla');

function crearApp(opciones = {}) {
  const baseUrl = opciones.baseUrl || process.env.BASE_URL || 'http://localhost:3000';
  const db = opciones.db || abrir(opciones.archivoDb || process.env.DB_FILE || path.join(__dirname, '..', 'data', 'cotizador.db'));
  const mensajeria = opciones.mensajeria || crearMensajeria(db, { modo: opciones.modoMensajeria });
  const modoDemo = mensajeria.modo === 'demo';
  const servicio = crearServicio(db, { mensajeria, baseUrl, ahora: opciones.ahora, modoDemo });
  const auth = crearAuth(db, { seguro: baseUrl.startsWith('https://') });
  if (opciones.semilla ?? process.env.SEED_DEMO !== '0') sembrarDemo(db, servicio);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  const envolver = (fn) => async (req, res, next) => {
    try { await fn(req, res, next); } catch (e) { next(e); }
  };
  const quien = (req) => ({ ip: req.ip || '', navegador: req.get('user-agent') || '' });
  const verificarUrl = `${baseUrl.replace(/\/$/, '')}/verificar`;

  // ---------------- Panel: sesión ----------------
  const api = express.Router();
  api.post('/login', (req, res) => {
    const r = auth.iniciar(req, res, req.body.correo, req.body.clave);
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json(r);
  });
  api.post('/logout', (req, res) => { auth.cerrar(req, res); res.json({ ok: true }); });
  api.get('/yo', (req, res) => {
    const u = auth.usuarioDe(req);
    if (!u) return res.status(401).json({ error: 'Inicia sesión' });
    res.json({ usuario: u, modo_mensajeria: mensajeria.modo, base_url: baseUrl });
  });
  api.use(auth.requerir);

  api.post('/clave', (req, res) => {
    const u = db.uno('SELECT * FROM usuarios WHERE id = ?', req.usuario.id);
    if (!verificarClave(req.body.actual, u.clave)) return res.status(400).json({ error: 'La contraseña actual no coincide' });
    if (String(req.body.nueva || '').length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
    db.ejecutar('UPDATE usuarios SET clave = ? WHERE id = ?', hashClave(req.body.nueva), u.id);
    res.json({ ok: true });
  });

  // ---------------- Negocio ----------------
  const CAMPOS_NEGOCIO = ['nombre', 'nit', 'telefono', 'correo', 'direccion', 'ciudad', 'logo', 'color1', 'color2', 'condiciones', 'notas',
    'vigencia_dias', 'redondeo', 'whatsapp_dueno', 'correo_dueno', 'politica_datos'];
  api.get('/negocio', (req, res) => res.json(servicio.negocio()));
  api.put('/negocio', (req, res) => {
    const b = req.body;
    if (b.logo && !/^data:image\/(png|jpe?g);base64,/.test(b.logo)) throw new ErrorNegocio('El logo debe ser PNG o JPG');
    if (b.logo && b.logo.length > 700_000) throw new ErrorNegocio('El logo es muy pesado (máximo 500 KB)');
    for (const c of ['color1', 'color2']) if (b[c] && !/^#[0-9a-f]{6}$/i.test(b[c])) throw new ErrorNegocio('Color inválido');
    if (b.redondeo !== undefined && ![1, 50, 100, 1000].includes(Number(b.redondeo))) throw new ErrorNegocio('Redondeo inválido');
    if (b.vigencia_dias !== undefined && !(Number(b.vigencia_dias) >= 1 && Number(b.vigencia_dias) <= 365)) throw new ErrorNegocio('Vigencia inválida');
    const sets = CAMPOS_NEGOCIO.filter((c) => b[c] !== undefined);
    if (sets.length) db.ejecutar(`UPDATE negocio SET ${sets.map((c) => `${c} = ?`).join(', ')} WHERE id = 1`, ...sets.map((c) => (['vigencia_dias', 'redondeo'].includes(c) ? Number(b[c]) : String(b[c]).slice(0, 8000))));
    res.json(servicio.negocio());
  });

  // ---------------- Catálogo ----------------
  const TIPOS = ['servicio', 'material', 'mano_obra', 'desplazamiento', 'otro'];
  function leerItemCatalogo(b) {
    const precio = Number(b.precio), iva = Number(b.iva);
    if (!String(b.nombre || '').trim()) throw new ErrorNegocio('El nombre es obligatorio');
    if (!Number.isSafeInteger(precio) || precio < 0) throw new ErrorNegocio('El precio debe ser un valor en pesos enteros');
    if (!Number.isSafeInteger(iva) || iva < 0 || iva > 100) throw new ErrorNegocio('IVA inválido');
    if (!TIPOS.includes(b.tipo)) throw new ErrorNegocio('Tipo inválido');
    return [String(b.codigo || '').slice(0, 30), String(b.nombre).trim().slice(0, 200), String(b.descripcion || '').slice(0, 500), b.tipo, String(b.unidad || 'unidad').slice(0, 30), precio, iva];
  }
  api.get('/catalogo', (req, res) => {
    const todos = req.query.todos === '1';
    res.json(db.todos(`SELECT * FROM catalogo ${todos ? '' : 'WHERE activo = 1'} ORDER BY usos DESC, nombre`));
  });
  api.post('/catalogo', (req, res) => {
    const v = leerItemCatalogo(req.body);
    const r = db.ejecutar('INSERT INTO catalogo (codigo, nombre, descripcion, tipo, unidad, precio, iva, creado) VALUES (?,?,?,?,?,?,?,?)', ...v, Date.now());
    res.json(db.uno('SELECT * FROM catalogo WHERE id = ?', r.lastInsertRowid));
  });
  api.put('/catalogo/:id', (req, res) => {
    const v = leerItemCatalogo(req.body);
    db.ejecutar('UPDATE catalogo SET codigo=?, nombre=?, descripcion=?, tipo=?, unidad=?, precio=?, iva=?, activo=? WHERE id = ?', ...v, req.body.activo === false || req.body.activo === 0 ? 0 : 1, req.params.id);
    res.json(db.uno('SELECT * FROM catalogo WHERE id = ?', req.params.id));
  });

  // ---------------- Clientes ----------------
  function leerCliente(b) {
    if (String(b.nombre || '').trim().length < 2) throw new ErrorNegocio('El nombre del cliente es obligatorio');
    if (!b.autoriza_datos) throw new ErrorNegocio('Confirma que el cliente autorizó el tratamiento de sus datos (Ley 1581)');
    return [String(b.nombre).trim().slice(0, 120), String(b.celular || '').slice(0, 30), String(b.correo || '').trim().slice(0, 120), String(b.documento || '').slice(0, 30), String(b.direccion || '').slice(0, 300)];
  }
  api.get('/clientes', (req, res) => {
    const q = `%${String(req.query.q || '').trim()}%`;
    res.json(db.todos('SELECT * FROM clientes WHERE nombre LIKE ? OR celular LIKE ? OR correo LIKE ? ORDER BY nombre LIMIT 200', q, q, q));
  });
  api.post('/clientes', (req, res) => {
    const v = leerCliente(req.body);
    const r = db.ejecutar('INSERT INTO clientes (nombre, celular, correo, documento, direccion, autoriza_datos_at, creado) VALUES (?,?,?,?,?,?,?)', ...v, Date.now(), Date.now());
    res.json(db.uno('SELECT * FROM clientes WHERE id = ?', r.lastInsertRowid));
  });
  api.put('/clientes/:id', (req, res) => {
    const v = leerCliente(req.body);
    db.ejecutar('UPDATE clientes SET nombre=?, celular=?, correo=?, documento=?, direccion=?, autoriza_datos_at = COALESCE(autoriza_datos_at, ?), no_contactar = ? WHERE id = ?', ...v, Date.now(), req.body.no_contactar ? 1 : 0, req.params.id);
    res.json(db.uno('SELECT * FROM clientes WHERE id = ?', req.params.id));
  });

  // ---------------- Cotizaciones ----------------
  function resumen(c) {
    const b = JSON.parse(c.borrador);
    let total = null;
    try { total = calcular({ items: b.items, desc_global_bp: b.desc_global_bp, redondeo: servicio.negocio().redondeo }).totales.total; } catch { /* borrador incompleto */ }
    return {
      id: c.id, consecutivo: c.consecutivo, estado: c.estado, estado_texto: ETIQUETA_ESTADO[c.estado], titulo: b.titulo,
      cliente: c.cli_nombre || null, total, version_actual: c.version_actual, actualizada_at: c.actualizada_at, enviada_at: c.enviada_at,
      vigencia_hasta: c.vigencia_hasta, es_plantilla: !!c.es_plantilla, nombre_plantilla: c.nombre_plantilla, items: b.items.length,
    };
  }
  api.get('/cotizaciones', (req, res) => {
    const filtros = [], p = [];
    if (req.query.plantillas === '1') filtros.push('c.es_plantilla = 1'); else filtros.push('c.es_plantilla = 0');
    if (req.query.estado) { filtros.push('c.estado = ?'); p.push(String(req.query.estado)); }
    if (req.query.q) { filtros.push('(c.consecutivo LIKE ? OR cl.nombre LIKE ? OR c.borrador LIKE ?)'); const q = `%${req.query.q}%`; p.push(q, q, q); }
    const filas = db.todos(`SELECT c.*, cl.nombre AS cli_nombre FROM cotizaciones c LEFT JOIN clientes cl ON cl.id = c.cliente_id
      WHERE ${filtros.join(' AND ')} ORDER BY c.actualizada_at DESC LIMIT 300`, ...p);
    res.json(filas.map(resumen));
  });

  api.post('/cotizaciones', (req, res) => {
    const { desde, cliente_id } = req.body || {};
    const id = desde ? servicio.duplicar(Number(desde), { usuario_id: req.usuario.id, cliente_id: cliente_id ?? undefined })
      : servicio.crear({ cliente_id: cliente_id || null, usuario_id: req.usuario.id });
    res.json({ id });
  });

  function detalle(id) {
    const c = servicio.obtener(id);
    const cliente = c.cliente_id ? db.uno('SELECT * FROM clientes WHERE id = ?', c.cliente_id) : null;
    const b = JSON.parse(c.borrador);
    let calculo = null, errorCalculo = null;
    try { calculo = calcular({ items: b.items, desc_global_bp: b.desc_global_bp, redondeo: servicio.negocio().redondeo }); } catch (e) { errorCalculo = e.message; }
    return {
      ...c, borrador: b, estado_texto: ETIQUETA_ESTADO[c.estado], cliente, calculo, error_calculo: errorCalculo,
      enlace: c.token ? servicio.enlace(c.token) : null,
      cambios_sin_enviar: c.version_actual ? servicio.tieneCambiosSinEnviar(c) : false,
      versiones: servicio.versiones(id),
      eventos: db.todos('SELECT * FROM eventos WHERE cotizacion_id = ? ORDER BY at DESC, id DESC', id),
      aprobacion: servicio.aprobacion(id),
      mensaje: c.version_actual ? servicio.mensajeCotizacion(servicio.versionActual(c).doc, servicio.enlace(c.token)) : null,
    };
  }
  api.get('/cotizaciones/:id', (req, res) => res.json(detalle(Number(req.params.id))));
  api.put('/cotizaciones/:id', (req, res) => {
    servicio.guardar(Number(req.params.id), { borrador: req.body.borrador, cliente_id: req.body.cliente_id });
    res.json(detalle(Number(req.params.id)));
  });
  api.post('/cotizaciones/:id/enviar', (req, res) => {
    const r = servicio.enviar(Number(req.params.id), { usuario_id: req.usuario.id });
    res.json({ numero: r.numero, huella: r.huella, enlace: r.enlace, texto: r.texto });
  });
  api.post('/cotizaciones/:id/enviar-cliente', envolver(async (req, res) => {
    const canal = req.body.canal === 'correo' ? 'correo' : 'whatsapp';
    res.json(await servicio.enviarAlCliente(Number(req.params.id), canal));
  }));
  api.post('/cotizaciones/:id/plantilla', (req, res) => {
    servicio.marcarPlantilla(Number(req.params.id), req.body);
    res.json({ ok: true });
  });
  api.post('/cotizaciones/:id/nuevo-enlace', (req, res) => res.json({ enlace: servicio.nuevoEnlace(Number(req.params.id)) }));
  api.get('/cotizaciones/:id/versiones/:n', (req, res) => res.json(servicio.version(Number(req.params.id), Number(req.params.n))));
  api.get('/cotizaciones/:id/versiones/:n/pdf', envolver(async (req, res) => {
    const id = Number(req.params.id), v = servicio.version(id, Number(req.params.n));
    const ap = servicio.aprobacion(id);
    const pdf = await generarPdf(v.doc, { huella: v.huella, aprobacion: ap && ap.version === v.numero ? ap : null, verificarUrl });
    enviarPdf(res, pdf, `${v.doc.consecutivo}-v${v.numero}.pdf`);
  }));

  api.get('/metricas', (req, res) => res.json(servicio.metricas()));
  api.get('/actividad', (req, res) => {
    res.json(db.todos(`SELECT e.*, c.consecutivo, cl.nombre AS cliente FROM eventos e JOIN cotizaciones c ON c.id = e.cotizacion_id
      LEFT JOIN clientes cl ON cl.id = c.cliente_id WHERE e.tipo IN ('vista','aprobada','cambios','rechazada','vencida','recordatorio','enviada')
        AND (e.tipo <> 'vista' OR e.id = (SELECT MIN(x.id) FROM eventos x WHERE x.cotizacion_id = e.cotizacion_id AND x.tipo = 'vista' AND x.version = e.version))
      ORDER BY e.at DESC, e.id DESC LIMIT 40`));
  });
  api.get('/mensajes', (req, res) => res.json(db.todos('SELECT m.*, c.consecutivo FROM mensajes m LEFT JOIN cotizaciones c ON c.id = m.cotizacion_id ORDER BY m.at DESC, m.id DESC LIMIT 200')));
  api.post('/tareas', envolver(async (req, res) => res.json(await servicio.ejecutarTareas())));

  // Exportación para el software de facturación electrónica (la cotización no es factura).
  api.get('/exportar/aprobadas.json', (req, res) => res.json(exportarAprobadas()));
  api.get('/exportar/aprobadas.csv', (req, res) => {
    const filas = [['consecutivo', 'version', 'aprobada_at', 'aprobo', 'cliente', 'documento_cliente', 'item', 'unidad', 'cantidad', 'precio_unitario', 'descuento', 'base', 'iva_pct', 'iva', 'total_item', 'total_cotizacion', 'huella']];
    for (const a of exportarAprobadas()) for (const l of a.lineas) {
      filas.push([a.consecutivo, a.version, a.aprobada_at, a.aprobo, a.cliente.nombre, a.cliente.documento, l.nombre, l.unidad, l.cantidad_mil / 1000, l.precio, l.desc_item + l.desc_global, l.neto, l.iva, l.valor_iva, l.total, a.totales.total, a.huella]);
    }
    const csv = filas.map((f) => f.map((v) => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cotizaciones-aprobadas.csv"');
    res.send('﻿' + csv);
  });
  function exportarAprobadas() {
    return db.todos(`SELECT a.*, v.documento FROM aprobaciones a JOIN versiones v ON v.cotizacion_id = a.cotizacion_id AND v.numero = a.version ORDER BY a.at DESC`).map((a) => {
      const d = JSON.parse(a.documento);
      return { consecutivo: d.consecutivo, version: a.version, aprobada_at: new Date(a.at).toISOString(), aprobo: a.nombre, contacto: a.contacto, cliente: d.cliente, lineas: d.lineas, totales: d.totales, huella: a.huella };
    });
  }

  app.use('/api', api);

  // ---------------- Lado público del cliente ----------------
  function enviarPdf(res, buffer, nombre) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
    res.send(buffer);
  }
  const pub = express.Router({ mergeParams: true });
  pub.use((req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.setHeader('Cache-Control', 'no-store'); next(); });

  pub.get('/', (req, res) => {
    const c = servicio.porToken(req.params.token);
    const { version, doc } = servicio.versionActual(c);
    // No contamos como "vista" cuando el dueño revisa su propio enlace con la sesión abierta.
    if (!auth.usuarioDe(req) && req.method === 'GET') servicio.registrarVista(c, quien(req));
    const actual = servicio.obtener(c.id);
    const ap = servicio.aprobacion(c.id);
    res.send(V.paginaCotizacion({
      cot: actual, doc, huella: version.huella, aprobacion: ap, token: req.params.token, modoDemo,
      politicaDatos: servicio.negocio().politica_datos,
    }));
  });
  pub.get('/pdf', envolver(async (req, res) => {
    const c = servicio.porToken(req.params.token);
    const { version, doc } = servicio.versionActual(c);
    const ap = servicio.aprobacion(c.id);
    enviarPdf(res, await generarPdf(doc, { huella: version.huella, aprobacion: ap && ap.version === version.numero ? ap : null, verificarUrl }), `${doc.consecutivo}-v${version.numero}.pdf`);
  }));
  pub.get('/version.json', (req, res) => {
    // El documento exacto de la versión vigente, para recalcular la huella por cuenta propia.
    const c = servicio.porToken(req.params.token);
    const { version } = servicio.versionActual(c);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(version.documento);
  });
  pub.post('/codigo', envolver(async (req, res) => res.json(await servicio.pedirCodigo(servicio.porToken(req.params.token), req.body, quien(req)))));
  pub.post('/aprobar', envolver(async (req, res) => res.json(await servicio.aprobar(servicio.porToken(req.params.token), req.body, quien(req)))));
  pub.post('/cambios', (req, res) => { servicio.pedirCambios(servicio.porToken(req.params.token), req.body, quien(req)); res.json({ ok: true }); });
  pub.post('/rechazar', (req, res) => { servicio.rechazar(servicio.porToken(req.params.token), req.body, quien(req)); res.json({ ok: true }); });
  pub.get('/no-contactar', (req, res) => {
    const c = servicio.porToken(req.params.token);
    servicio.noContactar(c);
    res.send(V.paginaNoContactar(servicio.negocio().nombre));
  });
  app.use('/c/:token', pub);

  app.get('/verificar', (req, res) => {
    const h = String(req.query.h || '').trim().toLowerCase();
    let resultado = null;
    if (/^[0-9a-f]{64}$/.test(h)) {
      const v = db.uno('SELECT * FROM versiones WHERE huella = ?', h);
      if (v) {
        const det = servicio.version(v.cotizacion_id, v.numero);
        const ap = servicio.aprobacion(v.cotizacion_id);
        resultado = { doc: det.doc, integra: det.integra, aprobacion: ap && ap.version === v.numero ? ap : null };
      }
    }
    res.setHeader('X-Robots-Tag', 'noindex');
    res.send(V.paginaVerificar({ h, resultado }));
  });

  // Panel del dueño (archivos estáticos). calc.js es el mismo motor de cálculo del servidor.
  app.get('/calc.js', (req, res) => res.type('application/javascript').sendFile(path.join(__dirname, 'calc.js')));
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

  // Errores
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error(err);
    const mensaje = status >= 500 && !(err instanceof ErrorNegocio) ? 'Error interno' : err.message;
    if (req.path.startsWith('/c/') && req.method === 'GET' && !req.path.endsWith('.json')) return res.status(status).send(V.paginaError(mensaje, status));
    res.status(status).json({ error: mensaje });
  });

  return { app, db, servicio, mensajeria };
}

module.exports = { crearApp };
