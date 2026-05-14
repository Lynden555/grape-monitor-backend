const Usuario = require('../models/Usuario');

/**
 * Middleware que verifica que el usuario tenga una licencia válida.
 * Requiere que llegue empresaId y ciudad en params, query, body o headers.
 * En caso de éxito, deja el usuario en req.usuario para usos posteriores.
 */
async function verificarLicencia(req, res, next) {
  try {
    const empresaId = req.params.empresaId || req.query.empresaId || req.body.empresaId;
    const ciudad = req.query.ciudad || req.body.ciudad || req.headers['x-ciudad'];

    if (!empresaId || !ciudad) {
      return res.status(401).json({
        ok: false,
        error: 'Credenciales de licencia no proporcionadas',
        codigo: 'SIN_CREDENCIALES'
      });
    }

    const usuario = await Usuario.findOne({ empresaId, ciudad });

    if (!usuario) {
      return res.status(401).json({
        ok: false,
        error: 'Usuario no encontrado',
        codigo: 'USUARIO_NO_ENCONTRADO'
      });
    }

    const ahora = new Date();
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
      return res.status(403).json({
        ok: false,
        error: 'Tu trial ha expirado. Actualiza tu plan para continuar.',
        codigo: 'TRIAL_EXPIRADO',
        necesitaActualizar: true
      });
    }
    // 4. Starter/Premium sin pagar
    else if (usuario.plan !== 'trial' && !usuario.activo) {
      return res.status(403).json({
        ok: false,
        error: 'Licencia pendiente de pago. Completa el pago para activar tu cuenta.',
        codigo: 'PENDIENTE_PAGO',
        necesitaActualizar: true
      });
    }

    if (!puedeAcceder) {
      return res.status(403).json({
        ok: false,
        error: 'Licencia no válida o expirada',
        codigo: 'LICENCIA_INVALIDA',
        necesitaActualizar: true
      });
    }

    req.usuario = usuario;
    next();

  } catch (error) {
    console.error('❌ Error verificando licencia:', error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
}

module.exports = verificarLicencia;
