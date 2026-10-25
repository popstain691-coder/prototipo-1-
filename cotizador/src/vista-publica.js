// Página pública que ve el cliente final (sin cuenta). Se arma desde la versión congelada.
const { fmtPesos, fmtCantidad, fmtPorcentaje } = require('./calc');
const { fmtFechaHora, fmtFecha } = require('./horarios');
const fmtContacto = (c) => (/^57\d{10}$/.test(c || '') ? `+57 ${c.slice(2, 5)} ${c.slice(5, 8)} ${c.slice(8)}` : c);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const color = (c, d) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : d);
const parrafos = (t) => esc(t).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

function marco({ titulo, c1 = '#0f6cbd', c2 = '#e8f1fb', cuerpo, script = '' }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow"><title>${esc(titulo)}</title>
<style>
:root{--c1:${c1};--c2:${c2};--tx:#14171a;--tx2:#5b6470;--bd:#e3e6ea;--bg:#f4f5f7;--ok:#1a7f37;--warn:#9a6700;--bad:#b42318}
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--tx);background:var(--bg)}
.wrap{max-width:760px;margin:0 auto;padding:0 16px 140px}
header.marca{background:var(--c1);color:#fff;padding:20px 16px}
header.marca .in{max-width:760px;margin:0 auto;display:flex;gap:14px;align-items:center}
header.marca img{max-height:52px;max-width:120px;background:#fff;border-radius:8px;padding:4px}
header.marca h1{font-size:18px;margin:0}header.marca small{opacity:.85}
.card{background:#fff;border:1px solid var(--bd);border-radius:14px;padding:16px;margin-top:14px}
.fila{display:flex;justify-content:space-between;gap:12px}.muted{color:var(--tx2)}.small{font-size:13px}
.k{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--tx2)}
.item{padding:12px 0;border-top:1px solid var(--bd)}.item:first-child{border-top:0}
.item .n{font-weight:600}.item .v{font-weight:700;white-space:nowrap}
.tot .fila{padding:4px 0}.tot .gran{font-size:20px;font-weight:800;border-top:2px solid var(--c1);margin-top:8px;padding-top:10px}
.banner{border-radius:12px;padding:12px 14px;margin-top:14px;font-weight:600}
.b-ok{background:#dafbe1;color:var(--ok)}.b-warn{background:#fff8c5;color:var(--warn)}.b-bad{background:#ffebe9;color:var(--bad)}.b-info{background:var(--c2);color:var(--tx)}
.huella{font-family:ui-monospace,Menlo,monospace;font-size:12px;word-break:break-all}
.acciones{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--bd);padding:12px 16px calc(12px + env(safe-area-inset-bottom))}
.acciones .in{max-width:760px;margin:0 auto;display:flex;gap:10px}
button,.btn{font:inherit;border-radius:12px;padding:13px 16px;border:1px solid var(--bd);background:#fff;color:var(--tx);cursor:pointer;text-align:center;text-decoration:none;display:inline-block}
.prim{background:var(--c1);border-color:var(--c1);color:#fff;font-weight:700;flex:2}.sec{flex:1}
button:disabled{opacity:.6}
.hoja{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:flex-end;justify-content:center;z-index:10}
.hoja.abierta{display:flex}.hoja .panel{background:#fff;width:100%;max-width:560px;border-radius:18px 18px 0 0;padding:20px 16px calc(20px + env(safe-area-inset-bottom));max-height:92vh;overflow:auto}
@media(min-width:620px){.hoja{align-items:center}.hoja .panel{border-radius:18px}}
label{display:block;font-weight:600;margin:12px 0 6px}input,textarea{width:100%;font:inherit;padding:12px;border:1px solid #c9ced6;border-radius:10px}
input.codigo{font-size:26px;letter-spacing:.4em;text-align:center}
.check{display:flex;gap:10px;align-items:flex-start;font-weight:400}.check input{width:auto;margin-top:4px}
.err{color:var(--bad);margin-top:10px;min-height:1em}.demo{background:#fff3cd;border:1px dashed #c69500;padding:10px;border-radius:10px;margin-top:10px}
a{color:var(--c1)}h2{font-size:16px;margin:0 0 8px}.cond p{margin:.4em 0}
</style></head><body>${cuerpo}${script}</body></html>`;
}

function paginaError(mensaje, status = 404) {
  return marco({
    titulo: 'Cotización',
    cuerpo: `<div class="wrap"><div class="card" style="margin-top:40px;text-align:center"><h2>${status === 410 ? 'Enlace vencido' : 'No encontramos esta cotización'}</h2><p class="muted">${esc(mensaje)}</p></div></div>`,
  });
}

function bloqueDocumento(doc, huella, base) {
  const t = doc.totales;
  const items = doc.lineas.map((l) => {
    const descuento = l.desc_item + l.desc_global;
    return `<div class="item"><div class="fila"><div><div class="n">${esc(l.nombre)}</div>
      ${l.descripcion ? `<div class="small muted">${esc(l.descripcion)}</div>` : ''}
      <div class="small muted">${fmtCantidad(l.cantidad_mil)} ${esc(l.unidad)} × ${fmtPesos(l.precio)}${descuento ? ` · desc. ${fmtPesos(descuento)}` : ''} · IVA&nbsp;${l.iva}&nbsp;%</div></div>
      <div class="v">${fmtPesos(l.neto)}</div></div></div>`;
  }).join('');
  const filaT = (k, v) => `<div class="fila"><span class="muted">${k}</span><span>${v}</span></div>`;
  const ivas = Object.entries(t.iva_por_tarifa).filter(([k]) => Number(k) > 0).map(([k, v]) => filaT(`IVA ${k} %`, fmtPesos(v.iva))).join('');
  return `
  <div class="card"><div class="fila"><div><div class="k">Cotización</div><div style="font-size:20px;font-weight:800">${esc(doc.consecutivo)}</div>
    <div class="small muted">Versión ${doc.version} · emitida el ${esc(fmtFecha(doc.emitida_at))}</div></div>
    <div style="text-align:right"><div class="k">Válida hasta</div><div style="font-weight:700">${esc(doc.vigencia)}</div></div></div>
    ${doc.borrador.titulo ? `<div style="margin-top:10px;font-weight:600">${esc(doc.borrador.titulo)}</div>` : ''}
    <div style="margin-top:12px" class="small"><span class="k">Para</span><br><b>${esc(doc.cliente.nombre)}</b>${doc.cliente.direccion ? `<br><span class="muted">${esc(doc.cliente.direccion)}</span>` : ''}</div>
  </div>
  <div class="card">${items}</div>
  <div class="card tot">
    ${filaT('Subtotal', fmtPesos(t.subtotal))}
    ${t.descuento_items ? filaT('Descuentos por ítem', '-' + fmtPesos(t.descuento_items)) : ''}
    ${t.descuento_global ? filaT(`Descuento global (${fmtPorcentaje(doc.borrador.desc_global_bp)})`, '-' + fmtPesos(t.descuento_global)) : ''}
    ${ivas}${t.ajuste ? filaT('Ajuste al peso', fmtPesos(t.ajuste)) : ''}
    <div class="fila gran"><span>Total</span><span>${fmtPesos(t.total)}</span></div>
  </div>
  ${doc.borrador.condiciones ? `<div class="card cond"><h2>Condiciones</h2>${parrafos(doc.borrador.condiciones)}</div>` : ''}
  ${doc.borrador.notas ? `<div class="card cond"><h2>Notas</h2>${parrafos(doc.borrador.notas)}</div>` : ''}
  <div class="card small"><div class="k">Huella SHA-256 de esta versión</div><div class="huella">${huella}</div>
    <div class="muted" style="margin-top:8px">${esc(doc.leyenda)} Cualquier cambio en el documento cambia esta huella.
    <a href="${base}/verificar?h=${huella}">Verificar</a> · <a href="${base}/pdf">Descargar PDF</a></div></div>`;
}

function constancia(ap) {
  return `<div class="card" style="border-color:var(--ok)"><h2 style="color:var(--ok)">Constancia de aprobación</h2>
  <div class="small">
  <div><span class="muted">Aprobó:</span> <b>${esc(ap.nombre)}</b></div>
  <div><span class="muted">Código verificado por ${ap.canal === 'correo' ? 'correo' : 'WhatsApp'}:</span> ${esc(fmtContacto(ap.contacto))}</div>
  <div><span class="muted">Fecha y hora:</span> ${esc(fmtFechaHora(ap.at))}</div>
  <div><span class="muted">Versión aprobada:</span> ${ap.version}</div>
  <div class="huella" style="margin-top:6px">${ap.huella}</div></div></div>`;
}

function paginaCotizacion({ cot, doc, huella, aprobacion, token, modoDemo, politicaDatos, estadoTexto }) {
  const base = `/c/${encodeURIComponent(token)}`;
  const abierta = ['enviada', 'vista', 'cambios'].includes(cot.estado);
  const n = doc.negocio;
  let banner = '';
  if (cot.estado === 'aprobada') banner = `<div class="banner b-ok">Aprobada. ¡Gracias! ${esc(n.nombre)} ya recibió el aviso.</div>`;
  else if (cot.estado === 'rechazada') banner = `<div class="banner b-bad">Indicaste que no te interesa esta cotización.</div>`;
  else if (cot.estado === 'vencida') banner = `<div class="banner b-warn">Esta cotización venció el ${esc(doc.vigencia)}. Pide a ${esc(n.nombre)} una actualizada.</div>`;
  else if (cot.estado === 'cambios') banner = `<div class="banner b-info">Pediste cambios. ${esc(n.nombre)} te enviará una versión nueva. Si cambias de opinión, puedes aprobar esta.</div>`;

  const cuerpo = `
<header class="marca"><div class="in">${/^data:image\//.test(n.logo || '') ? `<img src="${esc(n.logo)}" alt="">` : ''}
  <div><h1>${esc(n.nombre)}</h1><small>${esc([n.nit && 'NIT ' + n.nit, n.telefono, n.ciudad].filter(Boolean).join(' · '))}</small></div></div></header>
<div class="wrap">${banner}${aprobacion ? constancia(aprobacion) : ''}${bloqueDocumento(doc, huella, base)}</div>
${abierta ? `<div class="acciones"><div class="in"><button class="sec" data-abrir="h-cambios">Pedir cambios</button><button class="prim" data-abrir="h-aprobar">Aprobar</button></div></div>` :
    `<div class="acciones"><div class="in"><a class="btn prim" href="${base}/pdf">Descargar PDF</a></div></div>`}

<div class="hoja" id="h-aprobar"><div class="panel">
  <div id="paso1"><h2>Aprobar cotización ${esc(doc.consecutivo)}</h2>
    <div class="muted small">Total ${fmtPesos(doc.totales.total)} · versión ${doc.version}. Te enviaremos un código de un solo uso para confirmar que eres tú.</div>
    <label for="a-nombre">Nombre completo</label><input id="a-nombre" autocomplete="name" value="${esc(doc.cliente.nombre)}">
    <label for="a-contacto">Celular (WhatsApp) o correo</label><input id="a-contacto" inputmode="email" autocomplete="tel" value="${esc(doc.cliente.celular || doc.cliente.correo)}">
    <label class="check"><input type="checkbox" id="a-acepta"><span class="small">${esc(doc.texto_aceptacion)}${politicaDatos ? ` <a href="${esc(politicaDatos)}" target="_blank" rel="noopener">Política de datos</a>` : ''}</span></label>
    <div class="err" id="a-err"></div>
    <div style="display:flex;gap:10px;margin-top:8px"><button class="sec" data-cerrar>Cancelar</button><button class="prim" id="a-pedir">Enviar código</button></div>
  </div>
  <div id="paso2" hidden><h2>Escribe el código</h2>
    <div class="muted small" id="a-destino"></div>
    <div class="demo" id="a-demo" hidden></div>
    <label for="a-codigo">Código de 6 dígitos</label><input id="a-codigo" class="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
    <div class="err" id="a-err2"></div>
    <div style="display:flex;gap:10px;margin-top:8px"><button class="sec" id="a-reenviar">Pedir otro</button><button class="prim" id="a-confirmar">Aprobar</button></div>
  </div>
</div></div>

<div class="hoja" id="h-cambios"><div class="panel"><h2>Pedir cambios</h2>
  <div class="muted small">Cuéntale a ${esc(n.nombre)} qué quieres ajustar. Te enviarán una versión nueva.</div>
  <label for="c-nombre">Tu nombre</label><input id="c-nombre" value="${esc(doc.cliente.nombre)}">
  <label for="c-texto">¿Qué quieres cambiar?</label><textarea id="c-texto" rows="4" placeholder="Ej.: quitar el desplazamiento, agregar una unidad más…"></textarea>
  <div class="err" id="c-err"></div>
  <div style="display:flex;gap:10px;margin-top:8px"><button class="sec" data-cerrar>Cancelar</button><button class="prim" id="c-enviar">Enviar</button></div>
  <p class="small" style="margin-top:18px"><a href="#" id="c-rechazar">No me interesa esta cotización</a></p>
  <div id="r-form" hidden><label for="r-motivo">Motivo (opcional)</label><input id="r-motivo" placeholder="Ej.: ya contraté con otro">
  <button style="margin-top:10px;width:100%" id="r-enviar">Confirmar que no me interesa</button></div>
</div></div>`;

  const script = `<script>
(() => {
  const V = ${doc.version}, B = ${JSON.stringify(base)}, $ = (id) => document.getElementById(id);
  let codigoId = null;
  document.querySelectorAll('[data-abrir]').forEach(b => b.onclick = () => $(b.dataset.abrir).classList.add('abierta'));
  document.querySelectorAll('[data-cerrar]').forEach(b => b.onclick = () => b.closest('.hoja').classList.remove('abierta'));
  document.querySelectorAll('.hoja').forEach(h => h.onclick = (e) => { if (e.target === h) h.classList.remove('abierta'); });
  async function post(ruta, datos, btn, err) {
    btn.disabled = true; $(err).textContent = '';
    try {
      const r = await fetch(B + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Algo salió mal. Intenta de nuevo.');
      return j;
    } catch (e) { $(err).textContent = e.message; return null; } finally { btn.disabled = false; }
  }
  async function pedir(btn, err) {
    const j = await post('/codigo', { nombre: $('a-nombre').value, contacto: $('a-contacto').value, acepta: $('a-acepta').checked, version: V }, btn, err);
    if (!j) return;
    codigoId = j.codigo_id;
    $('paso1').hidden = true; $('paso2').hidden = false;
    $('a-destino').textContent = 'Lo enviamos por ' + (j.canal === 'correo' ? 'correo' : 'WhatsApp') + ' a ' + j.destino + '. Vence en 10 minutos.';
    if (j.codigo_demo) { $('a-demo').hidden = false; $('a-demo').textContent = 'Modo demostración: el código es ' + j.codigo_demo + ' (en producción solo llega al celular o correo).'; }
    $('a-codigo').focus();
  }
  $('a-pedir') && ($('a-pedir').onclick = (e) => pedir(e.target, 'a-err'));
  $('a-reenviar') && ($('a-reenviar').onclick = (e) => pedir(e.target, 'a-err2'));
  $('a-confirmar') && ($('a-confirmar').onclick = async (e) => {
    const j = await post('/aprobar', { codigo_id: codigoId, codigo: $('a-codigo').value }, e.target, 'a-err2');
    if (j) location.reload();
  });
  $('c-enviar') && ($('c-enviar').onclick = async (e) => {
    const j = await post('/cambios', { nombre: $('c-nombre').value, comentario: $('c-texto').value }, e.target, 'c-err');
    if (j) location.reload();
  });
  $('c-rechazar') && ($('c-rechazar').onclick = (e) => { e.preventDefault(); $('r-form').hidden = false; });
  $('r-enviar') && ($('r-enviar').onclick = async (e) => {
    const j = await post('/rechazar', { nombre: $('c-nombre').value, motivo: $('r-motivo').value }, e.target, 'c-err');
    if (j) location.reload();
  });
})();
</script>`;

  return marco({
    titulo: `${doc.consecutivo} · ${n.nombre}`, c1: color(n.color1, '#0f6cbd'), c2: color(n.color2, '#e8f1fb'),
    cuerpo: cuerpo + (modoDemo ? '' : ''), script,
  });
}

function paginaVerificar({ h, resultado }) {
  let res = '';
  if (h) {
    if (!resultado) res = `<div class="banner b-bad">No existe ningún documento con esa huella.</div>`;
    else {
      const d = resultado.doc;
      res = `<div class="banner ${resultado.integra ? 'b-ok' : 'b-bad'}">${resultado.integra
        ? 'Documento auténtico: la huella coincide con lo guardado y no ha sido alterado.'
        : 'Atención: el documento guardado no coincide con su huella.'}</div>
      <div class="card small"><div><span class="muted">Negocio:</span> ${esc(d.negocio.nombre)}</div>
      <div><span class="muted">Cotización:</span> ${esc(d.consecutivo)} · versión ${d.version}</div>
      <div><span class="muted">Emitida:</span> ${esc(d.emitida)}</div>
      <div><span class="muted">Cliente:</span> ${esc(d.cliente.nombre)}</div>
      <div><span class="muted">Total:</span> ${fmtPesos(d.totales.total)}</div>
      ${resultado.aprobacion ? `<div style="margin-top:8px"><b style="color:var(--ok)">Aprobada</b> por ${esc(resultado.aprobacion.nombre)} el ${esc(fmtFechaHora(resultado.aprobacion.at))}</div>` : ''}
      </div>`;
    }
  }
  return marco({
    titulo: 'Verificar cotización',
    cuerpo: `<div class="wrap"><div class="card" style="margin-top:30px"><h2>Verificar una cotización</h2>
    <p class="muted small">Pega la huella SHA-256 que aparece al pie del PDF o de la página de la cotización.</p>
    <form method="get"><input name="h" value="${esc(h || '')}" placeholder="64 caracteres" class="huella" pattern="[0-9a-fA-F]{64}" required>
    <button class="btn prim" style="margin-top:10px;width:100%">Verificar</button></form></div>${res}</div>`,
  });
}

function paginaNoContactar(nombreNegocio) {
  return marco({
    titulo: 'Listo',
    cuerpo: `<div class="wrap"><div class="card" style="margin-top:40px;text-align:center"><h2>Listo</h2><p class="muted">No te enviaremos más recordatorios de ${esc(nombreNegocio)} sobre cotizaciones.</p></div></div>`,
  });
}

module.exports = { fmtContacto, paginaCotizacion, paginaError, paginaVerificar, paginaNoContactar, esc };
