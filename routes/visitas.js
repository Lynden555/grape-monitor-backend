const express = require('express');
const router = express.Router();
const Visita = require('../models/Visita');
const Impresora = require('../models/Impresora');
const Empresa = require('../models/Empresa');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/visitas', authMiddleware, async (req, res) => {
  try {
    const visitas = await Visita.find({
      empresaPadreId: req.user.empresaId,
      ciudad: req.user.ciudad
    }).sort({ creadaEn: 1 }).lean();

    if (visitas.length === 0) return res.json({ ok: true, data: [] });

    const [impresoras, empresas] = await Promise.all([
      Impresora.find({ _id: { $in: visitas.map(v => v.printerId) } }).lean(),
      Empresa.find({ _id: { $in: visitas.map(v => v.empresaId) } }).lean()
    ]);

    const mapImp = new Map(impresoras.map(i => [String(i._id), i]));
    const mapEmp = new Map(empresas.map(e => [String(e._id), e]));

    const data = visitas.map(v => {
      const imp = mapImp.get(String(v.printerId));
      const emp = mapEmp.get(String(v.empresaId));
      return {
        _id: v._id,
        printerId: v.printerId,
        empresaId: v.empresaId,
        nota: v.nota,
        creadaEn: v.creadaEn,
        impresoraNombre: imp?.printerName || imp?.sysName || imp?.host || 'Impresora',
        impresoraModelo: imp?.model || null,
        clienteNombre: emp?.nombre || 'Cliente',
        ubicacion: emp?.ubicacion || null
      };
    });

    res.json({ ok: true, data });
  } catch (err) {
    console.error('GET /api/visitas:', err);
    res.status(500).json({ ok: false, error: 'Error obteniendo visitas' });
  }
});

router.post('/visitas', authMiddleware, async (req, res) => {
  try {
    const { printerId, nota } = req.body;

    const impresora = await Impresora.findById(printerId).lean();
    if (!impresora || impresora.ciudad !== req.user.ciudad) {
      return res.status(404).json({ ok: false, error: 'Impresora no encontrada' });
    }

    const visita = await Visita.findOneAndUpdate(
      { printerId, empresaPadreId: req.user.empresaId },
      {
        $set: {
          empresaId: impresora.empresaId,
          ciudad: req.user.ciudad,
          nota: (nota || '').trim()
        },
        $setOnInsert: { creadaEn: new Date() }
      },
      { new: true, upsert: true }
    );

    res.json({ ok: true, data: visita });
  } catch (err) {
    console.error('POST /api/visitas:', err);
    res.status(500).json({ ok: false, error: 'Error agregando visita' });
  }
});

router.delete('/visitas/:id', authMiddleware, async (req, res) => {
  try {
    const eliminada = await Visita.findOneAndDelete({
      _id: req.params.id,
      empresaPadreId: req.user.empresaId
    });

    if (!eliminada) {
      return res.status(404).json({ ok: false, error: 'Visita no encontrada' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/visitas/:id:', err);
    res.status(500).json({ ok: false, error: 'Error eliminando visita' });
  }
});

router.get('/visitas/estado/:printerId', authMiddleware, async (req, res) => {
  try {
    const visita = await Visita.findOne({
      printerId: req.params.printerId,
      empresaPadreId: req.user.empresaId
    }).lean();

    res.json({ ok: true, enAgenda: !!visita, visitaId: visita?._id || null, nota: visita?.nota || '' });
  } catch (err) {
    console.error('GET /api/visitas/estado:', err);
    res.status(500).json({ ok: false, error: 'Error consultando estado' });
  }
});

module.exports = router;