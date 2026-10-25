// Panel del dueño o técnico. JavaScript sin framework, pensado para usarse en el celular durante la visita.
(() => {
  'use strict';
  const app = document.getElementById('app');
  const nav = document.getElementById('nav');
  const hoja = document.getElementById('hoja');
  const hojaPanel = document.getElementById('hoja-panel');
  const { calcular, fmtPesos: pesos, fmtCantidad } = window.Calc;

  let yo = null, negocio = null, modoMensajeria = 'demo';

  // ---------- Utilidades ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fechaHora = (ms) => (ms ? new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }).format(ms) : '');
  const fecha = (ms) => (ms ? new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium' }).format(ms) : '');
  const ESTADOS = { borrador: 'Borrador', enviada: 'Enviada', vista: 'Vista', cambios: 'Cambios pedidos', aprobada: 'Aprobada', rechazada: 'Rechazada', vencida: 'Vencida' };
  const TIPOS = { servicio: 'Servicio', material: 'Material', mano_obra: 'Mano de obra', desplazamiento: 'Desplazamiento', otro: 'Otro' };
  const badge = (e) => `<span class="estado ${esc(e)}">${esc(ESTADOS[e] || e)}</span>`;

  // Entradas en formato colombiano, convertidas a enteros sin pasar por decimales flotantes.
  function leerCantidad(t) { // "1,5" → 1500 milésimas
    const s = String(t).trim().replace(/\s/g, '');
    const m = /^(\d{1,9})(?:[.,](\d{1,3}))?$/.exec(s);
    if (!m) return null;
    const v = Number(m[1]) * 1000 + Number((m[2] || '').padEnd(3, '0'));
    return v > 0 ? v : null;
  }
  const cantidadTxt = (mil) => String(Math.floor(mil / 1000)) + (mil % 1000 ? ',' + String(mil % 1000).padStart(3, '0').replace(/0+$/, '') : '');
  function leerPesos(t) { // "$180.000" → 180000
    const s = String(t).replace(/[^\d]/g, '');
    if (!s || s.length > 13) return null;
    return Number(s);
  }
  const pesosTxt = (v) => new Intl.NumberFormat('es-CO').format(v);
  function leerPct(t) { // "10,5" → 1050 centésimas de punto
    const s = String(t).trim().replace('%', '').trim();
    if (s === '') return 0;
    const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(s);
    if (!m) return null;
    const v = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
    return v <= 10000 ? v : null;
  }
  const pctTxt = (bp) => (bp ? String(Math.floor(bp / 100)) + (bp % 100 ? ',' + String(bp % 100).padStart(2, '0').replace(/0+$/, '') : '') : '');
  const telWa = (t) => { let d = String(t || '').replace(/\D/g, ''); if (d.length === 10 && d.startsWith('3')) d = '57' + d; return d; };

  let avisoT;
  function aviso(msg, error = false) {
    const el = document.getElementById('aviso');
    el.textContent = msg; el.className = 'aviso ver' + (error ? ' error' : '');
    clearTimeout(avisoT); avisoT = setTimeout(() => { el.className = 'aviso' + (error ? ' error' : ''); }, error ? 4500 : 2200);
  }

  async function api(metodo, url, datos) {
    const r = await fetch('/api' + url, {
      method: metodo, headers: datos ? { 'Content-Type': 'application/json' } : {}, body: datos ? JSON.stringify(datos) : undefined, credentials: 'same-origin',
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && url !== '/login') { vLogin(); throw new Error(j.error || 'Inicia sesión'); }
    if (!r.ok) throw new Error(j.error || 'Algo salió mal');
    return j;
  }
  const intentar = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { aviso(e.message, true); } };

  function abrirHoja(html, alMontar) {
    hojaPanel.innerHTML = html;
    hoja.classList.add('abierta');
    hojaPanel.querySelectorAll('[data-cerrar]').forEach((b) => (b.onclick = cerrarHoja));
    if (alMontar) alMontar(hojaPanel);
  }
  function cerrarHoja() { hoja.classList.remove('abierta'); hojaPanel.innerHTML = ''; }
  hoja.addEventListener('click', (e) => { if (e.target === hoja) cerrarHoja(); });

  const top = (titulo, { atras, sub = '', der = '' } = {}) =>
    `<div class="top">${atras ? `<a class="atras" href="${atras}" aria-label="Volver">‹</a>` : ''}<div><h1>${titulo}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="der">${der}</div></div>`;

  // ---------- Inicio de sesión ----------
  function vLogin() {
    nav.hidden = true;
    app.innerHTML = `<div class="login"><div class="card"><h1 style="margin-bottom:6px">Cotizador</h1>
      <div class="muted small">Entra para crear y enviar cotizaciones.</div>
      <form id="f-login"><label for="l-correo">Correo</label><input id="l-correo" type="email" autocomplete="username" required>
      <label for="l-clave">Contraseña</label><input id="l-clave" type="password" autocomplete="current-password" required>
      <button class="prim bloque" style="margin-top:14px">Entrar</button></form>
      <div class="tiny muted" style="margin-top:12px">Demo: demo@cotiza.local / demo1234</div></div></div>`;
    document.getElementById('f-login').onsubmit = intentar(async (e) => {
      e.preventDefault();
      await api('POST', '/login', { correo: document.getElementById('l-correo').value, clave: document.getElementById('l-clave').value });
      await iniciar();
    });
  }

  async function iniciar() {
    try {
      const r = await api('GET', '/yo');
      yo = r.usuario; modoMensajeria = r.modo_mensajeria;
      negocio = await api('GET', '/negocio');
      document.documentElement.style.setProperty('--c1', negocio.color1 || '#0f6cbd');
      document.documentElement.style.setProperty('--c1-suave', negocio.color2 || '#e8f1fb');
      nav.hidden = false;
      render();
    } catch { /* vLogin ya se mostró */ }
  }

  // ---------- Rutas ----------
  const RUTAS = [
    [/^#?\/?$/, 'inicio', vInicio], [/^#\/cotizaciones$/, 'cotizaciones', vLista], [/^#\/nueva$/, 'nueva', vNueva],
    [/^#\/cotizacion\/(\d+)$/, 'cotizaciones', vEditor], [/^#\/catalogo$/, 'catalogo', vCatalogo], [/^#\/clientes$/, 'mas', vClientes],
    [/^#\/mensajes$/, 'mas', vMensajes], [/^#\/config$/, 'mas', vConfig], [/^#\/mas$/, 'mas', vMas],
  ];
  let salidaPendiente = null; // guarda cambios antes de salir del editor
  async function render() {
    if (!yo) return;
    if (salidaPendiente) { const f = salidaPendiente; salidaPendiente = null; await f(); }
    cerrarHoja();
    const h = location.hash || '#/';
    for (const [re, seccion, vista] of RUTAS) {
      const m = re.exec(h);
      if (m) {
        nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.r === seccion));
        window.scrollTo(0, 0);
        try { await vista(...m.slice(1)); } catch (e) { app.innerHTML = top('Error') + `<div class="cont"><div class="card">${esc(e.message)}</div></div>`; }
        return;
      }
    }
    location.hash = '#/';
  }
  window.addEventListener('hashchange', render);

  // ---------- Inicio ----------
  const TEXTO_EVENTO = {
    creada: () => 'Creada', enviada: (e) => `Enviada versión ${e.version}`, vista: () => 'Vista por el cliente', codigo_enviado: () => 'Código de aprobación enviado',
    aprobada: () => 'Aprobada', cambios: () => 'Cambios pedidos', rechazada: () => 'Rechazada', vencida: () => 'Vencida',
    recordatorio: () => 'Recordatorio enviado', mensaje: () => 'Mensaje enviado', enlace_renovado: () => 'Enlace renovado', no_contactar: () => 'Pidió no recibir recordatorios',
  };
  async function vInicio() {
    const [m, act] = await Promise.all([api('GET', '/metricas'), api('GET', '/actividad')]);
    const kpi = (v, l) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`;
    app.innerHTML = top(esc(negocio.nombre), { sub: `Hola, ${esc(yo.nombre)}` }) + `<div class="cont">
      <a class="btn prim bloque" href="#/nueva" style="margin-top:4px;padding:14px">＋ Nueva cotización</a>
      <div class="grid4" style="margin-top:12px">
        ${kpi(m.minutos_para_emitir ?? '—', 'minutos para emitir (mediana)')}
        ${kpi(m.porcentaje_aprobado === null ? '—' : m.porcentaje_aprobado + ' %', `aprobadas este mes (${m.aprobadas_mes} de ${m.enviadas_mes})`)}
        ${kpi(m.sin_respuesta_3_dias, 'sin respuesta hace más de 3 días')}
        ${kpi(pesos(m.monto_aprobado_mes), 'aprobado este mes')}
      </div>
      <div class="card"><h2>Actividad reciente</h2><div class="lista">${act.length ? act.map((e) => `
        <a class="item" href="#/cotizacion/${e.cotizacion_id}"><div class="fila"><div><b>${esc(e.consecutivo)}</b> · ${esc((TEXTO_EVENTO[e.tipo] || (() => e.tipo))(e))}
        <div class="small muted">${esc(e.cliente || '')}${e.tipo === 'cambios' || e.tipo === 'rechazada' ? ' — ' + esc(e.detalle) : ''}</div></div>
        <div class="tiny muted" style="text-align:right">${fechaHora(e.at)}</div></div></a>`).join('') : '<div class="vacio">Todavía no hay actividad.</div>'}</div></div></div>`;
  }

  // ---------- Nueva cotización ----------
  async function vNueva() {
    const [plantillas, recientes] = await Promise.all([api('GET', '/cotizaciones?plantillas=1'), api('GET', '/cotizaciones')]);
    app.innerHTML = top('Nueva cotización', { atras: '#/' }) + `<div class="cont">
      <button class="prim bloque" id="n-blanco" style="padding:14px">Empezar en blanco</button>
      <div class="card"><h2>Desde una plantilla</h2><div class="lista">${plantillas.length ? plantillas.map((p) => `
        <a class="item" href="#" data-desde="${p.id}"><div class="fila"><div><b>${esc(p.nombre_plantilla || p.titulo || p.consecutivo)}</b><div class="small muted">${p.items} ítems</div></div><div class="b">${p.total !== null ? pesos(p.total) : ''}</div></div></a>`).join('')
        : '<div class="small muted">Aún no tienes plantillas. Abre cualquier cotización y toca "Guardar como plantilla".</div>'}</div></div>
      <div class="card"><h2>Duplicar una anterior</h2><div class="lista">${recientes.slice(0, 10).map((c) => `
        <a class="item" href="#" data-desde="${c.id}"><div class="fila"><div><b>${esc(c.consecutivo)}</b> · ${esc(c.cliente || 'Sin cliente')}<div class="small muted">${esc(c.titulo || '')}</div></div><div class="b">${c.total !== null ? pesos(c.total) : ''}</div></div></a>`).join('') || '<div class="small muted">Sin cotizaciones.</div>'}</div></div></div>`;
    document.getElementById('n-blanco').onclick = intentar(async () => { const r = await api('POST', '/cotizaciones', {}); location.hash = `#/cotizacion/${r.id}`; });
    app.querySelectorAll('[data-desde]').forEach((a) => (a.onclick = intentar(async (e) => {
      e.preventDefault();
      const r = await api('POST', '/cotizaciones', { desde: Number(a.dataset.desde) });
      location.hash = `#/cotizacion/${r.id}`;
    })));
  }

  // ---------- Lista ----------
  let filtroEstado = '', filtroTexto = '';
  async function vLista() {
    app.innerHTML = top('Cotizaciones') + `<div class="cont">
      <input id="q" placeholder="Buscar por cliente, número o ítem" value="${esc(filtroTexto)}" type="search">
      <div class="chips" style="margin-top:8px">${[['', 'Todas'], ...Object.entries(ESTADOS)].map(([k, v]) => `<button class="chip ${k === filtroEstado ? 'on' : ''}" data-e="${k}">${v}</button>`).join('')}</div>
      <div class="card lista" id="res"><div class="vacio">Cargando…</div></div></div>`;
    const cargar = async () => {
      const r = await api('GET', `/cotizaciones?estado=${encodeURIComponent(filtroEstado)}&q=${encodeURIComponent(filtroTexto)}`);
      document.getElementById('res').innerHTML = r.length ? r.map((c) => `
        <a class="item" href="#/cotizacion/${c.id}"><div class="fila"><div><b>${esc(c.consecutivo)}</b> ${badge(c.estado)}
        <div>${esc(c.cliente || 'Sin cliente')}</div><div class="small muted">${esc(c.titulo || '')}</div></div>
        <div style="text-align:right"><div class="b">${c.total !== null ? pesos(c.total) : '—'}</div><div class="tiny muted">${fecha(c.actualizada_at)}</div></div></div></a>`).join('')
        : '<div class="vacio">No hay cotizaciones con ese filtro.</div>';
    };
    let t;
    document.getElementById('q').oninput = (e) => { filtroTexto = e.target.value; clearTimeout(t); t = setTimeout(intentar(cargar), 250); };
    app.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => { filtroEstado = b.dataset.e; vLista(); }));
    await cargar();
  }

  // ---------- Editor de cotización ----------
  async function vEditor(idTxt) {
    const id = Number(idTxt);
    let d = await api('GET', `/cotizaciones/${id}`);
    const b = d.borrador;
    const editable = !['aprobada', 'rechazada'].includes(d.estado);
    let guardadoT = null, guardando = Promise.resolve(), sucio = false;

    function estadoGuardado(txt) { const el = document.getElementById('e-guardado'); if (el) el.textContent = txt; }
    function programarGuardado() {
      sucio = true; estadoGuardado('Guardando…');
      clearTimeout(guardadoT);
      guardadoT = setTimeout(guardarAhora, 700);
    }
    async function guardarAhora() {
      clearTimeout(guardadoT);
      if (!sucio) return guardando;
      sucio = false;
      guardando = guardando.then(async () => {
        try {
          d = await api('PUT', `/cotizaciones/${id}`, { borrador: b });
          estadoGuardado('Guardado');
          const a = document.getElementById('e-sin-enviar');
          if (a) a.hidden = !(d.version_actual && d.cambios_sin_enviar);
          actualizarBarra();
        } catch (e) { estadoGuardado('Sin guardar'); aviso(e.message, true); sucio = true; }
      });
      return guardando;
    }
    salidaPendiente = guardarAhora;

    const ultimoCambio = d.eventos.find((e) => e.tipo === 'cambios');
    const ap = d.aprobacion;

    app.innerHTML = top(esc(d.consecutivo), {
      atras: '#/cotizaciones',
      sub: `${esc(d.estado_texto)}${d.version_actual ? ` · v${d.version_actual}` : ''}${d.es_plantilla ? ' · Plantilla' : ''} · <span id="e-guardado" class="guardado">${editable ? 'Guardado' : 'Solo lectura'}</span>`,
    }) + `<div class="cont con-barra">
      ${d.estado === 'cambios' && ultimoCambio ? `<div class="alerta warn"><b>El cliente pidió cambios:</b> ${esc(ultimoCambio.detalle)}<div class="tiny">Edita y toca "Enviar versión ${d.version_actual + 1}".</div></div>` : ''}
      ${d.estado === 'vencida' ? `<div class="alerta warn">Venció el ${fecha(d.vigencia_hasta)}. Puedes ajustar y reenviar: se crea una versión nueva con nueva vigencia.</div>` : ''}
      <div class="alerta info" id="e-sin-enviar" ${d.version_actual && d.cambios_sin_enviar && editable ? '' : 'hidden'}>Tienes cambios sin enviar. El cliente sigue viendo la versión ${d.version_actual}.</div>
      ${ap ? `<div class="card evidencia"><h2 style="color:var(--ok)">Aprobada en línea</h2><div class="small">
        <div><span class="muted">Aprobó:</span> <b>${esc(ap.nombre)}</b></div>
        <div><span class="muted">Código verificado por ${ap.canal === 'correo' ? 'correo' : 'WhatsApp'}:</span> ${esc(ap.contacto)}</div>
        <div><span class="muted">Fecha y hora:</span> ${fechaHora(ap.at)}</div>
        <div><span class="muted">Versión:</span> ${ap.version} · <span class="muted">IP:</span> ${esc(ap.ip)}</div>
        <div class="mono" style="margin-top:6px">${esc(ap.huella)}</div></div></div>` : ''}

      <div class="card"><div class="fila"><h2 style="margin:0">Cliente</h2>${editable ? '<button class="chico" id="e-cliente">Cambiar</button>' : ''}</div>
        <div id="e-cliente-info" style="margin-top:8px">${clienteHtml(d.cliente)}</div></div>

      <div class="card"><label for="e-titulo" style="margin-top:0">Título (opcional)</label>
        <input id="e-titulo" value="${esc(b.titulo)}" placeholder="Ej.: Mantenimiento de 2 equipos" ${editable ? '' : 'disabled'}>
        ${d.es_plantilla ? `<label for="e-nplant">Nombre de la plantilla</label><input id="e-nplant" value="${esc(d.nombre_plantilla)}">` : ''}</div>

      <div class="card"><div class="fila"><h2 style="margin:0">Ítems</h2><span class="small muted" id="e-nitems"></span></div>
        <div id="e-lineas"></div>
        ${editable ? `<div class="btns"><button class="prim" id="e-agregar" style="flex:2">＋ Agregar del catálogo</button><button id="e-libre" style="flex:1">Ítem libre</button></div>` : ''}</div>

      <div class="card"><div class="grid2">
        <div><label for="e-dg" style="margin-top:0">Descuento global %</label><input id="e-dg" inputmode="decimal" value="${pctTxt(b.desc_global_bp)}" placeholder="0" ${editable ? '' : 'disabled'}></div>
        <div><label for="e-vig" style="margin-top:0">Vigencia (días)</label><input id="e-vig" inputmode="numeric" value="${b.vigencia_dias}" ${editable ? '' : 'disabled'}></div></div>
        <div class="totales" id="e-totales" style="margin-top:12px"></div></div>

      <div class="card"><label for="e-cond" style="margin-top:0">Condiciones</label>
        <textarea id="e-cond" rows="6" ${editable ? '' : 'disabled'}>${esc(b.condiciones)}</textarea>
        <label for="e-notas">Notas para el cliente</label><textarea id="e-notas" rows="2" ${editable ? '' : 'disabled'}>${esc(b.notas)}</textarea></div>

      ${d.version_actual ? `<div class="card"><h2>Compartir</h2><div class="small muted">El cliente ve siempre la última versión enviada.</div>
        <div class="btns">${botonesCompartir(d)}</div></div>` : ''}

      ${d.versiones.length ? `<div class="card"><h2>Versiones enviadas</h2>${d.versiones.map((v) => `
        <div class="fila" style="padding:8px 0;border-top:1px solid var(--bd)"><div><b>Versión ${v.numero}</b> <span class="tiny muted">${fechaHora(v.creada_at)}</span>
        <div class="mono muted">${esc(v.huella.slice(0, 16))}…${esc(v.huella.slice(-8))}</div></div>
        <a class="btn chico" href="/api/cotizaciones/${id}/versiones/${v.numero}/pdf" target="_blank">PDF</a></div>`).join('')}</div>` : ''}

      <div class="card"><h2>Historial</h2><div class="timeline">${d.eventos.map((e) => `
        <div class="ev ${esc(e.tipo)}"><div class="p"></div><div><div>${esc((TEXTO_EVENTO[e.tipo] || (() => e.tipo))(e))}</div>
        <div class="tiny muted">${fechaHora(e.at)}${e.ip ? ' · IP ' + esc(e.ip) : ''}</div>${e.detalle && !['enviada'].includes(e.tipo) ? `<div class="small muted">${esc(e.detalle)}</div>` : ''}</div></div>`).join('')}</div></div>

      <div class="card"><h2>Más acciones</h2><div class="btns">
        <button id="e-duplicar">Duplicar</button>
        <button id="e-plantilla">${d.es_plantilla ? 'Quitar de plantillas' : 'Guardar como plantilla'}</button>
        ${d.token && editable ? '<button id="e-enlace">Generar enlace nuevo</button>' : ''}</div></div>
    </div>
    <div class="barra"><div class="in"><div><div class="tiny muted">Total</div><div class="total" id="e-total"></div></div>
      <div style="margin-left:auto;display:flex;gap:8px" id="e-acciones"></div></div></div>`;

    // --- Ítems ---
    const cont = document.getElementById('e-lineas');
    function pintarLineas() {
      document.getElementById('e-nitems').textContent = `${b.items.length} ${b.items.length === 1 ? 'ítem' : 'ítems'}`;
      if (!b.items.length) { cont.innerHTML = '<div class="vacio small">Agrega servicios, materiales o desplazamiento desde el catálogo.</div>'; return recalcular(); }
      cont.innerHTML = b.items.map((it, i) => `<div class="linea" data-i="${i}">
        <input class="nombre" data-f="nombre" value="${esc(it.nombre)}" placeholder="Descripción del ítem" ${editable ? '' : 'disabled'}>
        <div class="campos">
          <div><label>Cant. (${esc(it.unidad)})</label><input data-f="cantidad" inputmode="decimal" value="${cantidadTxt(it.cantidad_mil)}" ${editable ? '' : 'disabled'}></div>
          <div><label>Precio unit.</label><input data-f="precio" inputmode="numeric" value="${pesosTxt(it.precio)}" ${editable ? '' : 'disabled'}></div>
          <div><label>Desc. %</label><input data-f="desc" inputmode="decimal" value="${pctTxt(it.desc_bp)}" placeholder="0" ${editable ? '' : 'disabled'}></div>
          <div><label>IVA</label><select data-f="iva" ${editable ? '' : 'disabled'}>${[0, 5, 19].concat([0, 5, 19].includes(it.iva) ? [] : [it.iva]).map((v) => `<option value="${v}" ${v === it.iva ? 'selected' : ''}>${v} %</option>`).join('')}</select></div>
        </div>
        <div class="pie">${editable ? `<div class="paso"><button class="chico" data-menos aria-label="Menos">−</button><button class="chico" data-mas aria-label="Más">＋</button></div>` : '<span></span>'}
          <span class="b" data-total></span>${editable ? '<button class="chico peligro" data-quitar>Quitar</button>' : ''}</div></div>`).join('');
      recalcular();
    }
    function recalcular() {
      let c;
      try { c = calcular({ items: b.items, desc_global_bp: b.desc_global_bp, redondeo: negocio.redondeo }); } catch { return; }
      cont.querySelectorAll('.linea').forEach((el, i) => {
        const l = c.lineas[i];
        const desc = l.desc_item + l.desc_global;
        el.querySelector('[data-total]').innerHTML = `${pesos(l.neto)}${desc ? ` <span class="tiny muted">(−${pesos(desc)})</span>` : ''}`;
      });
      const t = c.totales, f = (k, v) => `<div class="fila"><span class="muted">${k}</span><span>${v}</span></div>`;
      document.getElementById('e-totales').innerHTML = f('Subtotal', pesos(t.subtotal)) +
        (t.descuento_items ? f('Descuentos por ítem', '−' + pesos(t.descuento_items)) : '') +
        (t.descuento_global ? f('Descuento global', '−' + pesos(t.descuento_global)) : '') +
        Object.entries(t.iva_por_tarifa).filter(([k]) => Number(k) > 0).map(([k, v]) => f(`IVA ${k} % (base ${pesos(v.base)})`, pesos(v.iva))).join('') +
        (t.ajuste ? f('Ajuste al peso', pesos(t.ajuste)) : '') +
        `<div class="fila gran"><span>Total</span><span>${pesos(t.total)}</span></div>`;
      document.getElementById('e-total').textContent = pesos(t.total);
    }
    cont.addEventListener('input', (e) => {
      const el = e.target, li = el.closest('.linea'); if (!li) return;
      const it = b.items[Number(li.dataset.i)], f = el.dataset.f;
      let v = el.value, ok = true;
      if (f === 'nombre') it.nombre = v;
      else if (f === 'cantidad') { v = leerCantidad(v); ok = v !== null; if (ok) it.cantidad_mil = v; }
      else if (f === 'precio') { v = leerPesos(v); ok = v !== null; if (ok) it.precio = v; }
      else if (f === 'desc') { v = leerPct(v); ok = v !== null; if (ok) it.desc_bp = v; }
      else if (f === 'iva') it.iva = Number(v);
      el.style.borderColor = ok ? '' : 'var(--bad)';
      if (ok) { recalcular(); programarGuardado(); }
    });
    cont.addEventListener('change', (e) => {
      const el = e.target, li = el.closest('.linea'); if (!li) return;
      const it = b.items[Number(li.dataset.i)];
      if (el.dataset.f === 'precio' && leerPesos(el.value) !== null) el.value = pesosTxt(it.precio);
    });
    cont.addEventListener('click', (e) => {
      const li = e.target.closest('.linea'); if (!li) return;
      const i = Number(li.dataset.i);
      if (e.target.closest('[data-quitar]')) { b.items.splice(i, 1); pintarLineas(); programarGuardado(); }
      else if (e.target.closest('[data-mas]') || e.target.closest('[data-menos]')) {
        const it = b.items[i], paso = e.target.closest('[data-mas]') ? 1000 : -1000;
        it.cantidad_mil = Math.max(1000, it.cantidad_mil + paso);
        li.querySelector('[data-f="cantidad"]').value = cantidadTxt(it.cantidad_mil);
        recalcular(); programarGuardado();
      }
    });
    pintarLineas();

    // --- Campos generales ---
    const enlazar = (idc, fn) => { const el = document.getElementById(idc); if (el) el.addEventListener('input', () => { const ok = fn(el.value); el.style.borderColor = ok === false ? 'var(--bad)' : ''; if (ok !== false) { recalcular(); programarGuardado(); } }); };
    enlazar('e-titulo', (v) => { b.titulo = v; });
    enlazar('e-dg', (v) => { const p = leerPct(v); if (p === null) return false; b.desc_global_bp = p; });
    enlazar('e-vig', (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 365) return false; b.vigencia_dias = n; });
    enlazar('e-cond', (v) => { b.condiciones = v; });
    enlazar('e-notas', (v) => { b.notas = v; });
    const np = document.getElementById('e-nplant');
    if (np) np.addEventListener('change', intentar(async () => { await api('POST', `/cotizaciones/${id}/plantilla`, { es_plantilla: true, nombre_plantilla: np.value }); aviso('Plantilla renombrada'); }));

    // --- Agregar ítems ---
    if (editable) {
      document.getElementById('e-agregar').onclick = intentar(abrirCatalogo);
      document.getElementById('e-libre').onclick = () => {
        b.items.push({ catalogo_id: null, nombre: '', descripcion: '', tipo: 'otro', unidad: 'unidad', cantidad_mil: 1000, precio: 0, desc_bp: 0, iva: 19 });
        pintarLineas(); programarGuardado();
        cont.querySelector('.linea:last-child .nombre').focus();
      };
      document.getElementById('e-cliente').onclick = intentar(() => elegirCliente(async (cli) => {
        await guardarAhora();
        d = await api('PUT', `/cotizaciones/${id}`, { cliente_id: cli.id });
        document.getElementById('e-cliente-info').innerHTML = clienteHtml(d.cliente);
        const a = document.getElementById('e-sin-enviar'); if (a) a.hidden = !(d.version_actual && d.cambios_sin_enviar);
        actualizarBarra();
      }));
    }
    async function abrirCatalogo() {
      const cat = await api('GET', '/catalogo');
      const contador = {};
      abrirHoja(`<div class="cab"><h2 style="margin:0">Agregar del catálogo</h2><button class="prim chico" data-cerrar>Listo</button></div>
        <input id="c-q" type="search" placeholder="Buscar servicio o material">
        <div class="chips" style="margin-top:6px">${[['', 'Todo'], ...Object.entries(TIPOS)].map(([k, v]) => `<button class="chip ${k ? '' : 'on'}" data-t="${k}">${v}</button>`).join('')}</div>
        <div id="c-lista" style="margin-top:6px"></div>
        <a href="#/catalogo" class="small">Administrar catálogo</a>`, (p) => {
        let tipo = '';
        const pintar = () => {
          const q = p.querySelector('#c-q').value.toLowerCase();
          const f = cat.filter((c) => (!tipo || c.tipo === tipo) && (!q || (c.nombre + ' ' + c.codigo).toLowerCase().includes(q)));
          p.querySelector('#c-lista').innerHTML = f.map((c) => `<div class="cat-item ${contador[c.id] ? 'agregado' : ''}" data-id="${c.id}">
            <div><div>${esc(c.nombre)}</div><div class="small muted">${pesos(c.precio)} / ${esc(c.unidad)} · IVA ${c.iva} %${contador[c.id] ? ` · <b style="color:var(--ok)">agregado ×${contador[c.id]}</b>` : ''}</div></div>
            <div class="mas">＋</div></div>`).join('') || '<div class="vacio">Nada coincide.</div>';
        };
        p.querySelector('#c-q').oninput = pintar;
        p.querySelectorAll('[data-t]').forEach((bt) => (bt.onclick = () => { tipo = bt.dataset.t; p.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x === bt)); pintar(); }));
        p.querySelector('#c-lista').onclick = (e) => {
          const row = e.target.closest('.cat-item'); if (!row) return;
          const c = cat.find((x) => x.id === Number(row.dataset.id));
          const existente = b.items.find((it) => it.catalogo_id === c.id && it.precio === c.precio && !it.desc_bp);
          if (existente) existente.cantidad_mil += 1000;
          else b.items.push({ catalogo_id: c.id, nombre: c.nombre, descripcion: c.descripcion, tipo: c.tipo, unidad: c.unidad, cantidad_mil: 1000, precio: c.precio, desc_bp: 0, iva: c.iva });
          contador[c.id] = (contador[c.id] || 0) + 1;
          pintar(); pintarLineas(); programarGuardado();
        };
        pintar();
      });
    }

    // --- Barra inferior y envío ---
    function actualizarBarra() {
      const acc = document.getElementById('e-acciones'); if (!acc) return;
      if (d.es_plantilla) { acc.innerHTML = `<button class="prim" id="b-usar">Usar plantilla</button>`; document.getElementById('b-usar').onclick = intentar(duplicar); return; }
      if (!editable) { acc.innerHTML = d.version_actual ? `<a class="btn prim" href="/api/cotizaciones/${id}/versiones/${d.version_actual}/pdf" target="_blank">PDF</a>` : ''; return; }
      const nueva = !d.version_actual || d.cambios_sin_enviar;
      acc.innerHTML = (d.version_actual ? `<button id="b-compartir">Compartir</button>` : '') +
        (nueva ? `<button class="prim" id="b-enviar">${d.version_actual ? `Enviar versión ${d.version_actual + 1}` : 'Enviar'}</button>` : '');
      const be = document.getElementById('b-enviar'); if (be) be.onclick = intentar(confirmarEnvio);
      const bc = document.getElementById('b-compartir'); if (bc) bc.onclick = () => hojaCompartir(d);
    }
    async function confirmarEnvio() {
      await guardarAhora(); await guardando;
      if (!d.cliente) return aviso('Elige un cliente antes de enviar', true);
      if (!b.items.length) return aviso('Agrega al menos un ítem', true);
      const n = d.version_actual + 1;
      abrirHoja(`<h2>Enviar versión ${n}</h2>
        <p class="small">Se congelará esta versión con su huella SHA-256. ${d.cliente ? esc(d.cliente.nombre) : 'El cliente'} verá exactamente lo que está aquí, y podrá aprobarla con un código de un solo uso.</p>
        <p class="small muted">Vigencia: ${b.vigencia_dias} días. Lo enviado ya no se puede modificar: cualquier cambio crea una versión nueva.</p>
        <div class="btns"><button data-cerrar style="flex:1">Cancelar</button><button class="prim" id="h-ok" style="flex:2">Enviar</button></div>`, (p) => {
        p.querySelector('#h-ok').onclick = intentar(async (e) => {
          e.target.disabled = true;
          await api('POST', `/cotizaciones/${id}/enviar`);
          salidaPendiente = null;
          const nuevo = await api('GET', `/cotizaciones/${id}`);
          await vEditor(id);
          hojaCompartir(nuevo, true);
        });
      });
    }
    async function duplicar() {
      await guardarAhora();
      const r = await api('POST', '/cotizaciones', { desde: id });
      aviso('Cotización duplicada');
      location.hash = `#/cotizacion/${r.id}`;
    }
    document.getElementById('e-duplicar').onclick = intentar(duplicar);
    document.getElementById('e-plantilla').onclick = intentar(async () => {
      await guardarAhora();
      if (d.es_plantilla) { await api('POST', `/cotizaciones/${id}/plantilla`, { es_plantilla: false }); aviso('Ya no es plantilla'); return vEditor(id); }
      abrirHoja(`<h2>Guardar como plantilla</h2><p class="small muted">Se crea una plantilla con estos ítems y condiciones, sin cliente. Esta cotización no cambia.</p>
        <label for="p-nombre">Nombre de la plantilla</label><input id="p-nombre" value="${esc(b.titulo || '')}">
        <div class="btns"><button data-cerrar style="flex:1">Cancelar</button><button class="prim" id="p-ok" style="flex:2">Guardar</button></div>`, (p) => {
        p.querySelector('#p-ok').onclick = intentar(async () => {
          const r = await api('POST', '/cotizaciones', { desde: id, cliente_id: null });
          await api('POST', `/cotizaciones/${r.id}/plantilla`, { es_plantilla: true, nombre_plantilla: p.querySelector('#p-nombre').value });
          cerrarHoja(); aviso('Plantilla guardada');
        });
      });
    });
    const be = document.getElementById('e-enlace');
    if (be) be.onclick = intentar(async () => {
      if (!confirm('El enlace actual dejará de funcionar. ¿Generar uno nuevo?')) return;
      await api('POST', `/cotizaciones/${id}/nuevo-enlace`); aviso('Enlace nuevo generado'); vEditor(id);
    });
    app.querySelectorAll('[data-compartir]').forEach((x) => (x.onclick = (e) => accionCompartir(e, d)));
    actualizarBarra();
  }

  function clienteHtml(c) {
    if (!c) return '<div class="muted">Sin cliente. Toca "Cambiar" para elegir o crear uno.</div>';
    return `<b>${esc(c.nombre)}</b><div class="small muted">${esc([c.celular, c.correo, c.documento].filter(Boolean).join(' · '))}</div>${c.direccion ? `<div class="small muted">${esc(c.direccion)}</div>` : ''}`;
  }

  function botonesCompartir(d) {
    return `<button class="prim" data-compartir="wa">WhatsApp</button><button data-compartir="correo">Correo</button><button data-compartir="copiar">Copiar enlace</button>
      <a class="btn" href="${esc(d.enlace)}" target="_blank" rel="noopener">Ver como cliente</a>
      <a class="btn" href="/api/cotizaciones/${d.id}/versiones/${d.version_actual}/pdf" target="_blank">PDF</a>
      <button data-compartir="auto-wa">Enviar automático (WhatsApp)</button><button data-compartir="auto-correo">Enviar automático (correo)</button>`;
  }
  async function accionCompartir(e, d) {
    const tipo = e.target.closest('[data-compartir]').dataset.compartir;
    const cli = d.cliente || {};
    try {
      if (tipo === 'wa') window.open(`https://wa.me/${telWa(cli.celular)}?text=${encodeURIComponent(d.mensaje)}`, '_blank', 'noopener');
      else if (tipo === 'correo') location.href = `mailto:${encodeURIComponent(cli.correo || '')}?subject=${encodeURIComponent(`Cotización ${d.consecutivo} de ${negocio.nombre}`)}&body=${encodeURIComponent(d.mensaje)}`;
      else if (tipo === 'copiar') { await navigator.clipboard.writeText(d.enlace); aviso('Enlace copiado'); }
      else {
        const r = await api('POST', `/cotizaciones/${d.id}/enviar-cliente`, { canal: tipo === 'auto-correo' ? 'correo' : 'whatsapp' });
        aviso(r.estado === 'simulado' ? 'Mensaje simulado (modo demo): míralo en Más > Mensajes' : r.estado === 'enviado' ? 'Mensaje enviado' : `Error: ${r.error}`, r.estado === 'error');
      }
    } catch (err) { aviso(err.message, true); }
  }
  function hojaCompartir(d, recien = false) {
    abrirHoja(`<div class="cab"><h2 style="margin:0">${recien ? `Versión ${d.version_actual} enviada` : 'Compartir'}</h2><button class="chico" data-cerrar>Cerrar</button></div>
      <p class="small muted">Envía el enlace al cliente. Desde ahí puede ver, descargar el PDF y aprobar.</p>
      <input readonly value="${esc(d.enlace)}" class="mono" onclick="this.select()">
      <div class="small" style="margin-top:10px;background:var(--bg);padding:10px;border-radius:10px">${esc(d.mensaje)}</div>
      <div class="btns">${botonesCompartir(d)}</div>
      <p class="tiny muted">WhatsApp y Correo abren tu app con el mensaje listo (sin costo). "Enviar automático" usa la API de WhatsApp Business o el correo del sistema${modoMensajeria === 'demo' ? ' (en modo demo solo se registra)' : ''}.</p>`,
    (p) => p.querySelectorAll('[data-compartir]').forEach((x) => (x.onclick = (e) => accionCompartir(e, d))));
  }

  // ---------- Clientes ----------
  function formCliente(c = {}) {
    return `<label for="k-nombre">Nombre o razón social</label><input id="k-nombre" value="${esc(c.nombre)}" autocomplete="off">
      <div class="grid2"><div><label for="k-cel">Celular</label><input id="k-cel" inputmode="tel" value="${esc(c.celular)}"></div>
      <div><label for="k-correo">Correo</label><input id="k-correo" type="email" value="${esc(c.correo)}"></div></div>
      <div class="grid2"><div><label for="k-doc">Cédula o NIT</label><input id="k-doc" value="${esc(c.documento)}"></div>
      <div><label for="k-dir">Dirección del servicio</label><input id="k-dir" value="${esc(c.direccion)}"></div></div>
      <label class="check"><input type="checkbox" id="k-aut" ${c.autoriza_datos_at ? 'checked disabled' : ''}><span class="small">El cliente autorizó el tratamiento de sus datos personales (Ley 1581 de 2012)${c.autoriza_datos_at ? ` el ${fecha(c.autoriza_datos_at)}` : ''}.</span></label>
      ${c.id ? `<label class="check"><input type="checkbox" id="k-nc" ${c.no_contactar ? 'checked' : ''}><span class="small">No enviar recordatorios automáticos</span></label>` : ''}`;
  }
  const leerFormCliente = (p) => ({
    nombre: p.querySelector('#k-nombre').value, celular: p.querySelector('#k-cel').value, correo: p.querySelector('#k-correo').value,
    documento: p.querySelector('#k-doc').value, direccion: p.querySelector('#k-dir').value, autoriza_datos: p.querySelector('#k-aut').checked,
    no_contactar: p.querySelector('#k-nc')?.checked || false,
  });
  async function elegirCliente(alElegir) {
    abrirHoja(`<div class="cab"><h2 style="margin:0">Elegir cliente</h2><button class="chico" data-cerrar>Cerrar</button></div>
      <input id="k-q" type="search" placeholder="Buscar por nombre, celular o correo">
      <div id="k-lista" style="margin-top:6px"></div>
      <details style="margin-top:12px" id="k-nuevo"><summary class="b" style="cursor:pointer;color:var(--c1)">＋ Cliente nuevo</summary>${formCliente()}
      <button class="prim bloque" id="k-crear" style="margin-top:12px">Crear y usar</button></details>`, (p) => {
      const cargar = intentar(async () => {
        const r = await api('GET', `/clientes?q=${encodeURIComponent(p.querySelector('#k-q').value)}`);
        p.querySelector('#k-lista').innerHTML = r.map((c) => `<div class="cat-item" data-id="${c.id}"><div><div>${esc(c.nombre)}</div><div class="small muted">${esc([c.celular, c.correo].filter(Boolean).join(' · '))}</div></div><div class="mas">›</div></div>`).join('') || '<div class="small muted">Sin resultados.</div>';
        p.querySelector('#k-lista').onclick = intentar(async (e) => {
          const row = e.target.closest('.cat-item'); if (!row) return;
          await alElegir(r.find((c) => c.id === Number(row.dataset.id))); cerrarHoja();
        });
      });
      let t; p.querySelector('#k-q').oninput = () => { clearTimeout(t); t = setTimeout(cargar, 250); };
      p.querySelector('#k-crear').onclick = intentar(async () => { const c = await api('POST', '/clientes', leerFormCliente(p)); await alElegir(c); cerrarHoja(); aviso('Cliente creado'); });
      cargar();
    });
  }
  async function vClientes() {
    const r = await api('GET', '/clientes');
    app.innerHTML = top('Clientes', { atras: '#/mas', der: '<button class="chico" id="k-add">＋ Nuevo</button>' }) + `<div class="cont"><div class="card lista">${r.map((c) => `
      <a class="item" href="#" data-id="${c.id}"><b>${esc(c.nombre)}</b>${c.no_contactar ? ' <span class="estado">sin recordatorios</span>' : ''}<div class="small muted">${esc([c.celular, c.correo, c.documento].filter(Boolean).join(' · '))}</div></a>`).join('') || '<div class="vacio">Sin clientes.</div>'}</div></div>`;
    const editar = (c = {}) => abrirHoja(`<h2>${c.id ? 'Editar cliente' : 'Cliente nuevo'}</h2>${formCliente(c)}
      <div class="btns"><button data-cerrar style="flex:1">Cancelar</button><button class="prim" id="k-ok" style="flex:2">Guardar</button></div>`, (p) => {
      p.querySelector('#k-ok').onclick = intentar(async () => {
        const datos = leerFormCliente(p); if (c.autoriza_datos_at) datos.autoriza_datos = true;
        await api(c.id ? 'PUT' : 'POST', c.id ? `/clientes/${c.id}` : '/clientes', datos);
        cerrarHoja(); aviso('Cliente guardado'); vClientes();
      });
    });
    document.getElementById('k-add').onclick = () => editar();
    app.querySelectorAll('[data-id]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); editar(r.find((c) => c.id === Number(a.dataset.id))); }));
  }

  // ---------- Catálogo ----------
  async function vCatalogo() {
    const r = await api('GET', '/catalogo?todos=1');
    app.innerHTML = top('Catálogo', { der: '<button class="chico" id="c-add">＋ Nuevo</button>' }) + `<div class="cont">
      <input id="c-q" type="search" placeholder="Buscar"><div class="card lista" id="c-res"></div></div>`;
    const pintar = () => {
      const q = document.getElementById('c-q').value.toLowerCase();
      const grupos = Object.keys(TIPOS).map((t) => [t, r.filter((c) => c.tipo === t && (!q || c.nombre.toLowerCase().includes(q)))]).filter(([, l]) => l.length);
      document.getElementById('c-res').innerHTML = grupos.map(([t, l]) => `<h3 style="margin-top:10px">${TIPOS[t]}</h3>` + l.map((c) => `
        <a class="item" href="#" data-id="${c.id}" style="${c.activo ? '' : 'opacity:.5'}"><div class="fila"><div>${esc(c.nombre)}${c.activo ? '' : ' (inactivo)'}<div class="small muted">${esc(c.codigo)} · ${esc(c.unidad)} · IVA ${c.iva} %</div></div><div class="b">${pesos(c.precio)}</div></div></a>`).join('')).join('') || '<div class="vacio">El catálogo está vacío.</div>';
      app.querySelectorAll('[data-id]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); editar(r.find((c) => c.id === Number(a.dataset.id))); }));
    };
    const editar = (c = { tipo: 'servicio', unidad: 'unidad', iva: 19, activo: 1 }) => abrirHoja(`<h2>${c.id ? 'Editar ítem' : 'Ítem nuevo'}</h2>
      <label for="i-nombre">Nombre</label><input id="i-nombre" value="${esc(c.nombre)}">
      <label for="i-desc">Descripción (opcional)</label><input id="i-desc" value="${esc(c.descripcion)}">
      <div class="grid2"><div><label for="i-tipo">Tipo</label><select id="i-tipo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${k === c.tipo ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div><label for="i-unidad">Unidad</label><input id="i-unidad" value="${esc(c.unidad)}" list="unidades"><datalist id="unidades"><option>unidad</option><option>hora</option><option>metro</option><option>m²</option><option>kg</option><option>punto</option><option>visita</option><option>día</option><option>global</option></datalist></div></div>
      <div class="grid2"><div><label for="i-precio">Precio sin IVA (COP)</label><input id="i-precio" inputmode="numeric" value="${c.precio !== undefined ? pesosTxt(c.precio) : ''}"></div>
      <div><label for="i-iva">IVA</label><select id="i-iva">${[0, 5, 19].map((v) => `<option value="${v}" ${v === c.iva ? 'selected' : ''}>${v} %</option>`).join('')}</select></div></div>
      <label for="i-cod">Código (opcional)</label><input id="i-cod" value="${esc(c.codigo)}">
      ${c.id ? `<label class="check"><input type="checkbox" id="i-act" ${c.activo ? 'checked' : ''}><span>Activo (aparece al cotizar)</span></label>` : ''}
      <p class="tiny muted">Cambiar un precio no modifica las cotizaciones ya enviadas.</p>
      <div class="btns"><button data-cerrar style="flex:1">Cancelar</button><button class="prim" id="i-ok" style="flex:2">Guardar</button></div>`, (p) => {
      p.querySelector('#i-ok').onclick = intentar(async () => {
        const precio = leerPesos(p.querySelector('#i-precio').value);
        if (precio === null) throw new Error('Escribe el precio en pesos');
        const datos = { nombre: p.querySelector('#i-nombre').value, descripcion: p.querySelector('#i-desc').value, tipo: p.querySelector('#i-tipo').value,
          unidad: p.querySelector('#i-unidad').value, precio, iva: Number(p.querySelector('#i-iva').value), codigo: p.querySelector('#i-cod').value,
          activo: p.querySelector('#i-act') ? p.querySelector('#i-act').checked : true };
        await api(c.id ? 'PUT' : 'POST', c.id ? `/catalogo/${c.id}` : '/catalogo', datos);
        cerrarHoja(); aviso('Catálogo actualizado'); vCatalogo();
      });
    });
    document.getElementById('c-q').oninput = pintar;
    document.getElementById('c-add').onclick = () => editar();
    pintar();
  }

  // ---------- Mensajes ----------
  async function vMensajes() {
    const r = await api('GET', '/mensajes');
    const TIPO_M = { cotizacion: 'Cotización', codigo: 'Código de aprobación', recordatorio: 'Recordatorio', aviso_dueno: 'Aviso al dueño' };
    app.innerHTML = top('Mensajes', { atras: '#/mas', der: '<button class="chico" id="m-tareas">Revisar ahora</button>' }) + `<div class="cont">
      ${modoMensajeria === 'demo' ? '<div class="alerta warn">Modo demostración: ningún mensaje sale realmente. Aquí ves lo que se enviaría por WhatsApp o correo.</div>' : ''}
      <div class="card lista">${r.map((m) => `<div class="item"><div class="fila"><b>${esc(TIPO_M[m.tipo] || m.tipo)}</b><span class="tiny muted">${fechaHora(m.at)}</span></div>
        <div class="small muted">${esc(m.canal)} → ${esc(m.destino)} · ${esc(m.estado)}${m.consecutivo ? ' · ' + esc(m.consecutivo) : ''}</div>
        <div class="small" style="margin-top:4px">${esc(m.texto)}</div>${m.error ? `<div class="small peligro">${esc(m.error)}</div>` : ''}</div>`).join('') || '<div class="vacio">Sin mensajes.</div>'}</div></div>`;
    document.getElementById('m-tareas').onclick = intentar(async () => {
      const t = await api('POST', '/tareas');
      aviso(`${t.vencidas} vencidas, ${t.recordatorios} recordatorios`); vMensajes();
    });
  }

  // ---------- Configuración ----------
  async function vConfig() {
    const n = negocio = await api('GET', '/negocio');
    app.innerHTML = top('Configuración', { atras: '#/mas' }) + `<div class="cont">
      <div class="card"><h2>Marca</h2>
        <label for="g-nombre">Nombre del negocio</label><input id="g-nombre" value="${esc(n.nombre)}">
        <label>Logo (PNG o JPG)</label><div class="fila" style="justify-content:flex-start"><img id="g-logo-prev" class="logo-prev" ${n.logo ? `src="${esc(n.logo)}"` : 'hidden'} alt="Logo">
        <input type="file" id="g-logo" accept="image/png,image/jpeg" style="max-width:220px"><button class="chico" id="g-logo-quitar">Quitar</button></div>
        <div class="tiny muted">Usa un logo que el cliente haya autorizado por escrito.</div>
        <div class="grid2"><div><label for="g-c1">Color principal</label><input type="color" id="g-c1" value="${esc(n.color1)}"></div>
        <div><label for="g-c2">Color suave</label><input type="color" id="g-c2" value="${esc(n.color2)}"></div></div></div>
      <div class="card"><h2>Datos del negocio</h2>
        <div class="grid2"><div><label for="g-nit">NIT</label><input id="g-nit" value="${esc(n.nit)}"></div><div><label for="g-tel">Teléfono</label><input id="g-tel" value="${esc(n.telefono)}"></div></div>
        <div class="grid2"><div><label for="g-correo">Correo</label><input id="g-correo" value="${esc(n.correo)}"></div><div><label for="g-ciudad">Ciudad</label><input id="g-ciudad" value="${esc(n.ciudad)}"></div></div>
        <label for="g-dir">Dirección</label><input id="g-dir" value="${esc(n.direccion)}"></div>
      <div class="card"><h2>Cotizaciones</h2>
        <div class="grid2"><div><label for="g-vig">Vigencia por defecto (días)</label><input id="g-vig" inputmode="numeric" value="${n.vigencia_dias}"></div>
        <div><label for="g-red">Redondeo del total</label><select id="g-red">${[[1, 'Al peso (sin ajuste)'], [50, 'Múltiplo de $50'], [100, 'Múltiplo de $100'], [1000, 'Múltiplo de $1.000']].map(([v, t]) => `<option value="${v}" ${v === n.redondeo ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
        <label for="g-cond">Condiciones por defecto (redáctalas con el abogado del cliente)</label><textarea id="g-cond" rows="8">${esc(n.condiciones)}</textarea>
        <label for="g-notas">Notas por defecto</label><textarea id="g-notas" rows="2">${esc(n.notas)}</textarea>
        <label for="g-pol">Enlace a la política de tratamiento de datos</label><input id="g-pol" value="${esc(n.politica_datos)}" placeholder="https://minegocio.co/politica-de-datos"></div>
      <div class="card"><h2>Avisos al dueño</h2><div class="small muted">Te avisamos cuando el cliente ve, aprueba, pide cambios o rechaza.</div>
        <div class="grid2"><div><label for="g-wa">WhatsApp</label><input id="g-wa" inputmode="tel" value="${esc(n.whatsapp_dueno)}"></div><div><label for="g-cd">Correo</label><input id="g-cd" value="${esc(n.correo_dueno)}"></div></div></div>
      <button class="prim bloque" id="g-ok" style="margin-top:12px;padding:14px">Guardar configuración</button>
      <div class="card"><h2>Cambiar contraseña</h2><label for="g-pa">Actual</label><input type="password" id="g-pa" autocomplete="current-password">
        <label for="g-pn">Nueva (mínimo 8 caracteres)</label><input type="password" id="g-pn" autocomplete="new-password"><button id="g-clave" style="margin-top:10px">Cambiar</button></div></div>`;
    let logo = n.logo;
    document.getElementById('g-logo').onchange = intentar(async (e) => {
      const f = e.target.files[0]; if (!f) return;
      logo = await reducirImagen(f, 400);
      const img = document.getElementById('g-logo-prev'); img.src = logo; img.hidden = false;
    });
    document.getElementById('g-logo-quitar').onclick = () => { logo = ''; document.getElementById('g-logo-prev').hidden = true; };
    const v = (i) => document.getElementById(i).value;
    document.getElementById('g-ok').onclick = intentar(async () => {
      negocio = await api('PUT', '/negocio', {
        nombre: v('g-nombre'), logo, color1: v('g-c1'), color2: v('g-c2'), nit: v('g-nit'), telefono: v('g-tel'), correo: v('g-correo'), ciudad: v('g-ciudad'),
        direccion: v('g-dir'), vigencia_dias: Number(v('g-vig')), redondeo: Number(v('g-red')), condiciones: v('g-cond'), notas: v('g-notas'),
        politica_datos: v('g-pol'), whatsapp_dueno: v('g-wa'), correo_dueno: v('g-cd'),
      });
      document.documentElement.style.setProperty('--c1', negocio.color1);
      document.documentElement.style.setProperty('--c1-suave', negocio.color2);
      aviso('Configuración guardada');
    });
    document.getElementById('g-clave').onclick = intentar(async () => { await api('POST', '/clave', { actual: v('g-pa'), nueva: v('g-pn') }); aviso('Contraseña cambiada'); });
  }
  // Reduce el logo a un PNG de máximo `lado` píxeles para que el PDF y la página carguen rápido.
  function reducirImagen(archivo, lado) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, lado / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(img.src);
        resolve(cv.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('No se pudo leer la imagen'));
      img.src = URL.createObjectURL(archivo);
    });
  }

  // ---------- Más ----------
  function vMas() {
    const fila = (href, t, s, extra = '') => `<a class="item" href="${href}" ${extra}><b>${t}</b><div class="small muted">${s}</div></a>`;
    app.innerHTML = top('Más') + `<div class="cont"><div class="card lista">
      ${fila('#/clientes', 'Clientes', 'Datos de contacto y autorización de datos')}
      ${fila('#/mensajes', 'Mensajes', 'Lo que se envió por WhatsApp y correo')}
      ${fila('#/config', 'Configuración', 'Logo, colores, condiciones, vigencia y avisos')}
      ${fila('/verificar', 'Verificar una huella', 'Comprobar que una cotización no fue alterada', 'target="_blank"')}
      ${fila('/api/exportar/aprobadas.csv', 'Exportar aprobadas (CSV)', 'Para el software de facturación electrónica')}
      ${fila('/api/exportar/aprobadas.json', 'Exportar aprobadas (JSON)', 'Para integraciones', 'target="_blank"')}
      </div><button class="bloque" id="salir" style="margin-top:14px">Cerrar sesión</button>
      <p class="tiny muted" style="text-align:center;margin-top:14px">La cotización no es una factura. Si el negocio debe facturar electrónicamente, la factura sale por un software habilitado ante la DIAN.</p></div>`;
    document.getElementById('salir').onclick = intentar(async () => { await api('POST', '/logout'); yo = null; vLogin(); });
  }

  iniciar();
})();
