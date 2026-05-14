const express = require('express');
const router = express.Router();

const Impresora = require('../models/Impresora');
const ImpresoraLatest = require('../models/ImpresoraLatest');
const CortesMensuales = require('../models/CortesMensuales');

const { computeDerivedOnline, ONLINE_STALE_MS } = require('../helpers/onlineStatus');

// 🖨️ GET /api/empresas/:empresaId/impresoras - Listar impresoras de una empresa
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

// ✏️ PUT /api/impresoras/:id - Renombrar impresora
router.put('/impresoras/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { printerName } = req.body;

    if (!printerName || !printerName.trim()) {
      return res.status(400).json({
        ok: false,
        error: 'El nombre de la impresora no puede estar vacío'
      });
    }

    const impresora = await Impresora.findByIdAndUpdate(
      id,
      { printerName: printerName.trim() },
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
      data: impresora,
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

    // Limpiar datos asociados
    await Promise.all([
      ImpresoraLatest.deleteMany({ printerId: id }),
      CortesMensuales.deleteMany({ printerId: id }),
    ]);

    res.json({
      ok: true,
      message: `Impresora "${impresora.printerName || impresora.host}" eliminada correctamente`
    });
  } catch (err) {
    console.error('❌ DELETE /api/impresoras/:id', err);
    res.status(500).json({ ok: false, error: 'Error eliminando impresora' });
  }
});

// ℹ️ GET /api/online-policy - Política de online
router.get('/online-policy', (_req, res) => {
  res.json({
    ok: true,
    ONLINE_STALE_MS,
    note: 'Impresora se considera offline si lastSeenAt es más viejo que este umbral.'
  });
});

module.exports = router;
