// Punto de entrada: arranca el servidor y las tareas automáticas (vencimientos y recordatorios).
const { crearApp } = require('./app');

const PORT = Number(process.env.PORT || 3000);
const { app, servicio, mensajeria } = crearApp();

app.listen(PORT, () => {
  console.log(`Cotizador listo en ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
  console.log(`Mensajería: ${mensajeria.modo}${mensajeria.modo === 'demo' ? ' (los mensajes se ven en el panel > Mensajes)' : ''}`);
});

async function tick() {
  try {
    const r = await servicio.ejecutarTareas();
    if (r.vencidas || r.recordatorios) console.log(`Tareas: ${r.vencidas} vencidas, ${r.recordatorios} recordatorios`);
  } catch (e) { console.error('Error en tareas automáticas', e); }
}
tick();
setInterval(tick, 60_000).unref();
