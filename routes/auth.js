const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const Usuario = require('../models/Usuario');
const { puedeActivarUnaMas, contarImpresorasTotalesDeUsuario, obtenerLimitePorPlan } = require('../helpers/limitesPlan');

// 🔐 POST /login - Login con validación de licencia
router.post('/login', async (req, res) => {
  const { email, password, ciudad } = req.body;

  try {
    const usuario = await Usuario.findOne({ email, ciudad });

    if (!usuario) {
      return res.status(401).json({
        error: 'Usuario no encontrado',
        codigo: 'USUARIO_NO_ENCONTRADO'
      });
    }

    const passwordOk = await bcrypt.compare(password, usuario.password);
    if (!passwordOk) {
      return res.status(401).json({
        error: 'Contraseña incorrecta',
        codigo: 'CONTRASENA_INCORRECTA'
      });
    }

    const ahora = new Date();
    let puedeAcceder = false;
    let mensajeError = '';
    let codigoError = '';

    // CASO A: Licencia activa (ya pagó)
    if (usuario.activo && usuario.fechaExpiracionLicencia > ahora) {
      puedeAcceder = true;
    }
    // CASO B: Trial vigente
    else if (usuario.licenciaTrial && usuario.fechaExpiracionTrial > ahora) {
      puedeAcceder = true;
    }
// CASO C: Trial expirado (por fecha O por flag del cron)
    else if (
      usuario.plan === 'trial_expirado' ||
      (usuario.licenciaTrial && usuario.fechaExpiracionTrial <= ahora)
    ) {
      const fechaExp = usuario.fechaExpiracionTrial
        ? usuario.fechaExpiracionTrial.toLocaleDateString()
        : 'recientemente';
      mensajeError = `Tu trial expiró el ${fechaExp}. Actualiza tu plan para continuar.`;
      codigoError = 'TRIAL_EXPIRADO';
    }
    // CASO D: Starter/Premium sin pagar
    else if (usuario.plan !== 'trial' && !usuario.activo) {
      mensajeError = 'Licencia pendiente de pago. Por favor completa el pago para activar tu cuenta.';
      codigoError = 'PENDIENTE_PAGO';
    }
    // CASO E: Licencia expirada (pagó pero expiró)
    else if (usuario.activo && usuario.fechaExpiracionLicencia <= ahora) {
      mensajeError = 'Tu licencia ha expirado. Por favor renueva tu suscripción.';
      codigoError = 'LICENCIA_EXPIRADA';
    } else {
      mensajeError = 'Licencia no válida. Contacta a soporte.';
      codigoError = 'LICENCIA_INVALIDA';
    }

    if (!puedeAcceder) {
      return res.status(403).json({
        error: mensajeError,
        codigo: codigoError,
        datosLicencia: {
          plan: usuario.plan,
          activo: usuario.activo,
          licenciaTrial: usuario.licenciaTrial,
          expiraTrial: usuario.fechaExpiracionTrial,
          expiraLicencia: usuario.fechaExpiracionLicencia
        }
      });
    }

    let diasRestantes = null;
    if (usuario.licenciaTrial && usuario.fechaExpiracionTrial > ahora) {
      diasRestantes = Math.ceil((usuario.fechaExpiracionTrial - ahora) / (1000 * 60 * 60 * 24));
    }

    // 🆕 Generar JWT para app móvil / panel web (30 días de vigencia)
    const token = jwt.sign(
      {
        email: usuario.email,
        empresaId: usuario.empresaId,
        ciudad: usuario.ciudad
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      message: 'Login exitoso',
      token, // 🆕 Token JWT
      empresaId: usuario.empresaId,
      email: usuario.email,
      ciudad: usuario.ciudad,
      pais: usuario.pais || 'MX', 
      licencia: {
        plan: usuario.plan,
        activo: usuario.activo,
        licenciaTrial: usuario.licenciaTrial,
        diasRestantesTrial: diasRestantes,
        expiraTrial: usuario.fechaExpiracionTrial,
        expiraLicencia: usuario.fechaExpiracionLicencia,
        limiteImpresoras: usuario.limiteImpresoras
      }
    });

    res.json({
      success: true,
      message: 'Login exitoso',
      empresaId: usuario.empresaId,
      email: usuario.email,
      ciudad: usuario.ciudad,
      pais: usuario.pais || 'MX', 
      licencia: {
        plan: usuario.plan,
        activo: usuario.activo,
        licenciaTrial: usuario.licenciaTrial,
        diasRestantesTrial: diasRestantes,
        expiraTrial: usuario.fechaExpiracionTrial,
        expiraLicencia: usuario.fechaExpiracionLicencia,
        limiteImpresoras: usuario.limiteImpresoras
      }
    });

  } catch (error) {
    console.error('❌ Error en login:', error);
    res.status(500).json({
      error: 'Error en el servidor',
      codigo: 'ERROR_SERVIDOR'
    });
  }
});

// 📝 POST /api/registro - Registro con trial
router.post('/api/registro', async (req, res) => {
  try {
const {
      email,
      password,
      ciudad,
      empresaId,
      pais = 'MX',           
      plan = 'trial',
      diasTrial = 7
    } = req.body;

    if (!email || !password || !ciudad || !empresaId) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

   const planesValidos = ['trial', 'starter', 'pro', 'enterprise', 'custom'];
    if (!planesValidos.includes(plan)) {
      return res.status(400).json({ error: 'Plan no válido' });
    }

    const usuarioExistente = await Usuario.findOne({ email });
    if (usuarioExistente) {
      return res.status(400).json({ error: 'Este email ya está registrado' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const fechaActual = new Date();
    const fechaExpiracionTrial = new Date();
    fechaExpiracionTrial.setDate(fechaExpiracionTrial.getDate() + diasTrial);

const limiteImpresoras = obtenerLimitePorPlan(plan);

    const activo = (plan === 'trial');

const nuevoUsuario = new Usuario({
      email,
      password: hashedPassword,
      ciudad,
      empresaId,
      pais,                  
      plan,
      activo,
      licenciaTrial: true,
      fechaRegistro: fechaActual,
      fechaExpiracionTrial,
      fechaExpiracionLicencia: null,
      limiteImpresoras,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      ultimoPago: null
    });

    await nuevoUsuario.save();

    console.log('🎯 NUEVO REGISTRO CON LICENCIA:', {
      email, ciudad, empresaId, plan, activo, diasTrial, limiteImpresoras,
      expiraTrial: fechaExpiracionTrial.toISOString().split('T')[0]
    });

    res.json({
      success: true,
      message: plan === 'trial'
        ? `¡Registro exitoso! Tienes ${diasTrial} días de trial gratis.`
        : `¡Registro exitoso! Tienes ${diasTrial} días de trial. Procede al pago para activar tu licencia completa.`,
      empresaId,
      plan,
      activo,
      diasTrial,
diasTrial,
      expiraTrial: fechaExpiracionTrial,
      limiteImpresoras
    });

  } catch (error) {
    console.error('❌ Error en registro:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ✅ GET /api/verificar-licencia/:empresaId - Verificar licencia (usado por frontend)
router.get('/api/verificar-licencia/:empresaId', async (req, res) => {
  try {
    const { empresaId } = req.params;
    const usuario = await Usuario.findOne({ empresaId });

    if (!usuario) {
      return res.status(404).json({
        error: 'Empresa no encontrada',
        tieneLicencia: false
      });
    }

    const ahora = new Date();
    let puedeAcceder = false;
    let motivo = '';
    let datosLicencia = {};

    if (usuario.activo && usuario.fechaExpiracionLicencia > ahora) {
      puedeAcceder = true;
      motivo = 'Licencia activa (pago)';
      datosLicencia = {
tipo: 'pago',
        plan: usuario.plan,
        expira: usuario.fechaExpiracionLicencia,
        limiteImpresoras: usuario.limiteImpresoras
      };
    } else if (usuario.licenciaTrial && usuario.fechaExpiracionTrial > ahora) {
      puedeAcceder = true;
      motivo = 'Trial vigente';
      datosLicencia = {
        tipo: 'trial',
        plan: usuario.plan,
expira: usuario.fechaExpiracionTrial,
        diasRestantes: Math.ceil((usuario.fechaExpiracionTrial - ahora) / (1000 * 60 * 60 * 24)),
        limiteImpresoras: usuario.limiteImpresoras
      };
    } else if (usuario.licenciaTrial && usuario.fechaExpiracionTrial <= ahora) {
      motivo = 'Trial expirado';
      datosLicencia = {
        tipo: 'trial_expirado',
        plan: usuario.plan,
        expiroEl: usuario.fechaExpiracionTrial
      };
    } else {
      motivo = 'Licencia inactiva (pendiente de pago)';
      datosLicencia = {
        tipo: 'pendiente_pago',
        plan: usuario.plan,
        necesitaPago: true
      };
    }

    res.json({
      puedeAcceder,
      motivo,
      datosLicencia,
      usuario: {
        email: usuario.email,
        empresaId: usuario.empresaId,
        ciudad: usuario.ciudad,
        plan: usuario.plan,
        activo: usuario.activo,
        licenciaTrial: usuario.licenciaTrial
      }
    });

  } catch (error) {
    console.error('❌ Error verificando licencia:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      puedeAcceder: false
    });
  }
});

// 🔓 PATCH /api/usuarios/:email/activar - Activar licencia manualmente
router.patch('/api/usuarios/:email/activar', async (req, res) => {
  try {
    const { email } = req.params;

    const usuario = await Usuario.findOneAndUpdate(
      { email },
      { activo: true, fechaActivacion: new Date() },
      { new: true }
    );

    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({
      success: true,
      message: 'Licencia activada correctamente',
      usuario: {
        email: usuario.email,
        empresaId: usuario.empresaId,
        ciudad: usuario.ciudad,
        activo: usuario.activo
      }
    });

  } catch (error) {
    console.error('❌ Error activando licencia:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 📋 GET /api/registros-pendientes
router.get('/api/registros-pendientes', async (_req, res) => {
  try {
    const registrosPendientes = await Usuario.find(
      { activo: false },
      { password: 0 }
    ).sort({ fechaRegistro: -1 });

    res.json({
      success: true,
      count: registrosPendientes.length,
      registros: registrosPendientes
    });

  } catch (error) {
    console.error('❌ Error obteniendo registros:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 👥 GET /api/usuarios - Todos los usuarios (admin)
router.get('/api/usuarios', async (_req, res) => {
  try {
    const usuarios = await Usuario.find({}, { password: 0 }).sort({ fechaRegistro: -1 });
    res.json({
      success: true,
      count: usuarios.length,
      usuarios
    });
  } catch (error) {
    console.error('❌ Error obteniendo usuarios:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 📊 GET /api/usuarios/:email/plan-info - Info de plan para el front (barra de uso, modal upgrade)
router.get('/api/usuarios/:email/plan-info', async (req, res) => {
  try {
    const usuario = await Usuario.findOne({ email: req.params.email }).lean();
    if (!usuario) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }

    const check = await puedeActivarUnaMas(usuario._id);
    const totales = await contarImpresorasTotalesDeUsuario(usuario._id);
    const ahora = new Date();
    const diasRestantesTrial = usuario.fechaExpiracionTrial
      ? Math.max(0, Math.ceil((new Date(usuario.fechaExpiracionTrial) - ahora) / (1000 * 60 * 60 * 24)))
      : null;

    res.json({
      ok: true,
      plan: usuario.plan,
      limiteImpresoras: check.limite,
      impresorasActivas: check.usadas,
      impresorasInactivas: totales - check.usadas,
      impresorasTotales: totales,
      puedeAgregarMas: check.puede,
      diasRestantesTrial,
      fechaExpiracionTrial: usuario.fechaExpiracionTrial,
      fechaExpiracionLicencia: usuario.fechaExpiracionLicencia,
      trialExpirado: usuario.plan === 'trial_expirado',
      activo: usuario.activo
    });
  } catch (err) {
    console.error('❌ plan-info:', err);
    res.status(500).json({ ok: false, error: 'Error obteniendo info del plan' });
  }
});

module.exports = router;
