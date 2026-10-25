// Motor de cálculo. Todo en pesos enteros (BigInt por dentro), sin decimales flotantes.
//   cantidad_mil: cantidad en milésimas (1,5 kg = 1500)
//   precio:       precio unitario sin IVA, en pesos enteros
//   desc_bp:      descuento en centésimas de punto (10 % = 1000)
//   iva:          tarifa de IVA en puntos enteros (0, 5, 19)

const big = (v, campo) => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v);
  if (!Number.isSafeInteger(v) || v < 0) throw new Error(`${campo} debe ser un entero no negativo`);
  return BigInt(v);
};

// a / b redondeado al entero más cercano; 0,5 sube. Acepta a negativo.
function dividirRedondeando(a, b) {
  if (a < 0n) return -dividirRedondeando(-a, b);
  return (2n * a + b) / (2n * b);
}

function validarItem(it, i) {
  const n = `Ítem ${i + 1}`;
  const cantidad = big(it.cantidad_mil, `${n}: cantidad`);
  if (cantidad === 0n) throw new Error(`${n}: la cantidad debe ser mayor que cero`);
  const precio = big(it.precio, `${n}: precio`);
  const desc = big(it.desc_bp ?? 0, `${n}: descuento`);
  if (desc > 10000n) throw new Error(`${n}: el descuento no puede pasar de 100 %`);
  const iva = big(it.iva ?? 0, `${n}: IVA`);
  if (iva > 100n) throw new Error(`${n}: IVA inválido`);
  return { cantidad, precio, desc, iva };
}

/**
 * Calcula una cotización.
 * @param {{items: object[], desc_global_bp?: number, redondeo?: number}} entrada
 * @returns lineas con sus montos y totales, todo como Number (pesos enteros).
 */
function calcular({ items = [], desc_global_bp = 0, redondeo = 1 } = {}) {
  const descGlobal = big(desc_global_bp, 'Descuento global');
  if (descGlobal > 10000n) throw new Error('El descuento global no puede pasar de 100 %');
  const paso = big(redondeo || 1, 'Redondeo');

  const lineas = items.map((it, i) => {
    const v = validarItem(it, i);
    const base = dividirRedondeando(v.cantidad * v.precio, 1000n);       // 1. base
    const descItem = dividirRedondeando(base * v.desc, 10000n);          // 2. descuento del ítem
    return { ...v, base, descItem, neto: base - descItem };              // 3. neto
  });

  // 4. Descuento global, repartido por residuo mayor para que cuadre al peso.
  const sumaNetos = lineas.reduce((s, l) => s + l.neto, 0n);
  const totalDescGlobal = dividirRedondeando(sumaNetos * descGlobal, 10000n);
  let asignado = 0n;
  const residuos = lineas.map((l, i) => {
    if (sumaNetos === 0n) { l.descGlobal = 0n; return { i, r: 0n }; }
    const num = l.neto * totalDescGlobal;
    l.descGlobal = num / sumaNetos;
    asignado += l.descGlobal;
    return { i, r: num % sumaNetos };
  });
  let sobrante = totalDescGlobal - asignado;
  residuos.sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (const { i } of residuos) {
    if (sobrante <= 0n) break;
    lineas[i].descGlobal += 1n;
    sobrante -= 1n;
  }

  // 5. IVA por ítem sobre el neto después del descuento global.
  for (const l of lineas) {
    l.netoFinal = l.neto - l.descGlobal;
    l.valorIva = dividirRedondeando(l.netoFinal * l.iva, 100n);
    l.total = l.netoFinal + l.valorIva;
  }

  const suma = (k) => lineas.reduce((s, l) => s + l[k], 0n);
  const subtotal = suma('base');
  const descuentos = suma('descItem') + suma('descGlobal');
  const baseGravable = suma('netoFinal');
  const iva = suma('valorIva');
  const totalSinAjuste = baseGravable + iva;                              // 6. total
  const ajuste = paso > 1n ? dividirRedondeando(totalSinAjuste, paso) * paso - totalSinAjuste : 0n; // 7.

  // IVA agrupado por tarifa, útil para el PDF y para el contador.
  const porTarifa = {};
  for (const l of lineas) {
    const k = String(l.iva);
    porTarifa[k] ??= { base: 0n, iva: 0n };
    porTarifa[k].base += l.netoFinal;
    porTarifa[k].iva += l.valorIva;
  }

  const n = Number;
  return {
    lineas: lineas.map((l) => ({
      base: n(l.base), desc_item: n(l.descItem), desc_global: n(l.descGlobal),
      neto: n(l.netoFinal), valor_iva: n(l.valorIva), total: n(l.total),
    })),
    totales: {
      subtotal: n(subtotal),
      descuento_items: n(suma('descItem')),
      descuento_global: n(totalDescGlobal),
      descuentos: n(descuentos),
      base: n(baseGravable),
      iva: n(iva),
      iva_por_tarifa: Object.fromEntries(Object.entries(porTarifa).map(([k, v]) => [k, { base: n(v.base), iva: n(v.iva) }])),
      ajuste: n(ajuste),
      total: n(totalSinAjuste + ajuste),
    },
  };
}

// Utilidades de formato (Colombia).
const fmtPesos = (v) => '$' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(v);
const fmtCantidad = (mil) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 }).format(mil / 1000);
const fmtPorcentaje = (bp) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(bp / 100) + ' %';

const Calc = { calcular, dividirRedondeando, fmtPesos, fmtCantidad, fmtPorcentaje };
// El mismo archivo se usa en el servidor y en el navegador (panel), para que los totales coincidan siempre.
if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
else globalThis.Calc = Calc;
