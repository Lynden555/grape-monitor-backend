const express = require('express');
const router = express.Router();

const Empresa = require('../models/Empresa');
const Impresora = require('../models/Impresora');
const ImpresoraLatest = require('../models/ImpresoraLatest');
const CortesMensuales = require('../models/CortesMensuales');
const { Carpeta, AsignacionCarpeta } = require('../models/Carpeta');

const { generarApiKey } = require('../helpers/apiKey');

// 📌 POST /api/empresas - Crear empresa
router.post('/', async (req, res) => {
  try {
    const { nombre, empresaId, ciudad } = req.body;
    if (!nombre || nombre.trim().length < 3) {
      return res.status(400).json({ ok: false, error: 'Nombre inválido' });
    }
    if (!empresaId || !ciudad) {
      return res.status(400).json({ ok: false, error: 'empresaId y ciudad son obligatorios' });
    }

    const existe = await Empresa.findOne({
      nombre: nombre.trim(),
      empresaId,
      ciudad
    });
    if (existe) {
      return res.status(400).json({ ok: false, error: 'La empresa ya existe en este scope' });
    }

    const apiKey = generarApiKey();
    const nueva = new Empresa({
      nombre: nombre.trim(),
      apiKey,
      empresaId,
      ciudad
    });
    await nueva.save();

    res.json({
      ok: true,
      empresaId: nueva._id,
      apiKey: nueva.apiKey
    });
  } catch (err) {
    console.error('❌ Error creando empresa:', err);
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// 📋 GET /api/empresas - Listar empresas
router.get('/', async (req, res) => {
  try {
    const { empresaId, ciudad } = req.query;
    const q = {};
    if (empresaId) q.empresaId = String(empresaId);
    if (ciudad) q.ciudad = String(ciudad);

    const empresas = await Empresa
      .find(q, { _id: 1, nombre: 1 })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ ok: true, data: empresas });
  } catch (err) {
    console.error('❌ GET /api/empresas:', err);
    res.status(500).json({ ok: false, error: 'Error listando empresas' });
  }
});

// 🔍 GET /api/empresas/:id - Obtener empresa específica (con apiKey)
router.get('/:id', async (req, res) => {
  try {
    const empresa = await Empresa.findById(req.params.id);
    if (!empresa) {
      return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });
    }

    res.json({
      ok: true,
      data: empresa
    });
  } catch (err) {
    console.error('❌ GET /api/empresas/:id:', err);
    res.status(500).json({ ok: false, error: 'Error obteniendo empresa' });
  }
});

// ✏️ PUT /api/empresas/:id - Renombrar empresa
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre } = req.body;

    if (!nombre || nombre.trim().length < 3) {
      return res.status(400).json({
        ok: false,
        error: 'El nombre debe tener al menos 3 caracteres'
      });
    }

    const empresa = await Empresa.findByIdAndUpdate(
      id,
      { nombre: nombre.trim() },
      { new: true }
    );

    if (!empresa) {
      return res.status(404).json({
        ok: false,
        error: 'Empresa no encontrada'
      });
    }

    res.json({
      ok: true,
      data: empresa,
      message: `Empresa renombrada a "${nombre}"`
    });

  } catch (error) {
    console.error('❌ Error renombrando empresa:', error);
    res.status(500).json({
      ok: false,
      error: 'Error interno del servidor'
    });
  }
});

// 🗑️ DELETE /api/empresas/:id - Eliminar empresa (limpia datos asociados)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const empresa = await Empresa.findByIdAndDelete(id);
    if (!empresa) {
      return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });
    }

    // Limpiar todo lo asociado a esta empresa
    const impresoras = await Impresora.find({ empresaId: id }, { _id: 1 }).lean();
    const printerIds = impresoras.map(i => i._id);

    await Promise.all([
      Impresora.deleteMany({ empresaId: id }),
      ImpresoraLatest.deleteMany({ printerId: { $in: printerIds } }),
      CortesMensuales.deleteMany({ empresaId: id }),
      AsignacionCarpeta.deleteMany({ empresaId: id }),
    ]);

    res.json({
      ok: true,
      message: `Empresa "${empresa.nombre}" eliminada correctamente`
    });
  } catch (err) {
    console.error('❌ DELETE /api/empresas/:id', err);
    res.status(500).json({ ok: false, error: 'Error eliminando empresa' });
  }
});

module.exports = router;
