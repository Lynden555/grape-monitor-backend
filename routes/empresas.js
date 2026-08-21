const express = require('express');
const router = express.Router();

const Empresa = require('../models/Empresa');
const Usuario = require('../models/Usuario');
const Impresora = require('../models/Impresora');
const ImpresoraLatest = require('../models/ImpresoraLatest');
const CortesMensuales = require('../models/CortesMensuales');
const { Carpeta, AsignacionCarpeta } = require('../models/Carpeta');

const { generarApiKey } = require('../helpers/apiKey');
const { computeDerivedOnline } = require('../helpers/onlineStatus');

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

// 🆕 Resolver userId desde el empresaId String (mismo patrón que la migración)
    const usuarioDueno = await Usuario.findOne({ empresaId });
    if (!usuarioDueno) {
      return res.status(404).json({
        ok: false,
        error: 'No se encontró un usuario asociado a este empresaId'
      });
    }

    const apiKey = generarApiKey();
    const nueva = new Empresa({
      nombre: nombre.trim(),
      apiKey,
      empresaId,
      ciudad,
      userId: usuarioDueno._id
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
      .find(q, { _id: 1, nombre: 1, ubicacion: 1 })
      .sort({ createdAt: -1 })
      .lean();

    const empresaIds = empresas.map(e => e._id);

    const impresoras = await Impresora
      .find({ empresaId: { $in: empresaIds }, monitoreoActivo: true }, { _id: 1, empresaId: 1 })
      .lean();

    const latest = await ImpresoraLatest
      .find({ printerId: { $in: impresoras.map(i => i._id) } }, { printerId: 1, lastSeenAt: 1, online: 1 })
      .lean();

    const mapLatest = new Map(latest.map(l => [String(l.printerId), l]));
    const now = Date.now();

    const conteo = new Map();
    for (const imp of impresoras) {
      const key = String(imp.empresaId);
      const actual = conteo.get(key) || { total: 0, online: 0 };
      actual.total += 1;
      if (computeDerivedOnline(mapLatest.get(String(imp._id)), now)) {
        actual.online += 1;
      }
      conteo.set(key, actual);
    }

    const data = empresas.map(e => {
      const c = conteo.get(String(e._id)) || { total: 0, online: 0 };
      return { ...e, totalImpresoras: c.total, impresorasOnline: c.online };
    });

    res.json({ ok: true, data });
  } catch (err) {
    console.error('❌ GET /api/empresas:', err);
    res.status(500).json({ ok: false, error: 'Error listando empresas' });
  }
});

router.get('/buscar-lugar', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 3) {
      return res.status(400).json({ ok: false, error: 'Escribe al menos 3 caracteres' });
    }
    if (!process.env.GOOGLE_MAPS_API_KEY) {
      return res.status(500).json({ ok: false, error: 'Búsqueda no configurada' });
    }

    const respuesta = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location'
      },
      body: JSON.stringify({
        textQuery: q.trim(),
        languageCode: 'es',
        regionCode: 'MX',
        maxResultCount: 5
      })
    });

    if (!respuesta.ok) {
      const detalle = await respuesta.text();
      console.error('Error de Places API:', respuesta.status, detalle);
      return res.status(502).json({ ok: false, error: 'No se pudo buscar la ubicación' });
    }

    const datos = await respuesta.json();

    const resultados = (datos.places || []).map((lugar) => ({
      nombre: lugar.displayName?.text || '',
      direccion: lugar.formattedAddress || '',
      lat: lugar.location?.latitude,
      lng: lugar.location?.longitude
    })).filter((r) => typeof r.lat === 'number' && typeof r.lng === 'number');

    res.json({ ok: true, resultados });
  } catch (error) {
    console.error('Error buscando lugar:', error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
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

router.put('/:id/ubicacion', async (req, res) => {
  try {
    const { lat, lng, direccion, referencia, origen } = req.body;

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ ok: false, error: 'Coordenadas inválidas' });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ ok: false, error: 'Coordenadas fuera de rango' });
    }

    const empresa = await Empresa.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          ubicacion: {
            lat,
            lng,
            direccion: direccion || '',
            referencia: referencia || '',
            origen: ['gps', 'busqueda', 'manual'].includes(origen) ? origen : 'manual',
            registradaEn: new Date()
          }
        }
      },
      { new: true }
    );

    if (!empresa) {
      return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });
    }

    res.json({ ok: true, ubicacion: empresa.ubicacion });
  } catch (error) {
    console.error('Error guardando ubicación:', error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.delete('/:id/ubicacion', async (req, res) => {
  try {
    const empresa = await Empresa.findByIdAndUpdate(
      req.params.id,
      { $unset: { ubicacion: '' } },
      { new: true }
    );

    if (!empresa) {
      return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Error eliminando ubicación:', error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
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
