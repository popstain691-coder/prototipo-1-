// Base de datos SQLite (módulo node:sqlite de Node 22). Un solo archivo, fácil de respaldar.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const ESQUEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS negocio (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  nombre TEXT NOT NULL DEFAULT 'Mi negocio',
  nit TEXT DEFAULT '', telefono TEXT DEFAULT '', correo TEXT DEFAULT '', direccion TEXT DEFAULT '', ciudad TEXT DEFAULT '',
  logo TEXT DEFAULT '',                       -- data URL PNG/JPEG
  color1 TEXT DEFAULT '#0f6cbd', color2 TEXT DEFAULT '#e8f1fb',
  condiciones TEXT DEFAULT '', notas TEXT DEFAULT '',
  vigencia_dias INTEGER DEFAULT 15,
  redondeo INTEGER DEFAULT 1,                 -- 1 = al peso; 50 o 100 = ajuste del total
  whatsapp_dueno TEXT DEFAULT '', correo_dueno TEXT DEFAULT '',
  politica_datos TEXT DEFAULT '',
  plantilla_mensaje TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, correo TEXT NOT NULL UNIQUE,
  clave TEXT NOT NULL, rol TEXT NOT NULL DEFAULT 'dueno', creado INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sesiones (
  token_hash TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS catalogo (
  id INTEGER PRIMARY KEY, codigo TEXT DEFAULT '', nombre TEXT NOT NULL, descripcion TEXT DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'servicio' CHECK (tipo IN ('servicio','material','mano_obra','desplazamiento','otro')),
  unidad TEXT NOT NULL DEFAULT 'unidad',
  precio INTEGER NOT NULL CHECK (precio >= 0),
  iva INTEGER NOT NULL DEFAULT 19 CHECK (iva BETWEEN 0 AND 100),
  activo INTEGER NOT NULL DEFAULT 1, usos INTEGER NOT NULL DEFAULT 0, creado INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, celular TEXT DEFAULT '', correo TEXT DEFAULT '',
  documento TEXT DEFAULT '', direccion TEXT DEFAULT '',
  autoriza_datos_at INTEGER,                 -- fecha de la autorización de tratamiento de datos
  no_contactar INTEGER NOT NULL DEFAULT 0,   -- pidió no recibir recordatorios
  creado INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cotizaciones (
  id INTEGER PRIMARY KEY,
  consecutivo TEXT NOT NULL UNIQUE,
  cliente_id INTEGER REFERENCES clientes(id),
  estado TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador','enviada','vista','cambios','aprobada','rechazada','vencida')),
  borrador TEXT NOT NULL,                    -- JSON editable
  version_actual INTEGER NOT NULL DEFAULT 0, -- última versión enviada (0 = nunca enviada)
  token TEXT UNIQUE, token_expira INTEGER,
  vigencia_hasta INTEGER,
  enviada_primera_at INTEGER, enviada_at INTEGER,
  recordatorio_at INTEGER,
  es_plantilla INTEGER NOT NULL DEFAULT 0, nombre_plantilla TEXT DEFAULT '',
  origen_id INTEGER,                         -- duplicada desde
  creada_at INTEGER NOT NULL, actualizada_at INTEGER NOT NULL, creada_por INTEGER
);

CREATE TABLE IF NOT EXISTS versiones (
  id INTEGER PRIMARY KEY,
  cotizacion_id INTEGER NOT NULL REFERENCES cotizaciones(id),
  numero INTEGER NOT NULL,
  documento TEXT NOT NULL,                   -- JSON canónico, autocontenido
  huella TEXT NOT NULL,                      -- SHA-256 del documento
  creada_at INTEGER NOT NULL,
  UNIQUE (cotizacion_id, numero)
);

CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY,
  cotizacion_id INTEGER NOT NULL REFERENCES cotizaciones(id),
  version INTEGER, tipo TEXT NOT NULL, at INTEGER NOT NULL,
  ip TEXT DEFAULT '', navegador TEXT DEFAULT '', detalle TEXT DEFAULT '', actor TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS eventos_cot ON eventos(cotizacion_id, at);

CREATE TABLE IF NOT EXISTS codigos (
  id INTEGER PRIMARY KEY,
  cotizacion_id INTEGER NOT NULL REFERENCES cotizaciones(id),
  version INTEGER NOT NULL, nombre TEXT NOT NULL, destino TEXT NOT NULL, canal TEXT NOT NULL,
  codigo_hash TEXT NOT NULL, expira INTEGER NOT NULL, intentos INTEGER NOT NULL DEFAULT 0,
  usado_at INTEGER, creado INTEGER NOT NULL, ip TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS aprobaciones (
  id INTEGER PRIMARY KEY,
  cotizacion_id INTEGER NOT NULL UNIQUE REFERENCES cotizaciones(id),
  version INTEGER NOT NULL, huella TEXT NOT NULL,
  nombre TEXT NOT NULL, contacto TEXT NOT NULL, canal TEXT NOT NULL,
  at INTEGER NOT NULL, ip TEXT DEFAULT '', navegador TEXT DEFAULT '', codigo_id INTEGER
);

CREATE TABLE IF NOT EXISTS mensajes (
  id INTEGER PRIMARY KEY, cotizacion_id INTEGER, canal TEXT NOT NULL, destino TEXT NOT NULL,
  tipo TEXT NOT NULL, texto TEXT NOT NULL, estado TEXT NOT NULL, error TEXT DEFAULT '', at INTEGER NOT NULL
);

-- Lo enviado, los eventos y las aprobaciones no se editan ni se borran.
CREATE TRIGGER IF NOT EXISTS versiones_inmutables_u BEFORE UPDATE ON versiones
  BEGIN SELECT RAISE(ABORT, 'Las versiones enviadas no se pueden modificar'); END;
CREATE TRIGGER IF NOT EXISTS versiones_inmutables_d BEFORE DELETE ON versiones
  BEGIN SELECT RAISE(ABORT, 'Las versiones enviadas no se pueden borrar'); END;
CREATE TRIGGER IF NOT EXISTS eventos_inmutables_u BEFORE UPDATE ON eventos
  BEGIN SELECT RAISE(ABORT, 'Los eventos no se pueden modificar'); END;
CREATE TRIGGER IF NOT EXISTS eventos_inmutables_d BEFORE DELETE ON eventos
  BEGIN SELECT RAISE(ABORT, 'Los eventos no se pueden borrar'); END;
CREATE TRIGGER IF NOT EXISTS aprobaciones_inmutables_u BEFORE UPDATE ON aprobaciones
  BEGIN SELECT RAISE(ABORT, 'Las aprobaciones no se pueden modificar'); END;
CREATE TRIGGER IF NOT EXISTS aprobaciones_inmutables_d BEFORE DELETE ON aprobaciones
  BEGIN SELECT RAISE(ABORT, 'Las aprobaciones no se pueden borrar'); END;
CREATE TRIGGER IF NOT EXISTS aprobada_bloqueada BEFORE UPDATE OF borrador, version_actual, cliente_id ON cotizaciones
  WHEN OLD.estado = 'aprobada'
  BEGIN SELECT RAISE(ABORT, 'Una cotización aprobada no se puede editar'); END;
`;

function abrir(archivo) {
  if (archivo !== ':memory:') fs.mkdirSync(path.dirname(archivo), { recursive: true });
  const db = new DatabaseSync(archivo);
  if (archivo !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(ESQUEMA);
  db.prepare('INSERT OR IGNORE INTO negocio (id) VALUES (1)').run();

  // Transacción simple: db.tx(() => {...})
  db.tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  db.uno = (sql, ...p) => db.prepare(sql).get(...p);
  db.todos = (sql, ...p) => db.prepare(sql).all(...p);
  db.ejecutar = (sql, ...p) => db.prepare(sql).run(...p);
  return db;
}

module.exports = { abrir };
