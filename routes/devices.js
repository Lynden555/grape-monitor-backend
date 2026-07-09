const express = require('express');
const router = express.Router();
const DeviceToken = require('../models/DeviceToken');
const authMiddleware = require('../middleware/authMiddleware');

// 📱 POST /api/device-token - Registrar/actualizar token FCM del dispositivo
router.post('/device-token', authMiddleware, async (req, res) => {
  try {
    const { token, platform, deviceName = null, appVersion = null } = req.body;
    const { email, empresaId, ciudad } = req.user;

    if (!token) {
      return res.status(400).json({ ok: false, error: 'Falta token FCM' });
    }
    if (!platform || !['ios', 'android'].includes(platform)) {
      return res.status(400).json({ ok: false, error: 'Platform debe ser ios o android' });
    }

    // Upsert: si el token ya existe, actualiza; si no, crea
    const device = await DeviceToken.findOneAndUpdate(
      { token },
      {
        $set: {
          email,
          empresaId,
          ciudad,
          platform,
          deviceName,
          appVersion,
          activo: true,
          ultimoUso: new Date()
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { new: true, upsert: true }
    );

    res.json({
      ok: true,
      mensaje: 'Token registrado correctamente',
      deviceId: device._id
    });
  } catch (err) {
    console.error('❌ POST /api/device-token:', err);
    res.status(500).json({ ok: false, error: 'Error registrando token' });
  }
});

// 🚪 DELETE /api/device-token - Desactivar token (al logout)
router.delete('/device-token', authMiddleware, async (req, res) => {
  try {
    const { token } = req.body;
    const { email } = req.user;

    if (!token) {
      return res.status(400).json({ ok: false, error: 'Falta token FCM' });
    }

    // Solo puede borrar su propio token
    const result = await DeviceToken.findOneAndUpdate(
      { token, email },
      { $set: { activo: false } },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({ ok: false, error: 'Token no encontrado' });
    }

    res.json({ ok: true, mensaje: 'Token desactivado' });
  } catch (err) {
    console.error('❌ DELETE /api/device-token:', err);
    res.status(500).json({ ok: false, error: 'Error desactivando token' });
  }
});

module.exports = router;