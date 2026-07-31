const MODO_GENERAL = 'general';
const MODO_MONO = 'mono';
const MODO_COLOR = 'color';

// MARK: Deteccion de capacidades
function detectarModo(contadores) {
  const tieneMono = contadores.lastPageMono != null;
  const tieneColor = contadores.lastPageColor != null;

  if (tieneMono && tieneColor) return MODO_COLOR;
  if (tieneMono) return MODO_MONO;
  return MODO_GENERAL;
}

// MARK: Formato
function formatearFecha(fecha, timezone) {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone,
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(fecha);
}

// MARK: Calculo de corte
function calcularPeriodoCorte(ultimoCorte, contadoresActuales, timezone = 'America/Tijuana') {
  const ahora = new Date();
  const modoDetectado = detectarModo(contadoresActuales);

  const finGeneral = contadoresActuales.lastPageCount || 0;
  const finMono = contadoresActuales.lastPageMono;
  const finColor = contadoresActuales.lastPageColor;

  if (!ultimoCorte) {
    return {
      esBaseline: true,
      esPrimerCorte: true,
      modoConteo: modoDetectado,
      fechaInicioPeriodo: ahora,
      fechaFinPeriodo: ahora,
      periodo: 'Registro inicial',
      contadorInicioGeneral: finGeneral,
      contadorFinGeneral: finGeneral,
      totalPaginasGeneral: 0,
      contadorInicioMono: finMono,
      contadorFinMono: finMono,
      totalPaginasMono: finMono != null ? 0 : null,
      contadorInicioColor: finColor,
      contadorFinColor: finColor,
      totalPaginasColor: finColor != null ? 0 : null
    };
  }

  const inicioGeneral = ultimoCorte.contadorFinGeneral || 0;
  const inicioMono = ultimoCorte.contadorFinMono;
  const inicioColor = ultimoCorte.contadorFinColor;

  const desglosaMono = inicioMono != null && finMono != null;
  const desglosaColor = inicioColor != null && finColor != null;

  let modoConteo = modoDetectado;
  if (modoDetectado === MODO_COLOR && !(desglosaMono && desglosaColor)) modoConteo = MODO_GENERAL;
  if (modoDetectado === MODO_MONO && !desglosaMono) modoConteo = MODO_GENERAL;

  const fechaInicio = new Date(ultimoCorte.fechaFinPeriodo || ultimoCorte.fechaCorte);

  return {
    esBaseline: false,
    esPrimerCorte: false,
    modoConteo,
    fechaInicioPeriodo: fechaInicio,
    fechaFinPeriodo: ahora,
    periodo: `${formatearFecha(fechaInicio, timezone)} - ${formatearFecha(ahora, timezone)}`,
    contadorInicioGeneral: inicioGeneral,
    contadorFinGeneral: finGeneral,
    totalPaginasGeneral: Math.max(0, finGeneral - inicioGeneral),
    contadorInicioMono: desglosaMono ? inicioMono : null,
    contadorFinMono: desglosaMono ? finMono : null,
    totalPaginasMono: desglosaMono ? Math.max(0, finMono - inicioMono) : null,
    contadorInicioColor: desglosaColor ? inicioColor : null,
    contadorFinColor: desglosaColor ? finColor : null,
    totalPaginasColor: desglosaColor ? Math.max(0, finColor - inicioColor) : null
  };
}

module.exports = { calcularPeriodoCorte };