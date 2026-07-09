const mongoose = require('mongoose');

const deviceTokenSchema = new mongoose.Schema({
  // A quién pertenece el device
  email: { type: String, required: true, index: true },
  empresaId: { type: String, required: true, index: true },
  ciudad: { type: String, required: true, index: true },

  // Token FCM del dispositivo
  token: { type: String, required: true, unique: true },

  // Metadata del dispositivo
  platform: { type: String, enum: ['ios', 'android'], required: true },
  deviceName: { type: String, default: null },
  appVersion: { type: String, default: null },

  // Estado
  activo: { type: Boolean, default: true, index: true },
  ultimoUso: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
}, { strict: true });

// Índice compuesto para búsquedas rápidas por usuario
deviceTokenSchema.index({ email: 1, ciudad: 1, activo: 1 });

module.exports = mongoose.model('DeviceToken', deviceTokenSchema);