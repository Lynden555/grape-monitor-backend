const express = require('express');
const router = express.Router();
const Empresa = require('../models/Empresa');
const Impresora = require('../models/Impresora');
const ImpresoraLatest = require('../models/ImpresoraLatest');
const Usuario = require('../models/Usuario');
const { puedeActivarUnaMas } = require('../helpers/limitesPlan');
const { procesarPosibleAlerta } = require('../helpers/alertaService');

// 📊 POST /api/metrics/impresoras - Ingesta de métricas desde el agente SNMP
router.post('/metrics/impresoras', async (req, res) => {
  try {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: 'Falta ApiKey' });

    const empresa = await Empresa.findOne({ apiKey: token }).lean();
    if (!empresa) return res.status(403).json({ ok: false, error: 'ApiKey inválida' });

    // 🆕 BLOQUEO POR TRIAL EXPIRADO
    if (empresa.userId) {
      const usuario = await Usuario.findById(empresa.userId).select('plan').lean();
      if (usuario && usuario.plan === 'trial_expirado') {
        return res.status(403).json({
          ok: false,
          error: 'Trial expirado. El usuario debe actualizar su plan.',
          codigo: 'TRIAL_EXPIRADO'
        });
      }
    }

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

    // 🆕 Verificar si la impresora YA existe antes de upsert
    const impresoraExistente = await Impresora.findOne({
      empresaId: empresa._id,
      ...claveOr
    }).lean();

    // 🆕 LÓGICA DE LÍMITES: solo aplica para impresoras NUEVAS
    let monitoreoActivoParaNueva = true;
    let limiteAlcanzado = false;

    if (!impresoraExistente && empresa.userId) {
      const check = await puedeActivarUnaMas(empresa.userId);
      monitoreoActivoParaNueva = check.puede;
      limiteAlcanzado = !check.puede;
    }

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

    const setOnInsert = { createdAt: new Date() };
    // Solo seteamos monitoreoActivo en INSERT (no sobreescribimos el de impresoras existentes)
    if (!impresoraExistente) {
      setOnInsert.monitoreoActivo = monitoreoActivoParaNueva;
    }

    const impresora = await Impresora.findOneAndUpdate(
      { empresaId: empresa._id, ...claveOr },
      {
        $set: setBase,
        $setOnInsert: setOnInsert
      },
      { new: true, upsert: true }
    );

    // 🆕 Si la impresora tiene monitoreoActivo:false, NO procesamos métricas (ahorra tráfico Railway)
    if (!impresora.monitoreoActivo) {
      return res.json({
        ok: true,
        printerId: impresora._id,
        empresaId: empresa._id,
        agentVersion,
        monitoreoActivo: false,
        limiteAlcanzado: true,
        mensaje: 'Impresora registrada sin monitoreo activo. Actualiza tu plan para activarla.'
      });
    }

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

    // 🆕 Procesar alertas (no bloquea la respuesta del agente si falla)
    procesarPosibleAlerta(impresora, supplies).catch(err => {
      console.error('❌ AlertaService (background):', err);
    });

    res.json({
      ok: true,
      printerId: impresora._id,
      empresaId: empresa._id,
      agentVersion,
      monitoreoActivo: true
    });
  } catch (err) {
    console.error('❌ POST /api/metrics/impresoras:', err);
    res.status(500).json({ ok: false, error: 'Error ingesta impresoras' });
  }
});

module.exports = router;