// Hora de Colombia (UTC-5, sin horario de verano), festivos y ventanas de contacto (Ley 2300 de 2023).
//   Lunes a viernes 7:00 a 19:00, sábado 8:00 a 15:00, domingos y festivos no.
//   El abogado del cliente debe confirmar estos valores; se pueden cambiar aquí.

const OFFSET_MS = -5 * 3600 * 1000;
const VENTANAS = {
  1: [7, 19], 2: [7, 19], 3: [7, 19], 4: [7, 19], 5: [7, 19], // lunes a viernes
  6: [8, 15],                                                 // sábado
  0: null,                                                    // domingo
};

// Partes de la fecha en hora de Colombia.
function partesBogota(ms) {
  const d = new Date(ms + OFFSET_MS);
  return {
    anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(),
    hora: d.getUTCHours(), minuto: d.getUTCMinutes(), segundo: d.getUTCSeconds(),
    diaSemana: d.getUTCDay(),
  };
}

// Instante (ms UTC) de una hora local de Colombia.
const msBogota = (anio, mes, dia, hora = 0, minuto = 0) => Date.UTC(anio, mes - 1, dia, hora, minuto) - OFFSET_MS;

const clave = (a, m, d) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Domingo de Pascua (algoritmo anónimo gregoriano).
function pascua(anio) {
  const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(anio, mes - 1, dia);
}

const DIA = 864e5;
const aClave = (msUtc) => { const d = new Date(msUtc); return clave(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };
// Ley Emiliani: el festivo se traslada al lunes siguiente si no cae en lunes.
const alLunes = (msUtc) => { const dow = new Date(msUtc).getUTCDay(); return msUtc + ((8 - dow) % 7) * DIA; };

const cache = new Map();
function festivos(anio) {
  if (cache.has(anio)) return cache.get(anio);
  const f = (m, d) => Date.UTC(anio, m - 1, d);
  const p = pascua(anio);
  const lista = [
    f(1, 1), f(5, 1), f(7, 20), f(8, 7), f(12, 8), f(12, 25),              // fijos
    ...[f(1, 6), f(3, 19), f(6, 29), f(8, 15), f(10, 12), f(11, 1), f(11, 11)].map(alLunes),
    p - 3 * DIA, p - 2 * DIA,                                               // Jueves y Viernes Santo
    p + 43 * DIA, p + 64 * DIA, p + 71 * DIA,                               // Ascensión, Corpus, Sagrado Corazón
  ];
  const set = new Set(lista.map(aClave));
  cache.set(anio, set);
  return set;
}

const esFestivo = (ms) => { const p = partesBogota(ms); return festivos(p.anio).has(clave(p.anio, p.mes, p.dia)); };

function ventanaDelDia(ms) {
  if (esFestivo(ms)) return null;
  return VENTANAS[partesBogota(ms).diaSemana];
}

function enHorarioPermitido(ms) {
  const v = ventanaDelDia(ms);
  if (!v) return false;
  const { hora } = partesBogota(ms);
  return hora >= v[0] && hora < v[1];
}

// Primer instante >= ms dentro de una ventana permitida.
function siguienteHorarioPermitido(ms) {
  if (enHorarioPermitido(ms)) return ms;
  for (let i = 0; i < 15; i++) {
    const p = partesBogota(ms + i * DIA);
    const v = ventanaDelDia(msBogota(p.anio, p.mes, p.dia, 12));
    if (!v) continue;
    const inicio = msBogota(p.anio, p.mes, p.dia, v[0]);
    const fin = msBogota(p.anio, p.mes, p.dia, v[1]);
    if (ms < inicio) return inicio;
    if (ms < fin) return ms;
  }
  throw new Error('No se encontró horario permitido en 15 días');
}

// Fin del día (23:59:59) en Colombia, N días después de ms.
function finDelDiaMas(ms, dias) {
  const p = partesBogota(ms + dias * DIA);
  return msBogota(p.anio, p.mes, p.dia, 23, 59) + 59_000;
}

function fmtFechaHora(ms) {
  const p = partesBogota(ms), z = (n) => String(n).padStart(2, '0');
  return `${p.anio}-${z(p.mes)}-${z(p.dia)} ${z(p.hora)}:${z(p.minuto)}:${z(p.segundo)} -05:00`;
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function fmtFecha(ms) {
  const p = partesBogota(ms);
  return `${p.dia} de ${MESES[p.mes - 1]} de ${p.anio}`;
}

module.exports = {
  partesBogota, msBogota, festivos, esFestivo, enHorarioPermitido, siguienteHorarioPermitido,
  finDelDiaMas, fmtFechaHora, fmtFecha, pascua,
};
