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

module.exports = {
  ONLINE_STALE_MS,
  computeDerivedOnline
};
