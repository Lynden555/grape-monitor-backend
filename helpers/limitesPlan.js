const Empresa = require('../models/Empresa');
const Impresora = require('../models/Impresora');
const Usuario = require('../models/Usuario');

/**
 * Límites por defecto según plan.
 * El usuario puede tener un limiteImpresoras custom que sobreescribe esto.
 */
const LIMITES_POR_PLAN = {
  trial: 5,
  trial_expirado: 0,
  starter: 50,
  pro: 200,
  enterprise: 500,
  custom: 9999
};

function obtenerLimitePorPlan(plan) {
  return LIMITES_POR_PLAN[plan] ?? 5;
}

/**
 * Cuenta impresoras totales de un usuario sumando todas sus empresas.
 * Solo cuenta las que tienen monitoreoActivo:true (las inactivas no consumen recursos).
 */
async function contarImpresorasActivasDeUsuario(userId) {
  const empresas = await Empresa.find({ userId }).select('_id').lean();
  if (empresas.length === 0) return 0;
  const empresaIds = empresas.map(e => e._id);
  return Impresora.countDocuments({
    empresaId: { $in: empresaIds },
    monitoreoActivo: true
  });
}

/**
 * Cuenta TODAS las impresoras del usuario (activas + inactivas).
 */
async function contarImpresorasTotalesDeUsuario(userId) {
  const empresas = await Empresa.find({ userId }).select('_id').lean();
  if (empresas.length === 0) return 0;
  const empresaIds = empresas.map(e => e._id);
  return Impresora.countDocuments({ empresaId: { $in: empresaIds } });
}

/**
 * Determina si el usuario puede activar el monitoreo de UNA impresora más.
 * Devuelve { puede: bool, limite: number, usadas: number, plan: string }.
 */
async function puedeActivarUnaMas(userId) {
  const usuario = await Usuario.findById(userId).lean();
  if (!usuario) return { puede: false, limite: 0, usadas: 0, plan: null };

  // Si el usuario tiene un limiteImpresoras custom usamos ese, sino el del plan
  const limite = usuario.limiteImpresoras ?? obtenerLimitePorPlan(usuario.plan);
  const usadas = await contarImpresorasActivasDeUsuario(userId);

  return {
    puede: usadas < limite,
    limite,
    usadas,
    plan: usuario.plan
  };
}

module.exports = {
  LIMITES_POR_PLAN,
  obtenerLimitePorPlan,
  contarImpresorasActivasDeUsuario,
  contarImpresorasTotalesDeUsuario,
  puedeActivarUnaMas
};