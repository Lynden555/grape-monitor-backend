const express = require('express');
const router = express.Router();

const { Carpeta, AsignacionCarpeta } = require('../models/Carpeta');
const Impresora = require('../models/Impresora');

// ============================================================
// 📁 CARPETAS
// ============================================================

// GET /api/carpetas - Obtener carpetas del usuario
router.get('/carpetas', async (req, res) => {
  try {
    const { empresaId, ciudad } = req.query;

    if (!empresaId || !ciudad) {
      return res.status(400).json({
        ok: false,
        error: 'empresaId y ciudad son requeridos'
      });
    }

    const carpetas = await Carpeta.find({
      empresaId,
      ciudad
    }).sort({ fechaCreacion: -1 }).lean();

    const carpetaIds = carpetas.map(c => c._id);

    const [subs, asignaciones] = await Promise.all([
      Carpeta.find({ parentId: { $in: carpetaIds }, empresaId, ciudad }, { parentId: 1 }).lean(),
      AsignacionCarpeta.find(
        { carpetaId: { $in: carpetaIds }, empresaPadreId: empresaId, ciudad },
        { carpetaId: 1, empresaId: 1 }
      ).lean()
    ]);

    const empresasEnCarpetas = asignaciones.map(a => a.empresaId);
    const impresoras = await Impresora.find(
      { empresaId: { $in: empresasEnCarpetas }, ciudad, monitoreoActivo: true },
      { empresaId: 1 }
    ).lean();

    const impresorasPorEmpresa = new Map();
    for (const imp of impresoras) {
      const k = String(imp.empresaId);
      impresorasPorEmpresa.set(k, (impresorasPorEmpresa.get(k) || 0) + 1);
    }

    const conteo = new Map();
    for (const c of carpetas) conteo.set(String(c._id), { subcarpetas: 0, clientes: 0, impresoras: 0 });

    for (const s of subs) {
      const k = String(s.parentId);
      if (conteo.has(k)) conteo.get(k).subcarpetas += 1;
    }

    for (const a of asignaciones) {
      const k = String(a.carpetaId);
      if (!conteo.has(k)) continue;
      conteo.get(k).clientes += 1;
      conteo.get(k).impresoras += impresorasPorEmpresa.get(String(a.empresaId)) || 0;
    }

    const data = carpetas.map(c => ({ ...c, ...conteo.get(String(c._id)) }));

    res.json({ ok: true, data });

  } catch (error) {
    console.error('❌ Error obteniendo carpetas:', error);
    res.status(500).json({
      ok: false,
      error: 'Error interno del servidor'
    });
  }
});

// POST /api/carpetas - Crear carpeta
router.post('/carpetas', async (req, res) => {
  try {
    const { nombre, parentId, empresaId, ciudad } = req.body;

    if (!nombre || !empresaId || !ciudad) {
      return res.status(400).json({
        ok: false,
        error: 'Nombre, empresaId y ciudad son requeridos'
      });
    }

    if (parentId) {
      const parentExists = await Carpeta.findOne({ _id: parentId, empresaId, ciudad });
      if (!parentExists) {
        return res.status(404).json({
          ok: false,
          error: 'Carpeta padre no encontrada'
        });
      }
    }

    const nuevaCarpeta = new Carpeta({
      nombre: nombre.trim(),
      parentId: parentId || null,
      empresaId,
      ciudad,
      fechaCreacion: new Date()
    });

    await nuevaCarpeta.save();

    res.status(201).json({
      ok: true,
      data: nuevaCarpeta,
      message: `Carpeta "${nombre}" creada correctamente`
    });

  } catch (error) {
    console.error('❌ Error creando carpeta:', error);
    res.status(500).json({
      ok: false,
      error: 'Error interno del servidor'
    });
  }
});

// PUT /api/carpetas/:id - Renombrar carpeta
router.put('/carpetas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, empresaId, ciudad } = req.body;

    if (!nombre || nombre.trim().length < 1) {
      return res.status(400).json({
        ok: false,
        error: 'El nombre no puede estar vacío'
      });
    }

    const carpeta = await Carpeta.findOneAndUpdate(
      { _id: id, empresaId, ciudad },
      { nombre: nombre.trim() },
      { new: true }
    );

    if (!carpeta) {
      return res.status(404).json({
        ok: false,
        error: 'Carpeta no encontrada'
      });
    }

    res.json({
      ok: true,
      data: carpeta,
      message: `Carpeta renombrada a "${nombre}"`
    });

  } catch (error) {
    console.error('❌ Error renombrando carpeta:', error);
    res.status(500).json({
      ok: false,
      error: 'Error interno del servidor'
    });
  }
});

// Función auxiliar para eliminar subcarpetas recursivamente
async function eliminarSubcarpetasRecursivamente(parentId, empresaId, ciudad) {
  const subcarpetas = await Carpeta.find({ parentId, empresaId, ciudad });

  for (const subcarpeta of subcarpetas) {
    await AsignacionCarpeta.deleteMany({ carpetaId: subcarpeta._id });
    await eliminarSubcarpetasRecursivamente(subcarpeta._id, empresaId, ciudad);
    await Carpeta.findByIdAndDelete(subcarpeta._id);
  }
}

// DELETE /api/carpetas/:id - Eliminar carpeta
router.delete('/carpetas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { empresaId, ciudad } = req.body;

    const carpeta = await Carpeta.findOneAndDelete({
      _id: id,
      empresaId,
      ciudad
    });

    if (!carpeta) {
      return res.status(404).json({
        ok: false,
        error: 'Carpeta no encontrada'
      });
    }

    await AsignacionCarpeta.deleteMany({ carpetaId: id });
    await eliminarSubcarpetasRecursivamente(id, empresaId, ciudad);

    res.json({
      ok: true,
      message: `Carpeta "${carpeta.nombre}" eliminada correctamente`
    });

  } catch (error) {
    console.error('❌ Error eliminando carpeta:', error);
    res.status(500).json({
      ok: false,
      error: 'Error interno del servidor'
    });
  }
});

// ============================================================
// 📌 ASIGNACIONES DE EMPRESAS A CARPETAS
// ============================================================

// POST /api/asignaciones - Asignar empresa a carpeta
router.post('/asignaciones', async (req, res) => {
  try {
    const { empresaId, carpetaId, empresaPadreId, ciudad } = req.body;

    if (!empresaId || !empresaPadreId || !ciudad) {
      return res.status(400).json({
        ok: false,
        error: 'empresaId, empresaPadreId y ciudad son requeridos'
      });
    }

    // Si carpetaId es null, eliminar la asignación
    if (carpetaId === null) {
      await AsignacionCarpeta.findOneAndDelete({
        empresaId,
        empresaPadreId,
        ciudad
      });

      return res.json({
        ok: true,
        message: 'Empresa removida de carpeta'
      });
    }

    const carpeta = await Carpeta.findOne({
      _id: carpetaId,
      empresaId: empresaPadreId,
      ciudad
    });

    if (!carpeta) {
      return res.status(404).json({
        ok: false,
        error: 'Carpeta no encontrada'
      });
    }

    const asignacion = await AsignacionCarpeta.findOneAndUpdate(
      { empresaId, empresaPadreId, ciudad },
      { carpetaId },
      { new: true, upsert: true }
    );

    res.json({
      ok: true,
      data: asignacion,
      message: 'Empresa asignada a carpeta correctamente'
    });

  } catch (error) {
    console.error('❌ Error asignando empresa a carpeta:', error);
    res.status(500).json({
      ok: false,
      error: 'Error interno del servidor'
    });
  }
});

// GET /api/asignaciones - Obtener asignaciones del usuario
router.get('/asignaciones', async (req, res) => {
  try {
    const { empresaPadreId, ciudad } = req.query;

    if (!empresaPadreId || !ciudad) {
      return res.status(400).json({
        ok: false,
        error: 'empresaPadreId y ciudad son requeridos'
      });
    }

    const asignaciones = await AsignacionCarpeta.find({
      empresaPadreId,
      ciudad
    });

    // Convertir a objeto { empresaId: carpetaId } para el front
    const asignacionesMap = {};
    asignaciones.forEach(asig => {
      asignacionesMap[asig.empresaId] = asig.carpetaId;
    });

    res.json({
      ok: true,
      data: asignacionesMap
    });

  } catch (error) {
    console.error('❌ Error obteniendo asignaciones:', error);
    res.status(500).json({
      ok: false,
      error: 'Error interno del servidor'
    });
  }
});

module.exports = router;
