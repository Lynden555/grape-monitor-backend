// ⏱️ Configuración online/offline
const ONLINE_STALE_MS = Number(process.env.ONLINE_STALE_MS || 2 * 60 * 1000);

/**
 * Decide si una impresora está online basado en lastSeenAt
 * @param {Object} latest - Documento ImpresoraLatest
 * @param {Number} now - Timestamp actual (opcional)
 * @returns {Boolean}
 */
function computeDerivedOnline(latest, now = Date.now()) {
  if (!latest || !latest.lastSeenAt) return false;
  if (latest.online === false) return false;
  const ts = new Date(latest.lastSeenAt).getTime();
  if (!Number.isFinite(ts)) return false;
  const age = now - ts;
  return age <= ONLINE_STALE_MS;
}

const ABANDONO_MS = Number(process.env.ABANDONO_MS || 2 * 24 * 60 * 60 * 1000);

/**
 * Estado agregado de una flota.
 * rojo: alguna lleva más de 2 días sin reportar
 * amarillo: alguna desconectada, ninguna pasa de 2 días
 * verde: todas en línea
 * gris: sin equipos
 */
function estadoFlota(latests, now = Date.now()) {
  if (!latests || latests.length === 0) return 'gris';

  let hayDesconectada = false;

  for (const l of latests) {
    if (computeDerivedOnline(l, now)) continue;

    hayDesconectada = true;

    const ts = l?.lastSeenAt ? new Date(l.lastSeenAt).getTime() : null;
    if (!Number.isFinite(ts) || now - ts > ABANDONO_MS) return 'rojo';
  }

  return hayDesconectada ? 'amarillo' : 'verde';
}

module.exports = {
  ONLINE_STALE_MS,
  ABANDONO_MS,
  computeDerivedOnline,
  estadoFlota
};
