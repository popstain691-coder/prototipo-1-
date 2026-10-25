// PDF de una versión congelada. Se genera siempre desde el documento guardado, nunca desde el borrador.
const PDFDocument = require('pdfkit');
const { fmtPesos, fmtCantidad, fmtPorcentaje } = require('./calc');
const { fmtFechaHora } = require('./horarios');
const fmtContacto = (c) => (/^57\d{10}$/.test(c || '') ? `+57 ${c.slice(2, 5)} ${c.slice(5, 8)} ${c.slice(8)}` : c);

function imagenDeDataUrl(dataUrl) {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl || '');
  return m ? Buffer.from(m[2], 'base64') : null;
}

const colorValido = (c, defecto) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : defecto);

/**
 * @param {object} doc documento de la versión
 * @param {{huella:string, aprobacion?:object, verificarUrl?:string}} extra
 * @returns {Promise<Buffer>}
 */
function generarPdf(doc, { huella, aprobacion = null, verificarUrl = '' } = {}) {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'LETTER', margin: 40, bufferPages: true, info: {
      Title: `Cotización ${doc.consecutivo} v${doc.version}`, Author: doc.negocio.nombre, Subject: `Huella SHA-256 ${huella}`,
    } });
    const partes = [];
    pdf.on('data', (b) => partes.push(b));
    pdf.on('end', () => resolve(Buffer.concat(partes)));
    pdf.on('error', reject);

    const c1 = colorValido(doc.negocio.color1, '#0f6cbd');
    const c2 = colorValido(doc.negocio.color2, '#e8f1fb');
    const gris = '#555555';
    const W = pdf.page.width, M = 40, ancho = W - 2 * M;

    // Encabezado
    pdf.rect(0, 0, W, 8).fill(c1);
    let y = 28;
    const logo = imagenDeDataUrl(doc.negocio.logo);
    let xTexto = M;
    if (logo) {
      try { pdf.image(logo, M, y, { fit: [90, 60] }); xTexto = M + 104; } catch { /* imagen no soportada */ }
    }
    pdf.fillColor('#111').font('Helvetica-Bold').fontSize(15).text(doc.negocio.nombre, xTexto, y, { width: 260 });
    pdf.font('Helvetica').fontSize(9).fillColor(gris);
    const datosNeg = [doc.negocio.nit && `NIT ${doc.negocio.nit}`, doc.negocio.direccion, doc.negocio.ciudad, doc.negocio.telefono, doc.negocio.correo].filter(Boolean);
    pdf.text(datosNeg.join(' · '), xTexto, pdf.y + 2, { width: 260 });

    pdf.font('Helvetica-Bold').fontSize(18).fillColor(c1).text('COTIZACIÓN', M, y, { width: ancho, align: 'right' });
    pdf.font('Helvetica').fontSize(10).fillColor('#111')
      .text(`${doc.consecutivo} · versión ${doc.version}`, M, y + 24, { width: ancho, align: 'right' })
      .fillColor(gris).text(`Emitida: ${doc.emitida}`, { width: ancho, align: 'right' })
      .text(`Válida hasta: ${doc.vigencia}`, { width: ancho, align: 'right' });
    y = Math.max(pdf.y, y + 70) + 14;

    // Cliente
    pdf.roundedRect(M, y, ancho, 58, 6).fill(c2);
    pdf.fillColor(gris).fontSize(8).text('CLIENTE', M + 12, y + 9);
    pdf.fillColor('#111').font('Helvetica-Bold').fontSize(11).text(doc.cliente.nombre, M + 12, y + 20, { width: ancho / 2 });
    pdf.font('Helvetica').fontSize(9).fillColor(gris);
    const datosCli = [doc.cliente.documento && `Doc. ${doc.cliente.documento}`, doc.cliente.celular, doc.cliente.correo].filter(Boolean).join(' · ');
    pdf.text(datosCli, M + 12, y + 36, { width: ancho / 2 - 12 });
    if (doc.cliente.direccion) pdf.text(`Lugar del servicio: ${doc.cliente.direccion}`, M + ancho / 2, y + 20, { width: ancho / 2 - 12 });
    if (doc.borrador.titulo) pdf.font('Helvetica-Bold').fillColor('#111').text(doc.borrador.titulo, M + ancho / 2, y + 36, { width: ancho / 2 - 12 });
    y += 72;

    // Tabla de ítems
    const cols = [
      { t: 'Descripción', w: 196, a: 'left' }, { t: 'Cant.', w: 44, a: 'right' }, { t: 'Unidad', w: 50, a: 'left' },
      { t: 'Precio unit.', w: 70, a: 'right' }, { t: 'Desc.', w: 50, a: 'right' }, { t: 'IVA', w: 32, a: 'right' }, { t: 'Valor', w: ancho - 442, a: 'right' },
    ];
    const encabezado = () => {
      pdf.rect(M, y, ancho, 20).fill(c1);
      let x = M + 6;
      pdf.font('Helvetica-Bold').fontSize(8.5).fillColor('#fff');
      for (const c of cols) { pdf.text(c.t, x, y + 6, { width: c.w - 8, align: c.a }); x += c.w; }
      y += 24;
    };
    encabezado();
    pdf.font('Helvetica').fontSize(9);
    doc.lineas.forEach((l, i) => {
      const desc = l.descripcion ? `${l.nombre}\n${l.descripcion}` : l.nombre;
      const alto = Math.max(pdf.heightOfString(desc, { width: cols[0].w - 8 }), 11) + 8;
      if (y + alto > pdf.page.height - 120) { pdf.addPage(); y = M; encabezado(); pdf.font('Helvetica').fontSize(9); }
      if (i % 2 === 1) pdf.rect(M, y - 3, ancho, alto).fill('#f6f7f9');
      const descuento = l.desc_item + l.desc_global;
      const celdas = [desc, fmtCantidad(l.cantidad_mil), l.unidad, fmtPesos(l.precio), descuento ? `-${fmtPesos(descuento)}` : '—', `${l.iva} %`, fmtPesos(l.neto)];
      let x = M + 6;
      celdas.forEach((t, k) => {
        pdf.fillColor(k === 0 ? '#111' : '#333').font(k === 6 ? 'Helvetica-Bold' : 'Helvetica').text(t, x, y, { width: cols[k].w - 8, align: cols[k].a });
        x += cols[k].w;
      });
      y += alto;
    });

    // Totales
    if (y > pdf.page.height - 230) { pdf.addPage(); y = M; }
    y += 8;
    const t = doc.totales;
    const filas = [['Subtotal', fmtPesos(t.subtotal)]];
    if (t.descuento_items) filas.push(['Descuentos por ítem', `-${fmtPesos(t.descuento_items)}`]);
    if (t.descuento_global) filas.push([`Descuento global (${fmtPorcentaje(doc.borrador.desc_global_bp)})`, `-${fmtPesos(t.descuento_global)}`]);
    filas.push(['Base', fmtPesos(t.base)]);
    for (const [tarifa, v] of Object.entries(t.iva_por_tarifa)) if (Number(tarifa) > 0) filas.push([`IVA ${tarifa} % sobre ${fmtPesos(v.base)}`, fmtPesos(v.iva)]);
    if (t.ajuste) filas.push(['Ajuste al peso', fmtPesos(t.ajuste)]);
    const xT = M + ancho - 250;
    pdf.fontSize(9.5);
    for (const [k, v] of filas) {
      pdf.fillColor(gris).font('Helvetica').text(k, xT, y, { width: 150 });
      pdf.fillColor('#111').text(v, xT + 150, y, { width: 100, align: 'right' });
      y += 15;
    }
    pdf.rect(xT, y + 2, 250, 26).fill(c1);
    pdf.fillColor('#fff').font('Helvetica-Bold').fontSize(12).text('TOTAL', xT + 10, y + 10).text(fmtPesos(t.total), xT + 110, y + 10, { width: 130, align: 'right' });
    y += 44;

    // Condiciones y notas
    const bloque = (titulo, texto) => {
      if (!texto) return;
      if (y > pdf.page.height - 140) { pdf.addPage(); y = M; }
      pdf.fillColor(c1).font('Helvetica-Bold').fontSize(10).text(titulo, M, y);
      pdf.fillColor('#222').font('Helvetica').fontSize(9).text(texto, M, pdf.y + 3, { width: ancho });
      y = pdf.y + 12;
    };
    bloque('Condiciones', doc.borrador.condiciones);
    bloque('Notas', doc.borrador.notas);

    // Evidencia de aprobación
    if (aprobacion) {
      if (y > pdf.page.height - 170) { pdf.addPage(); y = M; }
      pdf.roundedRect(M, y, ancho, 92, 6).lineWidth(1.5).stroke('#1a7f37');
      pdf.fillColor('#1a7f37').font('Helvetica-Bold').fontSize(11).text('APROBADA EN LÍNEA', M + 12, y + 10);
      pdf.fillColor('#222').font('Helvetica').fontSize(9).text(
        `Aprobó: ${aprobacion.nombre}\n` +
        `Verificado con código de un solo uso enviado por ${aprobacion.canal === 'correo' ? 'correo' : 'WhatsApp'} a ${fmtContacto(aprobacion.contacto)}\n` +
        `Fecha y hora: ${fmtFechaHora(aprobacion.at)} · IP ${aprobacion.ip || '—'}\n` +
        `Versión aprobada: ${aprobacion.version} · Huella SHA-256: ${aprobacion.huella}`,
        M + 12, y + 28, { width: ancho - 24, lineGap: 2 },
      );
      y += 104;
    }

    // Pie en todas las páginas
    const rango = pdf.bufferedPageRange();
    for (let i = 0; i < rango.count; i++) {
      pdf.switchToPage(i);
      const yPie = pdf.page.height - 62;
      pdf.page.margins.bottom = 0;
      pdf.moveTo(M, yPie).lineTo(W - M, yPie).lineWidth(0.5).stroke('#cccccc');
      pdf.fillColor(gris).font('Helvetica').fontSize(7.5)
        .text(`${doc.leyenda} Huella SHA-256 de esta versión: ${huella}`, M, yPie + 6, { width: ancho - 60 })
        .text(verificarUrl ? `Verifique la autenticidad en ${verificarUrl}` : '', M, pdf.y + 2, { width: ancho - 60 });
      pdf.text(`Página ${i + 1} de ${rango.count}`, W - M - 80, yPie + 6, { width: 80, align: 'right' });
    }
    pdf.end();
  });
}

module.exports = { generarPdf };
