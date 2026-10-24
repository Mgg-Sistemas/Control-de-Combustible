/**
 * Generación de reportes PDF para el módulo de Combustible:
 * 1. Informe de Conciliación y Cuadre de Combustible (Balance semanal/mensual con firmas).
 * 2. Comprobante de Jornada del Surtidor (Despachos realizados en campo con contadores y horómetros).
 */
import { exportPdf, nowStamp } from './pdf';
import { LOGO_DATA_URI } from './logoData';
import { BCV_LOGO_DATA_URI } from './logoBcvData';
import { REPORT_BRAND } from './pdf';

function esc(val: any): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '0';
  return Number(n).toLocaleString('es-VE', { maximumFractionDigits: 2 });
}

export interface FilaConciliacionCombustible {
  tanqueNombre: string;
  combustible: string;
  capacidadL: number;
  saldoInicialL: number;
  entradasL: number;
  despachosL: number;
  trasladosNetosL: number;
  saldoTeoricoL: number;
  saldoFisicoVaraL: number;
  diferenciaL: number; // Físico - Teórico
  pctDiferencia: number;
  estado: 'cuadrado' | 'merma' | 'sobrante';
}

export interface DatosInformeConciliacion {
  periodoDesde: string;
  periodoHasta: string;
  elaboradoPor: string;
  revisadoPor?: string;
  aprobadoPor?: string;
  observaciones?: string;
  filas: FilaConciliacionCombustible[];
}

export async function exportarConciliacionPdf(datos: DatosInformeConciliacion): Promise<void> {
  const totInicial = datos.filas.reduce((s, f) => s + f.saldoInicialL, 0);
  const totEntradas = datos.filas.reduce((s, f) => s + f.entradasL, 0);
  const totDespachos = datos.filas.reduce((s, f) => s + f.despachosL, 0);
  const totTeorico = datos.filas.reduce((s, f) => s + f.saldoTeoricoL, 0);
  const totFisico = datos.filas.reduce((s, f) => s + f.saldoFisicoVaraL, 0);
  const totDiferencia = totFisico - totTeorico;

  const rowsHtml = datos.filas
    .map((f, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
      const difColor = f.diferenciaL < 0 ? '#b91c1c' : f.diferenciaL > 0 ? '#15803d' : '#374151';
      return `
        <tr style="background: ${bg}; border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 7px 8px; font-weight: 700; color: #111827;">${esc(f.tanqueNombre)}</td>
          <td style="padding: 7px 8px; color: #4b5563; text-transform: capitalize;">${esc(f.combustible)}</td>
          <td style="padding: 7px 8px; text-align: right; font-family: monospace;">${fmtNum(f.saldoInicialL)}</td>
          <td style="padding: 7px 8px; text-align: right; font-family: monospace; color: #15803d;">+${fmtNum(f.entradasL)}</td>
          <td style="padding: 7px 8px; text-align: right; font-family: monospace; color: #b91c1c;">-${fmtNum(f.despachosL)}</td>
          <td style="padding: 7px 8px; text-align: right; font-family: monospace;">${f.trasladosNetosL >= 0 ? '+' : ''}${fmtNum(f.trasladosNetosL)}</td>
          <td style="padding: 7px 8px; text-align: right; font-family: monospace; font-weight: 700;">${fmtNum(f.saldoTeoricoL)}</td>
          <td style="padding: 7px 8px; text-align: right; font-family: monospace; font-weight: 700; color: #1e3a5f;">${fmtNum(f.saldoFisicoVaraL)}</td>
          <td style="padding: 7px 8px; text-align: right; font-family: monospace; font-weight: 800; color: ${difColor};">
            ${f.diferenciaL > 0 ? '+' : ''}${fmtNum(f.diferenciaL)} L
            <div style="font-size: 9px; opacity: 0.85;">(${f.pctDiferencia.toFixed(1)}%)</div>
          </td>
        </tr>
      `;
    })
    .join('');

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="utf-8" />
      <title>Conciliacion-Combustible-${datos.periodoDesde}-${datos.periodoHasta}</title>
      <style>
        @page { size: letter landscape; margin: 1.2cm; }
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #1f2937; margin: 0; padding: 0; }
        .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1E3A5F; padding-bottom: 12px; margin-bottom: 14px; }
        .brand-logos { display: flex; align-items: center; gap: 14px; }
        .logo { height: 46px; object-fit: contain; }
        .title-block { text-align: right; }
        .title { font-size: 18px; font-weight: 900; color: #1E3A5F; margin: 0; text-transform: uppercase; letter-spacing: 0.5px; }
        .subtitle { font-size: 11px; color: #4B5563; margin-top: 3px; }
        .meta-strip { display: flex; justify-content: space-between; background: #F3F4F6; border: 1px solid #E5E7EB; border-radius: 6px; padding: 8px 12px; margin-bottom: 14px; font-size: 11px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 10.5px; }
        th { background: #1E3A5F; color: #ffffff; padding: 8px 6px; text-align: right; font-weight: 700; text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.3px; }
        th:first-child, th:nth-child(2) { text-align: left; }
        tfoot td { background: #E5E7EB; font-weight: 900; padding: 8px 6px; border-top: 2px solid #1E3A5F; }
        .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 34px; padding-top: 8px; }
        .sign-box { border-top: 1px solid #9CA3AF; text-align: center; padding-top: 6px; font-size: 10px; color: #374151; }
        .sign-role { font-weight: 800; color: #1E3A5F; text-transform: uppercase; font-size: 10px; }
      </style>
    </head>
    <body>
      <div class="head">
        <div class="brand-logos">
          ${LOGO_DATA_URI ? `<img src="${LOGO_DATA_URI}" class="logo" alt="SOS" />` : ''}
          ${BCV_LOGO_DATA_URI ? `<img src="${BCV_LOGO_DATA_URI}" class="logo" alt="BCV" />` : ''}
          <div>
            <div style="font-size: 13px; font-weight: 800; color: #1E3A5F;">${esc(REPORT_BRAND)}</div>
            <div style="font-size: 10px; color: #6B7280;">GERENCIA DE CONTROL Y SUMINISTRO DE COMBUSTIBLE</div>
          </div>
        </div>
        <div class="title-block">
          <h1 class="title">Acta de Conciliación de Combustible</h1>
          <div class="subtitle">Período: ${esc(datos.periodoDesde)} al ${esc(datos.periodoHasta)}</div>
          <div style="font-size: 9px; color: #9CA3AF; margin-top: 2px;">Emitido: ${nowStamp()}</div>
        </div>
      </div>

      <div class="meta-strip">
        <div><strong>Responsable de Patio:</strong> ${esc(datos.elaboradoPor)}</div>
        <div><strong>Metodología:</strong> Balances Teóricos en Libros vs. Medición Física por Vara (Cubicación)</div>
        <div><strong>Estado del Balance:</strong> <span style="font-weight: 800; color: ${totDiferencia < -100 ? '#b91c1c' : '#15803d'}">${totDiferencia < -100 ? 'MERMA DETECTADA' : 'CUADRADO'}</span></div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Tanque / Cisterna</th>
            <th>Tipo</th>
            <th>Saldo Inicial</th>
            <th>+ Entradas</th>
            <th>- Despachos</th>
            <th>± Traslados</th>
            <th>Saldo Teórico</th>
            <th>Saldo Físico (Vara)</th>
            <th>Diferencia / Merma</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2" style="text-align: left;">TOTALES GENERALES (LITROS)</td>
            <td style="text-align: right; font-family: monospace;">${fmtNum(totInicial)}</td>
            <td style="text-align: right; font-family: monospace; color: #15803d;">+${fmtNum(totEntradas)}</td>
            <td style="text-align: right; font-family: monospace; color: #b91c1c;">-${fmtNum(totDespachos)}</td>
            <td style="text-align: right; font-family: monospace;">—</td>
            <td style="text-align: right; font-family: monospace;">${fmtNum(totTeorico)}</td>
            <td style="text-align: right; font-family: monospace; color: #1E3A5F;">${fmtNum(totFisico)}</td>
            <td style="text-align: right; font-family: monospace; color: ${totDiferencia < 0 ? '#b91c1c' : '#15803d'};">
              ${totDiferencia > 0 ? '+' : ''}${fmtNum(totDiferencia)} L
            </td>
          </tr>
        </tfoot>
      </table>

      ${datos.observaciones ? `
        <div style="background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 6px; padding: 8px 12px; margin-top: 8px; font-size: 10px; color: #92400E;">
          <strong>Observaciones de auditoría:</strong> ${esc(datos.observaciones)}
        </div>
      ` : ''}

      <div class="signatures">
        <div class="sign-box">
          <div class="sign-role">Encargado de Combustible / Patio</div>
          <div style="margin-top: 18px;">${esc(datos.elaboradoPor)}</div>
        </div>
        <div class="sign-box">
          <div class="sign-role">Auditoría / Control de Gestión</div>
          <div style="margin-top: 18px;">${esc(datos.revisadoPor || 'Revisado')}</div>
        </div>
        <div class="sign-box">
          <div class="sign-role">Gerencia General / Coordinación</div>
          <div style="margin-top: 18px;">${esc(datos.aprobadoPor || 'Aprobado')}</div>
        </div>
      </div>
    </body>
    </html>
  `;

  await exportPdf(html, `Conciliacion-Combustible-${datos.periodoDesde}-${datos.periodoHasta}`);
}

export interface FilaDespachoSurtidorPdf {
  fecha: string;
  hora: string;
  equipoCodigo: string;
  equipoPlaca: string;
  tanqueNombre: string;
  litros: number;
  contadorIni?: number | null;
  contadorFin?: number | null;
  horometroIni?: number | null;
  horometroFin?: number | null;
  horasTrabajadas?: number | null;
  autorizadoPor?: string | null;
}

export interface DatosJornadaSurtidorPdf {
  choferNombre: string;
  fechaJornada: string;
  despachos: FilaDespachoSurtidorPdf[];
}

export async function exportarJornadaSurtidorPdf(datos: DatosJornadaSurtidorPdf): Promise<void> {
  const totLitros = datos.despachos.reduce((s, d) => s + d.litros, 0);

  const rows = datos.despachos
    .map((d, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
      const maqLabel = [d.equipoCodigo, d.equipoPlaca ? `<span style="color:#b91c1c; font-weight:800;">[PLACA: ${esc(d.equipoPlaca)}]</span>` : ''].filter(Boolean).join(' ');
      const contadores = d.contadorIni != null && d.contadorFin != null ? `${fmtNum(d.contadorIni)} ➔ ${fmtNum(d.contadorFin)}` : '—';
      const horometros = d.horometroIni != null && d.horometroFin != null ? `${fmtNum(d.horometroIni)} ➔ ${fmtNum(d.horometroFin)} (${fmtNum(d.horasTrabajadas)}h)` : '—';

      return `
        <tr style="background: ${bg}; border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 6px 8px; font-weight: 600;">${esc(d.hora || d.fecha)}</td>
          <td style="padding: 6px 8px; font-weight: 700;">${maqLabel}</td>
          <td style="padding: 6px 8px; color: #4b5563;">${esc(d.tanqueNombre)}</td>
          <td style="padding: 6px 8px; text-align: right; font-family: monospace; font-weight: 800; color: #1e3a5f;">${fmtNum(d.litros)} L</td>
          <td style="padding: 6px 8px; font-family: monospace; font-size: 9.5px; text-align: center;">${contadores}</td>
          <td style="padding: 6px 8px; font-family: monospace; font-size: 9.5px; text-align: center;">${horometros}</td>
          <td style="padding: 6px 8px; color: #6b7280; font-size: 9.5px;">${esc(d.autorizadoPor || '—')}</td>
        </tr>
      `;
    })
    .join('');

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="utf-8" />
      <title>Jornada-Surtidor-${datos.fechaJornada}</title>
      <style>
        @page { size: letter portrait; margin: 1.2cm; }
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #1f2937; margin: 0; padding: 0; }
        .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1E3A5F; padding-bottom: 10px; margin-bottom: 12px; }
        .brand-logos { display: flex; align-items: center; gap: 12px; }
        .logo { height: 42px; object-fit: contain; }
        .title { font-size: 16px; font-weight: 900; color: #1E3A5F; margin: 0; text-transform: uppercase; }
        .meta-strip { display: flex; justify-content: space-between; background: #F3F4F6; border: 1px solid #E5E7EB; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 10px; }
        th { background: #1E3A5F; color: #ffffff; padding: 7px 6px; text-align: left; font-weight: 700; text-transform: uppercase; font-size: 9px; }
        th:nth-child(4) { text-align: right; }
        th:nth-child(5), th:nth-child(6) { text-align: center; }
        tfoot td { background: #E5E7EB; font-weight: 900; padding: 8px 6px; border-top: 2px solid #1E3A5F; }
        .signatures { display: grid; grid-template-columns: repeat(2, 1fr); gap: 40px; margin-top: 40px; }
        .sign-box { border-top: 1px solid #9CA3AF; text-align: center; padding-top: 6px; font-size: 10px; }
      </style>
    </head>
    <body>
      <div class="head">
        <div class="brand-logos">
          ${LOGO_DATA_URI ? `<img src="${LOGO_DATA_URI}" class="logo" alt="SOS" />` : ''}
          ${BCV_LOGO_DATA_URI ? `<img src="${BCV_LOGO_DATA_URI}" class="logo" alt="BCV" />` : ''}
          <div>
            <div style="font-size: 12px; font-weight: 800; color: #1E3A5F;">${esc(REPORT_BRAND)}</div>
            <div style="font-size: 9.5px; color: #6B7280;">CONTROL DE SUMINISTRO EN CAMPO</div>
          </div>
        </div>
        <div style="text-align: right;">
          <h1 class="title">Parte Diario de Surtido</h1>
          <div style="font-size: 10px; color: #4B5563;">Fecha: ${esc(datos.fechaJornada)}</div>
        </div>
      </div>

      <div class="meta-strip">
        <div><strong>Chofer / Surtidor:</strong> ${esc(datos.choferNombre)}</div>
        <div><strong>Total Despachos:</strong> ${datos.despachos.length}</div>
        <div><strong>Litros Totales Dispensados:</strong> <span style="font-weight: 800; color: #1E3A5F;">${fmtNum(totLitros)} L</span></div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Hora</th>
            <th>Maquinaria / Vehículo</th>
            <th>Tanque</th>
            <th style="text-align: right;">Litros</th>
            <th style="text-align: center;">Contador Bomba</th>
            <th style="text-align: center;">Horómetro (h)</th>
            <th>Autorizó</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3">TOTAL DESPACHADO EN LA JORNADA</td>
            <td style="text-align: right; font-family: monospace; font-weight: 900; color: #1E3A5F;">${fmtNum(totLitros)} L</td>
            <td colspan="3"></td>
          </tr>
        </tfoot>
      </table>

      <div class="signatures">
        <div class="sign-box">
          <div style="font-weight: 800; color: #1E3A5F;">Firma del Chofer de Combustible</div>
          <div style="margin-top: 20px;">${esc(datos.choferNombre)}</div>
        </div>
        <div class="sign-box">
          <div style="font-weight: 800; color: #1E3A5F;">Firma del Supervisor de Patio / Mina</div>
          <div style="margin-top: 20px;">Recibido Conforme</div>
        </div>
      </div>
    </body>
    </html>
  `;

  await exportPdf(html, `Parte-Diario-Surtidor-${datos.fechaJornada}`);
}
