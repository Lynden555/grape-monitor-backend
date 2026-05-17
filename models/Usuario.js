const mongoose = require('mongoose');

const usuarioSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String,
  activo: { type: Boolean, default: false },
  ciudad: String,
  empresaId: String,
  fechaRegistro: { type: Date, default: Date.now },

  // Campos de licencia
  plan: {
    type: String,
    enum: ['trial', 'trial_expirado', 'starter', 'pro', 'enterprise', 'custom'],
    default: 'trial'
  },
  licenciaTrial: { type: Boolean, default: true },
  fechaExpiracionTrial: Date,
  fechaExpiracionLicencia: Date,

  // 🆕 Sistema de límites por impresoras (no por empresas)
  limiteImpresoras: { type: Number, default: 5 },

  // Para Stripe (después)
  stripeCustomerId: String,
  stripeSubscriptionId: String,
  ultimoPago: Date
});

module.exports = mongoose.model('Usuario', usuarioSchema);