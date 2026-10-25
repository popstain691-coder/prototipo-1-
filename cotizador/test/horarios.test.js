const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../src/horarios');

test('festivos de Colombia 2026', () => {
  const f = [...H.festivos(2026)].sort();
  assert.deepEqual(f, [
    '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-18', '2026-06-08',
    '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16',
    '2026-12-08', '2026-12-25',
  ]);
});

test('ventanas de la Ley 2300', () => {
  // Lunes 26 de octubre de 2026
  assert.equal(H.enHorarioPermitido(H.msBogota(2026, 10, 26, 6, 59)), false);
  assert.equal(H.enHorarioPermitido(H.msBogota(2026, 10, 26, 7, 0)), true);
  assert.equal(H.enHorarioPermitido(H.msBogota(2026, 10, 26, 18, 59)), true);
  assert.equal(H.enHorarioPermitido(H.msBogota(2026, 10, 26, 19, 0)), false);
  // Sábado 31 de octubre: 8 a 15
  assert.equal(H.enHorarioPermitido(H.msBogota(2026, 10, 31, 7, 30)), false);
  assert.equal(H.enHorarioPermitido(H.msBogota(2026, 10, 31, 14, 59)), true);
  assert.equal(H.enHorarioPermitido(H.msBogota(2026, 10, 31, 15, 0)), false);
  // Domingo y festivo (lunes 2 de noviembre de 2026)
  assert.equal(H.enHorarioPermitido(H.msBogota(2026, 11, 1, 10)), false);
  assert.equal(H.enHorarioPermitido(H.msBogota(2026, 11, 2, 10)), false);
});

test('siguiente horario permitido salta domingo y festivo', () => {
  // Sábado 31 oct 16:00 → domingo no, lunes 2 nov festivo → martes 3 nov 7:00
  assert.equal(H.siguienteHorarioPermitido(H.msBogota(2026, 10, 31, 16)), H.msBogota(2026, 11, 3, 7));
  // Viernes 20:00 → sábado 8:00
  assert.equal(H.siguienteHorarioPermitido(H.msBogota(2026, 10, 30, 20)), H.msBogota(2026, 10, 31, 8));
});
