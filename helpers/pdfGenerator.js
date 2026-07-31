const PDFDocument = require('pdfkit');

// MARK: Marca
const VIOLETA = '#8b5cf6';
const VIOLETA_OSCURO = '#6d28d9';
const VIOLETA_CLARO = '#ddd6fe';
const TINTA = '#1e293b';
const TINTA_SUAVE = '#64748b';

// MARK: Formato
function fmtFecha(fecha, timezone) {
  if (!fecha) return null;
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone,
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(new Date(fecha));
}

function fmtFechaHora(fecha, timezone) {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(fecha));
}

function fmtNum(valor) {
  return (valor || 0).toLocaleString('es-MX');
}

/**
 * Genera un PDF profesional con los datos de un corte
 * @param {Object} corte - Datos del corte (con período calculado)
 * @param {Object} impresora - Documento Impresora (con empresaId populado)
 * @returns {Promise<Buffer>} Buffer del PDF generado
 */
async function generarPDFProfesional(corte, impresora) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 20,
        size: 'A4'
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        resolve(pdfBuffer);
      });

      const pageHeight = doc.page.height;
      const bottomMargin = 20;
      const timezone = impresora.empresaId?.timezone || 'America/Tijuana';
      const anchoDer = doc.page.width - 320;

      // MARK: Encabezado
      doc.rect(0, 0, doc.page.width, 92).fillColor(VIOLETA).fill();
      doc.rect(0, 92, doc.page.width, 4).fillColor(VIOLETA_OSCURO).fill();

      doc.fillColor(VIOLETA_CLARO)
         .fontSize(8)
         .font('Helvetica-Bold')
         .text('GRAPELABS', 20, 22, { characterSpacing: 2 });

      doc.fillColor('white')
         .fontSize(21)
         .font('Helvetica-Bold')
         .text('Reporte de Consumo', 20, 36);

      doc.fillColor(VIOLETA_CLARO)
         .fontSize(8.5)
         .font('Helvetica')
         .text('Grape Monitor · Monitoreo de impresoras', 20, 66);

      doc.fillColor('white')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text(impresora.empresaId?.nombre || 'Cliente', 300, 28, { width: anchoDer, align: 'right', lineBreak: false, ellipsis: true });

      doc.fillColor(VIOLETA_CLARO)
         .fontSize(9)
         .font('Helvetica-Bold')
         .text(corte.folio || '', 300, 46, { width: anchoDer, align: 'right' });

      doc.fontSize(8)
         .font('Helvetica')
         .text(fmtFecha(new Date(), timezone), 300, 62, { width: anchoDer, align: 'right' });

      // ========== INFORMACIÓN GENERAL ==========
      let yPosition = 116;

      doc.rect(20, yPosition, doc.page.width - 40, 80)
         .fillColor('#f8fafc')
         .fill()
         .strokeColor('#e2e8f0')
         .stroke();

      const col1 = 30;
      const col2 = doc.page.width / 2;

      doc.fillColor('#1e293b')
         .fontSize(10)
         .font('Helvetica-Bold')
         .text('INFORMACIÓN GENERAL', col1, yPosition + 15);

      doc.font('Helvetica')
         .fillColor('#475569')
         .fontSize(9);

      doc.text(`Empresa: ${impresora.empresaId?.nombre || 'N/A'}`, col1, yPosition + 35);
      doc.text(`Impresora: ${impresora.printerName || impresora.sysName || impresora.host}`, col1, yPosition + 50);
      doc.text(`Modelo: ${impresora.model || impresora.sysDescr || 'N/A'}`, col1, yPosition + 65);

      doc.text(`Número de Serie: ${impresora.serial || 'No disponible'}`, col2, yPosition + 35);
      doc.text(`Ubicación: ${impresora.ciudad || 'N/A'}`, col2, yPosition + 50);
      doc.text(`Período: ${corte.periodo || 'No especificado'}`, col2, yPosition + 65);

      // ========== ESTADÍSTICAS PRINCIPALES ==========
      // MARK: Contadores
      yPosition += 100;

      const esColor = corte.modoConteo === 'color';
      const inicioTotal = esColor
        ? (corte.contadorInicioMono || 0) + (corte.contadorInicioColor || 0)
        : (corte.contadorInicioGeneral || 0);
      const finTotal = esColor
        ? (corte.contadorFinMono || 0) + (corte.contadorFinColor || 0)
        : (corte.contadorFinGeneral || 0);
      const consumoTotal = esColor
        ? (corte.totalPaginasMono || 0) + (corte.totalPaginasColor || 0)
        : (corte.totalPaginasGeneral || 0);

      const fechaIni = fmtFecha(corte.fechaInicioPeriodo, timezone);
      const fechaFin = fmtFecha(corte.fechaFinPeriodo, timezone);
      const dias = corte.fechaInicioPeriodo && corte.fechaFinPeriodo
        ? Math.max(0, Math.round((new Date(corte.fechaFinPeriodo) - new Date(corte.fechaInicioPeriodo)) / 86400000))
        : null;
      const pieConsumo = corte.esBaseline ? 'Registro inicial' : (dias != null ? `${dias} dias` : null);

      const statWidth = (doc.page.width - 60) / 3;
      const statHeight = 100;

      const stats = [
        { label: 'INICIO PERÍODO', value: fmtNum(inicioTotal), pie: fechaIni, bg: '#f5f3ff', stroke: '#ddd6fe', color: '#5b21b6', fontSize: 18 },
        { label: 'FIN PERÍODO', value: fmtNum(finTotal), pie: fechaFin, bg: '#f0fdf4', stroke: '#bbf7d0', color: '#15803d', fontSize: 18 },
        { label: 'CONSUMO TOTAL', value: fmtNum(consumoTotal), pie: pieConsumo, bg: '#fef7ed', stroke: '#fed7aa', color: '#c2410c', fontSize: 22 }
      ];

      stats.forEach((stat, i) => {
        const x = 20 + i * (statWidth + 10);
        doc.rect(x, yPosition, statWidth, statHeight)
           .fillColor(stat.bg)
           .fill()
           .strokeColor(stat.stroke)
           .stroke();

        doc.fillColor(TINTA_SUAVE)
           .fontSize(9)
           .font('Helvetica-Bold')
           .text(stat.label, x, yPosition + 14, { width: statWidth, align: 'center', characterSpacing: 0.5 });

        doc.fillColor(stat.color)
           .fontSize(stat.fontSize)
           .font('Helvetica-Bold')
           .text(stat.value, x, yPosition + 32, { width: statWidth, align: 'center' });

        doc.fillColor(TINTA_SUAVE)
           .fontSize(7.5)
           .font('Helvetica')
           .text('PÁGINAS', x, yPosition + 58, { width: statWidth, align: 'center' });

        if (stat.pie) {
          doc.moveTo(x + 18, yPosition + 74)
             .lineTo(x + statWidth - 18, yPosition + 74)
             .strokeColor(stat.stroke)
             .lineWidth(1)
             .stroke();

          doc.fillColor(TINTA)
             .fontSize(8)
             .font('Helvetica-Bold')
             .text(stat.pie, x, yPosition + 81, { width: statWidth, align: 'center' });
        }
      });

      // MARK: Desglose por tipo
      yPosition += statHeight;

      const tieneMono = corte.totalPaginasMono != null;
      const tieneColor = corte.totalPaginasColor != null;

      if (tieneMono || tieneColor) {
        const anchoBloque = doc.page.width - 40;
        const mono = corte.totalPaginasMono || 0;
        const color = corte.totalPaginasColor || 0;
        const suma = mono + color;

        const filas = [];
        if (tieneMono) filas.push({ etiqueta: 'Blanco y Negro', valor: mono, swatch: '#334155' });
        if (tieneColor) filas.push({ etiqueta: 'Color', valor: color, swatch: VIOLETA });

        const conBarra = tieneMono && tieneColor && suma > 0;
        const altoCaja = 32 + filas.length * 22 + (conBarra ? 24 : 0) + 30;

        yPosition += 20;
        doc.fillColor(TINTA)
           .fontSize(12)
           .font('Helvetica-Bold')
           .text('IMPRESIONES DEL PERÍODO', 20, yPosition);

        if (fechaIni && fechaFin) {
          doc.fillColor(TINTA_SUAVE)
             .fontSize(9)
             .font('Helvetica')
             .text(corte.esBaseline ? 'Registro inicial' : `${fechaIni} - ${fechaFin}`, 20, yPosition + 1, { width: doc.page.width - 40, align: 'right' });
        }

        const yCaja = yPosition + 20;
        doc.rect(20, yCaja, anchoBloque, altoCaja)
           .fillColor('#ffffff')
           .fill()
           .strokeColor('#e2e8f0')
           .lineWidth(1)
           .stroke();

        filas.forEach((fila, i) => {
          const yFila = yCaja + 16 + i * 22;

          doc.rect(34, yFila + 1, 9, 9).fillColor(fila.swatch).fill();

          doc.fillColor(TINTA)
             .fontSize(10)
             .font('Helvetica')
             .text(fila.etiqueta, 50, yFila);

          if (suma > 0) {
            doc.fillColor(TINTA_SUAVE)
               .fontSize(8)
               .font('Helvetica')
               .text(`${Math.round((fila.valor / suma) * 100)}%`, 20, yFila + 1, { width: anchoBloque - 90, align: 'right' });
          }

          doc.fillColor(TINTA)
             .fontSize(10)
             .font('Helvetica-Bold')
             .text(fmtNum(fila.valor), 20, yFila, { width: anchoBloque - 14, align: 'right' });
        });

        let yCursor = yCaja + 16 + filas.length * 22;

        if (conBarra) {
          const anchoBarra = anchoBloque - 28;
          const anchoMono = (mono / suma) * anchoBarra;

          doc.rect(34, yCursor + 4, anchoMono, 7).fillColor('#334155').fill();
          doc.rect(34 + anchoMono, yCursor + 4, anchoBarra - anchoMono, 7).fillColor(VIOLETA).fill();

          yCursor += 24;
        }

        doc.moveTo(34, yCursor + 6)
           .lineTo(doc.page.width - 34, yCursor + 6)
           .strokeColor('#cbd5e1')
           .lineWidth(1)
           .stroke();

        doc.fillColor(TINTA)
           .fontSize(10)
           .font('Helvetica-Bold')
           .text('TOTAL IMPRESIONES', 34, yCursor + 15, { characterSpacing: 0.5 });

        doc.fillColor(VIOLETA_OSCURO)
           .fontSize(13)
           .font('Helvetica-Bold')
           .text(fmtNum(suma), 20, yCursor + 12, { width: anchoBloque - 14, align: 'right' });

        yPosition = yCaja + altoCaja;
      }

      // ========== ESTADO DE SUMINISTROS ==========
      yPosition += 20;
      doc.fillColor(TINTA)
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('ESTADO DE SUMINISTROS', 20, yPosition);

      const supplies = corte.suppliesFin || [];

      if (supplies.length > 0) {
        const supplyWidth = (doc.page.width - 60) / Math.min(supplies.length, 4);
        let supplyX = 20;

        supplies.forEach((supply, index) => {
          if (index >= 4) return;
          const level = supply.level || 0;
          const max = supply.max || 100;
          const percentage = max > 0 ? (level / max) * 100 : level;

          let color = '#22c55e';
          if (percentage <= 20) color = '#ef4444';
          else if (percentage <= 50) color = '#f59e0b';

          doc.rect(supplyX, yPosition + 25, supplyWidth - 10, 60)
             .fillColor('#f8fafc')
             .fill()
             .strokeColor('#e2e8f0')
             .stroke();

          doc.fillColor('#475569')
             .fontSize(8)
             .font('Helvetica-Bold')
             .text((supply.name || `Supply ${index + 1}`).toUpperCase(), supplyX + 5, yPosition + 35, { width: supplyWidth - 20, align: 'center' });

          const barWidth = supplyWidth - 30;
          const barHeight = 8;
          const barX = supplyX + 5;
          const barY = yPosition + 50;

          doc.rect(barX, barY, barWidth, barHeight)
             .fillColor('#e2e8f0')
             .fill();

          doc.rect(barX, barY, (percentage / 100) * barWidth, barHeight)
             .fillColor(color)
             .fill();

          doc.fillColor('#1e293b')
             .fontSize(7)
             .font('Helvetica-Bold')
             .text(`${Math.round(percentage)}%`, barX, barY + 12, { width: barWidth, align: 'center' });

          doc.fillColor('#64748b')
             .fontSize(7)
             .font('Helvetica')
             .text(`${level}${max > 0 ? `/${max}` : ''}`, barX, barY + 25, { width: barWidth, align: 'center' });

          supplyX += supplyWidth;
        });
      } else {
        doc.fillColor('#94a3b8')
           .fontSize(10)
           .font('Helvetica')
           .text('No hay datos de suministros disponibles', 20, yPosition + 40);
      }

      // ========== DETALLES ADICIONALES ==========
      yPosition += 100;
      doc.rect(20, yPosition, doc.page.width - 40, 60)
         .fillColor('#f8fafc')
         .fill()
         .strokeColor('#e2e8f0')
         .stroke();

      doc.fillColor('#1e293b')
         .fontSize(10)
         .font('Helvetica-Bold')
         .text('INFORMACIÓN ADICIONAL', 30, yPosition + 15);

      doc.fillColor('#475569')
         .fontSize(8)
         .font('Helvetica')
         .text(`Fecha de generación: ${fmtFechaHora(new Date(), timezone)}`, 30, yPosition + 35);
      doc.text(`Folio: ${corte.folio || corte._id || 'N/A'}`, 30, yPosition + 50);

      // ========== PIE DE PÁGINA ==========
      doc.rect(0, pageHeight - 40 - bottomMargin, doc.page.width, 40)
         .fillColor('#1e293b')
         .fill();

      doc.fillColor('white')
         .fontSize(7)
         .font('Helvetica')
         .text('Sistema de Monitoreo de Impresoras • Reporte generado automáticamente', 20, pageHeight - 25 - bottomMargin, { align: 'left' });
      doc.text(corte.folio || '', 0, pageHeight - 25 - bottomMargin, { width: doc.page.width - 20, align: 'right' });

      doc.end();

    } catch (error) {
      console.error('Error detallado en generación PDF:', error);
      reject(error);
    }
  });
}

module.exports = { generarPDFProfesional };
