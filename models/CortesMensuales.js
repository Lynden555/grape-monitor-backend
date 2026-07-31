const mongoose = require('mongoose');

const cortesMensualesSchema = new mongoose.Schema({
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
  fechaCorte: { type: Date, default: Date.now },
  mes: { type: Number, required: true },
  año: { type: Number, required: true },
  contadorInicioGeneral: { type: Number, default: 0 },
  contadorFinGeneral: { type: Number, required: true },
  totalPaginasGeneral: { type: Number, required: true },
  // MARK: Folio
  folio: { type: String, default: null },
  esBaseline: { type: Boolean, default: false },

  // MARK: Modo de conteo
  modoConteo: {
    type: String,
    enum: ['general', 'mono', 'color'],
    default: 'general'
  },

  // MARK: Periodo
  fechaInicioPeriodo: { type: Date, default: null },
  fechaFinPeriodo: { type: Date, default: null },

  // MARK: Mono
  contadorInicioMono: { type: Number, default: null },
  contadorFinMono: { type: Number, default: null },
  totalPaginasMono: { type: Number, default: null },

  // MARK: Color
  contadorInicioColor: { type: Number, default: null },
  contadorFinColor: { type: Number, default: null },
  totalPaginasColor: { type: Number, default: null },
  suppliesInicio: [{ name: String, level: Number, max: Number }],
  suppliesFin: [{ name: String, level: Number, max: Number }],
  pdfPath: { type: String, default: null },
  nombreImpresora: { type: String, default: '' },
  modeloImpresora: { type: String, default: '' },
  periodo: { type: String, default: '' }
}, { 
  strict: true,
  timestamps: true
});

cortesMensualesSchema.index({ printerId: 1, fechaCorte: -1 });
cortesMensualesSchema.index({ empresaId: 1, mes: 1, año: 1 });
cortesMensualesSchema.index({ folio: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('CortesMensuales', cortesMensualesSchema);