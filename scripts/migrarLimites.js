/**
 * MIGRACIÓN ONE-SHOT
 * Ejecuta: node scripts/migrarLimites.js
 * 
 * Hace:
 * 1. Pone limiteImpresoras:9999 y plan:'custom' en diegollera1@gmail.com
 * 2. Migra usuarios viejos: si tienen limiteEmpresas pero no limiteImpresoras, les asigna el límite por plan
 * 3. Asegura que todas las Impresoras existentes tengan monitoreoActivo:true (default)
 * 4. Asegura que todas las Empresas tengan userId si se puede inferir
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Usuario = require('../models/Usuario');
const Empresa = require('../models/Empresa');
const Impresora = require('../models/Impresora');
const { obtenerLimitePorPlan } = require('../helpers/limitesPlan');

async function migrar() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Conectado a MongoDB');

  // 1. Cuenta del owner (Diego) con plan custom y 9999 impresoras
  const diego = await Usuario.findOneAndUpdate(
    { email: 'diegollera1@gmail.com' },
    {
      $set: {
        plan: 'custom',
        limiteImpresoras: 9999,
        activo: true,
        licenciaTrial: false
      }
    },
    { new: true }
  );
  if (diego) {
    console.log(`✅ Cuenta Diego actualizada: plan=${diego.plan}, limite=${diego.limiteImpresoras}`);
  } else {
    console.log('⚠️ Cuenta diegollera1@gmail.com no encontrada');
  }

  // 2. Para todos los demás usuarios sin limiteImpresoras definido, asignar el del plan
  const usuariosSinLimite = await Usuario.find({
    $or: [
      { limiteImpresoras: { $exists: false } },
      { limiteImpresoras: null }
    ]
  });
  for (const u of usuariosSinLimite) {
    if (u.email === 'diegollera1@gmail.com') continue;
    u.limiteImpresoras = obtenerLimitePorPlan(u.plan);
    await u.save();
    console.log(`✅ ${u.email}: limiteImpresoras=${u.limiteImpresoras} (plan=${u.plan})`);
  }

  // 3. Asegurar monitoreoActivo:true en impresoras existentes
  const resImpresoras = await Impresora.updateMany(
    { monitoreoActivo: { $exists: false } },
    { $set: { monitoreoActivo: true } }
  );
  console.log(`✅ ${resImpresoras.modifiedCount} impresoras existentes marcadas con monitoreoActivo:true`);

  // 4. Intentar conectar Empresas con Usuarios por el campo String empresaId
  const empresasSinUserId = await Empresa.find({
    $or: [
      { userId: { $exists: false } },
      { userId: null }
    ]
  });
  let conectadas = 0;
  for (const emp of empresasSinUserId) {
    // Buscar usuario que tenga este empresaId (el String)
    const user = await Usuario.findOne({ empresaId: emp.empresaId });
    if (user) {
      emp.userId = user._id;
      await emp.save();
      conectadas++;
    }
  }
  console.log(`✅ ${conectadas} empresas conectadas a su Usuario por empresaId String`);
  
  const huerfanas = empresasSinUserId.length - conectadas;
  if (huerfanas > 0) {
    console.log(`⚠️ ${huerfanas} empresas no se pudieron conectar a un Usuario. Revisar manualmente.`);
  }

  await mongoose.disconnect();
  console.log('✅ Migración terminada');
}

migrar().catch(err => {
  console.error('❌ Error en migración:', err);
  process.exit(1);
});