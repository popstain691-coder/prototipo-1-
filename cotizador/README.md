# Cotizador — Prototipo 3

Cotizaciones con la marca del negocio que se envían por enlace (WhatsApp o correo) y que el cliente aprueba en línea con un código de un solo uso, dejando evidencia: fecha y hora, nombre, celular o correo verificado, versión exacta y huella SHA-256 del documento.

## Probarlo en 1 minuto

Requisito: Node.js 22.13 o superior.

```bash
npm install
npm start            # http://localhost:3000
```

- Panel: `demo@cotiza.local` / `demo1234` (se crea solo la primera vez, con catálogo y clientes de ejemplo).
- En modo demostración ningún mensaje sale realmente: se ven en **Más > Mensajes**, y la página del cliente muestra el código de aprobación en un recuadro amarillo.
- Para ver el lado del cliente, abre el enlace de una cotización enviada en otra ventana privada (con la sesión del dueño abierta no se cuenta como "vista").

```bash
npm test             # cálculo, festivos y horarios, y el flujo completo de aprobación
```

## Qué incluye (versión 1)

| Función | Dónde |
| --- | --- |
| Catálogo con precio, unidad, tipo e IVA | Panel > Catálogo |
| Cotización con ítems, descuentos por ítem y global, vigencia, condiciones y notas | Panel > Nueva |
| Plantillas y duplicar una cotización anterior | Panel > Nueva, y "Más acciones" en el editor |
| Logo, colores y textos del negocio | Más > Configuración |
| PDF generado desde la versión congelada | Editor y página del cliente |
| Enlace público de 32 caracteres con vencimiento, botones Aprobar y Pedir cambios | `/c/<código>` |
| Estados: borrador, enviada, vista, cambios pedidos, aprobada, rechazada, vencida | Automático |
| Aprobación con código de 6 dígitos por WhatsApp o correo (10 min, 5 intentos, 3 códigos cada 15 min) | Página del cliente |
| Evidencia inmutable y verificación de huella | `/verificar` |
| Avisos al dueño cuando el cliente ve, aprueba, pide cambios o rechaza | WhatsApp o correo del dueño |
| Un recordatorio a las 72 h, solo en horario de la Ley 2300 (L–V 7–19 h, sáb 8–15 h, sin domingos ni festivos) | Automático, cada minuto |
| Métricas: minutos para emitir, % aprobado, sin respuesta a 3 días | Inicio |
| Exportación de aprobadas a CSV y JSON para facturación | Más |

## Reglas clave

- **Montos en pesos enteros.** Cantidades en milésimas, descuentos en centésimas de punto, todo calculado con enteros (`src/calc.js`). El mismo archivo calcula en el panel y en el servidor.
- **Lo enviado no se edita.** Cada envío crea una versión inmutable con su huella; la base de datos lo impide con triggers (`src/db.js`). Una cotización aprobada queda bloqueada.
- **La huella** es SHA-256 del JSON canónico de la versión (claves ordenadas). Cualquiera puede descargar `/c/<código>/version.json` y recalcularla.
- **La cotización no es factura.** Las aprobadas se exportan para el software de facturación habilitado ante la DIAN.

## Producción

Variables de entorno:

| Variable | Para qué | Ejemplo |
| --- | --- | --- |
| `BASE_URL` | Dominio del cliente (activa cookie `Secure` si es https) | `https://cotiza.minegocio.co` |
| `PORT` | Puerto | `3000` |
| `DB_FILE` | Archivo SQLite (respáldalo a diario) | `/var/lib/cotizador/cotizador.db` |
| `SEED_DEMO` | `0` para no crear datos de demostración | `0` |
| `TRUST_PROXY` | `1` si hay Nginx o un balanceador delante (IP real del cliente) | `1` |
| `MENSAJERIA` | `demo` o `real` | `real` |
| `WA_TOKEN`, `WA_PHONE_ID` | WhatsApp Cloud API de Meta | |
| `WA_TPL_COTIZACION`, `WA_TPL_CODIGO`, `WA_TPL_RECORDATORIO`, `WA_TPL_AVISO` | Nombres de las plantillas aprobadas por Meta | `cotizacion_enviada` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Correo saliente | |
| `RECORDATORIO_HORAS` | Horas para el recordatorio | `72` |

Primer usuario real (con `SEED_DEMO=0`):

```bash
node -e "const {abrir}=require('./src/db');const {hashClave}=require('./src/auth');const db=abrir(process.env.DB_FILE||'data/cotizador.db');db.ejecutar('INSERT INTO usuarios (nombre,correo,clave,rol,creado) VALUES (?,?,?,?,?)','Nombre','correo@negocio.co',hashClave('una-clave-segura'),'dueno',Date.now())"
```

Plantillas de WhatsApp: escríbelas solo con información de la cotización pedida (sin promociones) para que Meta las clasifique como "utilidad". La del código debe ser de tipo "autenticación".

## Pendiente fuera del código

- Condiciones y texto de aceptación: redactarlos con el abogado del cliente (Configuración y `TEXTO_ACEPTACION` en `src/cotizaciones.js`).
- Reglas de IVA y redondeo: confirmarlas con el contador del cliente.
- Horarios de la Ley 2300: confirmar con el abogado (`src/horarios.js`).
- Autorización de datos personales (Ley 1581) y contrato de transmisión, igual que en los prototipos anteriores.
- Para montos altos o contratos: firma electrónica certificada (versión 2).

## Estructura

```
src/
  server.js        arranque y tareas automáticas
  app.js           rutas del panel, página pública y verificación
  cotizaciones.js  reglas: versiones, enlace, código, aprobación, recordatorios, métricas
  calc.js          motor de cálculo en pesos enteros (servidor y navegador)
  huella.js        JSON canónico, SHA-256 y códigos aleatorios
  horarios.js      hora de Colombia, festivos (Ley Emiliani) y ventanas de la Ley 2300
  pdf.js           PDF con PDFKit
  vista-publica.js página que ve el cliente
  mensajeria.js    WhatsApp Cloud API, SMTP y modo demo
  auth.js          contraseñas scrypt y sesiones
  db.js            esquema SQLite y triggers de inmutabilidad
  semilla.js       datos de demostración
public/            panel del dueño (HTML, CSS y JS sin framework)
test/              pruebas con node:test
```
