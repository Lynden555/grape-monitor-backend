const mongoose = require('mongoose');

const empresaSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  apiKey: { type: String, required: true, unique: true },
  empresaId: { type: String, required: true },
  ciudad: { type: String, required: true },
  // 🆕 Referencia al usuario dueño (para validar límites)
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', index: true },
  createdAt: { type: Date, default: Date.now }
});

empresaSchema.index({ empresaId: 1, ciudad: 1, createdAt: -1 });

module.exports = mongoose.model('Empresa', empresaSchema);