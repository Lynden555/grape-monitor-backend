const mongoose = require('mongoose');

const alertaConfigSchema = new mongoose.Schema({
  // Impresora a la que aplica (una config por impresora)
  printerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Impresora',
    required: true,
    unique: true,
    index: true
  },

  // Referencia rápida para queries por empresa
  empresaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Empresa',
    required: true,
    index: true
  },
  ciudad: { type: String, default: null, index: true },

  // Switch principal (el checkbox de la app)
  activa: { type: Boolean, default: false },

  // Umbral que configura el usuario (1-100)
  // Sistema escalona internamente: umbral → mitad → 5
  umbralPorcentaje: {
    type: Number,
    min: 1,
    max: 100,
    default: 30
  },

  // Tipos de suministro a monitorear (por defecto tóner e ink)
  // Se puede extender en el futuro: 'drum', 'transfer', etc.
  tiposSuministro: {
    type: [String],
    default: ['toner', 'ink']
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { strict: true });

module.exports = mongoose.model('AlertaConfig', alertaConfigSchema);