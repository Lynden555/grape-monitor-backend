const express = require('express');
const router = express.Router();

const Impresora = require('../models/Impresora');
const ImpresoraLatest = require('../models/ImpresoraLatest');
const CortesMensuales = require('../models/CortesMensuales');
const FolioContador = require('../models/FolioContador');

const { calcularPeriodoCorte } = require('../helpers/cortes');
const { generarPDFProfesional } = require('../helpers/pdfGenerator');

// MARK: Helpers de periodo
function partesEnZona(fecha, timezone) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(fecha);

  return {
    anio: Number(partes.find(p => p.type === 'year').value),
    mes: Number(partes.find(p => p.type === 'month').value)
  };
}

async function generarFolio(empresaId, mes, anio) {
  const sufijo = String(empresaId).slice(-4).toUpperCase();
  const clave = `${sufijo}-${anio}-${String(mes).padStart(2, '0')}`;

  const contador = await FolioContador.findByIdAndUpdate(
    clave,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  return `GM-${clave}-${String(contador.seq).padStart(4, '0')}`;
}
async function ejecutarCorte(printerId) {
  const impresora = await Impresora.findById(printerId).populate('empresaId').lean();
  if (!impresora) return { ok: false, error: 'Impresora no encontrada' };

  const latest = await ImpresoraLatest.findOne({ printerId }).lean();
  if (!latest) return { ok: false, error: 'Sin datos de la impresora' };

  let ultimoCorte = null;
  if (latest.ultimoCorteId) {
    ultimoCorte = await CortesMensuales.findById(latest.ultimoCorteId).lean();
  }

  const ahora = new Date();
  const timezone = impresora.empresaId?.timezone || 'America/Tijuana';
  const empresaObjectId = impresora.empresaId?._id || impresora.empresaId;
  const calculos = calcularPeriodoCorte(ultimoCorte, latest, timezone);
  const { mes, anio } = partesEnZona(ahora, timezone);
  const folio = await generarFolio(empresaObjectId, mes, anio);

  const nuevoCorte = new CortesMensuales({
    printerId,
    empresaId: empresaObjectId,
    folio,
    fechaCorte: ahora,
    mes,
    año: anio,
    esBaseline: calculos.esBaseline,
    modoConteo: calculos.modoConteo,
    fechaInicioPeriodo: calculos.fechaInicioPeriodo,
    fechaFinPeriodo: calculos.fechaFinPeriodo,
    periodo: calculos.periodo,
    contadorInicioGeneral: calculos.contadorInicioGeneral,
    contadorFinGeneral: calculos.contadorFinGeneral,
    totalPaginasGeneral: calculos.totalPaginasGeneral,
    contadorInicioMono: calculos.contadorInicioMono,
    contadorFinMono: calculos.contadorFinMono,
    totalPaginasMono: calculos.totalPaginasMono,
    contadorInicioColor: calculos.contadorInicioColor,
    contadorFinColor: calculos.contadorFinColor,
    totalPaginasColor: calculos.totalPaginasColor,
    suppliesInicio: ultimoCorte?.suppliesFin || [],
    suppliesFin: latest.lastSupplies || [],
    nombreImpresora: impresora.printerName || impresora.sysName || impresora.host,
    modeloImpresora: impresora.model || impresora.sysDescr || ''
  });

  let corteGuardado;
  try {
    corteGuardado = await nuevoCorte.save();
  } catch (errGuardado) {
    const sufijoRb = String(empresaObjectId).slice(-4).toUpperCase();
    await FolioContador.findByIdAndUpdate(
      `${sufijoRb}-${anio}-${String(mes).padStart(2, '0')}`,
      { $inc: { seq: -1 } }
    );
    throw errGuardado;
  }

  await ImpresoraLatest.findOneAndUpdate(
    { printerId },
    { $set: { ultimoCorteId: corteGuardado._id, lastCutDate: ahora } }
  );

  return {
    ok: true,
    corteId: corteGuardado._id,
    folio,
    nombreImpresora: impresora.printerName || impresora.sysName || impresora.host,
    clienteNombre: impresora.empresaId?.nombre || null,
    datos: {
      periodo: `${calculos.contadorInicioGeneral} → ${latest.lastPageCount || 0}`,
      totalPaginas: calculos.totalPaginasGeneral,
      fecha: ahora.toLocaleDateString()
    }
  };
}

// 📅 POST /api/impresoras/:id/registrar-corte
router.post('/impresoras/:id/registrar-corte', async (req, res) => {
  try {
    const resultado = await ejecutarCorte(req.params.id);

    if (!resultado.ok) {
      return res.status(404).json({ ok: false, error: resultado.error });
    }

    res.json({
      ok: true,
      corteId: resultado.corteId,
      mensaje: 'Corte registrado correctamente',
      datos: resultado.datos
    });

  } catch (err) {
    console.error('❌ Error registrando corte:', err);
    res.status(500).json({ ok: false, error: 'Error interno registrando corte' });
  }
});

async function resolverImpresoras({ printerIds, empresaIds, ciudad }) {
  const filtro = { monitoreoActivo: true };
  if (ciudad) filtro.ciudad = ciudad;

  if (Array.isArray(printerIds) && printerIds.length > 0) {
    filtro._id = { $in: printerIds };
  } else if (Array.isArray(empresaIds) && empresaIds.length > 0) {
    filtro.empresaId = { $in: empresaIds };
  } else {
    return [];
  }

  return Impresora.find(filtro).populate('empresaId').lean();
}

router.post('/cortes-masivos', async (req, res) => {
  try {
    const { printerIds, empresaIds, ciudad } = req.body;

    const impresoras = await resolverImpresoras({ printerIds, empresaIds, ciudad });
    if (impresoras.length === 0) {
      return res.status(400).json({ ok: false, error: 'No se encontraron impresoras' });
    }

    const exitosos = [];
    const fallidos = [];
    const LOTE = 5;

    for (let i = 0; i < impresoras.length; i += LOTE) {
      const lote = impresoras.slice(i, i + LOTE);
      const resultados = await Promise.allSettled(
        lote.map(imp => ejecutarCorte(imp._id))
      );

      resultados.forEach((r, idx) => {
        const imp = lote[idx];
        const nombre = imp.printerName || imp.sysName || imp.host;
        const cliente = imp.empresaId?.nombre || 'Cliente';

        if (r.status === 'fulfilled' && r.value.ok) {
          exitosos.push({
            printerId: imp._id,
            nombreImpresora: nombre,
            clienteNombre: cliente,
            folio: r.value.folio,
            totalPaginas: r.value.datos.totalPaginas
          });
        } else {
          const motivo = r.status === 'rejected'
            ? (r.reason?.message || 'Error inesperado')
            : r.value.error;
          fallidos.push({
            printerId: imp._id,
            nombreImpresora: nombre,
            clienteNombre: cliente,
            error: motivo
          });
        }
      });
    }

    res.json({
      ok: true,
      fecha: new Date(),
      total: impresoras.length,
      exitosos,
      fallidos
    });

  } catch (err) {
    console.error('❌ Error en corte masivo:', err);
    res.status(500).json({ ok: false, error: 'Error interno en corte masivo' });
  }
});

function nombreArchivoSeguro(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

router.post('/cortes-masivos/pdf', async (req, res) => {
  const archiver = require('archiver');

  try {
    const { printerIds, empresaIds, ciudad } = req.body;

    const impresoras = await resolverImpresoras({ printerIds, empresaIds, ciudad });
    if (impresoras.length === 0) {
      return res.status(400).json({ ok: false, error: 'No se encontraron impresoras' });
    }

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="contadores-${stamp}.zip"`);

    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('error', err => {
      console.error('❌ Error armando ZIP:', err);
      res.destroy();
    });
    zip.pipe(res);

    const usados = new Set();
    let incluidos = 0;
    const omitidos = [];

    for (const imp of impresoras) {
      try {
        const latest = await ImpresoraLatest.findOne({ printerId: imp._id })
          .populate('ultimoCorteId')
          .lean();

        if (!latest?.ultimoCorteId) {
          omitidos.push(`${imp.empresaId?.nombre || 'Cliente'} - sin corte registrado`);
          continue;
        }

        const pdfBuffer = await generarPDFProfesional({ ...latest.ultimoCorteId }, imp);

        const cliente = nombreArchivoSeguro(imp.empresaId?.nombre || 'Cliente');
        const equipo = nombreArchivoSeguro(imp.printerName || imp.sysName || imp.host);
        let nombre = `${cliente}_${equipo}.pdf`;
        let n = 2;
        while (usados.has(nombre)) {
          nombre = `${cliente}_${equipo}-${n}.pdf`;
          n += 1;
        }
        usados.add(nombre);

        zip.append(pdfBuffer, { name: nombre });
        incluidos += 1;
      } catch (errPdf) {
        console.error(`❌ PDF fallido para ${imp._id}:`, errPdf.message);
        omitidos.push(`${imp.empresaId?.nombre || 'Cliente'} - ${errPdf.message}`);
      }
    }

    if (omitidos.length > 0) {
      zip.append(
        `Impresoras omitidas:\n\n${omitidos.join('\n')}\n`,
        { name: '_omitidas.txt' }
      );
    }

    console.log(`📦 ZIP de contadores: ${incluidos} incluidos, ${omitidos.length} omitidos`);
    await zip.finalize();

  } catch (err) {
    console.error('❌ Error generando ZIP:', err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: 'Error generando el ZIP' });
    }
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

    const datosPDF = { ...corte };

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
