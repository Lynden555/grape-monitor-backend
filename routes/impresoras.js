const express = require('express');
const router = express.Router();
const Empresa = require('../models/Empresa');
const { Carpeta, AsignacionCarpeta } = require('../models/Carpeta');
const Impresora = require('../models/Impresora');
const ImpresoraLatest = require('../models/ImpresoraLatest');
const CortesMensuales = require('../models/CortesMensuales');
const PDFDocument = require('pdfkit');

// ⏱️ Configuración online/offline
const ONLINE_STALE_MS = Number(process.env.ONLINE_STALE_MS || 2 * 60 * 1000);

// Helper: decide online por lastSeenAt
function computeDerivedOnline(latest, now = Date.now()) {
  if (!latest || !latest.lastSeenAt) return false;
  if (latest.online === false) return false;
  const ts = new Date(latest.lastSeenAt).getTime();
  if (!Number.isFinite(ts)) return false;
  const age = now - ts;
  return age <= ONLINE_STALE_MS;
}

// 🧮 Helper para cálculos de cortes
function calcularPeriodoCorte(ultimoCorte, contadoresActuales) {
  const contadorActual = contadoresActuales.lastPageCount || 0;

  if (!ultimoCorte) {
    return {
      contadorInicioGeneral: 0,
      contadorFinGeneral: contadorActual,
      totalPaginasGeneral: contadorActual,
      periodo: 'Desde instalación',
      esPrimerCorte: true
    };
  }

  const contadorInicioGeneral = ultimoCorte.contadorFinGeneral || 0;
  const totalPaginasGeneral = Math.max(0, contadorActual - contadorInicioGeneral);
  const fechaInicio = new Date(ultimoCorte.fechaCorte);
  const fechaFin = new Date();
  const periodo = `${fechaInicio.toLocaleDateString()} - ${fechaFin.toLocaleDateString()}`;

  return {
    contadorInicioGeneral,
    contadorFinGeneral: contadorActual,
    totalPaginasGeneral,
    periodo,
    esPrimerCorte: false
  };
}

// 🎨 Función para generar PDF profesional
async function generarPDFProfesional(corte, impresora) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        margin: 20,
        size: 'A4'
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        resolve(pdfBuffer);
      });

      const pageHeight = doc.page.height;
      const bottomMargin = 20;

      // ========== ENCABEZADO ==========
      doc.rect(0, 0, doc.page.width, 100)
         .fillColor('#1e3a8a')
         .fill();

      doc.fillColor('white')
         .fontSize(24)
         .font('Helvetica-Bold')
         .text('REPORTE DE CONSUMO', 0, 35, { align: 'center' });

      doc.fontSize(12)
         .font('Helvetica')
         .text('Sistema de Gestión de Impresoras', 0, 65, { align: 'center' });

      // ========== INFORMACIÓN GENERAL ==========
      let yPosition = 120;

      doc.rect(20, yPosition, doc.page.width - 40, 80)
         .fillColor('#f8fafc')
         .fill()
         .strokeColor('#e2e8f0')
         .stroke();

      const col1 = 30;
      const col2 = doc.page.width / 2;

      doc.fillColor('#1e293b')
         .fontSize(10)
         .font('Helvetica-Bold')
         .text('INFORMACIÓN GENERAL', col1, yPosition + 15);

      doc.font('Helvetica')
         .fillColor('#475569')
         .fontSize(9);

      doc.text(`Empresa: ${impresora.empresaId?.nombre || 'N/A'}`, col1, yPosition + 35);
      doc.text(`Impresora: ${impresora.printerName || impresora.sysName || impresora.host}`, col1, yPosition + 50);
      doc.text(`Modelo: ${impresora.model || impresora.sysDescr || 'N/A'}`, col1, yPosition + 65);

      doc.text(`Número de Serie: ${impresora.serial || 'No disponible'}`, col2, yPosition + 35);
      doc.text(`Ubicación: ${impresora.ciudad || 'N/A'}`, col2, yPosition + 50);
      doc.text(`Período: ${corte.periodo || 'No especificado'}`, col2, yPosition + 65);

      // ========== ESTADÍSTICAS PRINCIPALES ==========
      yPosition += 100;

      const statWidth = (doc.page.width - 60) / 3;

      const stats = [
        { label: 'INICIO PERÍODO', value: corte.contadorInicioGeneral?.toLocaleString() || '0', bg: '#f0f9ff', stroke: '#bae6fd', color: '#0c4a6e', fontSize: 18 },
        { label: 'FIN PERÍODO', value: corte.contadorFinGeneral.toLocaleString(), bg: '#f0fdf4', stroke: '#bbf7d0', color: '#15803d', fontSize: 18 },
        { label: 'CONSUMO TOTAL', value: corte.totalPaginasGeneral.toLocaleString(), bg: '#fef7ed', stroke: '#fed7aa', color: '#c2410c', fontSize: 22 }
      ];

      stats.forEach((stat, i) => {
        const x = 20 + i * (statWidth + 10);
        doc.rect(x, yPosition, statWidth, 80)
           .fillColor(stat.bg)
           .fill()
           .strokeColor(stat.stroke)
           .stroke();

        doc.fillColor('#0369a1')
           .fontSize(11)
           .font('Helvetica-Bold')
           .text(stat.label, x, yPosition + 15, { width: statWidth, align: 'center' });

        doc.fillColor(stat.color)
           .fontSize(stat.fontSize)
           .font('Helvetica-Bold')
           .text(stat.value, x, yPosition + 35, { width: statWidth, align: 'center' });

        doc.fillColor('#64748b')
           .fontSize(8)
           .font('Helvetica')
           .text('PÁGINAS', x, yPosition + 60, { width: statWidth, align: 'center' });
      });

      // ========== ESTADO DE SUMINISTROS ==========
      yPosition += 100;
      doc.fillColor('#1e293b')
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('ESTADO DE SUMINISTROS', 20, yPosition);

      const supplies = corte.suppliesFin || [];

      if (supplies.length > 0) {
        const supplyWidth = (doc.page.width - 60) / Math.min(supplies.length, 4);
        let supplyX = 20;

        supplies.forEach((supply, index) => {
          if (index >= 4) return;
          const level = supply.level || 0;
          const max = supply.max || 100;
          const percentage = max > 0 ? (level / max) * 100 : level;

          let color = '#22c55e';
          if (percentage <= 20) color = '#ef4444';
          else if (percentage <= 50) color = '#f59e0b';

          doc.rect(supplyX, yPosition + 25, supplyWidth - 10, 60)
             .fillColor('#f8fafc')
             .fill()
             .strokeColor('#e2e8f0')
             .stroke();

          doc.fillColor('#475569')
             .fontSize(8)
             .font('Helvetica-Bold')
             .text((supply.name || `Supply ${index + 1}`).toUpperCase(), supplyX + 5, yPosition + 35, { width: supplyWidth - 20, align: 'center' });

          const barWidth = supplyWidth - 30;
          const barHeight = 8;
          const barX = supplyX + 5;
          const barY = yPosition + 50;

          doc.rect(barX, barY, barWidth, barHeight)
             .fillColor('#e2e8f0')
             .fill();

          doc.rect(barX, barY, (percentage / 100) * barWidth, barHeight)
             .fillColor(color)
             .fill();

          doc.fillColor('#1e293b')
             .fontSize(7)
             .font('Helvetica-Bold')
             .text(`${Math.round(percentage)}%`, barX, barY + 12, { width: barWidth, align: 'center' });

          doc.fillColor('#64748b')
             .fontSize(7)
             .font('Helvetica')
             .text(`${level}${max > 0 ? `/${max}` : ''}`, barX, barY + 25, { width: barWidth, align: 'center' });

          supplyX += supplyWidth;
        });
      } else {
        doc.fillColor('#94a3b8')
           .fontSize(10)
           .font('Helvetica')
           .text('No hay datos de suministros disponibles', 20, yPosition + 40);
      }

      // ========== DETALLES ADICIONALES ==========
      yPosition += 100;
      doc.rect(20, yPosition, doc.page.width - 40, 60)
         .fillColor('#f8fafc')
         .fill()
         .strokeColor('#e2e8f0')
         .stroke();

      doc.fillColor('#1e293b')
         .fontSize(10)
         .font('Helvetica-Bold')
         .text('INFORMACIÓN ADICIONAL', 30, yPosition + 15);

      doc.fillColor('#475569')
         .fontSize(8)
         .font('Helvetica')
         .text(`Fecha de generación: ${new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, 30, yPosition + 35);
      doc.text(`ID del reporte: ${corte._id || 'N/A'}`, 30, yPosition + 50);

      // ========== PIE DE PÁGINA ==========
      doc.rect(0, pageHeight - 40 - bottomMargin, doc.page.width, 40)
         .fillColor('#1e293b')
         .fill();

      doc.fillColor('white')
         .fontSize(7)
         .font('Helvetica')
         .text('Sistema de Monitoreo de Impresoras • Reporte generado automáticamente', 20, pageHeight - 25 - bottomMargin, { align: 'left' });
      doc.text(`Página 1 de 1 • ${new Date().getFullYear()}`, 0, pageHeight - 25 - bottomMargin, { align: 'center' });

      doc.end();

    } catch (error) {
      console.error('Error detallado en generación PDF:', error);
      reject(error);
    }
  });
}

// Función para generar ApiKey aleatoria
function generarApiKey() {
  return 'emp_' + Math.random().toString(36).substring(2, 12) +
         Math.random().toString(36).substring(2, 12);
}

// 📌 Endpoint para crear empresa
router.post('/api/empresas', async (req, res) => {
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

// 📋 Listar empresas
router.get('/api/empresas', async (req, res) => {
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


// ✏️ PUT /api/empresas/:id - Renombrar empresa
router.put('/api/empresas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre } = req.body;

    if (!nombre || nombre.trim().length < 3) {
      return res.status(400).json({
        ok: false,
        error: 'El nombre debe tener al menos 3 caracteres'
      });
    }

    // Buscar y actualizar la empresa
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

// 🗑️ DELETE /api/empresas/:id - Eliminar empresa (YA EXISTE PERO MEJORADO)
router.delete('/api/empresas/:id', async (req, res) => {
  try {
    const empresa = await Empresa.findByIdAndDelete(req.params.id);
    if (!empresa) return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });

    // Opcional: Eliminar también las impresoras asociadas
    await Impresora.deleteMany({ empresaId: req.params.id });
    await ImpresoraLatest.deleteMany({ empresaId: req.params.id });
    await CortesMensuales.deleteMany({ empresaId: req.params.id });

    res.json({ 
      ok: true,
      message: `Empresa "${empresa.nombre}" eliminada correctamente` 
    });
  } catch (err) {
    console.error('❌ DELETE /api/empresas/:id', err);
    res.status(500).json({ ok: false, error: 'Error eliminando empresa' });
  }
});



// 🔍 GET /api/empresas/:id - Obtener empresa específica
router.get('/api/empresas/:id', async (req, res) => {
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



// 🖨️ Listar impresoras de una empresa
router.get('/api/empresas/:empresaId/impresoras', async (req, res) => {
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

// 📊 Ingesta de métricas desde agente
router.post('/api/metrics/impresoras', async (req, res) => {
  try {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: 'Falta ApiKey' });

    const empresa = await Empresa.findOne({ apiKey: token }).lean();
    if (!empresa) return res.status(403).json({ ok: false, error: 'ApiKey inválida' });

    const {
      host,
      pageCount,
      pageCountMono = null,
      pageCountColor = null,
      supplies = [],
      sysName = null,
      sysDescr = null,
      printerName = null,
      serial = null,
      model = null,
      ciudad = null,
      ts = new Date().toISOString(),
      agentVersion = '1.0.0'
    } = req.body || {};

    if (!host) {
      return res.status(400).json({ ok: false, error: 'host requerido' });
    }

    const claveOr = serial
      ? { $or: [{ serial }, { host }] }
      : { host };

    const setBase = {
      empresaId: empresa._id,
      ciudad: ciudad || null,
      host,
      serial,
      sysName,
      sysDescr,
      printerName,
      model
    };

    const impresora = await Impresora.findOneAndUpdate(
      { empresaId: empresa._id, ...claveOr },
      {
        $set: setBase,
        $setOnInsert: { createdAt: new Date() }
      },
      { new: true, upsert: true }
    );

    const lastSeenAt = new Date(ts);
    const snmpOk =
      (typeof pageCount === 'number' && !Number.isNaN(pageCount)) ||
      (Array.isArray(supplies) && supplies.length > 0) ||
      !!sysName || !!sysDescr || !!serial || !!model;

    const lowToner = Array.isArray(supplies) && supplies.some(s => {
      const lvl = Number(s?.level);
      const max = Number(s?.max);
      if (isFinite(lvl) && isFinite(max) && max > 0) return (lvl / max) * 100 <= 20;
      return isFinite(lvl) && lvl <= 20;
    });

    await ImpresoraLatest.findOneAndUpdate(
      { printerId: impresora._id },
      {
        $set: {
          lastPageCount: (typeof pageCount === 'number' && !Number.isNaN(pageCount)) ? Number(pageCount) : null,
          lastPageMono: (typeof pageCountMono === 'number' && !Number.isNaN(pageCountMono)) ? Number(pageCountMono) : null,
          lastPageColor: (typeof pageCountColor === 'number' && !Number.isNaN(pageCountColor)) ? Number(pageCountColor) : null,
          lastSupplies: Array.isArray(supplies) ? supplies : [],
          lastSeenAt,
          lowToner,
          online: snmpOk,
        }
      },
      { new: true, upsert: true }
    );

    res.json({ ok: true, printerId: impresora._id, empresaId: empresa._id, agentVersion });
  } catch (err) {
    console.error('❌ POST /api/metrics/impresoras:', err);
    res.status(500).json({ ok: false, error: 'Error ingesta impresoras' });
  }
});

// 📅 Registrar corte mensual
router.post('/api/impresoras/:id/registrar-corte', async (req, res) => {
  try {
    const printerId = req.params.id;
    
    const impresora = await Impresora.findById(printerId).lean();
    if (!impresora) {
      return res.status(404).json({ ok: false, error: 'Impresora no encontrada' });
    }

    const latest = await ImpresoraLatest.findOne({ printerId }).lean();
    if (!latest) {
      return res.status(404).json({ ok: false, error: 'Datos de impresora no encontrados' });
    }

    let ultimoCorte = null;
    if (latest.ultimoCorteId) {
      ultimoCorte = await CortesMensuales.findById(latest.ultimoCorteId).lean();
    }

    const ahora = new Date();
    const calculos = calcularPeriodoCorte(ultimoCorte, latest);

    console.log('🔍 DEBUG CORTE:', {
      printerId,
      tieneUltimoCorte: !!ultimoCorte,
      ultimoCorteId: latest.ultimoCorteId,
      contadoresActuales: {
        lastPageMono: latest.lastPageMono,
        lastPageColor: latest.lastPageColor, 
        lastPageCount: latest.lastPageCount
      },
      calculosResultado: calculos
    });

    const nuevoCorte = new CortesMensuales({
      printerId,
      empresaId: impresora.empresaId,
      fechaCorte: ahora,
      mes: ahora.getMonth() + 1,
      año: ahora.getFullYear(),
      contadorInicioGeneral: calculos.contadorInicioGeneral,
      contadorFinGeneral: calculos.contadorFinGeneral,
      totalPaginasGeneral: calculos.totalPaginasGeneral,
      periodo: calculos.periodo,
      suppliesInicio: ultimoCorte?.suppliesFin || [],
      suppliesFin: latest.lastSupplies || [],
      nombreImpresora: impresora.printerName || impresora.sysName || impresora.host,
      modeloImpresora: impresora.model || impresora.sysDescr || ''
    });

    const corteGuardado = await nuevoCorte.save();

    await ImpresoraLatest.findOneAndUpdate(
      { printerId },
      { 
        $set: { 
          ultimoCorteId: corteGuardado._id,
          lastCutDate: ahora
        } 
      }
    );

    res.json({
      ok: true,
      corteId: corteGuardado._id,
      mensaje: 'Corte registrado correctamente',
      datos: {
        periodo: `${calculos.contadorInicioGeneral} → ${latest.lastPageCount || 0}`,
        totalPaginas: calculos.totalPaginasGeneral,
        fecha: ahora.toLocaleDateString()
      }
    });

  } catch (err) {
    console.error('❌ Error registrando corte:', err);
    res.status(500).json({ ok: false, error: 'Error interno registrando corte' });
  }
});

// 📄 Generar PDF del corte
router.get('/api/impresoras/:id/generar-pdf', async (req, res) => {
  try {
    const printerId = req.params.id;
    
    const latest = await ImpresoraLatest.findOne({ printerId })
      .populate('ultimoCorteId')
      .lean();

    if (!latest || !latest.ultimoCorteId) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Primero debe registrar un corte para generar el PDF' 
      });
    }

    const corte = latest.ultimoCorteId;
    const impresora = await Impresora.findById(printerId)
      .populate('empresaId')
      .lean();

    let ultimoCorteAnterior = null;
    if (corte.ultimoCorteId) {
      ultimoCorteAnterior = await CortesMensuales.findById(corte.ultimoCorteId).lean();
    }
    
    const calculosPeriodo = calcularPeriodoCorte(ultimoCorteAnterior, latest);
    
    const datosPDF = {
      ...corte,
      periodo: calculosPeriodo.periodo
    };

    const pdfBuffer = await generarPDFProfesional(datosPDF, impresora);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-${impresora.printerName || impresora.host}-${Date.now()}.pdf"`);
    res.send(pdfBuffer);

  } catch (err) {
    console.error('❌ Error generando PDF:', err);
    res.status(500).json({ ok: false, error: 'Error interno generando PDF: ' + err.message });
  }
});

// 🗑️ Eliminar empresa
router.delete('/api/empresas/:id', async (req, res) => {
  try {
    const empresa = await Empresa.findByIdAndDelete(req.params.id);
    if (!empresa) return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ DELETE /api/empresas/:id', err);
    res.status(500).json({ ok: false, error: 'Error eliminando empresa' });
  }
});


// 📁 ENDPOINTS PARA CARPETAS

// GET /api/carpetas - Obtener carpetas del usuario
router.get('/api/carpetas', async (req, res) => {
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
    }).sort({ fechaCreacion: -1 });

    res.json({
      ok: true,
      data: carpetas
    });

  } catch (error) {
    console.error('❌ Error obteniendo carpetas:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Error interno del servidor' 
    });
  }
});

// POST /api/carpetas - Crear carpeta
router.post('/api/carpetas', async (req, res) => {
  try {
    const { nombre, parentId, empresaId, ciudad } = req.body;

    if (!nombre || !empresaId || !ciudad) {
      return res.status(400).json({
        ok: false,
        error: 'Nombre, empresaId y ciudad son requeridos'
      });
    }

    // Verificar que parentId existe si se proporciona
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
router.put('/api/carpetas/:id', async (req, res) => {
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

// DELETE /api/carpetas/:id - Eliminar carpeta
router.delete('/api/carpetas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { empresaId, ciudad } = req.body;

    // Buscar y eliminar la carpeta
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

    // Eliminar asignaciones asociadas a esta carpeta
    await AsignacionCarpeta.deleteMany({ carpetaId: id });

    // Eliminar subcarpetas recursivamente
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

// Función auxiliar para eliminar subcarpetas recursivamente
async function eliminarSubcarpetasRecursivamente(parentId, empresaId, ciudad) {
  const subcarpetas = await Carpeta.find({ parentId, empresaId, ciudad });
  
  for (const subcarpeta of subcarpetas) {
    await AsignacionCarpeta.deleteMany({ carpetaId: subcarpeta._id });
    await eliminarSubcarpetasRecursivamente(subcarpeta._id, empresaId, ciudad);
    await Carpeta.findByIdAndDelete(subcarpeta._id);
  }
}

// 📌 ENDPOINTS PARA ASIGNACIONES DE EMPRESAS A CARPETAS

// POST /api/asignaciones - Asignar empresa a carpeta
router.post('/api/asignaciones', async (req, res) => {
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

    // Verificar que la carpeta existe
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

    // Crear o actualizar asignación
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
router.get('/api/asignaciones', async (req, res) => {
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

    // Convertir a objeto { empresaId: carpetaId } para facilitar el uso en frontend
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



// ℹ️ Política de online
router.get('/api/online-policy', (_req, res) => {
  res.json({
    ok: true,
    ONLINE_STALE_MS,
    note: 'Impresora se considera offline si lastSeenAt es más viejo que este umbral.'
  });
});

// ============================================
// MIDDLEWARE DE LICENCIA
// ============================================
const verificarLicencia = async (req, res, next) => {
  try {
    // IMPORTAR USUARIO (ajusta la ruta si es diferente)
    const Usuario = require('../models/Usuario'); 
    
    // Obtener empresaId de la ruta o query
    const empresaId = req.params.empresaId || req.query.empresaId || req.body.empresaId;
    const ciudad = req.query.ciudad || req.body.ciudad || req.headers['x-ciudad'];
    
    console.log('🔍 Verificando licencia:', { empresaId, ciudad });
    
    if (!empresaId || !ciudad) {
      return res.status(401).json({ 
        error: 'Credenciales de licencia no proporcionadas',
        codigo: 'SIN_CREDENCIALES'
      });
    }
    
    const usuario = await Usuario.findOne({ empresaId, ciudad });
    
    if (!usuario) {
      return res.status(401).json({ 
        error: 'Usuario no encontrado',
        codigo: 'USUARIO_NO_ENCONTRADO'
      });
    }
    
    const ahora = new Date();
    
    // Verificar si puede acceder
    let puedeAcceder = false;
    
    // 1. Licencia activa (pagada y vigente)
    if (usuario.activo && usuario.fechaExpiracionLicencia > ahora) {
      puedeAcceder = true;
    } 
    // 2. Trial vigente
    else if (usuario.licenciaTrial && usuario.fechaExpiracionTrial > ahora) {
      puedeAcceder = true;
    }
    // 3. Trial expirado
    else if (usuario.licenciaTrial && usuario.fechaExpiracionTrial <= ahora) {
      console.log('❌ Trial expirado:', usuario.email);
      return res.status(403).json({ 
        error: 'Tu trial ha expirado. Actualiza tu plan para continuar.',
        codigo: 'TRIAL_EXPIRADO',
        necesitaActualizar: true
      });
    }
    // 4. Starter/Premium sin pagar
    else if (usuario.plan !== 'trial' && !usuario.activo) {
      console.log('❌ Licencia pendiente de pago:', usuario.email);
      return res.status(403).json({ 
        error: 'Licencia pendiente de pago. Completa el pago para activar tu cuenta.',
        codigo: 'PENDIENTE_PAGO',
        necesitaActualizar: true
      });
    }
    
    if (!puedeAcceder) {
      return res.status(403).json({ 
        error: 'Licencia no válida o expirada',
        codigo: 'LICENCIA_INVALIDA',
        necesitaActualizar: true
      });
    }
    
    // Guardar usuario en request para uso posterior
    req.usuario = usuario;
    console.log('✅ Licencia válida:', usuario.email, 'Plan:', usuario.plan);
    next();
    
  } catch (error) {
    console.error('❌ Error verificando licencia:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ============================================
// APLICAR MIDDLEWARE A TODAS LAS RUTAS
// ============================================
const rutasProtegidas = [
  '/empresas/:empresaId/impresoras',
  '/impresoras/:id/registrar-corte',
  '/impresoras/:id/generar-pdf',
  '/api/metrics/impresoras',
  '/impresoras/:id',
  '/impresoras/:empresaId/upload',
  '/cortes-mensuales',
  '/cortes-mensuales/:empresaId',
  '/carpetas'
  // Agrega aquí otras rutas que necesiten protección
];

// Aplicar middleware solo a rutas específicas
router.stack.forEach(layer => {
  if (layer.route) {
    const ruta = layer.route.path;
    const metodo = layer.route.stack[0].method;
    
    // Verificar si esta ruta necesita protección
    const necesitaProteccion = rutasProtegidas.some(rutaProtegida => {
      // Coincidencia simple de patrones
      return ruta.includes(rutaProtegida.split(':')[0]);
    });
    
    if (necesitaProteccion) {
      console.log(`🔒 Protegiendo ruta: ${metodo.toUpperCase()} ${ruta}`);
      // Agregar middleware al inicio de los handlers
      layer.route.stack.unshift({ handle: verificarLicencia });
    }
  }
});

console.log('✅ Middleware de licencia aplicado a rutas protegidas');
// ============================================


module.exports = router;