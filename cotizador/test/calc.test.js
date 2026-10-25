const test = require('node:test');
const assert = require('node:assert/strict');
const { calcular, dividirRedondeando } = require('../src/calc');

test('ejemplo de la documentación: total COP 504.157', () => {
  const r = calcular({
    desc_global_bp: 500,
    items: [
      { cantidad_mil: 2000, precio: 180000, desc_bp: 0, iva: 19 },
      { cantidad_mil: 1500, precio: 45000, desc_bp: 1000, iva: 19 },
      { cantidad_mil: 1000, precio: 30000, desc_bp: 0, iva: 0 },
    ],
  });
  assert.deepEqual(r.lineas.map((l) => l.desc_global), [18000, 3038, 1500]);
  assert.deepEqual(r.lineas.map((l) => l.neto), [342000, 57712, 28500]);
  assert.deepEqual(r.lineas.map((l) => l.valor_iva), [64980, 10965, 0]);
  assert.equal(r.totales.subtotal, 457500);
  assert.equal(r.totales.descuentos, 29288);
  assert.equal(r.totales.base, 428212);
  assert.equal(r.totales.iva, 75945);
  assert.equal(r.totales.total, 504157);
});

test('redondeo: 0,5 sube y todo queda en enteros', () => {
  assert.equal(dividirRedondeando(5n, 2n), 3n);
  assert.equal(dividirRedondeando(4n, 3n), 1n);
  const r = calcular({ items: [{ cantidad_mil: 333, precio: 1000, iva: 19 }] }); // 0,333 × 1000 = 333
  assert.equal(r.totales.base, 333);
  assert.equal(r.totales.iva, 63); // 63,27
  for (const v of Object.values(r.totales)) if (typeof v === 'number') assert.ok(Number.isInteger(v));
});

test('el descuento global repartido siempre cuadra al peso', () => {
  for (let s = 1; s < 200; s++) {
    const items = Array.from({ length: (s % 7) + 1 }, (_, i) => ({ cantidad_mil: 1000 + ((s * 37 + i * 101) % 5000), precio: 1000 + ((s * 7919 + i * 104729) % 900000), iva: [0, 5, 19][i % 3] }));
    const r = calcular({ items, desc_global_bp: (s * 13) % 10001 });
    const suma = r.lineas.reduce((a, l) => a + l.desc_global, 0);
    assert.equal(suma, r.totales.descuento_global);
    assert.equal(r.lineas.reduce((a, l) => a + l.total, 0), r.totales.total);
  }
});

test('ajuste del total al múltiplo de 100', () => {
  const r = calcular({ items: [{ cantidad_mil: 1000, precio: 10049, iva: 0 }], redondeo: 100 });
  assert.equal(r.totales.ajuste, -49);
  assert.equal(r.totales.total, 10000);
});

test('rechaza valores inválidos', () => {
  assert.throws(() => calcular({ items: [{ cantidad_mil: 0, precio: 1 }] }));
  assert.throws(() => calcular({ items: [{ cantidad_mil: 1000, precio: 1.5 }] }));
  assert.throws(() => calcular({ items: [{ cantidad_mil: 1000, precio: 100, desc_bp: 10001 }] }));
});
