// Reglas del negocio: borradores, versiones inmutables, enlace público, aprobación con código y tareas automáticas.
const { calcular, fmtPesos } = require('./calc');
const { huella, sha256, tokenAleatorio, codigoNumerico, canonico } = require('./huella');
const H = require('./horarios');

const DIA = 864e5;
const ESTADOS_ABIERTOS = ['enviada', 'vista', 'cambios'];
const ETIQUETA_ESTADO = {
  borrador: 'Borrador', enviada: 'Enviada', vista: 'Vista', cambios: 'Cambios pedidos',
  aprobada: 'Aprobada', rechazada: 'Rechazada', vencida: 'Vencida',
};
const TEXTO_ACEPTACION =
  'Al aprobar confirmo que leí esta cotización, acepto los ítems, valores y condiciones de esta versión, ' +
  'y autorizo el tratamiento de mis datos para gestionar el servicio.';

class ErrorNegocio extends Error {
  constructor(mensaje, status = 400) { super(mensaje); this.status = status; }
}

const limpiarTexto = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
const entero = (v, min, max, nombre) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new ErrorNegocio(`${nombre} inválido`);
  return n;
};

function normalizarTelefono(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('3')) d = '57' + d; // celular colombiano sin indicativo
  return d;
}
const esCorreo = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

function crearServicio(db, { mensajeria, baseUrl = 'http://localhost:3000', ahora = () => Date.now(), modoDemo = false } = {}) {
  const negocio = () => db.uno('SELECT * FROM negocio WHERE id = 1');
  const enlace = (token) => `${baseUrl.replace(/\/$/, '')}/c/${token}`;

  // ---------- Borradores ----------
  function borradorVacio() {
    const n = negocio();
    return {
      titulo: '', items: [], desc_global_bp: 0, vigencia_dias: n.vigencia_dias || 15,
      condiciones: n.condiciones || '', notas: n.notas || '',
    };
  }

  function normalizarBorrador(b) {
    if (!b || typeof b !== 'object') throw new ErrorNegocio('Borrador inválido');
    const items = Array.isArray(b.items) ? b.items : [];
    if (items.length > 200) throw new ErrorNegocio('Máximo 200 ítems');
    const limpio = {
      titulo: limpiarTexto(b.titulo, 140),
      items: items.map((it, i) => ({
        catalogo_id: it.catalogo_id ? entero(it.catalogo_id, 1, Number.MAX_SAFE_INTEGER, 'Catálogo') : null,
        nombre: limpiarTexto(it.nombre, 200) || `Ítem ${i + 1}`,
        descripcion: limpiarTexto(it.descripcion, 500),
        tipo: limpiarTexto(it.tipo, 20) || 'servicio',
        unidad: limpiarTexto(it.unidad, 30) || 'unidad',
        cantidad_mil: entero(it.cantidad_mil, 1, 1e12, `Cantidad del ítem ${i + 1}`),
        precio: entero(it.precio, 0, 1e13, `Precio del ítem ${i + 1}`),
        desc_bp: entero(it.desc_bp ?? 0, 0, 10000, `Descuento del ítem ${i + 1}`),
        iva: entero(it.iva ?? 0, 0, 100, `IVA del ítem ${i + 1}`),
      })),
      desc_global_bp: entero(b.desc_global_bp ?? 0, 0, 10000, 'Descuento global'),
      vigencia_dias: entero(b.vigencia_dias ?? 15, 1, 365, 'Vigencia'),
      condiciones: limpiarTexto(b.condiciones, 8000),
      notas: limpiarTexto(b.notas, 4000),
    };
    return limpio;
  }

  function siguienteConsecutivo(prefijo = 'COT') {
    const r = db.uno('SELECT MAX(CAST(SUBSTR(consecutivo, 5) AS INTEGER)) AS n FROM cotizaciones WHERE consecutivo LIKE ?', `${prefijo}-%`);
    return `${prefijo}-` + String((r.n || 0) + 1).padStart(4, '0');
  }

  function evento(cotId, tipo, { version = null, ip = '', navegador = '', detalle = '', actor = '' } = {}) {
    db.ejecutar(
      'INSERT INTO eventos (cotizacion_id, version, tipo, at, ip, navegador, detalle, actor) VALUES (?,?,?,?,?,?,?,?)',
      cotId, version, tipo, ahora(), ip, String(navegador).slice(0, 300), limpiarTexto(detalle, 2000), actor,
    );
  }

  function crear({ cliente_id = null, borrador, origen_id = null, usuario_id = null, es_plantilla = 0, nombre_plantilla = '' } = {}) {
    const b = normalizarBorrador(borrador || borradorVacio());
    if (cliente_id && !db.uno('SELECT id FROM clientes WHERE id = ?', cliente_id)) throw new ErrorNegocio('Cliente no existe');
    return db.tx(() => {
      const t = ahora();
      const { lastInsertRowid } = db.ejecutar(
        `INSERT INTO cotizaciones (consecutivo, cliente_id, borrador, creada_at, actualizada_at, creada_por, origen_id, es_plantilla, nombre_plantilla)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        siguienteConsecutivo(es_plantilla ? 'PLT' : 'COT'), cliente_id, JSON.stringify(b), t, t, usuario_id, origen_id, es_plantilla ? 1 : 0, limpiarTexto(nombre_plantilla, 80),
      );
      const id = Number(lastInsertRowid);
      evento(id, 'creada', { actor: 'dueno', detalle: origen_id ? `Duplicada de ${db.uno('SELECT consecutivo FROM cotizaciones WHERE id = ?', origen_id)?.consecutivo}` : '' });
      return id;
    });
  }

  function obtener(id) {
    const c = db.uno('SELECT * FROM cotizaciones WHERE id = ?', id);
    if (!c) throw new ErrorNegocio('Cotización no encontrada', 404);
    return c;
  }

  // Duplicar: copia el borrador (o la última versión enviada) a una cotización nueva en borrador.
  function duplicar(id, { usuario_id, cliente_id } = {}) {
    const c = obtener(id);
    const b = JSON.parse(c.borrador);
    b.vigencia_dias = b.vigencia_dias || negocio().vigencia_dias;
    return crear({ cliente_id: cliente_id === undefined ? (c.es_plantilla ? null : c.cliente_id) : cliente_id, borrador: b, origen_id: c.id, usuario_id });
  }

  function guardar(id, { borrador, cliente_id }) {
    const c = obtener(id);
    if (c.estado === 'aprobada') throw new ErrorNegocio('La cotización ya fue aprobada y no se puede editar. Duplícala para hacer una nueva.', 409);
    if (c.estado === 'rechazada') throw new ErrorNegocio('La cotización fue rechazada. Duplícala para hacer una nueva.', 409);
    const b = borrador === undefined ? JSON.parse(c.borrador) : normalizarBorrador(borrador);
    const cli = cliente_id === undefined ? c.cliente_id : cliente_id || null;
    if (cli && !db.uno('SELECT id FROM clientes WHERE id = ?', cli)) throw new ErrorNegocio('Cliente no existe');
    db.ejecutar('UPDATE cotizaciones SET borrador = ?, cliente_id = ?, actualizada_at = ? WHERE id = ?', JSON.stringify(b), cli, ahora(), id);
  }

  function marcarPlantilla(id, { es_plantilla, nombre_plantilla }) {
    obtener(id);
    db.ejecutar('UPDATE cotizaciones SET es_plantilla = ?, nombre_plantilla = ? WHERE id = ?', es_plantilla ? 1 : 0, limpiarTexto(nombre_plantilla, 80), id);
  }

  // Hay cambios en el borrador que el cliente todavía no ve.
  function tieneCambiosSinEnviar(c) {
    if (!c.version_actual) return true;
    const v = db.uno('SELECT documento FROM versiones WHERE cotizacion_id = ? AND numero = ?', c.id, c.version_actual);
    const doc = JSON.parse(v.documento);
    const b = JSON.parse(c.borrador);
    const comparable = (x) => canonico({ items: x.items.map(({ catalogo_id, ...r }) => r), desc_global_bp: x.desc_global_bp, condiciones: x.condiciones, notas: x.notas, titulo: x.titulo, cliente_id: x.cliente_id });
    return comparable({ ...b, cliente_id: c.cliente_id }) !== comparable({ ...doc.borrador, cliente_id: doc.cliente.id });
  }

  // ---------- Versiones ----------
  function armarDocumento(c, numero, t) {
    const n = negocio();
    const b = normalizarBorrador(JSON.parse(c.borrador));
    const cli = c.cliente_id ? db.uno('SELECT * FROM clientes WHERE id = ?', c.cliente_id) : null;
    if (!cli) throw new ErrorNegocio('Elige un cliente antes de enviar');
    if (!b.items.length) throw new ErrorNegocio('Agrega al menos un ítem antes de enviar');
    const calculo = calcular({ items: b.items, desc_global_bp: b.desc_global_bp, redondeo: n.redondeo });
    const vigencia = H.finDelDiaMas(t, b.vigencia_dias);
    return {
      tipo: 'cotizacion', formato: 1,
      consecutivo: c.consecutivo, version: numero,
      emitida_at: t, emitida: H.fmtFechaHora(t), vigencia_hasta: vigencia, vigencia: H.fmtFecha(vigencia),
      negocio: {
        nombre: n.nombre, nit: n.nit, telefono: n.telefono, correo: n.correo, direccion: n.direccion, ciudad: n.ciudad,
        color1: n.color1, color2: n.color2, logo: n.logo, redondeo: n.redondeo,
      },
      cliente: { id: cli.id, nombre: cli.nombre, celular: cli.celular, correo: cli.correo, documento: cli.documento, direccion: cli.direccion },
      borrador: { ...b, items: b.items.map(({ catalogo_id, ...r }) => r) },
      lineas: b.items.map(({ catalogo_id, ...it }, i) => ({ ...it, ...calculo.lineas[i] })),
      totales: calculo.totales,
      texto_aceptacion: TEXTO_ACEPTACION,
      leyenda: 'Este documento es una cotización y no es una factura de venta.',
    };
  }

  function enviar(id, { usuario_id, canal = null } = {}) {
    const res = db.tx(() => {
      const c = obtener(id);
      if (c.estado === 'aprobada') throw new ErrorNegocio('La cotización ya fue aprobada', 409);
      if (c.estado === 'rechazada') throw new ErrorNegocio('La cotización fue rechazada. Duplícala para enviar una nueva.', 409);
      if (c.es_plantilla) throw new ErrorNegocio('Una plantilla no se envía: duplícala para crear una cotización.');
      const t = ahora();
      const numero = c.version_actual + 1;
      const documento = armarDocumento(c, numero, t);
      const doc = canonico(documento);
      const h = huella(documento);
      db.ejecutar('INSERT INTO versiones (cotizacion_id, numero, documento, huella, creada_at) VALUES (?,?,?,?,?)', id, numero, doc, h, t);
      const token = c.token || tokenAleatorio();
      db.ejecutar(
        `UPDATE cotizaciones SET estado = 'enviada', version_actual = ?, token = ?, token_expira = ?, vigencia_hasta = ?,
           enviada_at = ?, enviada_primera_at = COALESCE(enviada_primera_at, ?), recordatorio_at = NULL, actualizada_at = ? WHERE id = ?`,
        numero, token, documento.vigencia_hasta + 30 * DIA, documento.vigencia_hasta, t, t, t, id,
      );
      evento(id, 'enviada', { version: numero, actor: 'dueno', detalle: `Huella ${h}` });
      for (const it of JSON.parse(c.borrador).items) if (it.catalogo_id) db.ejecutar('UPDATE catalogo SET usos = usos + 1 WHERE id = ?', it.catalogo_id);
      return { numero, token, huella: h, documento };
    });
    res.enlace = enlace(res.token);
    res.texto = mensajeCotizacion(res.documento, res.enlace);
    return res;
  }

  function mensajeCotizacion(doc, url) {
    const primerNombre = (doc.cliente.nombre || '').split(' ')[0];
    return `Hola ${primerNombre}, ${doc.negocio.nombre} te envía la cotización ${doc.consecutivo}` +
      `${doc.borrador.titulo ? ` (${doc.borrador.titulo})` : ''} por ${fmtPesos(doc.totales.total)}, válida hasta el ${doc.vigencia}. ` +
      `Puedes revisarla y aprobarla aquí: ${url}`;
  }

  // Envía el enlace al cliente desde el sistema (WhatsApp Cloud API o correo).
  async function enviarAlCliente(id, canal) {
    const c = obtener(id);
    if (!c.version_actual) throw new ErrorNegocio('Primero envía la cotización');
    const { doc } = versionActual(c);
    const url = enlace(c.token);
    const texto = mensajeCotizacion(doc, url);
    let destino;
    if (canal === 'whatsapp') destino = normalizarTelefono(doc.cliente.celular);
    else destino = doc.cliente.correo;
    if (!destino) throw new ErrorNegocio(canal === 'whatsapp' ? 'El cliente no tiene celular' : 'El cliente no tiene correo');
    const r = await mensajeria.enviar({
      cotizacion_id: id, canal, destino, tipo: 'cotizacion', texto, asunto: `Cotización ${doc.consecutivo} de ${doc.negocio.nombre}`,
      plantilla: 'cotizacion', parametros: [doc.cliente.nombre, doc.negocio.nombre, doc.consecutivo, url],
    });
    evento(id, 'mensaje', { version: c.version_actual, actor: 'sistema', detalle: `Enlace enviado por ${canal} a ${destino} (${r.estado})` });
    return r;
  }

  function versionActual(c) {
    const v = db.uno('SELECT * FROM versiones WHERE cotizacion_id = ? AND numero = ?', c.id, c.version_actual);
    if (!v) throw new ErrorNegocio('Sin versión enviada', 404);
    return { version: v, doc: JSON.parse(v.documento) };
  }

  function versiones(id) {
    return db.todos('SELECT numero, huella, creada_at FROM versiones WHERE cotizacion_id = ? ORDER BY numero DESC', id);
  }

  function version(id, numero) {
    const v = db.uno('SELECT * FROM versiones WHERE cotizacion_id = ? AND numero = ?', id, numero);
    if (!v) throw new ErrorNegocio('Versión no encontrada', 404);
    return { ...v, doc: JSON.parse(v.documento), integra: sha256(v.documento) === v.huella };
  }

  function nuevoEnlace(id) {
    const c = obtener(id);
    if (!c.token) throw new ErrorNegocio('La cotización no se ha enviado');
    const token = tokenAleatorio();
    db.ejecutar('UPDATE cotizaciones SET token = ? WHERE id = ?', token, id);
    evento(id, 'enlace_renovado', { actor: 'dueno', detalle: 'El enlace anterior dejó de funcionar' });
    return enlace(token);
  }

  // ---------- Lado público ----------
  function porToken(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new ErrorNegocio('Enlace no válido', 404);
    const c = db.uno('SELECT * FROM cotizaciones WHERE token = ?', token);
    if (!c || !c.version_actual) throw new ErrorNegocio('Enlace no válido', 404);
    if (c.token_expira && ahora() > c.token_expira) throw new ErrorNegocio('Este enlace venció. Pide al negocio uno nuevo.', 410);
    vencerSiCorresponde(c);
    return obtener(c.id);
  }

  function vencerSiCorresponde(c) {
    if (ESTADOS_ABIERTOS.includes(c.estado) && c.vigencia_hasta && ahora() > c.vigencia_hasta) {
      db.ejecutar("UPDATE cotizaciones SET estado = 'vencida' WHERE id = ? AND estado IN ('enviada','vista','cambios')", c.id);
      evento(c.id, 'vencida', { version: c.version_actual, actor: 'sistema' });
      mensajeria.avisarDueno(c.id, `${c.consecutivo} venció sin respuesta.`);
      return true;
    }
    return false;
  }

  function registrarVista(c, { ip, navegador }) {
    const yaVista = db.uno("SELECT 1 AS x FROM eventos WHERE cotizacion_id = ? AND tipo = 'vista' AND version = ?", c.id, c.version_actual);
    evento(c.id, 'vista', { version: c.version_actual, ip, navegador, actor: 'cliente' });
    if (c.estado === 'enviada') db.ejecutar("UPDATE cotizaciones SET estado = 'vista' WHERE id = ? AND estado = 'enviada'", c.id);
    if (!yaVista) {
      const cli = c.cliente_id ? db.uno('SELECT nombre FROM clientes WHERE id = ?', c.cliente_id) : null;
      mensajeria.avisarDueno(c.id, `${cli?.nombre || 'El cliente'} abrió la cotización ${c.consecutivo} (v${c.version_actual}).`);
    }
  }

  function exigirAbierta(c) {
    if (c.estado === 'aprobada') throw new ErrorNegocio('Esta cotización ya fue aprobada', 409);
    if (c.estado === 'rechazada') throw new ErrorNegocio('Esta cotización fue rechazada', 409);
    if (c.estado === 'vencida') throw new ErrorNegocio('Esta cotización venció. Pide al negocio una actualizada.', 409);
    if (!ESTADOS_ABIERTOS.includes(c.estado)) throw new ErrorNegocio('Esta cotización no está disponible', 409);
  }

  async function pedirCodigo(c, { nombre, contacto, acepta, version: versionVista }, { ip }) {
    exigirAbierta(c);
    nombre = limpiarTexto(nombre, 120);
    if (nombre.length < 3) throw new ErrorNegocio('Escribe tu nombre completo');
    if (!acepta) throw new ErrorNegocio('Debes aceptar las condiciones y el tratamiento de datos');
    if (Number(versionVista) !== c.version_actual) throw new ErrorNegocio('La cotización cambió. Recarga la página para ver la versión nueva.', 409);
    let canal, destino;
    if (esCorreo(contacto)) { canal = 'correo'; destino = String(contacto).trim().toLowerCase(); }
    else {
      destino = normalizarTelefono(contacto);
      if (destino.length < 10 || destino.length > 15) throw new ErrorNegocio('Escribe un celular válido o un correo');
      canal = 'whatsapp';
    }
    const t = ahora();
    const recientes = db.uno('SELECT COUNT(*) AS n FROM codigos WHERE cotizacion_id = ? AND creado > ?', c.id, t - 15 * 60e3).n;
    if (recientes >= 3) throw new ErrorNegocio('Ya pediste 3 códigos. Espera 15 minutos e intenta de nuevo.', 429);

    const codigo = codigoNumerico();
    const { lastInsertRowid } = db.ejecutar(
      'INSERT INTO codigos (cotizacion_id, version, nombre, destino, canal, codigo_hash, expira, creado, ip) VALUES (?,?,?,?,?,?,?,?,?)',
      c.id, c.version_actual, nombre, destino, canal, sha256(`${c.id}:${codigo}`), t + 10 * 60e3, t, ip,
    );
    const neg = negocio();
    const texto = `${codigo} es tu código para aprobar la cotización ${c.consecutivo} de ${neg.nombre}. Vence en 10 minutos. No lo compartas.`;
    await mensajeria.enviar({
      cotizacion_id: c.id, canal, destino, tipo: 'codigo', texto, asunto: `Código para aprobar ${c.consecutivo}`,
      plantilla: 'codigo', parametros: [codigo],
    });
    evento(c.id, 'codigo_enviado', { version: c.version_actual, ip, actor: 'cliente', detalle: `${canal} ${ocultar(destino)}` });
    return { codigo_id: Number(lastInsertRowid), canal, destino: ocultar(destino), ...(modoDemo ? { codigo_demo: codigo } : {}) };
  }

  const ocultar = (d) => (d.includes('@') ? d.replace(/^(.{2}).*(@.*)$/, '$1•••$2') : d.replace(/^(\d+)(\d{4})$/, (_, a, b) => '•'.repeat(Math.max(0, a.length - 2)) + a.slice(-2) + b));

  async function aprobar(c, { codigo_id, codigo }, { ip, navegador }) {
    exigirAbierta(c);
    const t = ahora();
    const resultado = db.tx(() => {
      const k = db.uno('SELECT * FROM codigos WHERE id = ? AND cotizacion_id = ?', codigo_id, c.id);
      if (!k || k.usado_at) throw new ErrorNegocio('Código no válido. Pide uno nuevo.');
      if (k.version !== c.version_actual) throw new ErrorNegocio('La cotización cambió después de pedir el código. Recarga y pide uno nuevo.', 409);
      if (t > k.expira) throw new ErrorNegocio('El código venció. Pide uno nuevo.');
      if (k.intentos >= 5) throw new ErrorNegocio('Demasiados intentos. Pide un código nuevo.', 429);
      db.ejecutar('UPDATE codigos SET intentos = intentos + 1 WHERE id = ?', k.id);
      if (sha256(`${c.id}:${String(codigo || '').trim()}`) !== k.codigo_hash) return { error: `Código incorrecto. Te quedan ${4 - k.intentos} intentos.` };
      const v = db.uno('SELECT huella, documento FROM versiones WHERE cotizacion_id = ? AND numero = ?', c.id, k.version);
      if (sha256(v.documento) !== v.huella) throw new ErrorNegocio('La versión no coincide con su huella', 500);
      db.ejecutar('UPDATE codigos SET usado_at = ? WHERE id = ?', t, k.id);
      db.ejecutar(
        'INSERT INTO aprobaciones (cotizacion_id, version, huella, nombre, contacto, canal, at, ip, navegador, codigo_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
        c.id, k.version, v.huella, k.nombre, k.destino, k.canal, t, ip, String(navegador).slice(0, 300), k.id,
      );
      db.ejecutar("UPDATE cotizaciones SET estado = 'aprobada', actualizada_at = ? WHERE id = ?", t, c.id);
      evento(c.id, 'aprobada', { version: k.version, ip, navegador, actor: 'cliente', detalle: `${k.nombre} · ${k.canal} ${k.destino} · huella ${v.huella}` });
      return { ok: true, nombre: k.nombre, version: k.version, huella: v.huella };
    });
    if (resultado.error) throw new ErrorNegocio(resultado.error);
    const { doc } = versionActual(c);
    mensajeria.avisarDueno(c.id, `${c.consecutivo} aprobada por ${resultado.nombre}, ${fmtPesos(doc.totales.total)} (v${resultado.version}).`);
    return resultado;
  }

  function aprobacion(id) {
    return db.uno('SELECT * FROM aprobaciones WHERE cotizacion_id = ?', id) || null;
  }

  function pedirCambios(c, { nombre, comentario }, { ip, navegador }) {
    exigirAbierta(c);
    comentario = limpiarTexto(comentario, 2000);
    if (comentario.length < 3) throw new ErrorNegocio('Cuéntanos qué quieres cambiar');
    db.ejecutar("UPDATE cotizaciones SET estado = 'cambios', actualizada_at = ? WHERE id = ?", ahora(), c.id);
    evento(c.id, 'cambios', { version: c.version_actual, ip, navegador, actor: 'cliente', detalle: `${limpiarTexto(nombre, 120) || 'Cliente'}: ${comentario}` });
    mensajeria.avisarDueno(c.id, `${limpiarTexto(nombre, 120) || 'El cliente'} pidió cambios en ${c.consecutivo}: "${comentario.slice(0, 200)}"`);
  }

  function rechazar(c, { nombre, motivo }, { ip, navegador }) {
    exigirAbierta(c);
    motivo = limpiarTexto(motivo, 1000);
    db.ejecutar("UPDATE cotizaciones SET estado = 'rechazada', actualizada_at = ? WHERE id = ?", ahora(), c.id);
    evento(c.id, 'rechazada', { version: c.version_actual, ip, navegador, actor: 'cliente', detalle: `${limpiarTexto(nombre, 120) || 'Cliente'}: ${motivo || 'sin motivo'}` });
    mensajeria.avisarDueno(c.id, `${c.consecutivo} rechazada${motivo ? `: "${motivo.slice(0, 200)}"` : '.'}`);
  }

  function noContactar(c) {
    if (c.cliente_id) db.ejecutar('UPDATE clientes SET no_contactar = 1 WHERE id = ?', c.cliente_id);
    evento(c.id, 'no_contactar', { actor: 'cliente', detalle: 'El cliente pidió no recibir recordatorios' });
  }

  // ---------- Tareas automáticas ----------
  async function ejecutarTareas() {
    const t = ahora();
    const horas = Number(process.env.RECORDATORIO_HORAS || 72);
    const resumen = { vencidas: 0, recordatorios: 0 };

    for (const c of db.todos("SELECT * FROM cotizaciones WHERE estado IN ('enviada','vista','cambios') AND vigencia_hasta < ?", t)) {
      if (vencerSiCorresponde(c)) resumen.vencidas++;
    }

    if (!H.enHorarioPermitido(t)) return resumen; // Ley 2300: fuera de horario no se escribe al cliente.
    const pendientes = db.todos(
      `SELECT c.*, cl.nombre AS cli_nombre, cl.celular, cl.correo AS cli_correo, cl.no_contactar
         FROM cotizaciones c JOIN clientes cl ON cl.id = c.cliente_id
        WHERE c.estado IN ('enviada','vista') AND c.recordatorio_at IS NULL AND c.enviada_at <= ?`,
      t - horas * 3600e3,
    );
    for (const c of pendientes) {
      if (c.no_contactar) continue;
      db.ejecutar('UPDATE cotizaciones SET recordatorio_at = ? WHERE id = ?', t, c.id);
      const url = enlace(c.token);
      const texto = `Hola ${c.cli_nombre.split(' ')[0]}, te recordamos la cotización ${c.consecutivo} de ${negocio().nombre}, ` +
        `válida hasta el ${H.fmtFecha(c.vigencia_hasta)}. Puedes aprobarla o pedir cambios aquí: ${url} ` +
        `Si no quieres más recordatorios: ${url}/no-contactar`;
      const celular = normalizarTelefono(c.celular);
      const canal = celular ? 'whatsapp' : 'correo';
      const destino = celular || c.cli_correo;
      if (!destino) continue;
      await mensajeria.enviar({
        cotizacion_id: c.id, canal, destino, tipo: 'recordatorio', texto, asunto: `Recordatorio: cotización ${c.consecutivo}`,
        plantilla: 'recordatorio', parametros: [c.cli_nombre, c.consecutivo, url],
      });
      evento(c.id, 'recordatorio', { version: c.version_actual, actor: 'sistema', detalle: `${canal} ${destino}` });
      resumen.recordatorios++;
    }
    return resumen;
  }

  // ---------- Métricas ----------
  function metricas() {
    const t = ahora();
    const p = H.partesBogota(t);
    const inicioMes = H.msBogota(p.anio, p.mes, 1);
    const q = (sql, ...a) => db.uno(sql, ...a);
    const enviadas = q('SELECT COUNT(*) AS n FROM cotizaciones WHERE enviada_primera_at >= ? AND es_plantilla = 0', inicioMes).n;
    const aprobadas = q("SELECT COUNT(*) AS n FROM cotizaciones WHERE enviada_primera_at >= ? AND estado = 'aprobada'", inicioMes).n;
    const montoAprobado = db.todos(
      `SELECT v.documento FROM cotizaciones c JOIN versiones v ON v.cotizacion_id = c.id AND v.numero = c.version_actual
        WHERE c.estado = 'aprobada' AND c.enviada_primera_at >= ?`, inicioMes,
    ).reduce((s, r) => s + JSON.parse(r.documento).totales.total, 0);
    const sinRespuesta = q("SELECT COUNT(*) AS n FROM cotizaciones WHERE estado IN ('enviada','vista') AND enviada_at <= ?", t - 3 * DIA).n;
    const tiempos = db.todos(
      `SELECT (e.at - c.creada_at) / 60000.0 AS min FROM cotizaciones c
         JOIN eventos e ON e.cotizacion_id = c.id AND e.tipo = 'enviada' AND e.version = 1
        WHERE c.es_plantilla = 0 ORDER BY e.at DESC LIMIT 50`,
    ).map((r) => r.min).sort((a, b) => a - b);
    const mediana = tiempos.length ? tiempos[Math.floor(tiempos.length / 2)] : null;
    const porEstado = Object.fromEntries(db.todos('SELECT estado, COUNT(*) AS n FROM cotizaciones WHERE es_plantilla = 0 GROUP BY estado').map((r) => [r.estado, r.n]));
    return {
      mes: `${p.anio}-${String(p.mes).padStart(2, '0')}`,
      enviadas_mes: enviadas, aprobadas_mes: aprobadas,
      porcentaje_aprobado: enviadas ? Math.round((aprobadas / enviadas) * 100) : null,
      monto_aprobado_mes: montoAprobado,
      sin_respuesta_3_dias: sinRespuesta,
      minutos_para_emitir: mediana === null ? null : Math.round(mediana * 10) / 10,
      por_estado: porEstado,
    };
  }

  return {
    negocio, borradorVacio, normalizarBorrador, crear, obtener, duplicar, guardar, marcarPlantilla, tieneCambiosSinEnviar,
    enviar, enviarAlCliente, mensajeCotizacion, versionActual, versiones, version, nuevoEnlace, enlace,
    porToken, registrarVista, pedirCodigo, aprobar, aprobacion, pedirCambios, rechazar, noContactar,
    ejecutarTareas, metricas, evento,
  };
}

module.exports = { crearServicio, ErrorNegocio, ETIQUETA_ESTADO, TEXTO_ACEPTACION, normalizarTelefono, esCorreo };
