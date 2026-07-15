const mongoose = require('mongoose');

const alertaSchema = new mongoose.Schema({
  // Referencias
  printerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Impresora',
    required: true,
    index: true
  },
  empresaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Empresa',
    required: true,
    index: true
  },
  ciudad: { type: String, default: null, index: true },

  // Tipo de alerta (genérico para futuro: TONER_BAJO, IMPRESORA_OFFLINE, etc.)
  tipoAlerta: {
    type: String,
    enum: ['TONER_BAJO', 'IMPRESORA_OFFLINE', 'PAPEL_ATASCADO'],
    default: 'TONER_BAJO',
    index: true
  },

  // Datos específicos del disparo
  supplyName: { type: String, default: null },   // ej: "cyan ink 3JA00A"
  nivel: { type: Number, default: null },        // % al momento del disparo
  nivelEscalado: {                                // cuál de los 3 niveles
    type: String,
    enum: ['umbral', 'mitad', 'critico'],
    default: null
  },

  // Ciclo del cartucho (se resetea al cambiar cartucho)
  cicloId: { type: String, default: null },

  // A quién se le envió
  destinatariosEnviados: [{
    email: String,
    deviceToken: String,
    platform: String,
    messageId: String,          // ID del envío en Firebase
    estado: {
      type: String,
      enum: ['sent', 'failed'],
      default: 'sent'
    },
    error: { type: String, default: null }
  }],

  leidaPor: {
    type: [String],
    default: []
  },

  enviadoEn: { type: Date, default: Date.now, index: true }
}, { strict: true });

// Índice compuesto para historial rápido
alertaSchema.index({ empresaId: 1, enviadoEn: -1 });
alertaSchema.index({ printerId: 1, enviadoEn: -1 });

module.exports = mongoose.model('Alerta', alertaSchema);