const mongoose = require('mongoose');

const visitaSchema = new mongoose.Schema({
  printerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Impresora', required: true },
  empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
  empresaPadreId: { type: String, required: true, index: true },
  ciudad: { type: String, required: true },
  nota: { type: String, trim: true, default: '' },
  creadaEn: { type: Date, default: Date.now }
});

visitaSchema.index({ empresaPadreId: 1, ciudad: 1, creadaEn: 1 });
visitaSchema.index({ printerId: 1, empresaPadreId: 1 }, { unique: true });

module.exports = mongoose.model('Visita', visitaSchema);