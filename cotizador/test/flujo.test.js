// Flujo completo por HTTP: login, catálogo, cotización, envío, vista, código, aprobación y evidencia.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearApp } = require('../src/app');
const { abrir } = require('../src/db');
const { huella } = require('../src/huella');
const H = require('../src/horarios');

async function arrancar(ahora) {
  const db = abrir(':memory:');
  const { app, servicio } = crearApp({ db, baseUrl: 'http://prueba.local', modoMensajeria: 'demo', ahora, semilla: true });
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  let cookie = '';
  const pedir = async (metodo, ruta, datos, { conSesion = true } = {}) => {
    const r = await fetch(base + ruta, {
      method: metodo, headers: { 'Content-Type': 'application/json', ...(conSesion && cookie ? { Cookie: cookie } : {}) },
      body: datos ? JSON.stringify(datos) : undefined,
    });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const tipo = r.headers.get('content-type') || '';
    return { status: r.status, cuerpo: tipo.includes('json') ? await r.json() : await r.text(), tipo };
  };
  return { db, servicio, pedir, cerrar: () => srv.close() };
}

test('flujo de aprobación con evidencia', async () => {
  let reloj = H.msBogota(2026, 10, 26, 9); // lunes 9:00
  const s = await arrancar(() => reloj);
  try {
    assert.equal((await s.pedir('POST', '/api/login', { correo: 'demo@cotiza.local', clave: 'mala' })).status, 401);
    assert.equal((await s.pedir('POST', '/api/login', { correo: 'demo@cotiza.local', clave: 'demo1234' })).status, 200);

    const cat = (await s.pedir('GET', '/api/catalogo')).cuerpo;
    const mt = cat.find((c) => c.codigo === 'MT-12');
    const { id } = (await s.pedir('POST', '/api/cotizaciones', { cliente_id: 1 })).cuerpo;
    const borrador = { titulo: 'Prueba', items: [{ catalogo_id: mt.id, nombre: mt.nombre, unidad: mt.unidad, tipo: mt.tipo, cantidad_mil: 3000, precio: mt.precio, desc_bp: 0, iva: 19 }], desc_global_bp: 0, vigencia_dias: 10, condiciones: 'Pago contra entrega', notas: '' };
    let r = await s.pedir('PUT', `/api/cotizaciones/${id}`, { borrador });
    assert.equal(r.cuerpo.calculo.totales.total, 535500); // 3 × 150.000 + 19 %

    r = await s.pedir('POST', `/api/cotizaciones/${id}/enviar`);
    assert.equal(r.status, 200);
    const token = r.cuerpo.enlace.split('/c/')[1];
    assert.equal(token.length, 32);
    const huellaV1 = r.cuerpo.huella;

    // El cliente abre el enlace (sin sesión): queda "vista" y se avisa al dueño.
    r = await s.pedir('GET', `/c/${token}`, null, { conSesion: false });
    assert.equal(r.status, 200);
    assert.match(r.cuerpo, /Aprobar/);
    assert.equal(s.db.uno('SELECT estado FROM cotizaciones WHERE id = ?', id).estado, 'vista');
    assert.ok(s.db.uno("SELECT 1 AS x FROM mensajes WHERE tipo = 'aviso_dueno' AND texto LIKE '%abrió%'"));

    // El documento publicado coincide con su huella.
    r = await s.pedir('GET', `/c/${token}/version.json`, null, { conSesion: false });
    assert.equal(huella(r.cuerpo), huellaV1); // cualquiera puede recalcularla

    // El cliente pide cambios; el dueño edita y envía v2.
    r = await s.pedir('POST', `/c/${token}/cambios`, { nombre: 'Ana', comentario: 'Solo 2 equipos' }, { conSesion: false });
    assert.equal(r.status, 200);
    borrador.items[0].cantidad_mil = 2000;
    await s.pedir('PUT', `/api/cotizaciones/${id}`, { borrador });
    r = await s.pedir('POST', `/api/cotizaciones/${id}/enviar`);
    assert.equal(r.cuerpo.numero, 2);
    assert.notEqual(r.cuerpo.huella, huellaV1);
    const huellaV2 = r.cuerpo.huella;

    // Un código pedido para v1 no sirve; se pide para v2.
    r = await s.pedir('POST', `/c/${token}/codigo`, { nombre: 'Ana María Pérez', contacto: '300 123 4567', acepta: true, version: 1 }, { conSesion: false });
    assert.equal(r.status, 409);
    r = await s.pedir('POST', `/c/${token}/codigo`, { nombre: 'Ana María Pérez', contacto: '300 123 4567', acepta: false, version: 2 }, { conSesion: false });
    assert.equal(r.status, 400);
    r = await s.pedir('POST', `/c/${token}/codigo`, { nombre: 'Ana María Pérez', contacto: '300 123 4567', acepta: true, version: 2 }, { conSesion: false });
    assert.equal(r.status, 200);
    const { codigo_id, codigo_demo } = r.cuerpo;
    assert.match(codigo_demo, /^\d{6}$/);
    assert.ok(s.db.uno("SELECT 1 AS x FROM mensajes WHERE tipo = 'codigo' AND destino = '573001234567'"));

    // Código incorrecto, luego correcto.
    const malo = codigo_demo === '000000' ? '111111' : '000000';
    r = await s.pedir('POST', `/c/${token}/aprobar`, { codigo_id, codigo: malo }, { conSesion: false });
    assert.equal(r.status, 400);
    reloj += 60e3;
    r = await s.pedir('POST', `/c/${token}/aprobar`, { codigo_id, codigo: codigo_demo }, { conSesion: false });
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.huella, huellaV2);

    const ap = s.db.uno('SELECT * FROM aprobaciones WHERE cotizacion_id = ?', id);
    assert.equal(ap.nombre, 'Ana María Pérez');
    assert.equal(ap.contacto, '573001234567');
    assert.equal(ap.version, 2);
    assert.equal(ap.huella, huellaV2);
    assert.equal(ap.at, reloj);

    // Lo aprobado no se edita, ni por la API ni directamente en la base.
    r = await s.pedir('PUT', `/api/cotizaciones/${id}`, { borrador });
    assert.equal(r.status, 409);
    assert.equal((await s.pedir('POST', `/api/cotizaciones/${id}/enviar`)).status, 409);
    assert.throws(() => s.db.ejecutar("UPDATE versiones SET documento = '{}' WHERE cotizacion_id = ?", id), /no se pueden modificar/);
    assert.throws(() => s.db.ejecutar('DELETE FROM aprobaciones WHERE cotizacion_id = ?', id), /no se pueden borrar/);
    assert.throws(() => s.db.ejecutar("UPDATE cotizaciones SET borrador = '{}' WHERE id = ?", id), /aprobada/);
    assert.equal((await s.pedir('POST', `/c/${token}/codigo`, { nombre: 'Otra', contacto: '3000000000', acepta: true, version: 2 }, { conSesion: false })).status, 409);

    // PDF y verificación.
    const pdf = await s.pedir('GET', `/c/${token}/pdf`, null, { conSesion: false });
    assert.equal(pdf.tipo, 'application/pdf');
    r = await s.pedir('GET', `/verificar?h=${huellaV2}`, null, { conSesion: false });
    assert.match(r.cuerpo, /Documento auténtico/);
    assert.match(r.cuerpo, /Aprobada/);

    // Métricas y exportación.
    const m = (await s.pedir('GET', '/api/metricas')).cuerpo;
    assert.ok(m.aprobadas_mes >= 1);
    const csv = await s.pedir('GET', '/api/exportar/aprobadas.csv');
    assert.match(csv.cuerpo, /consecutivo,version/);
  } finally { s.cerrar(); }
});

test('recordatorio a los 3 días solo en horario permitido, y vencimiento', async () => {
  let reloj = H.msBogota(2026, 10, 28, 18, 30); // miércoles 18:30
  const s = await arrancar(() => reloj);
  try {
    const cot = s.db.uno("SELECT * FROM cotizaciones WHERE consecutivo = 'COT-0001'"); // enviada por la semilla con este reloj

    reloj += 71 * 3600e3; // sábado 17:30: menos de 72 h
    assert.equal((await s.servicio.ejecutarTareas()).recordatorios, 0);
    reloj += 1 * 3600e3; // sábado 18:30: 72 h, pero fuera de horario (sábado hasta 15:00)
    assert.equal((await s.servicio.ejecutarTareas()).recordatorios, 0);
    reloj = H.msBogota(2026, 11, 2, 10); // lunes festivo
    assert.equal((await s.servicio.ejecutarTareas()).recordatorios, 0);
    reloj = H.msBogota(2026, 11, 3, 7, 5); // martes 7:05
    assert.equal((await s.servicio.ejecutarTareas()).recordatorios, 1);
    assert.equal((await s.servicio.ejecutarTareas()).recordatorios, 0, 'solo un recordatorio');
    const msj = s.db.uno("SELECT * FROM mensajes WHERE tipo = 'recordatorio'");
    assert.match(msj.texto, /no-contactar/);

    reloj = H.msBogota(2026, 12, 20, 10); // después de la vigencia de 15 días
    assert.equal((await s.servicio.ejecutarTareas()).vencidas, 1);
    assert.equal(s.db.uno('SELECT estado FROM cotizaciones WHERE id = ?', cot.id).estado, 'vencida');
  } finally { s.cerrar(); }
});

test('enlaces inválidos y límite de códigos', async () => {
  const s = await arrancar(() => H.msBogota(2026, 10, 26, 9));
  try {
    assert.equal((await s.pedir('GET', '/c/abc')).status, 404);
    assert.equal((await s.pedir('GET', '/c/' + 'x'.repeat(32))).status, 404);
    const token = s.db.uno("SELECT token FROM cotizaciones WHERE consecutivo = 'COT-0001'").token;
    const datos = { nombre: 'Ana María', contacto: 'ana@ejemplo.co', acepta: true, version: 1 };
    for (let i = 0; i < 3; i++) assert.equal((await s.pedir('POST', `/c/${token}/codigo`, datos)).status, 200);
    assert.equal((await s.pedir('POST', `/c/${token}/codigo`, datos)).status, 429);
    assert.equal((await s.pedir('GET', '/api/cotizaciones')).status, 401);
  } finally { s.cerrar(); }
});
