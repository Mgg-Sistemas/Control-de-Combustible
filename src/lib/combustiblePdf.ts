/**
 * Generación de reportes PDF para el módulo de Combustible:
 * 1. Informe de Conciliación y Cuadre de Combustible (Balance semanal/mensual con firmas).
 * 2. Comprobante de Jornada del Surtidor (Despachos realizados en campo con contadores y horómetros).
 */
import { exportPdf, nowStamp, REPORT_BRAND } from './pdf';
import { LOGO_DATA_URI } from './logoData';
import { BCV_LOGO_DATA_URI } from './logoBcvData';
import { GOLDEN_TOUCH_LOGO_DATA_URI } from './logoGoldenTouchData';
import { RENACE_LOGO_DATA_URI } from './logoRenaceData';
import { JHENZAEN_LOGO_DATA_URI } from './logoJhenzaenData';
import {
  LogosReporteCombustible,
  OpcionesActivas,
  OPCIONES_REPORTE_CONCILIACION,
  OPCIONES_REPORTE_PARTE_DIARIO,
  mezclarLogosCombustible,
  mezclarOpciones,
} from './combustibleReportes';
import { marcaInstitucionalLogos } from './combustibleReportesPdf';

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

function renderBrandLogosHtml(
  logos: Partial<LogosReporteCombustible> | null | undefined,
  conMarca: boolean,
  subtituloDepto: string,
): string {
  const L = mezclarLogosCombustible(logos as any);
  const marcaTxt = marcaInstitucionalLogos(L);
  const imgs = [
    L.sos && LOGO_DATA_URI ? `<div class="logo-box"><img src="${LOGO_DATA_URI}" class="logo" alt="SOS" /><div class="logo-cap">SOS La Guaira</div></div>` : '',
    L.bcv && BCV_LOGO_DATA_URI ? `<div class="logo-box"><img src="${BCV_LOGO_DATA_URI}" class="logo" alt="BCV" /><div class="logo-cap">Banco Central de Venezuela</div></div>` : '',
    L.golden && GOLDEN_TOUCH_LOGO_DATA_URI ? `<div class="logo-box"><img src="${GOLDEN_TOUCH_LOGO_DATA_URI}" class="logo" alt="Golden Touch" /><div class="logo-cap">Golden Touch</div></div>` : '',
    L.renace && RENACE_LOGO_DATA_URI ? `<div class="logo-box"><img src="${RENACE_LOGO_DATA_URI}" class="logo" alt="Renace" /><div class="logo-cap">Plan Venezuela Renace</div></div>` : '',
    L.jhenzaen && JHENZAEN_LOGO_DATA_URI ? `<div class="logo-box"><img src="${JHENZAEN_LOGO_DATA_URI}" class="logo" alt="Jhenzaen" /><div class="logo-cap">Jhenzaen 2.012 C.A</div></div>` : '',
  ]
    .filter(Boolean)
    .join('');

  return `
    <div class="brand-logos">
      ${imgs}
      ${
        conMarca
          ? `<div>
              <div style="font-size: 12px; font-weight: 800; color: #1E3A5F;">${esc(marcaTxt)}</div>
              <div style="font-size: 9.5px; color: #6B7280;">${esc(subtituloDepto)}</div>
            </div>`
          : ''
      }
    </div>
  `;
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
  opciones?: OpcionesActivas | null;
  logos?: Partial<LogosReporteCombustible> | null;
}

export async function exportarConciliacionPdf(
  datos: DatosInformeConciliacion,
  opcionesParam?: OpcionesActivas | null,
  logosParam?: Partial<LogosReporteCombustible> | null,
): Promise<void> {
  const op = mezclarOpciones(OPCIONES_REPORTE_CONCILIACION, opcionesParam ?? datos.opciones ?? null);
  const logos = logosParam ?? datos.logos ?? null;
  const totInicial = datos.filas.reduce((s, f) => s + f.saldoInicialL, 0);
  const totEntradas = datos.filas.reduce((s, f) => s + f.entradasL, 0);
  const totDespachos = datos.filas.reduce((s, f) => s + f.despachosL, 0);
  const totTeorico = datos.filas.reduce((s, f) => s + f.saldoTeoricoL, 0);
  const totFisico = datos.filas.reduce((s, f) => s + f.saldoFisicoVaraL, 0);
  const totDiferencia = totFisico - totTeorico;

  const cols: { head: string; left?: boolean; cell: (f: FilaConciliacionCombustible) => string; foot: string }[] = [
    {
      head: 'Tanque / Cisterna',
      left: true,
      cell: (f) => `<td style="padding: 7px 8px; font-weight: 700; color: #111827;">${esc(f.tanqueNombre)}</td>`,
      foot: `<td style="text-align: left;">TOTALES GENERALES (LITROS)</td>`,
    },
  ];
  if (op.tipoCombustible !== false) {
    cols.push({
      head: 'Tipo',
      left: true,
      cell: (f) => `<td style="padding: 7px 8px; color: #4b5563; text-transform: capitalize;">${esc(f.combustible)}</td>`,
      foot: `<td></td>`,
    });
  }
  if (op.saldoInicial !== false) {
    cols.push({
      head: 'Saldo Inicial',
      cell: (f) => `<td style="padding: 7px 8px; text-align: right; font-family: monospace;">${fmtNum(f.saldoInicialL)}</td>`,
      foot: `<td style="text-align: right; font-family: monospace;">${fmtNum(totInicial)}</td>`,
    });
  }
  if (op.entradas !== false) {
    cols.push({
      head: '+ Entradas',
      cell: (f) => `<td style="padding: 7px 8px; text-align: right; font-family: monospace; color: #15803d;">+${fmtNum(f.entradasL)}</td>`,
      foot: `<td style="text-align: right; font-family: monospace; color: #15803d;">+${fmtNum(totEntradas)}</td>`,
    });
  }
  if (op.despachos !== false) {
    cols.push({
      head: '- Despachos',
      cell: (f) => `<td style="padding: 7px 8px; text-align: right; font-family: monospace; color: #b91c1c;">-${fmtNum(f.despachosL)}</td>`,
      foot: `<td style="text-align: right; font-family: monospace; color: #b91c1c;">-${fmtNum(totDespachos)}</td>`,
    });
  }
  if (op.traslados !== false) {
    cols.push({
      head: '± Traslados',
      cell: (f) => `<td style="padding: 7px 8px; text-align: right; font-family: monospace;">${f.trasladosNetosL >= 0 ? '+' : ''}${fmtNum(f.trasladosNetosL)}</td>`,
      foot: `<td style="text-align: right; font-family: monospace;">—</td>`,
    });
  }
  if (op.saldoTeorico !== false) {
    cols.push({
      head: 'Saldo Teórico',
      cell: (f) => `<td style="padding: 7px 8px; text-align: right; font-family: monospace; font-weight: 700;">${fmtNum(f.saldoTeoricoL)}</td>`,
      foot: `<td style="text-align: right; font-family: monospace;">${fmtNum(totTeorico)}</td>`,
    });
  }
  if (op.saldoFisico !== false) {
    cols.push({
      head: 'Saldo Físico (Vara)',
      cell: (f) => `<td style="padding: 7px 8px; text-align: right; font-family: monospace; font-weight: 700; color: #1e3a5f;">${fmtNum(f.saldoFisicoVaraL)}</td>`,
      foot: `<td style="text-align: right; font-family: monospace; color: #1E3A5F;">${fmtNum(totFisico)}</td>`,
    });
  }
  if (op.diferencia !== false) {
    cols.push({
      head: 'Diferencia / Merma',
      cell: (f) => {
        const difColor = f.diferenciaL < 0 ? '#b91c1c' : f.diferenciaL > 0 ? '#15803d' : '#374151';
        return `<td style="padding: 7px 8px; text-align: right; font-family: monospace; font-weight: 800; color: ${difColor};">${f.diferenciaL > 0 ? '+' : ''}${fmtNum(f.diferenciaL)} L<div style="font-size: 9px; opacity: 0.85;">(${f.pctDiferencia.toFixed(1)}%)</div></td>`;
      },
      foot: `<td style="text-align: right; font-family: monospace; color: ${totDiferencia < 0 ? '#b91c1c' : '#15803d'};">${totDiferencia > 0 ? '+' : ''}${fmtNum(totDiferencia)} L</td>`,
    });
  }

  const rowsHtml = datos.filas
    .map((f, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
      return `<tr style="background: ${bg}; border-bottom: 1px solid #e5e7eb;">${cols.map((c) => c.cell(f)).join('')}</tr>`;
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
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #1f2937; margin: 0; padding: 0; }
        .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1E3A5F; padding-bottom: 12px; margin-bottom: 14px; }
        .brand-logos { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .logo-box { display: flex; flex-direction: column; align-items: center; gap: 2px; }
        .logo { height: 42px; width: auto; object-fit: contain; background: #fff; }
        .logo-cap { font-size: 7.5px; font-weight: 800; color: #1E3A5F; text-align: center; max-width: 105px; line-height: 1.1; text-transform: uppercase; }
        .title-block { text-align: right; }
        .title { font-size: 18px; font-weight: 900; color: #1E3A5F; margin: 0; text-transform: uppercase; letter-spacing: 0.5px; }
        .subtitle { font-size: 11px; color: #4B5563; margin-top: 3px; }
        .meta-strip { display: flex; justify-content: space-between; background: #F3F4F6; border: 1px solid #E5E7EB; border-radius: 6px; padding: 8px 12px; margin-bottom: 14px; font-size: 11px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 10.5px; }
        th { background: #1E3A5F; color: #ffffff; padding: 8px 6px; text-align: right; font-weight: 700; text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.3px; }
        tfoot td { background: #E5E7EB; font-weight: 900; padding: 8px 6px; border-top: 2px solid #1E3A5F; }
        .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 34px; padding-top: 8px; }
        .sign-box { border-top: 1px solid #9CA3AF; text-align: center; padding-top: 6px; font-size: 10px; color: #374151; }
        .sign-role { font-weight: 800; color: #1E3A5F; text-transform: uppercase; font-size: 10px; }
      </style>
    </head>
    <body>
      <div class="head">
        ${renderBrandLogosHtml(logos, op.marcaTexto !== false, 'GERENCIA DE CONTROL Y SUMINISTRO DE COMBUSTIBLE')}
        <div class="title-block">
          <h1 class="title">Acta de Conciliación de Combustible</h1>
          <div class="subtitle">Período: ${esc(datos.periodoDesde)} al ${esc(datos.periodoHasta)}</div>
          <div style="font-size: 9px; color: #9CA3AF; margin-top: 2px;">Emitido: ${nowStamp()}</div>
        </div>
      </div>

      ${
        op.meta !== false
          ? `<div class="meta-strip">
              <div><strong>Responsable de Patio:</strong> ${esc(datos.elaboradoPor)}</div>
              <div><strong>Metodología:</strong> Balances Teóricos en Libros vs. Medición Física por Vara (Cubicación)</div>
              <div><strong>Estado del Balance:</strong> <span style="font-weight: 800; color: ${totDiferencia < -100 ? '#b91c1c' : '#15803d'}">${totDiferencia < -100 ? 'MERMA DETECTADA' : 'CUADRADO'}</span></div>
            </div>`
          : ''
      }

      <table>
        <thead>
          <tr>
            ${cols.map((c) => `<th style="text-align: ${c.left ? 'left' : 'right'};">${c.head}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
        <tfoot>
          <tr>
            ${cols.map((c) => c.foot).join('')}
          </tr>
        </tfoot>
      </table>

      ${
        op.observaciones !== false && datos.observaciones
          ? `<div style="background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 6px; padding: 8px 12px; margin-top: 8px; font-size: 10px; color: #92400E;">
              <strong>Observaciones de auditoría:</strong> ${esc(datos.observaciones)}
            </div>`
          : ''
      }

      ${
        op.firmas !== false
          ? `<div class="signatures">
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
            </div>`
          : ''
      }
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
  equipoSerial?: string | null;
  tanqueNombre: string;
  litros: number;
  contadorIni?: number | null;
  contadorFin?: number | null;
  horometroIni?: number | null;
  horometroFin?: number | null;
  horasTrabajadas?: number | null;
  autorizadoPor?: string | null;
  nota?: string | null;
}

export interface DatosJornadaSurtidorPdf {
  choferNombre: string;
  fechaJornada: string;
  despachos: FilaDespachoSurtidorPdf[];
  opciones?: OpcionesActivas | null;
  logos?: Partial<LogosReporteCombustible> | null;
}

export async function exportarJornadaSurtidorPdf(
  datos: DatosJornadaSurtidorPdf,
  opcionesParam?: OpcionesActivas | null,
  logosParam?: Partial<LogosReporteCombustible> | null,
): Promise<void> {
  const op = mezclarOpciones(OPCIONES_REPORTE_PARTE_DIARIO, opcionesParam ?? datos.opciones ?? null);
  const logos = logosParam ?? datos.logos ?? null;
  const totLitros = datos.despachos.reduce((s, d) => s + d.litros, 0);

  const cols: { head: string; align?: 'left' | 'right' | 'center'; cell: (d: FilaDespachoSurtidorPdf) => string }[] = [];
  if (op.hora !== false) {
    cols.push({
      head: 'Hora',
      align: 'left',
      cell: (d) => `<td style="padding: 6px 8px; font-weight: 600;">${esc(d.hora || d.fecha)}</td>`,
    });
  }
  cols.push({
    head: 'Maquinaria / Vehículo',
    align: 'left',
    cell: (d) => {
      const maqLabel = [
        esc(d.equipoCodigo),
        op.placa !== false ? `<span style="color:#b91c1c; font-weight:800;">[PLACA: ${esc(d.equipoPlaca || 'S/P')}]</span>` : '',
        op.serial !== false && d.equipoSerial ? `<span style="color:#1e3a5f; font-weight:700;">[SERIAL: ${esc(d.equipoSerial)}]</span>` : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<td style="padding: 6px 8px; font-weight: 700;">${maqLabel}</td>`;
    },
  });
  if (op.tanque !== false) {
    cols.push({
      head: 'Tanque',
      align: 'left',
      cell: (d) => `<td style="padding: 6px 8px; color: #4b5563;">${esc(d.tanqueNombre)}</td>`,
    });
  }
  cols.push({
    head: 'Litros',
    align: 'right',
    cell: (d) => `<td style="padding: 6px 8px; text-align: right; font-family: monospace; font-weight: 800; color: #1e3a5f;">${fmtNum(d.litros)} L</td>`,
  });
  if (op.contador !== false) {
    cols.push({
      head: 'Contador Bomba',
      align: 'center',
      cell: (d) => {
        const contadores = d.contadorIni != null && d.contadorFin != null ? `${fmtNum(d.contadorIni)} ➔ ${fmtNum(d.contadorFin)}` : '—';
        return `<td style="padding: 6px 8px; font-family: monospace; font-size: 9.5px; text-align: center;">${contadores}</td>`;
      },
    });
  }
  if (op.horometro !== false) {
    cols.push({
      head: 'Horómetro (h)',
      align: 'center',
      cell: (d) => {
        const horometros =
          d.horometroIni != null && d.horometroFin != null
            ? `${fmtNum(d.horometroIni)} ➔ ${fmtNum(d.horometroFin)}${d.horasTrabajadas != null ? ` (${fmtNum(d.horasTrabajadas)}h)` : ''}`
            : d.horometroFin != null
            ? `${fmtNum(d.horometroFin)} h`
            : '—';
        return `<td style="padding: 6px 8px; font-family: monospace; font-size: 9.5px; text-align: center;">${horometros}</td>`;
      },
    });
  }
  if (op.autorizado !== false) {
    cols.push({
      head: 'Autorizó',
      align: 'left',
      cell: (d) => `<td style="padding: 6px 8px; color: #6b7280; font-size: 9.5px;">${esc(d.autorizadoPor || '—')}</td>`,
    });
  }
  if (op.nota !== false && datos.despachos.some((d) => String(d.nota ?? '').trim().length > 0)) {
    cols.push({
      head: 'Nota',
      align: 'left',
      cell: (d) => `<td style="padding: 6px 8px; color: #6b7280; font-size: 9.5px;">${esc(d.nota || '')}</td>`,
    });
  }

  const iLitros = cols.findIndex((c) => c.head === 'Litros');
  const rows = datos.despachos
    .map((d, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
      return `<tr style="background: ${bg}; border-bottom: 1px solid #e5e7eb;">${cols.map((c) => c.cell(d)).join('')}</tr>`;
    })
    .join('');

  let totalesEquipoHtml = '';
  if (op.totalesEquipo !== false && datos.despachos.length > 0) {
    const porEq = new Map<string, { codigo: string; placa: string; serial: string; surtidos: number; litros: number }>();
    for (const d of datos.despachos) {
      const k = `${d.equipoCodigo}|${d.equipoPlaca || ''}|${d.equipoSerial || ''}`;
      const prev = porEq.get(k) || {
        codigo: d.equipoCodigo,
        placa: d.equipoPlaca || 'S/P',
        serial: d.equipoSerial || '',
        surtidos: 0,
        litros: 0,
      };
      prev.surtidos += 1;
      prev.litros = Math.round((prev.litros + (Number(d.litros) || 0)) * 100) / 100;
      porEq.set(k, prev);
    }
    const listaEq = Array.from(porEq.values()).sort((a, b) => b.litros - a.litros);
    totalesEquipoHtml = `
      <h3 style="color: #1E3A5F; font-size: 11px; margin: 14px 0 6px; text-transform: uppercase;">Resumen por Máquina / Vehículo</h3>
      <table>
        <thead>
          <tr>
            <th>Equipo</th>
            ${op.placa !== false ? '<th>Placa</th>' : ''}
            ${op.serial !== false ? '<th>Serial</th>' : ''}
            <th style="text-align: right;">Surtidos</th>
            <th style="text-align: right;">Litros</th>
          </tr>
        </thead>
        <tbody>
          ${listaEq
            .map(
              (e, idx) => `
              <tr style="background: ${idx % 2 === 0 ? '#ffffff' : '#f9fafb'}; border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 5px 8px; font-weight: 700;">${esc(e.codigo)}</td>
                ${op.placa !== false ? `<td style="padding: 5px 8px;">${esc(e.placa || 'S/P')}</td>` : ''}
                ${op.serial !== false ? `<td style="padding: 5px 8px;">${esc(e.serial || '—')}</td>` : ''}
                <td style="padding: 5px 8px; text-align: right; font-family: monospace;">${e.surtidos}</td>
                <td style="padding: 5px 8px; text-align: right; font-family: monospace; font-weight: 800; color: #1E3A5F;">${fmtNum(e.litros)} L</td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    `;
  }

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="utf-8" />
      <title>Jornada-Surtidor-${datos.fechaJornada}</title>
      <style>
        @page { size: letter portrait; margin: 1.2cm; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #1f2937; margin: 0; padding: 0; }
        .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1E3A5F; padding-bottom: 10px; margin-bottom: 12px; }
        .brand-logos { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .logo-box { display: flex; flex-direction: column; align-items: center; gap: 2px; }
        .logo { height: 42px; width: auto; object-fit: contain; background: #fff; }
        .logo-cap { font-size: 7.5px; font-weight: 800; color: #1E3A5F; text-align: center; max-width: 105px; line-height: 1.1; text-transform: uppercase; }
        .title { font-size: 16px; font-weight: 900; color: #1E3A5F; margin: 0; text-transform: uppercase; }
        .meta-strip { display: flex; justify-content: space-between; background: #F3F4F6; border: 1px solid #E5E7EB; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 10px; }
        th { background: #1E3A5F; color: #ffffff; padding: 7px 6px; text-align: left; font-weight: 700; text-transform: uppercase; font-size: 9px; }
        tfoot td { background: #E5E7EB; font-weight: 900; padding: 8px 6px; border-top: 2px solid #1E3A5F; }
        .signatures { display: grid; grid-template-columns: repeat(2, 1fr); gap: 40px; margin-top: 40px; }
        .sign-box { border-top: 1px solid #9CA3AF; text-align: center; padding-top: 6px; font-size: 10px; }
      </style>
    </head>
    <body>
      <div class="head">
        ${renderBrandLogosHtml(logos, op.marcaTexto !== false, 'CONTROL DE SUMINISTRO EN CAMPO')}
        <div style="text-align: right;">
          <h1 class="title">Parte Diario de Surtido</h1>
          <div style="font-size: 10px; color: #4B5563;">Fecha: ${esc(datos.fechaJornada)}</div>
        </div>
      </div>

      ${
        op.resumen !== false
          ? `<div class="meta-strip">
              <div><strong>Chofer / Surtidor:</strong> ${esc(datos.choferNombre)}</div>
              <div><strong>Total Despachos:</strong> ${datos.despachos.length}</div>
              <div><strong>Litros Totales Dispensados:</strong> <span style="font-weight: 800; color: #1E3A5F;">${fmtNum(totLitros)} L</span></div>
            </div>`
          : ''
      }

      <table>
        <thead>
          <tr>
            ${cols.map((c) => `<th style="text-align: ${c.align || 'left'};">${c.head}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
        <tfoot>
          <tr>
            ${cols
              .map((_, i) =>
                i === 0
                  ? `<td>TOTAL DESPACHADO EN LA JORNADA</td>`
                  : i === iLitros
                  ? `<td style="text-align: right; font-family: monospace; font-weight: 900; color: #1E3A5F;">${fmtNum(totLitros)} L</td>`
                  : `<td></td>`,
              )
              .join('')}
          </tr>
        </tfoot>
      </table>

      ${totalesEquipoHtml}

      ${
        op.firmas !== false
          ? `<div class="signatures">
              <div class="sign-box">
                <div style="font-weight: 800; color: #1E3A5F;">Firma del Chofer de Combustible</div>
                <div style="margin-top: 20px;">${esc(datos.choferNombre)}</div>
              </div>
              <div class="sign-box">
                <div style="font-weight: 800; color: #1E3A5F;">Firma del Supervisor de Patio / Mina</div>
                <div style="margin-top: 20px;">Recibido Conforme</div>
              </div>
            </div>`
          : ''
      }
    </body>
    </html>
  `;

  await exportPdf(html, `Parte-Diario-Surtidor-${datos.fechaJornada}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 🧾 Desglose del rango (02-nov-2026): consumos y entradas del rango escogido en
// Conciliación. Lo que se apaga en las opciones no sale ni deja rastro (ni
// columna vacía ni aviso).
// ─────────────────────────────────────────────────────────────────────────────
export interface DatosDesgloseRangoPdf {
  desglose: import('./combustibleDesglose').DesgloseRango;
  opciones: import('./combustibleDesglose').OpcionesDesglose;
  elaboradoPor: string;
  logos?: Partial<LogosReporteCombustible> | null;
}

export async function exportarDesgloseRangoPdf(datos: DatosDesgloseRangoPdf): Promise<void> {
  const { desglose: g, opciones: o, logos } = datos;
  const td = (v: string, extra = '') => `<td style="padding: 5px 6px; ${extra}">${v}</td>`;
  const num = 'text-align: right; font-family: monospace;';
  const fondo = (idx: number) => (idx % 2 === 0 ? '#ffffff' : '#f9fafb');

  let consumosHtml = '';
  if (o.consumos && g.consumos.length > 0) {
    const heads = ['Fecha'];
    if (o.hora !== false) heads.push('Hora');
    heads.push('Equipo');
    if (o.placa) heads.push('Placa');
    if (o.serial) heads.push('Serial');
    if (o.tanque !== false) heads.push('Tanque');
    heads.push('Litros');
    if (o.contador) heads.push('Contador bomba');
    if (o.horometro) heads.push('Horómetro (inspector)');
    if (o.autorizado !== false) heads.push('Autorizó');
    if (o.nota !== false && g.consumos.some((c) => c.nota)) heads.push('Nota');
    const inclNota = o.nota !== false && g.consumos.some((c) => c.nota);
    const filas = g.consumos
      .map((c, idx) => {
        const celdas = [td(esc(c.fecha))];
        if (o.hora !== false) celdas.push(td(esc(c.hora)));
        celdas.push(td(`<b>${esc(c.equipo)}</b>`));
        if (o.placa) celdas.push(td(esc(c.placa || 'S/P')));
        if (o.serial) celdas.push(td(esc(c.serial)));
        if (o.tanque !== false) celdas.push(td(esc(c.tanque)));
        celdas.push(td(`${fmtNum(c.litros)} L`, num + ' font-weight: 800;'));
        if (o.contador) {
          celdas.push(td(c.contadorIni != null && c.contadorFin != null ? `${fmtNum(c.contadorIni)} ➔ ${fmtNum(c.contadorFin)}` : '', 'font-family: monospace; text-align: center;'));
        }
        if (o.horometro) {
          const h = c.horometroIni != null || c.horometroFin != null
            ? `${c.horometroIni != null ? fmtNum(c.horometroIni) : '?'} ➔ ${c.horometroFin != null ? fmtNum(c.horometroFin) : '?'}${c.horas != null ? ` (${fmtNum(c.horas)} h)` : ''}`
            : '';
          celdas.push(td(h, 'font-family: monospace; text-align: center;'));
        }
        if (o.autorizado !== false) celdas.push(td(esc(c.autorizado), 'color: #6b7280;'));
        if (inclNota) celdas.push(td(esc(c.nota), 'color: #6b7280;'));
        return `<tr style="background: ${fondo(idx)}; border-bottom: 1px solid #e5e7eb;">${celdas.join('')}</tr>`;
      })
      .join('');
    consumosHtml = `
      <h2 class="sec">Consumos (salidas)</h2>
      <table>
        <thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr><td colspan="${heads.length}">TOTAL CONSUMIDO: ${fmtNum(g.totalConsumido)} L · ${g.consumos.length} surtidos</td></tr></tfoot>
      </table>`;
  }

  let entradasHtml = '';
  if (o.entradas && g.entradas.length > 0) {
    const heads = ['Fecha', 'Proveedor'];
    if (o.factura !== false) heads.push('Factura');
    if (o.tanque !== false) heads.push('Tanque');
    heads.push('Litros');
    if (o.costo !== false) heads.push('Costo unit.', 'Costo total');
    const filas = g.entradas
      .map((e, idx) => {
        const celdas = [td(esc(e.fecha)), td(esc(e.proveedor))];
        if (o.factura !== false) celdas.push(td(esc(e.factura)));
        if (o.tanque !== false) celdas.push(td(esc(e.tanque)));
        celdas.push(td(`${fmtNum(e.litros)} L`, num + ' font-weight: 800;'));
        if (o.costo !== false) {
          celdas.push(td(e.costoUnitario != null ? fmtNum(e.costoUnitario) : '', num));
          celdas.push(td(e.costoTotal != null ? fmtNum(e.costoTotal) : '', num));
        }
        return `<tr style="background: ${fondo(idx)}; border-bottom: 1px solid #e5e7eb;">${celdas.join('')}</tr>`;
      })
      .join('');
    entradasHtml = `
      <h2 class="sec">Entradas</h2>
      <table>
        <thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr><td colspan="${heads.length}">TOTAL ENTRADO: ${fmtNum(g.totalEntrado)} L${o.costo !== false && g.totalCosto > 0 ? ` · ${fmtNum(g.totalCosto)} en costo` : ''}</td></tr></tfoot>
      </table>`;
  }

  let equiposHtml = '';
  if (o.consumos && o.totalesEquipo && g.porEquipo.length > 0) {
    const heads = ['Equipo'];
    if (o.placa) heads.push('Placa');
    if (o.serial) heads.push('Serial');
    heads.push('Surtidos', 'Litros');
    if (o.horometro) heads.push('Horas (inspector)');
    const filas = g.porEquipo
      .map((e, idx) => {
        const celdas = [td(`<b>${esc(e.equipo)}</b>`)];
        if (o.placa) celdas.push(td(esc(e.placa || 'S/P')));
        if (o.serial) celdas.push(td(esc(e.serial)));
        celdas.push(td(String(e.surtidos), num), td(`${fmtNum(e.litros)} L`, num + ' font-weight: 800;'));
        if (o.horometro) celdas.push(td(e.horas != null ? `${fmtNum(e.horas)} h` : '', num));
        return `<tr style="background: ${fondo(idx)};">${celdas.join('')}</tr>`;
      })
      .join('');
    equiposHtml = `<h2 class="sec">Totales por equipo</h2><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${filas}</tbody></table>`;
  }

  let tanquesHtml = '';
  if (o.totalesTanque && g.porTanque.length > 0 && (o.consumos || o.entradas)) {
    const heads = ['Tanque'];
    if (o.entradas) heads.push('Entró');
    if (o.consumos) heads.push('Salió');
    const filas = g.porTanque
      .map((t, idx) => {
        const celdas = [td(`<b>${esc(t.tanque)}</b>`)];
        if (o.entradas) celdas.push(td(`${fmtNum(t.entro)} L`, num));
        if (o.consumos) celdas.push(td(`${fmtNum(t.salio)} L`, num));
        return `<tr style="background: ${fondo(idx)};">${celdas.join('')}</tr>`;
      })
      .join('');
    tanquesHtml = `<h2 class="sec">Totales por tanque</h2><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${filas}</tbody></table>`;
  }

  const meta: string[] = [`<div><strong>Período:</strong> ${esc(g.desde)} al ${esc(g.hasta)}</div>`];
  if (o.entradas) meta.push(`<div><strong>Entradas:</strong> ${fmtNum(g.totalEntrado)} L</div>`);
  if (o.consumos) meta.push(`<div><strong>Consumos:</strong> ${fmtNum(g.totalConsumido)} L</div>`);

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="utf-8" />
      <title>Desglose-Combustible-${esc(g.desde)}-${esc(g.hasta)}</title>
      <style>
        @page { size: letter landscape; margin: 1cm; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 10.5px; color: #1f2937; margin: 0; padding: 0; }
        .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1E3A5F; padding-bottom: 10px; margin-bottom: 12px; }
        .brand-logos { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .logo-box { display: flex; flex-direction: column; align-items: center; gap: 2px; }
        .logo { height: 42px; width: auto; object-fit: contain; background: #fff; }
        .logo-cap { font-size: 7.5px; font-weight: 800; color: #1E3A5F; text-align: center; max-width: 105px; line-height: 1.1; text-transform: uppercase; }
        .title { font-size: 16px; font-weight: 900; color: #1E3A5F; margin: 0; text-transform: uppercase; }
        .meta-strip { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; background: #F3F4F6; border: 1px solid #E5E7EB; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; }
        .sec { font-size: 12px; color: #1E3A5F; margin: 14px 0 6px; text-transform: uppercase; }
        table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
        tr { page-break-inside: avoid; }
        th { background: #1E3A5F; color: #ffffff; padding: 6px; text-align: left; font-weight: 700; text-transform: uppercase; font-size: 8.5px; }
        tfoot td { background: #E5E7EB; font-weight: 900; padding: 7px 6px; border-top: 2px solid #1E3A5F; }
        .signatures { display: grid; grid-template-columns: repeat(2, 1fr); gap: 40px; margin-top: 32px; page-break-inside: avoid; }
        .sign-box { border-top: 1px solid #9CA3AF; text-align: center; padding-top: 6px; font-size: 10px; }
      </style>
    </head>
    <body>
      <div class="head">
        ${renderBrandLogosHtml(logos, o.marcaTexto !== false, 'CONTROL DE COMBUSTIBLE')}
        <div style="text-align: right;">
          <h1 class="title">Desglose de Combustible</h1>
          <div style="font-size: 10px; color: #4B5563;">Emitido: ${esc(nowStamp())} · ${esc(datos.elaboradoPor)}</div>
        </div>
      </div>
      <div class="meta-strip">${meta.join('')}</div>
      ${consumosHtml}
      ${entradasHtml}
      ${equiposHtml}
      ${tanquesHtml}
      ${
        o.firmas
          ? `<div class="signatures">
              <div class="sign-box">
                <div style="font-weight: 800; color: #1E3A5F;">Elaborado por</div>
                <div style="margin-top: 18px;">${esc(datos.elaboradoPor)}</div>
              </div>
              <div class="sign-box">
                <div style="font-weight: 800; color: #1E3A5F;">Conformado / Auditoría</div>
                <div style="margin-top: 18px;">Revisado Conforme</div>
              </div>
            </div>`
          : ''
      }
    </body>
    </html>
  `;

  await exportPdf(html, `Desglose-Combustible-${g.desde}-${g.hasta}`);
}
