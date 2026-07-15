const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AlertaConfig = require('../models/AlertaConfig');
const Alerta = require('../models/Alerta');
const Impresora = require('../models/Impresora');
const authMiddleware = require('../middleware/authMiddleware');

/**
 * Helper: valida que el usuario tenga acceso a la impresora.
 * Retorna la impresora si tiene acceso, null si no.
 */
async function verificarAccesoImpresora(printerId, user) {
  if (!mongoose.isValidObjectId(printerId)) return null;

  const impresora = await Impresora.findById(printerId).lean();
  if (!impresora) return null;

  // Verificar que la impresora pertenezca a la ciudad del usuario logueado
  if (impresora.ciudad !== user.ciudad) return null;

  return impresora;
}

// 📖 GET /api/alertas/config/:printerId - Obtener config de alertas de una impresora
router.get('/alertas/config/:printerId', authMiddleware, async (req, res) => {
  try {
    const { printerId } = req.params;

    const impresora = await verificarAccesoImpresora(printerId, req.user);
    if (!impresora) {
      return res.status(404).json({ ok: false, error: 'Impresora no encontrada o sin acceso' });
    }

    let config = await AlertaConfig.findOne({ printerId }).lean();

    // Si no existe config, devolver defaults (no crear en DB hasta que el usuario guarde)
    if (!config) {
      config = {
        printerId,
        empresaId: impresora.empresaId,
        ciudad: impresora.ciudad,
        activa: false,
        umbralPorcentaje: 30,
        tiposSuministro: ['toner', 'ink'],
        _default: true
      };
    }

    res.json({ ok: true, config });
  } catch (err) {
    console.error('❌ GET /api/alertas/config:', err);
    res.status(500).json({ ok: false, error: 'Error obteniendo config' });
  }
});

// ✏️ PUT /api/alertas/config/:printerId - Crear/actualizar config de alertas
router.put('/alertas/config/:printerId', authMiddleware, async (req, res) => {
  try {
    const { printerId } = req.params;
    const { activa, umbralPorcentaje, tiposSuministro } = req.body;

    const impresora = await verificarAccesoImpresora(printerId, req.user);
    if (!impresora) {
      return res.status(404).json({ ok: false, error: 'Impresora no encontrada o sin acceso' });
    }

    // Validaciones
    if (typeof activa !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'activa debe ser boolean' });
    }
    if (typeof umbralPorcentaje !== 'number' || umbralPorcentaje < 1 || umbralPorcentaje > 100) {
      return res.status(400).json({ ok: false, error: 'umbralPorcentaje debe ser 1-100' });
    }

    const config = await AlertaConfig.findOneAndUpdate(
      { printerId },
      {
        $set: {
          activa,
          umbralPorcentaje,
          tiposSuministro: Array.isArray(tiposSuministro) ? tiposSuministro : ['toner', 'ink'],
          empresaId: impresora.empresaId,
          ciudad: impresora.ciudad,
          updatedAt: new Date()
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { new: true, upsert: true }
    );

    res.json({ ok: true, config });
  } catch (err) {
    console.error('❌ PUT /api/alertas/config:', err);
    res.status(500).json({ ok: false, error: 'Error guardando config' });
  }
});

// 📜 GET /api/alertas/historial - Historial de alertas del usuario (últimas 50)
router.get('/alertas/historial', authMiddleware, async (req, res) => {
  try {
    const { ciudad, email } = req.user;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const alertas = await Alerta.find({ ciudad })
      .sort({ enviadoEn: -1 })
      .limit(limit)
      .populate('printerId', 'customName printerName host serial')
      .lean();

    const withLeida = alertas.map(a => ({
      ...a,
      leida: Array.isArray(a.leidaPor) && a.leidaPor.includes(email)
    }));

    res.json({ ok: true, count: withLeida.length, alertas: withLeida });
  } catch (err) {
    console.error('GET /api/alertas/historial:', err);
    res.status(500).json({ ok: false, error: 'Error obteniendo historial' });
  }
});

router.delete('/alertas/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const alerta = await Alerta.findOneAndDelete({
      _id: id,
      ciudad: req.user.ciudad
    });

    if (!alerta) {
      return res.status(404).json({ ok: false, error: 'Alerta no encontrada' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/alertas/:id:', err);
    res.status(500).json({ ok: false, error: 'Error eliminando alerta' });
  }
});

router.delete('/alertas', authMiddleware, async (req, res) => {
  try {
    const result = await Alerta.deleteMany({ ciudad: req.user.ciudad });
    res.json({ ok: true, deletedCount: result.deletedCount });
  } catch (err) {
    console.error('DELETE /api/alertas:', err);
    res.status(500).json({ ok: false, error: 'Error eliminando alertas' });
  }
});

router.get('/alertas/unread-count', authMiddleware, async (req, res) => {
  try {
    const count = await Alerta.countDocuments({
      ciudad: req.user.ciudad,
      leidaPor: { $ne: req.user.email }
    });
    res.json({ ok: true, count });
  } catch (err) {
    console.error('GET /api/alertas/unread-count:', err);
    res.status(500).json({ ok: false, error: 'Error obteniendo conteo' });
  }
});

router.patch('/alertas/mark-read', authMiddleware, async (req, res) => {
  try {
    const result = await Alerta.updateMany(
      {
        ciudad: req.user.ciudad,
        leidaPor: { $ne: req.user.email }
      },
      { $addToSet: { leidaPor: req.user.email } }
    );
    res.json({ ok: true, marked: result.modifiedCount });
  } catch (err) {
    console.error('PATCH /api/alertas/mark-read:', err);
    res.status(500).json({ ok: false, error: 'Error marcando como leídas' });
  }
});

module.exports = router;