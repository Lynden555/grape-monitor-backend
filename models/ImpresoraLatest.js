const mongoose = require('mongoose');

const impresoraLatestSchema = new mongoose.Schema({
  printerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Impresora', 
    unique: true 
  },
  ultimoCorteId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'CortesMensuales', 
    default: null 
  },
  lastCutDate: { type: Date, default: null },
  lastPageCount: { type: Number, default: null },
  lastPageMono: { type: Number, default: null },
  lastPageColor: { type: Number, default: null },
  lastSupplies: [{
    name: String,
    level: Number,
    max: Number
  }],
  // 🆕 Tracking de suministros para detectar cruces de umbral y resets de cartucho
  suppliesTracking: [{
    name: String,
    ultimoNivel: Number,
    cicloActual: { type: Number, default: 1 },
    ultimoUmbralDisparado: {
      type: String,
      enum: ['umbral', 'mitad', 'critico', null],
      default: null
    },
    updatedAt: { type: Date, default: Date.now }
  }],
  lastSeenAt: { type: Date, default: null },
  lowToner: { type: Boolean, default: false },
  online: { type: Boolean, default: true }
}, { strict: true });

module.exports = mongoose.model('ImpresoraLatest', impresoraLatestSchema);