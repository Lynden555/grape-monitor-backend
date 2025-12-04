const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcrypt');

const connectDB = require('./config/database');
const impresorasRoutes = require('./routes/impresoras');

const app = express();
const PORT = 8080; // Puerto fijo para Railway

// Conectar a la base de datos
connectDB();

// Schema de Usuario para login
const usuarioSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String,
  activo: { type: Boolean, default: false },
  ciudad: String,
  empresaId: String,
  fechaRegistro: { type: Date, default: Date.now },
  
  // CAMPOS NUEVOS PARA LICENCIA:
  plan: { 
    type: String, 
    enum: ['trial', 'starter', 'premium'],
    default: 'trial'
  },
  licenciaTrial: { type: Boolean, default: true },
  fechaExpiracionTrial: Date,
  fechaExpiracionLicencia: Date,
  limiteEmpresas: { type: Number, default: 1 },
  
  // Para Stripe (después)
  stripeCustomerId: String,
  stripeSubscriptionId: String,
  ultimoPago: Date
});

const Usuario = mongoose.model('Usuario', usuarioSchema);

// Middlewares básicos
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos
app.use('/uploads', express.static('uploads'));


// NUEVA Configuración CORS corregida
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Manejar requests OPTIONS directamente
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Rutas
app.use('/', impresorasRoutes);

// Endpoint de Login
// Endpoint de Login CON VALIDACIÓN DE LICENCIA
app.post('/login', async (req, res) => {
  const { email, password, ciudad } = req.body;
  
  try {
    // 1. Buscar usuario
    const usuario = await Usuario.findOne({ email, ciudad });
    
    if (!usuario) {
      return res.status(401).json({ 
        error: 'Usuario no encontrado',
        codigo: 'USUARIO_NO_ENCONTRADO'
      });
    }

    // 2. Verificar contraseña
    const passwordOk = await bcrypt.compare(password, usuario.password);
    if (!passwordOk) {
      return res.status(401).json({ 
        error: 'Contraseña incorrecta',
        codigo: 'CONTRASENA_INCORRECTA'
      });
    }

    // 3. VERIFICAR LICENCIA (NUEVA LÓGICA)
    const ahora = new Date();
    let puedeAcceder = false;
    let mensajeError = '';
    let codigoError = '';

    // CASO A: Tiene licencia activa (ya pagó)
    if (usuario.activo && usuario.fechaExpiracionLicencia > ahora) {
      puedeAcceder = true;
    }
    // CASO B: Está en trial vigente
    else if (usuario.licenciaTrial && usuario.fechaExpiracionTrial > ahora) {
      puedeAcceder = true;
    }
    // CASO C: Trial expirado
    else if (usuario.licenciaTrial && usuario.fechaExpiracionTrial <= ahora) {
      puedeAcceder = false;
      mensajeError = `Tu trial expiró el ${usuario.fechaExpiracionTrial.toLocaleDateString()}.`;
      codigoError = 'TRIAL_EXPIRADO';
    }
    // CASO D: Starter/Premium sin pagar (activo = false)
    else if (usuario.plan !== 'trial' && !usuario.activo) {
      puedeAcceder = false;
      mensajeError = 'Licencia pendiente de pago. Por favor completa el pago para activar tu cuenta.';
      codigoError = 'PENDIENTE_PAGO';
    }
    // CASO E: Licencia expirada (pagó pero expiró)
    else if (usuario.activo && usuario.fechaExpiracionLicencia <= ahora) {
      puedeAcceder = false;
      mensajeError = 'Tu licencia ha expirado. Por favor renueva tu suscripción.';
      codigoError = 'LICENCIA_EXPIRADA';
    }
    // CASO F: Cualquier otra situación
    else {
      puedeAcceder = false;
      mensajeError = 'Licencia no válida. Contacta a soporte.';
      codigoError = 'LICENCIA_INVALIDA';
    }

    // 4. Si NO puede acceder, retornar error
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

    // 5. Si PUEDE acceder, calcular días restantes (si es trial)
    let diasRestantes = null;
    if (usuario.licenciaTrial && usuario.fechaExpiracionTrial > ahora) {
      diasRestantes = Math.ceil((usuario.fechaExpiracionTrial - ahora) / (1000 * 60 * 60 * 24));
    }

    // 6. Login exitoso
    res.json({ 
      success: true,
      message: 'Login exitoso',
      empresaId: usuario.empresaId,
      email: usuario.email,
      ciudad: usuario.ciudad,
      licencia: {
        plan: usuario.plan,
        activo: usuario.activo,
        licenciaTrial: usuario.licenciaTrial,
        diasRestantesTrial: diasRestantes,
        expiraTrial: usuario.fechaExpiracionTrial,
        expiraLicencia: usuario.fechaExpiracionLicencia,
        limiteEmpresas: usuario.limiteEmpresas
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

// Endpoint de Registro
// Endpoint de Registro CON TRIAL
app.post('/api/registro', async (req, res) => {
  try {
    const { 
      email, 
      password, 
      ciudad, 
      empresaId,
      plan = 'trial',           // Nuevo: 'trial', 'starter', 'premium'
      diasTrial = 7             // Nuevo: 7 días para trial, 3 para pago
    } = req.body;

    // Validar datos requeridos
    if (!email || !password || !ciudad || !empresaId) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    // Validar plan
    const planesValidos = ['trial', 'starter', 'premium'];
    if (!planesValidos.includes(plan)) {
      return res.status(400).json({ error: 'Plan no válido' });
    }

    // Verificar si el email ya existe
    const usuarioExistente = await Usuario.findOne({ email });
    if (usuarioExistente) {
      return res.status(400).json({ error: 'Este email ya está registrado' });
    }

    // Verificar fortaleza de contraseña
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    // Encriptar contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // CALCULAR FECHAS SEGÚN PLAN
    const fechaActual = new Date();
    const fechaExpiracionTrial = new Date();
    fechaExpiracionTrial.setDate(fechaExpiracionTrial.getDate() + diasTrial);

    // DETERMINAR LÍMITE DE EMPRESAS
    let limiteEmpresas = 1; // Default trial
    if (plan === 'starter') limiteEmpresas = 10;
    if (plan === 'premium') limiteEmpresas = 30;

    // DETERMINAR SI ESTÁ ACTIVO
    // Trial: activo true (acceso inmediato)
    // Starter/Premium: activo false hasta que paguen
    const activo = (plan === 'trial') ? true : false;

    // Crear nuevo usuario CON CAMPOS DE LICENCIA
    const nuevoUsuario = new Usuario({
      email,
      password: hashedPassword,
      ciudad,
      empresaId,
      plan,                    // 'trial', 'starter', 'premium'
      activo,                  // true para trial, false para pago
      licenciaTrial: true,     // Siempre true al registrar
      fechaRegistro: fechaActual,
      fechaExpiracionTrial: fechaExpiracionTrial,
      fechaExpiracionLicencia: null, // Se llena cuando pague
      limiteEmpresas: limiteEmpresas,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      ultimoPago: null
    });

    await nuevoUsuario.save();

    // 📢 Notificación en consola DETALLADA
    console.log('🎯 NUEVO REGISTRO CON LICENCIA:', {
      email,
      ciudad,
      empresaId,
      plan,
      activo,
      diasTrial,
      limiteEmpresas,
      expiraTrial: fechaExpiracionTrial.toISOString().split('T')[0]
    });

    // Respuesta exitosa CON INFO DE LICENCIA
    res.json({
      success: true,
      message: plan === 'trial' 
        ? `¡Registro exitoso! Tienes ${diasTrial} días de trial gratis.`
        : `¡Registro exitoso! Tienes ${diasTrial} días de trial. Procede al pago para activar tu licencia completa.`,
      empresaId: empresaId,
      plan: plan,
      activo: activo,
      diasTrial: diasTrial,
      expiraTrial: fechaExpiracionTrial,
      limiteEmpresas: limiteEmpresas
    });

  } catch (error) {
    console.error('❌ Error en registro:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});


// Endpoint para verificar licencia (usado por frontend en login)
app.get('/api/verificar-licencia/:empresaId', async (req, res) => {
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
    
    // VERIFICAR LÓGICA DE LICENCIA:
    let puedeAcceder = false;
    let motivo = '';
    let datosLicencia = {};

    // 1. Si tiene licencia activa (pagó)
    if (usuario.activo && usuario.fechaExpiracionLicencia > ahora) {
      puedeAcceder = true;
      motivo = 'Licencia activa (pago)';
      datosLicencia = {
        tipo: 'pago',
        plan: usuario.plan,
        expira: usuario.fechaExpiracionLicencia,
        limiteEmpresas: usuario.limiteEmpresas
      };
    }
    // 2. Si está en trial vigente
    else if (usuario.licenciaTrial && usuario.fechaExpiracionTrial > ahora) {
      puedeAcceder = true;
      motivo = 'Trial vigente';
      datosLicencia = {
        tipo: 'trial',
        plan: usuario.plan,
        expira: usuario.fechaExpiracionTrial,
        diasRestantes: Math.ceil((usuario.fechaExpiracionTrial - ahora) / (1000 * 60 * 60 * 24)),
        limiteEmpresas: usuario.limiteEmpresas
      };
    }
    // 3. Si el trial expiró
    else if (usuario.licenciaTrial && usuario.fechaExpiracionTrial <= ahora) {
      puedeAcceder = false;
      motivo = 'Trial expirado';
      datosLicencia = {
        tipo: 'trial_expirado',
        plan: usuario.plan,
        expiroEl: usuario.fechaExpiracionTrial
      };
    }
    // 4. Si no tiene licencia activa (starter/premium sin pagar)
    else {
      puedeAcceder = false;
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

// Endpoint para activar licencias manualmente
app.patch('/api/usuarios/:email/activar', async (req, res) => {
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

// Endpoint para ver registros pendientes
app.get('/api/registros-pendientes', async (req, res) => {
  try {
    const registrosPendientes = await Usuario.find(
      { activo: false }, 
      { password: 0 } // Excluir contraseñas
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

// Endpoint para obtener todos los usuarios (solo para admin)
app.get('/api/usuarios', async (req, res) => {
  try {
    const usuarios = await Usuario.find({}, { password: 0 }).sort({ fechaRegistro: -1 });

    res.json({
      success: true,
      count: usuarios.length,
      usuarios: usuarios
    });

  } catch (error) {
    console.error('❌ Error obteniendo usuarios:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta de prueba
app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 Backend de Monitoreo de Impresoras funcionando',
    version: '1.0.0',
    database: 'monitoreo_impresoras',
    endpoints: {
      empresas: '/api/empresas',
      impresoras: '/api/empresas/:empresaId/impresoras',
      metrics: '/api/metrics/impresoras',
      cortes: '/api/impresoras/:id/registrar-corte',
      pdf: '/api/impresoras/:id/generar-pdf',
      login: '/login',
      registro: '/api/registro',
      activarLicencia: '/api/usuarios/:email/activar',
      registrosPendientes: '/api/registros-pendientes',
      usuarios: '/api/usuarios'
    }
  });
});

// Manejo de errores 404
app.use((req, res) => {
  res.status(404).json({ 
    ok: false, 
    error: 'Endpoint no encontrado',
    path: req.path
  });
});

// Manejo de errores global
app.use((error, req, res, next) => {
  console.error('❌ Error global:', error);
  res.status(500).json({ 
    ok: false, 
    error: 'Error interno del servidor' 
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor de Monitoreo corriendo en puerto ${PORT}`);
  console.log(`📊 Base de datos: monitoreo_impresoras`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`🔗 MongoDB: Cluster0`);
});