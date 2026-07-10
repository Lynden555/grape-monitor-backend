const express = require('express');
const router = express.Router();

const Impresora = require('../models/Impresora');
const ImpresoraLatest = require('../models/ImpresoraLatest');
const CortesMensuales = require('../models/CortesMensuales');

const { computeDerivedOnline, ONLINE_STALE_MS } = require('../helpers/onlineStatus');
const Empresa = require('../models/Empresa');
const authMiddleware = require('../middleware/authMiddleware');

// 🆕 Helper: nombre final que ve el usuario (prioridad: custom > snmp > fallback)
const resolveDisplayName = (i) =>
  i.customName || i.printerName || i.sysName || i.host || 'Impresora';

// 🖨️ GET /api/empresas/:empresaId/impresoras - Listar impresoras
router.get('/empresas/:empresaId/impresoras', async (req, res) => {
  try {
    const { empresaId } = req.params;
    const { ciudad } = req.query;

    const q = { empresaId };
    if (ciudad) q.ciudad = ciudad;

    const impresoras = await Impresora.find(q).lean();
    const ids = impresoras.map(i => i._id);
    const latest = await ImpresoraLatest.find({ printerId: { $in: ids } }).lean();
    const mapLatest = new Map(latest.map(l => [String(l.printerId), l]));

    const now = Date.now();
    const data = impresoras.map(i => {
      const l = mapLatest.get(String(i._id)) || null;
      const derivedOnline = computeDerivedOnline(l, now);
      const latestWithDerived = l ? { ...l, derivedOnline } : null;

      return {
        ...i,
        displayName: resolveDisplayName(i),  // 🆕 nombre final ya resuelto
        online: derivedOnline,
        latest: latestWithDerived
      };
    });

    res.json({ ok: true, data });
  } catch (err) {
    console.error('❌ GET /api/empresas/:empresaId/impresoras:', err);
    res.status(500).json({ ok: false, error: 'Error listando impresoras' });
  }
});

// ✏️ PUT /api/impresoras/:id - Renombrar impresora (guarda en customName)
router.put('/impresoras/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { printerName } = req.body; // el front sigue mandando "printerName"

    if (!printerName || !printerName.trim()) {
      return res.status(400).json({
        ok: false,
        error: 'El nombre de la impresora no puede estar vacío'
      });
    }

    // ⚡ Guardamos en customName, NO en printerName (printerName lo controla SNMP)
    const impresora = await Impresora.findByIdAndUpdate(
      id,
      { customName: printerName.trim() },
      { new: true }
    );

    if (!impresora) {
      return res.status(404).json({
        ok: false,
        error: 'Impresora no encontrada'
      });
    }

    res.json({
      ok: true,
      data: {
        ...impresora.toObject(),
        displayName: resolveDisplayName(impresora)
      },
      message: `Impresora renombrada a "${printerName.trim()}"`
    });

  } catch (error) {
    console.error('❌ Error renombrando impresora:', error);
    res.status(500).json({
      ok: false,
      error: 'Error interno del servidor'
    });
  }
});

// 🗑️ DELETE /api/impresoras/:id - Eliminar impresora
router.delete('/impresoras/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const impresora = await Impresora.findByIdAndDelete(id);
    if (!impresora) {
      return res.status(404).json({
        ok: false,
        error: 'Impresora no encontrada'
      });
    }

    await Promise.all([
      ImpresoraLatest.deleteMany({ printerId: id }),
      CortesMensuales.deleteMany({ printerId: id }),
    ]);

    res.json({
      ok: true,
      message: `Impresora "${resolveDisplayName(impresora)}" eliminada correctamente`
    });
  } catch (err) {
    console.error('❌ DELETE /api/impresoras/:id', err);
    res.status(500).json({ ok: false, error: 'Error eliminando impresora' });
  }
});

// ℹ️ GET /api/online-policy
router.get('/online-policy', (_req, res) => {
  res.json({
    ok: true,
    ONLINE_STALE_MS,
    note: 'Impresora se considera offline si lastSeenAt es más viejo que este umbral.'
  });
});

// ============================================================
// 📱 ENDPOINTS PARA APP MÓVIL (protegidos con JWT)
// ============================================================

/**
 * Helper interno: resuelve la Empresa del usuario logueado.
 * Retorna la Empresa o null si no existe.
 */
async function resolveEmpresaDelUsuario(user) {
  return Empresa.findOne({
    empresaId: user.empresaId,
    ciudad: user.ciudad
  }).lean();
}

// 📱 GET /api/impresoras/mias - Lista impresoras del usuario logueado
router.get('/impresoras/mias', authMiddleware, async (req, res) => {
  try {
    const empresa = await resolveEmpresaDelUsuario(req.user);
    if (!empresa) {
      return res.json({ ok: true, data: [] });
    }

    const impresoras = await Impresora.find({
      empresaId: empresa._id,
      ciudad: req.user.ciudad,
      monitoreoActivo: true
    }).lean();

    const ids = impresoras.map(i => i._id);
    const latest = await ImpresoraLatest.find({ printerId: { $in: ids } }).lean();
    const mapLatest = new Map(latest.map(l => [String(l.printerId), l]));

    const now = Date.now();
    const data = impresoras.map(i => {
      const l = mapLatest.get(String(i._id)) || null;
      const derivedOnline = computeDerivedOnline(l, now);
      return {
        _id: i._id,
        displayName: resolveDisplayName(i),
        model: i.model,
        host: i.host,
        serial: i.serial,
        ciudad: i.ciudad,
        online: derivedOnline,
        lastSeenAt: l?.lastSeenAt || null,
        lastPageCount: l?.lastPageCount || null,
        lowToner: l?.lowToner || false
      };
    });

    res.json({ ok: true, data });
  } catch (err) {
    console.error('❌ GET /api/impresoras/mias:', err);
    res.status(500).json({ ok: false, error: 'Error obteniendo impresoras' });
  }
});

// 📱 GET /api/impresoras/mias/:id - Detalle completo de una impresora
router.get('/impresoras/mias/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const impresora = await Impresora.findById(id).lean();
    if (!impresora) {
      return res.status(404).json({ ok: false, error: 'Impresora no encontrada' });
    }

    // Validar que la impresora pertenezca a la empresa+ciudad del usuario
    const empresa = await resolveEmpresaDelUsuario(req.user);
    if (!empresa || String(impresora.empresaId) !== String(empresa._id) || impresora.ciudad !== req.user.ciudad) {
      return res.status(403).json({ ok: false, error: 'Sin acceso a esta impresora' });
    }

    const latest = await ImpresoraLatest.findOne({ printerId: id }).lean();
    const derivedOnline = computeDerivedOnline(latest, Date.now());

    res.json({
      ok: true,
      data: {
        _id: impresora._id,
        displayName: resolveDisplayName(impresora),
        model: impresora.model,
        host: impresora.host,
        serial: impresora.serial,
        sysName: impresora.sysName,
        sysDescr: impresora.sysDescr,
        ciudad: impresora.ciudad,
        online: derivedOnline,
        lastSeenAt: latest?.lastSeenAt || null,
        counters: {
          total: latest?.lastPageCount || null,
          mono: latest?.lastPageMono || null,
          color: latest?.lastPageColor || null
        },
        supplies: latest?.lastSupplies || [],
        lowToner: latest?.lowToner || false
      }
    });
  } catch (err) {
    console.error('❌ GET /api/impresoras/mias/:id:', err);
    res.status(500).json({ ok: false, error: 'Error obteniendo detalle' });
  }
});

module.exports = router;