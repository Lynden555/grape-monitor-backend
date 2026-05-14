const express = require('express');
const router = express.Router();

const Impresora = require('../models/Impresora');
const ImpresoraLatest = require('../models/ImpresoraLatest');
const CortesMensuales = require('../models/CortesMensuales');

const { calcularPeriodoCorte } = require('../helpers/cortes');
const { generarPDFProfesional } = require('../helpers/pdfGenerator');

// 📅 POST /api/impresoras/:id/registrar-corte
router.post('/impresoras/:id/registrar-corte', async (req, res) => {
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

    if (process.env.NODE_ENV !== 'production') {
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
    }

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

// 📄 GET /api/impresoras/:id/generar-pdf
router.get('/impresoras/:id/generar-pdf', async (req, res) => {
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

module.exports = router;
