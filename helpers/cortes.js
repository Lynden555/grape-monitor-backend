/**
 * Calcula el período de corte basado en el último corte y los contadores actuales
 * @param {Object|null} ultimoCorte - Documento CortesMensuales del corte anterior
 * @param {Object} contadoresActuales - Documento ImpresoraLatest
 * @returns {Object} { contadorInicioGeneral, contadorFinGeneral, totalPaginasGeneral, periodo, esPrimerCorte }
 */
function calcularPeriodoCorte(ultimoCorte, contadoresActuales) {
  const contadorActual = contadoresActuales.lastPageCount || 0;

  if (!ultimoCorte) {
    return {
      contadorInicioGeneral: 0,
      contadorFinGeneral: contadorActual,
      totalPaginasGeneral: contadorActual,
      periodo: 'Desde instalación',
      esPrimerCorte: true
    };
  }

  const contadorInicioGeneral = ultimoCorte.contadorFinGeneral || 0;
  const totalPaginasGeneral = Math.max(0, contadorActual - contadorInicioGeneral);
  const fechaInicio = new Date(ultimoCorte.fechaCorte);
  const fechaFin = new Date();
  const periodo = `${fechaInicio.toLocaleDateString()} - ${fechaFin.toLocaleDateString()}`;

  return {
    contadorInicioGeneral,
    contadorFinGeneral: contadorActual,
    totalPaginasGeneral,
    periodo,
    esPrimerCorte: false
  };
}

module.exports = { calcularPeriodoCorte };
