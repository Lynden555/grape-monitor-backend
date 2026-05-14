const PDFDocument = require('pdfkit');

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

      // ========== ENCABEZADO ==========
      doc.rect(0, 0, doc.page.width, 100)
         .fillColor('#1e3a8a')
         .fill();

      doc.fillColor('white')
         .fontSize(24)
         .font('Helvetica-Bold')
         .text('REPORTE DE CONSUMO', 0, 35, { align: 'center' });

      doc.fontSize(12)
         .font('Helvetica')
         .text('Sistema de Gestión de Impresoras', 0, 65, { align: 'center' });

      // ========== INFORMACIÓN GENERAL ==========
      let yPosition = 120;

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
      yPosition += 100;

      const statWidth = (doc.page.width - 60) / 3;

      const stats = [
        { label: 'INICIO PERÍODO', value: corte.contadorInicioGeneral?.toLocaleString() || '0', bg: '#f0f9ff', stroke: '#bae6fd', color: '#0c4a6e', fontSize: 18 },
        { label: 'FIN PERÍODO', value: corte.contadorFinGeneral.toLocaleString(), bg: '#f0fdf4', stroke: '#bbf7d0', color: '#15803d', fontSize: 18 },
        { label: 'CONSUMO TOTAL', value: corte.totalPaginasGeneral.toLocaleString(), bg: '#fef7ed', stroke: '#fed7aa', color: '#c2410c', fontSize: 22 }
      ];

      stats.forEach((stat, i) => {
        const x = 20 + i * (statWidth + 10);
        doc.rect(x, yPosition, statWidth, 80)
           .fillColor(stat.bg)
           .fill()
           .strokeColor(stat.stroke)
           .stroke();

        doc.fillColor('#0369a1')
           .fontSize(11)
           .font('Helvetica-Bold')
           .text(stat.label, x, yPosition + 15, { width: statWidth, align: 'center' });

        doc.fillColor(stat.color)
           .fontSize(stat.fontSize)
           .font('Helvetica-Bold')
           .text(stat.value, x, yPosition + 35, { width: statWidth, align: 'center' });

        doc.fillColor('#64748b')
           .fontSize(8)
           .font('Helvetica')
           .text('PÁGINAS', x, yPosition + 60, { width: statWidth, align: 'center' });
      });

      // ========== ESTADO DE SUMINISTROS ==========
      yPosition += 100;
      doc.fillColor('#1e293b')
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
         .text(`Fecha de generación: ${new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, 30, yPosition + 35);
      doc.text(`ID del reporte: ${corte._id || 'N/A'}`, 30, yPosition + 50);

      // ========== PIE DE PÁGINA ==========
      doc.rect(0, pageHeight - 40 - bottomMargin, doc.page.width, 40)
         .fillColor('#1e293b')
         .fill();

      doc.fillColor('white')
         .fontSize(7)
         .font('Helvetica')
         .text('Sistema de Monitoreo de Impresoras • Reporte generado automáticamente', 20, pageHeight - 25 - bottomMargin, { align: 'left' });
      doc.text(`Página 1 de 1 • ${new Date().getFullYear()}`, 0, pageHeight - 25 - bottomMargin, { align: 'center' });

      doc.end();

    } catch (error) {
      console.error('Error detallado en generación PDF:', error);
      reject(error);
    }
  });
}

module.exports = { generarPDFProfesional };
