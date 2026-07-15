const mongoose = require('mongoose');
const AlertaConfig = require('../models/AlertaConfig');
const Alerta = require('../models/Alerta');
const DeviceToken = require('../models/DeviceToken');
const ImpresoraLatest = require('../models/ImpresoraLatest');
const { enviarPush } = require('./fcmService');

// Umbral fijo de "crítico" (siempre 5%)
const NIVEL_CRITICO = 5;

// Si el nivel sube más de este delta, asumimos cambio de cartucho
const DELTA_RESET_CARTUCHO = 30;

/**
 * Calcula el porcentaje real de un supply.
 */
function calcularPorcentaje(supply) {
  const level = Number(supply?.level);
  const max = Number(supply?.max);
  if (!isFinite(level)) return null;
  if (isFinite(max) && max > 0) return (level / max) * 100;
  return level; // asumir que level ya es porcentaje
}

/**
 * Determina qué nivel escalado (si alguno) corresponde a un porcentaje.
 * Retorna 'critico' | 'mitad' | 'umbral' | null
 */
function determinarNivelEscalado(porcentaje, umbralUsuario) {
  if (porcentaje <= NIVEL_CRITICO) return 'critico';
  if (porcentaje <= umbralUsuario / 2) return 'mitad';
  if (porcentaje <= umbralUsuario) return 'umbral';
  return null;
}

/**
 * Verifica si un nivel escalado debe disparar dado el que ya se disparó antes.
 * Los niveles son progresivos: umbral -> mitad -> critico
 */
function debeDisparar(nivelNuevo, ultimoDisparado) {
  if (!nivelNuevo) return false;
  if (!ultimoDisparado) return true;

  const orden = { umbral: 1, mitad: 2, critico: 3 };
  return orden[nivelNuevo] > orden[ultimoDisparado];
}

/**
 * Envía push a todos los devices activos de una ciudad.
 */
async function notificarDevices(ciudad, titulo, cuerpo, data) {
  const devices = await DeviceToken.find({ ciudad, activo: true }).lean();

  if (devices.length === 0) {
    console.log(`Sin devices activos para ciudad="${ciudad}"`);
    return [];
  }

  const resultados = [];
  for (const device of devices) {
    const unreadCount = await Alerta.countDocuments({
      ciudad,
      leidaPor: { $ne: device.email }
    });
    const badgeCount = unreadCount + 1;

    const result = await enviarPush(device.token, titulo, cuerpo, data, badgeCount);
    resultados.push({
      email: device.email,
      deviceToken: device.token,
      platform: device.platform,
      messageId: result.messageId || null,
      estado: result.ok ? 'sent' : 'failed',
      error: result.error || null
    });

    if (!result.ok && result.error?.includes('registration-token-not-registered')) {
      await DeviceToken.updateOne({ _id: device._id }, { $set: { activo: false } });
    }
  }
  return resultados;
}

/**
 * Función principal: procesa las lecturas nuevas de una impresora
 * y dispara alertas si corresponde.
 *
 * @param {Object} impresora - documento de Impresora
 * @param {Array} supplies - array de {name, level, max} de la lectura nueva
 */
async function procesarPosibleAlerta(impresora, supplies) {
  try {
    if (!impresora || !Array.isArray(supplies) || supplies.length === 0) return;

    // 1. Buscar config de alertas
    const config = await AlertaConfig.findOne({ printerId: impresora._id }).lean();
    if (!config || !config.activa) return; // sin config o desactivada

    // 2. Traer tracking anterior de esta impresora
    const latest = await ImpresoraLatest.findOne({ printerId: impresora._id }).lean();
    const trackingPrevio = latest?.suppliesTracking || [];

    // Crear map name -> tracking previo
    const mapPrevio = {};
    trackingPrevio.forEach(t => { mapPrevio[t.name] = t; });

    const nuevoTracking = [];
    const disparos = []; // alertas a disparar

    for (const supply of supplies) {
      if (!supply?.name) continue;

      const porcentaje = calcularPorcentaje(supply);
      if (porcentaje === null) continue;

      const previo = mapPrevio[supply.name];
      let cicloActual = previo?.cicloActual || 1;
      let ultimoUmbralDisparado = previo?.ultimoUmbralDisparado || null;

      // Detección de cambio de cartucho (nivel subió mucho)
      if (previo && porcentaje - previo.ultimoNivel >= DELTA_RESET_CARTUCHO) {
        cicloActual += 1;
        ultimoUmbralDisparado = null;
        console.log(`🔄 Reset cartucho detectado en ${supply.name} (${previo.ultimoNivel}% → ${porcentaje.toFixed(1)}%). Ciclo ${cicloActual}`);
      }

      // Determinar si dispara
      const nivelEscalado = determinarNivelEscalado(porcentaje, config.umbralPorcentaje);
      if (debeDisparar(nivelEscalado, ultimoUmbralDisparado)) {
        disparos.push({
          supplyName: supply.name,
          nivel: Math.round(porcentaje * 10) / 10,
          nivelEscalado,
          cicloId: `${impresora._id}-${supply.name}-c${cicloActual}`
        });
        ultimoUmbralDisparado = nivelEscalado;
      }

      nuevoTracking.push({
        name: supply.name,
        ultimoNivel: porcentaje,
        cicloActual,
        ultimoUmbralDisparado,
        updatedAt: new Date()
      });
    }

    // 3. Guardar tracking actualizado
    await ImpresoraLatest.updateOne(
      { printerId: impresora._id },
      { $set: { suppliesTracking: nuevoTracking } }
    );

    // 4. Disparar las alertas
    const Empresa = require('../models/Empresa');
    const clienteDoc = await Empresa.findById(impresora.empresaId).select('nombre').lean();
    const nombreCliente = clienteDoc?.nombre || null;

    for (const d of disparos) {
      const nombreImpresora = impresora.customName || impresora.printerName || impresora.host;
      const titulos = {
        umbral: `Tóner bajo en ${nombreImpresora} ⚠️ `,
        mitad: `Tóner muy bajo en ${nombreImpresora} 🟠`,
        critico: `Crítico: tóner casi vacío en ${nombreImpresora} 🔴`
      };
      const cuerpo = nombreCliente
        ? `${nombreCliente} · ${d.supplyName}: ${d.nivel}%`
        : `${d.supplyName}: ${d.nivel}%`;

      const destinatariosEnviados = await notificarDevices(
        impresora.ciudad,
        titulos[d.nivelEscalado],
        cuerpo,
        {
          tipoAlerta: 'TONER_BAJO',
          printerId: impresora._id.toString(),
          supplyName: d.supplyName,
          nivel: d.nivel,
          nivelEscalado: d.nivelEscalado
        }
      );

      await Alerta.create({
        printerId: impresora._id,
        empresaId: impresora.empresaId,
        ciudad: impresora.ciudad,
        tipoAlerta: 'TONER_BAJO',
        supplyName: d.supplyName,
        nivel: d.nivel,
        nivelEscalado: d.nivelEscalado,
        cicloId: d.cicloId,
        destinatariosEnviados,
        enviadoEn: new Date()
      });

      console.log(`🔔 Alerta disparada: ${d.supplyName} = ${d.nivel}% (${d.nivelEscalado}) → ${destinatariosEnviados.length} devices`);
    }
  } catch (err) {
    console.error('❌ Error en AlertaService.procesarPosibleAlerta:', err);
    // No propagar — el ingest del agente no debe fallar por un error de alerta
  }
}

module.exports = {
  procesarPosibleAlerta,
  // Exportados para tests unitarios futuros
  _internal: {
    calcularPorcentaje,
    determinarNivelEscalado,
    debeDisparar,
    NIVEL_CRITICO,
    DELTA_RESET_CARTUCHO
  }
};