require('dotenv').config();

const express = require('express');
const path = require('path');

const connectDB = require('./config/database');
const { iniciarCronTrialExpirado } = require('./helpers/cronTrialExpirado');

// Routers
const authRoutes = require('./routes/auth');
const empresasRoutes = require('./routes/empresas');
const impresorasRoutes = require('./routes/impresoras');
const carpetasRoutes = require('./routes/carpetas');
const metricsRoutes = require('./routes/metrics');
const reportesRoutes = require('./routes/reportes');
const devicesRoutes = require('./routes/devices');
const alertasRoutes = require('./routes/alertas');

const app = express();
const PORT = 8080; // Puerto fijo para Railway

// Conectar a la base de datos
connectDB();

// ============================================================
// MIDDLEWARES GLOBALES
// ============================================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Archivos estáticos
app.use('/uploads', express.static('uploads'));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-ciudad');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ============================================================
// MONTAR ROUTERS
// ============================================================

// Auth (login, registro, licencias) — montados en la raíz para preservar /login y /api/registro
app.use('/', authRoutes);

// API
app.use('/api/empresas', empresasRoutes);   // /api/empresas, /api/empresas/:id
app.use('/api', impresorasRoutes);          // /api/empresas/:empresaId/impresoras, /api/impresoras/:id, /api/online-policy
app.use('/api', carpetasRoutes);            // /api/carpetas*, /api/asignaciones*
app.use('/api', metricsRoutes);             // /api/metrics/impresoras
app.use('/api', reportesRoutes);            // /api/impresoras/:id/registrar-corte, /api/impresoras/:id/generar-pdf
app.use('/api', devicesRoutes);              // /api/device-token
app.use('/api', alertasRoutes);              // /api/alertas/config/:printerId, /api/alertas/historial

// ============================================================
// RUTA DE PRUEBA
// ============================================================
app.get('/', (req, res) => {
  res.json({
    message: '🚀 Backend de Monitoreo de Impresoras funcionando',
    version: '2.0.0',
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

// ============================================================
// MANEJO DE ERRORES
// ============================================================

// 404
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: 'Endpoint no encontrado',
    path: req.path
  });
});

// Error global
app.use((error, req, res, next) => {
  console.error('❌ Error global:', error);
  res.status(500).json({
    ok: false,
    error: 'Error interno del servidor'
  });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 Servidor de Monitoreo corriendo en puerto ${PORT}`);
  console.log(`📊 Base de datos: monitoreo_impresoras`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`🔗 MongoDB: Cluster0`);
  
  // 🆕 Iniciar cron de trial expirado
  iniciarCronTrialExpirado();
});
