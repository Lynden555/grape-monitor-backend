const jwt = require('jsonwebtoken');

/**
 * Middleware de autenticación JWT.
 * Valida el header Authorization: Bearer <token>
 * y adjunta req.user con { email, empresaId, ciudad }
 *
 * Uso: router.get('/ruta', authMiddleware, handler)
 */
function authMiddleware(req, res, next) {
  try {
    const auth = req.headers['authorization'] || '';

    if (!auth.startsWith('Bearer ')) {
      return res.status(401).json({
        ok: false,
        error: 'Token no proporcionado',
        codigo: 'TOKEN_FALTANTE'
      });
    }

    const token = auth.slice(7); // Remover "Bearer "

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: 'Token vacío',
        codigo: 'TOKEN_VACIO'
      });
    }

    // Verificar y decodificar el token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Adjuntar datos del usuario a la request
    req.user = {
      email: decoded.email,
      empresaId: decoded.empresaId,
      ciudad: decoded.ciudad
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        ok: false,
        error: 'Token expirado, inicia sesión de nuevo',
        codigo: 'TOKEN_EXPIRADO'
      });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        ok: false,
        error: 'Token inválido',
        codigo: 'TOKEN_INVALIDO'
      });
    }
    console.error('❌ Error en authMiddleware:', err);
    return res.status(500).json({
      ok: false,
      error: 'Error validando autenticación'
    });
  }
}

module.exports = authMiddleware;