// scripts/migrarPaises.js
// Asigna pais='MX' a todos los usuarios existentes que no tengan el campo.
// Uso: node scripts/migrarPaises.js

require('dotenv').config();
const mongoose = require('mongoose');
const Usuario = require('../models/Usuario');

const MONGO_URI = process.env.MONGODB_URI;

async function migrar() {
  if (!MONGO_URI) {
    console.error('❌ Falta MONGODB_URI en .env');
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado a MongoDB');

    // Buscar usuarios sin campo `pais` o con pais nulo/vacío
    const sinPais = await Usuario.find({
      $or: [
        { pais: { $exists: false } },
        { pais: null },
        { pais: '' }
      ]
    });

    console.log(`📊 Usuarios sin país: ${sinPais.length}`);

    if (sinPais.length === 0) {
      console.log('✨ No hay nada que migrar. Todos los usuarios ya tienen país asignado.');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Mostrar lista antes de migrar
    console.log('\n📋 Usuarios que se actualizarán:');
    sinPais.forEach(u => {
      console.log(`  - ${u.email} (ciudad: ${u.ciudad}, empresaId: ${u.empresaId})`);
    });

    // Hacer la actualización masiva
    const result = await Usuario.updateMany(
      {
        $or: [
          { pais: { $exists: false } },
          { pais: null },
          { pais: '' }
        ]
      },
      { $set: { pais: 'MX' } }
    );

    console.log(`\n✅ Migración completada:`);
    console.log(`   Matched: ${result.matchedCount}`);
    console.log(`   Modified: ${result.modifiedCount}`);

    await mongoose.disconnect();
    console.log('👋 Desconectado de MongoDB');
    process.exit(0);

  } catch (err) {
    console.error('❌ Error en migración:', err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

migrar();