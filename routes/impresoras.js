const express = require('express');
const router = express.Router();

const Impresora = require('../models/Impresora');
const ImpresoraLatest = require('../models/ImpresoraLatest');
const CortesMensuales = require('../models/CortesMensuales');

const { computeDerivedOnline, ONLINE_STALE_MS } = require('../helpers/onlineStatus');
const Empresa = require('../models/Empresa');
const authMiddleware = require('../middleware/authMiddleware');
const { Carpeta, AsignacionCarpeta } = require('../models/Carpeta');

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
async function empresasDelUsuario(user) {
  return Empresa.find({
    empresaId: user.empresaId,
    ciudad: user.ciudad
  }).lean();
}


// 📱 GET /api/impresoras/mias/:id - Detalle completo de una impresora
router.get('/impresoras/mias/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const impresora = await Impresora.findById(id).lean();
    if (!impresora) {
      return res.status(404).json({ ok: false, error: 'Impresora no encontrada' });
    }

    // Validar que la impresora pertenezca a la empresa+ciudad del usuario
    const empresas = await empresasDelUsuario(req.user);
    const empresaIds = empresas.map(e => String(e._id));
    if (!empresaIds.includes(String(impresora.empresaId)) || impresora.ciudad !== req.user.ciudad) {
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

// ============================================================
// ENDPOINTS MOVILES DE NAVEGACION (carpetas / clientes)
// ============================================================

router.get('/mobile/root', authMiddleware, async (req, res) => {
  try {
    const empresas = await empresasDelUsuario(req.user);
    const empresaIds = empresas.map(e => e._id);

    const carpetas = await Carpeta.find({
      empresaId: req.user.empresaId,
      ciudad: req.user.ciudad,
      parentId: null
    }).sort({ nombre: 1 }).lean();

    const asignaciones = await AsignacionCarpeta.find({
      empresaPadreId: req.user.empresaId,
      ciudad: req.user.ciudad,
      empresaId: { $in: empresaIds }
    }).lean();
    const empresaIdsConCarpeta = new Set(asignaciones.map(a => String(a.empresaId)));

    const clientesSinCarpeta = empresas.filter(e => !empresaIdsConCarpeta.has(String(e._id)));

    const [countsCarpetas, countsClientes] = await Promise.all([
      contarContenidoCarpetas(carpetas.map(c => c._id), req.user),
      contarImpresorasPorCliente(clientesSinCarpeta.map(c => c._id), req.user.ciudad)
    ]);

    res.json({
      ok: true,
      carpetas: carpetas.map(c => ({
        _id: c._id,
        nombre: c.nombre,
        subcarpetas: countsCarpetas[String(c._id)]?.subcarpetas || 0,
        clientes: countsCarpetas[String(c._id)]?.clientes || 0,
        impresoras: countsCarpetas[String(c._id)]?.impresoras || 0
      })),
      clientes: clientesSinCarpeta.map(c => ({
        _id: c._id,
        nombre: c.nombre,
        impresoras: countsClientes[String(c._id)] || 0
      }))
    });
  } catch (err) {
    console.error('GET /api/mobile/root:', err);
    res.status(500).json({ ok: false, error: 'Error obteniendo raiz' });
  }
});

router.get('/mobile/carpeta/:carpetaId', authMiddleware, async (req, res) => {
  try {
    const { carpetaId } = req.params;

    const carpeta = await Carpeta.findOne({
      _id: carpetaId,
      empresaId: req.user.empresaId,
      ciudad: req.user.ciudad
    }).lean();

    if (!carpeta) {
      return res.status(404).json({ ok: false, error: 'Carpeta no encontrada' });
    }

    const subcarpetas = await Carpeta.find({
      parentId: carpetaId,
      empresaId: req.user.empresaId,
      ciudad: req.user.ciudad
    }).sort({ nombre: 1 }).lean();

    const asignaciones = await AsignacionCarpeta.find({
      carpetaId,
      empresaPadreId: req.user.empresaId,
      ciudad: req.user.ciudad
    }).lean();

    const clienteIds = asignaciones.map(a => a.empresaId);
    const clientes = await Empresa.find({
      _id: { $in: clienteIds }
    }).sort({ nombre: 1 }).lean();

    const [countsSubcarpetas, countsClientes] = await Promise.all([
      contarContenidoCarpetas(subcarpetas.map(c => c._id), req.user),
      contarImpresorasPorCliente(clienteIds, req.user.ciudad)
    ]);

    res.json({
      ok: true,
      carpeta: { _id: carpeta._id, nombre: carpeta.nombre },
      subcarpetas: subcarpetas.map(c => ({
        _id: c._id,
        nombre: c.nombre,
        subcarpetas: countsSubcarpetas[String(c._id)]?.subcarpetas || 0,
        clientes: countsSubcarpetas[String(c._id)]?.clientes || 0,
        impresoras: countsSubcarpetas[String(c._id)]?.impresoras || 0
      })),
      clientes: clientes.map(c => ({
        _id: c._id,
        nombre: c.nombre,
        impresoras: countsClientes[String(c._id)] || 0
      }))
    });
  } catch (err) {
    console.error('GET /api/mobile/carpeta:', err);
    res.status(500).json({ ok: false, error: 'Error obteniendo carpeta' });
  }
});

router.get('/mobile/cliente/:clienteId/impresoras', authMiddleware, async (req, res) => {
  try {
    const { clienteId } = req.params;

    const cliente = await Empresa.findOne({
      _id: clienteId,
      empresaId: req.user.empresaId,
      ciudad: req.user.ciudad
    }).lean();

    if (!cliente) {
      return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });
    }

    const impresoras = await Impresora.find({
      empresaId: cliente._id,
      ciudad: req.user.ciudad,
      monitoreoActivo: true
    }).sort({ createdAt: -1 }).lean();

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

    res.json({
      ok: true,
      cliente: { _id: cliente._id, nombre: cliente.nombre },
      impresoras: data
    });
  } catch (err) {
    console.error('GET /api/mobile/cliente/:id/impresoras:', err);
    res.status(500).json({ ok: false, error: 'Error obteniendo impresoras' });
  }
});

async function contarContenidoCarpetas(carpetaIds, user) {
  if (carpetaIds.length === 0) return {};
  const result = {};

  const subcarpetas = await Carpeta.aggregate([
    { $match: { parentId: { $in: carpetaIds }, empresaId: user.empresaId, ciudad: user.ciudad } },
    { $group: { _id: '$parentId', count: { $sum: 1 } } }
  ]);
  subcarpetas.forEach(r => {
    result[String(r._id)] = { subcarpetas: r.count, clientes: 0, impresoras: 0 };
  });

  const asignaciones = await AsignacionCarpeta.aggregate([
    { $match: { carpetaId: { $in: carpetaIds }, empresaPadreId: user.empresaId, ciudad: user.ciudad } },
    { $group: { _id: '$carpetaId', clientes: { $push: '$empresaId' }, count: { $sum: 1 } } }
  ]);

  for (const r of asignaciones) {
    const key = String(r._id);
    if (!result[key]) result[key] = { subcarpetas: 0, clientes: 0, impresoras: 0 };
    result[key].clientes = r.count;

    const impresorasCount = await Impresora.countDocuments({
      empresaId: { $in: r.clientes },
      ciudad: user.ciudad,
      monitoreoActivo: true
    });
    result[key].impresoras = impresorasCount;
  }

  return result;
}

async function contarImpresorasPorCliente(clienteIds, ciudad) {
  if (clienteIds.length === 0) return {};
  const result = {};

  const counts = await Impresora.aggregate([
    { $match: { empresaId: { $in: clienteIds }, ciudad, monitoreoActivo: true } },
    { $group: { _id: '$empresaId', count: { $sum: 1 } } }
  ]);

  counts.forEach(r => {
    result[String(r._id)] = r.count;
  });

  return result;
}

module.exports = router;