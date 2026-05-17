const cron = require('node-cron');
const Usuario = require('../models/Usuario');

/**
 * Cron que corre cada día a las 00:05 (madrugada).
 * Busca usuarios con plan='trial' cuya fechaExpiracionTrial ya pasó
 * y los marca como plan='trial_expirado'.
 */
function iniciarCronTrialExpirado() {
  cron.schedule('5 0 * * *', async () => {
    try {
      const ahora = new Date();
      const resultado = await Usuario.updateMany(
        {
          plan: 'trial',
          fechaExpiracionTrial: { $lte: ahora }
        },
        {
          $set: { plan: 'trial_expirado', licenciaTrial: false }
        }
      );
      console.log(`🕒 [Cron Trial] ${resultado.modifiedCount} usuarios marcados como trial_expirado`);
    } catch (err) {
      console.error('❌ [Cron Trial] Error:', err);
    }
  }, {
    timezone: 'America/Tijuana' // 🇲🇽 Baja California
  });

  console.log('✅ Cron de trial_expirado programado (diario 00:05 hora Tijuana)');
}

module.exports = { iniciarCronTrialExpirado };