const mongoose = require('mongoose');

const impresoraSchema = new mongoose.Schema({
  empresaId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Empresa', 
    index: true, 
    required: true 
  },
  ciudad: { type: String, default: null, index: true },
  host: { type: String, required: true },
  serial: { type: String, default: null },
  sysName: { type: String, default: null },
  sysDescr: { type: String, default: null },
  model: { type: String, default: null },
  printerName: { type: String, default: null },
  customName: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
}, { strict: true });

impresoraSchema.index({ empresaId: 1, serial: 1 }, { unique: true, sparse: true });
impresoraSchema.index({ empresaId: 1, host: 1 }, { unique: true });

module.exports = mongoose.model('Impresora', impresoraSchema);