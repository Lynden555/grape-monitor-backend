const mongoose = require('mongoose');

const folioContadorSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 }
}, { versionKey: false });

module.exports = mongoose.model('FolioContador', folioContadorSchema);