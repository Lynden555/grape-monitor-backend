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

module.exports = mongoose.model('Usuario', usuarioSchema);
