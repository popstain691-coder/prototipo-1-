// Bandeja de salida de mensajes (WhatsApp y correo).
// MENSAJERIA=demo (por defecto): no se envía nada, los mensajes quedan visibles en el panel > Mensajes.
// MENSAJERIA=real: WhatsApp Cloud API (plantillas aprobadas por Meta) y correo SMTP.
//
// Las plantillas de WhatsApp deben crearse en Meta con estos nombres (configurables por variable de entorno)
// y escribirse solo con información de la cotización pedida, para que Meta las trate como "utilidad".

const PLANTILLAS_WA = {
  cotizacion: process.env.WA_TPL_COTIZACION || 'cotizacion_enviada',     // {{1}} cliente {{2}} negocio {{3}} consecutivo {{4}} enlace
  codigo: process.env.WA_TPL_CODIGO || 'codigo_aprobacion',              // plantilla de autenticación: {{1}} código
  recordatorio: process.env.WA_TPL_RECORDATORIO || 'cotizacion_recordatorio', // {{1}} cliente {{2}} consecutivo {{3}} enlace
  aviso: process.env.WA_TPL_AVISO || 'aviso_dueno',                      // {{1}} texto del aviso
};

function crearMensajeria(db, opciones = {}) {
  const modo = opciones.modo || process.env.MENSAJERIA || 'demo';
  let transporteCorreo = null;

  function correoTransporte() {
    if (transporteCorreo) return transporteCorreo;
    const nodemailer = require('nodemailer');
    transporteCorreo = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === '1',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    return transporteCorreo;
  }

  async function enviarWhatsApp(destino, plantilla, parametros) {
    const url = `https://graph.facebook.com/${process.env.WA_API_VERSION || 'v21.0'}/${process.env.WA_PHONE_ID}/messages`;
    const components = [{ type: 'body', parameters: parametros.map((t) => ({ type: 'text', text: String(t) })) }];
    if (plantilla === PLANTILLAS_WA.codigo) {
      // Las plantillas de autenticación llevan el código también en el botón de copiar.
      components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(parametros[0]) }] });
    }
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: destino.replace(/\D/g, ''), type: 'template',
        template: { name: plantilla, language: { code: process.env.WA_IDIOMA || 'es_CO' }, components },
      }),
    });
    if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }

  async function enviarCorreo(destino, asunto, texto) {
    await correoTransporte().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER, to: destino, subject: asunto, text: texto,
    });
  }

  /**
   * Registra y envía un mensaje.
   * @param {{cotizacion_id?, canal:'whatsapp'|'correo', destino, tipo, texto, asunto?, plantilla?, parametros?}} m
   */
  async function enviar(m) {
    const at = Date.now();
    const { lastInsertRowid: id } = db.ejecutar(
      'INSERT INTO mensajes (cotizacion_id, canal, destino, tipo, texto, estado, at) VALUES (?,?,?,?,?,?,?)',
      m.cotizacion_id ?? null, m.canal, m.destino, m.tipo, m.texto, modo === 'demo' ? 'simulado' : 'pendiente', at,
    );
    if (modo === 'demo') return { id, estado: 'simulado' };
    try {
      if (m.canal === 'whatsapp') await enviarWhatsApp(m.destino, PLANTILLAS_WA[m.plantilla] || m.plantilla, m.parametros || [m.texto]);
      else await enviarCorreo(m.destino, m.asunto || 'Cotización', m.texto);
      db.ejecutar("UPDATE mensajes SET estado = 'enviado' WHERE id = ?", id);
      return { id, estado: 'enviado' };
    } catch (e) {
      db.ejecutar("UPDATE mensajes SET estado = 'error', error = ? WHERE id = ?", String(e.message).slice(0, 500), id);
      return { id, estado: 'error', error: e.message };
    }
  }

  // Aviso al dueño: por WhatsApp y/o correo según la configuración del negocio.
  async function avisarDueno(cotizacionId, texto) {
    const n = db.uno('SELECT whatsapp_dueno, correo_dueno, nombre FROM negocio WHERE id = 1');
    const envios = [];
    if (n.whatsapp_dueno) envios.push(enviar({ cotizacion_id: cotizacionId, canal: 'whatsapp', destino: n.whatsapp_dueno, tipo: 'aviso_dueno', texto, plantilla: 'aviso', parametros: [texto] }));
    if (n.correo_dueno) envios.push(enviar({ cotizacion_id: cotizacionId, canal: 'correo', destino: n.correo_dueno, tipo: 'aviso_dueno', texto, asunto: `Aviso: ${texto.slice(0, 60)}` }));
    if (!envios.length) envios.push(enviar({ cotizacion_id: cotizacionId, canal: 'panel', destino: 'panel', tipo: 'aviso_dueno', texto }));
    return Promise.all(envios);
  }

  return { modo, enviar, avisarDueno };
}

module.exports = { crearMensajeria, PLANTILLAS_WA };
