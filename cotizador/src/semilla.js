// Datos de demostración: se cargan solo si la base está vacía. Desactivar con SEED_DEMO=0.
const { hashClave } = require('./auth');

const CONDICIONES = `Vigencia: los precios se mantienen hasta la fecha indicada.
Alcance: incluye únicamente los ítems listados. Trabajos adicionales se cotizan por aparte.
Exclusiones: obras civiles, resanes y pintura no están incluidos salvo que aparezcan como ítem.
Forma de pago: 50 % al aprobar y 50 % al terminar, por transferencia o efectivo.
Garantía: 90 días sobre mano de obra; repuestos según garantía del fabricante.
Cambios: cualquier cambio de alcance genera una nueva versión de esta cotización.`;

const CATALOGO = [
  ['MT-12', 'Mantenimiento preventivo minisplit 9.000–12.000 BTU', 'Limpieza de filtros, serpentines y bandeja; revisión de presiones', 'servicio', 'unidad', 150000, 19],
  ['MT-24', 'Mantenimiento preventivo minisplit 18.000–24.000 BTU', 'Limpieza completa y revisión eléctrica', 'servicio', 'unidad', 190000, 19],
  ['IN-12', 'Instalación minisplit hasta 12.000 BTU', 'Incluye hasta 3 m de tubería y soportes', 'servicio', 'unidad', 450000, 19],
  ['GR-410', 'Gas refrigerante R410A', '', 'material', 'kg', 45000, 19],
  ['TB-CU', 'Tubería de cobre 1/4" + 3/8" aislada', '', 'material', 'metro', 38000, 19],
  ['MO-H', 'Mano de obra técnica', 'Hora de técnico certificado', 'mano_obra', 'hora', 60000, 19],
  ['PL-DES', 'Destape de tubería con sonda', '', 'servicio', 'punto', 120000, 19],
  ['EL-TOM', 'Instalación de tomacorriente', 'Incluye cableado hasta 5 m', 'servicio', 'punto', 70000, 19],
  ['DESP-U', 'Desplazamiento zona urbana', '', 'desplazamiento', 'visita', 30000, 0],
  ['DESP-R', 'Desplazamiento zona rural o municipio cercano', '', 'desplazamiento', 'visita', 70000, 0],
];

function sembrarDemo(db, servicio) {
  if (db.uno('SELECT COUNT(*) AS n FROM usuarios').n > 0) return false;
  const t = Date.now();
  db.tx(() => {
    db.ejecutar(`UPDATE negocio SET nombre = ?, nit = ?, telefono = ?, correo = ?, direccion = ?, ciudad = ?, color1 = ?, color2 = ?,
      condiciones = ?, notas = ?, vigencia_dias = 15, redondeo = 1, correo_dueno = ?, whatsapp_dueno = ? WHERE id = 1`,
    'Clima Total Servicios (demo)', '900.000.000-0', '+57 300 000 0000', 'contacto@ejemplo.co', 'Calle 00 # 00-00', 'Barranquilla',
    '#0f6cbd', '#e8f1fb', CONDICIONES, 'Gracias por confiar en nosotros.', 'dueno@ejemplo.co', '573000000000');
    db.ejecutar('INSERT INTO usuarios (nombre, correo, clave, rol, creado) VALUES (?,?,?,?,?)', 'Usuario demo', 'demo@cotiza.local', hashClave('demo1234'), 'dueno', t);
    for (const c of CATALOGO) db.ejecutar('INSERT INTO catalogo (codigo, nombre, descripcion, tipo, unidad, precio, iva, creado) VALUES (?,?,?,?,?,?,?,?)', ...c, t);
    db.ejecutar('INSERT INTO clientes (nombre, celular, correo, documento, direccion, autoriza_datos_at, creado) VALUES (?,?,?,?,?,?,?)',
      'Ana María Pérez (demo)', '3001234567', 'ana@ejemplo.co', '1.000.000.000', 'Cra. 00 # 00-00, apto 101', t, t);
    db.ejecutar('INSERT INTO clientes (nombre, celular, correo, documento, direccion, autoriza_datos_at, creado) VALUES (?,?,?,?,?,?,?)',
      'Restaurante El Ejemplo (demo)', '3109876543', '', '901.000.000-1', 'Av. 00 # 00-00, local 2', t, t);
  });

  const item = (codigo, cantidad_mil, desc_bp = 0) => {
    const c = db.uno('SELECT * FROM catalogo WHERE codigo = ?', codigo);
    return { catalogo_id: c.id, nombre: c.nombre, descripcion: c.descripcion, tipo: c.tipo, unidad: c.unidad, cantidad_mil, precio: c.precio, desc_bp, iva: c.iva };
  };
  const base = servicio.borradorVacio();

  // Plantilla reutilizable
  servicio.crear({ borrador: { ...base, titulo: 'Mantenimiento preventivo', items: [item('MT-12', 1000), item('DESP-U', 1000)] }, es_plantilla: 1, nombre_plantilla: 'Mantenimiento minisplit' });

  // Cotización de ejemplo (el ejemplo de la documentación), ya enviada.
  const id = servicio.crear({
    cliente_id: 1,
    borrador: { ...base, titulo: 'Mantenimiento de 2 equipos y recarga de gas', desc_global_bp: 500,
      items: [{ ...item('MT-12', 2000), precio: 180000, nombre: 'Mantenimiento minisplit 12.000 BTU' }, item('GR-410', 1500, 1000), item('DESP-U', 1000)] },
  });
  servicio.enviar(id);
  return true;
}

module.exports = { sembrarDemo };
