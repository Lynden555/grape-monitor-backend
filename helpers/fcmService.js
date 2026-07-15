const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

// Inicializar Firebase Admin SDK (una sola vez)
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    })
  });
  console.log('🔥 Firebase Admin inicializado');
}

/**
 * Envía una push notification a un token FCM.
 */
async function enviarPush(token, titulo, cuerpo, data = {}, badge = 1) {
  try {
    const stringData = {};
    Object.keys(data).forEach(k => { stringData[k] = String(data[k]); });

    const messageId = await getMessaging().send({
      token,
      notification: { title: titulo, body: cuerpo },
      data: stringData,
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge
          }
        }
      },
      android: {
        notification: {
          sound: 'default',
          priority: 'high',
          channelId: 'grape_alerts'
        }
      }
    });

    return { ok: true, messageId };
  } catch (err) {
    console.error('Error enviando push:', err.code, err.message);
    return { ok: false, error: err.code || err.message };
  }
}

module.exports = { enviarPush };