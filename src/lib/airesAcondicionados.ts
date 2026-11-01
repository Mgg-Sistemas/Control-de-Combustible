// ============================================================================
// ❄️ CONTROL RIGUROSO Y PREVENTIVO DE AIRES ACONDICIONADOS (BASE Y FLOTA/MAQUINARIA)
// ============================================================================
// Gestiona el inventario de las unidades de aire acondicionado de la base,
// frentes externos (ej. Carbozulia) y flota pesada (maquinarias, camiones roqueros,
// palas, camionetas), su semáforo riguroso y su ciclo preventivo (camión de lavado),
// checklist técnico, sincronización en la nube sobre `public.servicios` y PDF.

import type { ServicioRecord, ServicioItem } from '../types/database';
import { pdfDocument } from './pdf';

export const AC_MASTER_CODE = 'AC-CATALOG-MASTER';
export const AC_CATEGORIA_SERVICIO = 'MANTENIMIENTO DE AIRE ACONDICIONADO';
export const TOTAL_UNIDADES_BASE = 37;

export type AcTipoEquipo =
  | 'SPLIT'
  | 'VENTANA'
  | 'PISO-TECHO'
  | 'COMPACTO'
  | 'PORTATIL'
  | 'MAQUINARIA'
  | 'CAMIÓN / ROQUERO'
  | 'PALA / EXCAVADORA'
  | 'CAMIONETA / VEHÍCULO'
  | 'CHUTO / GANDOLA';

export type AcEstadoOperativo = 'operativo' | 'observacion' | 'dañado';
export type AcSemaforo = 'al_dia' | 'proximo' | 'vencido' | 'sin_registro';

export interface AcUnit {
  id: string;                        // 'AA-01', 'ROCKERO-18', etc.
  code: string;                      // 'AA-01', 'ROCKERO-18', etc.
  name: string;                      // Nombre o referencia específica (ej. 'CARBOZULIA', 'OFICINA GERENCIA')
  area: string;                      // Área / Ubicación / Frente (ej. 'CARBOZULIA', 'OFICINA PRINCIPAL', 'PATIO'...)
  tipo_equipo: AcTipoEquipo;
  btu: string;                       // Ej. '18.000 BTU', 'COMPRESOR 508', 'A/A PESADO 24V'
  marca: string;                     // Ej. 'LG', 'SAMSUNG', 'SANDEN', 'CAT', 'LIEBHERR'
  serial: string;                    // Serial físico (opcional)
  placa?: string;                    // Placa de la maquinaria / camión / vehículo (obligatorio mostrar si aplica)
  machinery_id?: string | null;      // Vínculo opcional con tabla machinery / vehicles
  company_id: string | null;         // Empresa asociada en la base
  freq_days: number;                 // Frecuencia de mantenimiento riguroso en días (default: 30 o 45)
  freq_prev_days?: number | null;    // Frecuencia de mantenimiento preventivo (camión de lavado) en días (ej. 2)
  prev_responsable?: string;         // Quién realiza el preventivo (ej. 'CAMIÓN DE LAVADO')
  estado_operativo: AcEstadoOperativo;
  last_maint_manual: string | null;  // Fecha AAAA-MM-DD opcional de último servicio riguroso previo
  last_prev_manual?: string | null;  // Fecha AAAA-MM-DD opcional de último mantenimiento preventivo / lavado
  notes: string;                     // Nota fija del equipo (gas, voltaje, protector, compresor, etc.)
  active: boolean;
}

export interface AcPresupuestoAdjunto {
  id: string;
  url: string;
  kind: 'image' | 'pdf';
  name: string;
}

export type AcModoIva = 'incluye_iva' | 'mas_iva' | 'exento';

export interface AcMaintHistoryEntry {
  servicioId: string;
  servicioCode: string;
  fecha: string;
  supplierId: string | null;
  companyId: string | null;
  tipo: string;
  detalle: string;
  detalleLibre?: string;
  checklist: string[];
  costoUsd: number;
  totalServicioUsd?: number;
  ivaModo?: AcModoIva;
  alicuotaIva?: number;
  subtotalUsd?: number;
  ivaUsd?: number;
  monedaCaptura?: 'USD' | 'VES';
  tasaBcv?: number | null;
  modoPrecio?: 'unitario' | 'total';
  usaInventario?: boolean;
  itemId?: string | null;
  itemName?: string;
  facturaUrl: string | null;
  facturaType?: 'image' | 'pdf' | null;
  facturaName?: string | null;
  presupuestos?: AcPresupuestoAdjunto[];
  condicionesPago: string;
  notaServicio: string;
  esPreventivoLavado?: boolean;
}

export interface AcUnitCalc extends AcUnit {
  ultimaFecha: string | null;
  proximaFecha: string | null;
  diasTranscurridos: number | null;
  diasRestantes: number | null;
  semaforo: AcSemaforo;
  semaforoLabel: string;
  // Ciclo de Mantenimiento Preventivo (Camión de lavado / soplado frecuente)
  ultimaFechaPrev: string | null;
  proximaFechaPrev: string | null;
  diasTranscurridosPrev: number | null;
  diasRestantesPrev: number | null;
  semaforoPrev: AcSemaforo | 'no_aplica';
  semaforoPrevLabel: string;
  mantenimientosCount: number;
  preventivosCount: number;
  gastoAcumuladoUsd: number;
  ultimoTrabajo: string;
  ultimoSupplierId: string | null;
  historial: AcMaintHistoryEntry[];
}

export const AC_AREAS_SUGERIDAS = [
  'CARBOZULIA',
  'PATIO / ACOPIO',
  'MUELLE',
  'FLOTA PESADA / CAMIONES',
  'MAQUINARIA EN CAMPO',
  'VEHÍCULOS / CAMIONETAS',
  'CONTENEDOR',
  'ROMANA',
  'OFICINA PRINCIPAL',
  'GERENCIA',
  'ADMINISTRACIÓN',
  'CARPA NUEVA',
  'COMEDOR',
  'COCINA',
  'DORMITORIOS',
  'TALLER',
  'ALMACÉN',
  'GARITA',
  'SALA DE REUNIONES',
  'LABORATORIO / CONTROL',
] as const;

export const AC_BTU_OPCIONES = [
  '9.000 BTU',
  '12.000 BTU',
  '18.000 BTU',
  '24.000 BTU',
  '36.000 BTU',
  '48.000 BTU',
  '60.000 BTU (5 TON)',
] as const;

export const AC_CAPACIDAD_MAQUINARIA_OPCIONES = [
  'COMPRESOR 508',
  'COMPRESOR 507',
  'COMPRESOR 709',
  'COMPRESOR 10PA17C',
  'A/A PESADO 24V',
  'A/A AUTOMOTRIZ 12V',
  'CABINA MAQUINARIA',
  'DOBLE EVAPORADOR',
  'ESTÁNDAR CAMIÓN / MAQ',
] as const;

export const AC_TIPOS_EQUIPO: AcTipoEquipo[] = [
  'SPLIT',
  'VENTANA',
  'PISO-TECHO',
  'COMPACTO',
  'PORTATIL',
  'MAQUINARIA',
  'CAMIÓN / ROQUERO',
  'PALA / EXCAVADORA',
  'CAMIONETA / VEHÍCULO',
  'CHUTO / GANDOLA',
];

export function esEquipoMovilAc(tipo?: string | null): boolean {
  const t = String(tipo || '').toUpperCase();
  return (
    t === 'MAQUINARIA' ||
    t === 'CAMIÓN / ROQUERO' ||
    t === 'CAMION / ROQUERO' ||
    t === 'PALA / EXCAVADORA' ||
    t === 'CAMIONETA / VEHÍCULO' ||
    t === 'CAMIONETA / VEHICULO' ||
    t === 'CHUTO / GANDOLA'
  );
}

export const AC_FRECUENCIAS_DIAS = [15, 21, 30, 45, 60, 90] as const;

export const AC_FRECUENCIAS_PREVENTIVO_DIAS = [0, 1, 2, 3, 4, 5, 7, 10, 15] as const;

export const AC_RESPONSABLES_PREVENTIVO = [
  'CAMIÓN DE LAVADO',
  'PERSONAL DE PATIO / TALLER',
  'TÉCNICO DE REFRIGERACIÓN',
] as const;

export const AC_TIPOS_INTERVENCION = [
  'MANTENIMIENTO PREVENTIVO RIGUROSO',
  'MANTENIMIENTO PREVENTIVO (CAMIÓN DE LAVADO)',
  'LIMPIEZA DE FILTROS Y SERPENTÍN',
  'RECARGA DE GAS REFRIGERANTE',
  'REPARACIÓN DE COMPRESOR / MANGUERAS (MAQUINARIA / CAMIÓN)',
  'REPARACIÓN ELÉCTRICA / CAPACITOR',
  'MANTENIMIENTO CORRECTIVO',
  'INSTALACIÓN / REUBICACIÓN',
] as const;

export const AC_CHECKLIST_RIGUROSO = [
  'Lavado por camión de lavado (condensador, radiador y cabina)',
  'Limpieza y soplado de filtros de cabina / panel frontal',
  'Lavado de evaporador (consola interna)',
  'Lavado a presión de condensador (unidad externa)',
  'Destape y soplado de manguera/tubería de drenaje',
  'Revisión de presión de gas refrigerante (PSI)',
  'Revisión de compresor (508 / automotriz), correa y embrague',
  'Revisión de mangueras de alta/baja y sellos (O-rings)',
  'Revisión eléctrica, amperaje, relés y borneras',
  'Limpieza de turbina, soplador (blower) y lubricación',
  'Revisión / cambio de capacitor, filtro secador o válvula',
] as const;

export function esIntervencionPreventivaLavado(tipo?: string | null, detalle?: string | null): boolean {
  const txt = `${tipo || ''} ${detalle || ''}`.toUpperCase();
  return (
    txt.includes('CAMIÓN DE LAVADO') ||
    txt.includes('CAMION DE LAVADO') ||
    txt.includes('LAVADO PREVENTIVO')
  );
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function codigoUnidadAc(num: number): string {
  return `AA-${pad2(num)}`;
}

export function hoyAcISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function sumarDiasAc(iso: string, dias: number): string {
  const [y, m, d] = (iso || hoyAcISO()).split('-').map(Number);
  const dt = new Date(y || 2026, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + (Number(dias) || 0));
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

export function diasEntreAc(desdeISO: string, hastaISO: string): number {
  const parse = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y || 2026, (m || 1) - 1, d || 1).getTime();
  };
  return Math.round((parse(hastaISO) - parse(desdeISO)) / 86400000);
}

export function fmtFechaAc(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Genera o completa las 37 unidades de aire acondicionado de la base (AA-01 a AA-37),
 * preservando intacta cualquier personalización existente.
 */
export function generar37UnidadesBase(existentes: AcUnit[] = []): AcUnit[] {
  const mapa = new Map<string, AcUnit>();
  for (const u of existentes) {
    if (u && u.code) {
      mapa.set(u.code.toUpperCase(), {
        ...u,
        id: u.id || u.code.toUpperCase(),
        code: u.code.toUpperCase(),
        freq_days: Number(u.freq_days) > 0 ? Number(u.freq_days) : 30,
        freq_prev_days: Number(u.freq_prev_days) > 0 ? Number(u.freq_prev_days) : null,
        prev_responsable: u.prev_responsable || 'CAMIÓN DE LAVADO',
        placa: u.placa ? String(u.placa).trim().toUpperCase() : '',
        machinery_id: u.machinery_id || null,
        estado_operativo: u.estado_operativo || 'operativo',
        last_prev_manual: u.last_prev_manual || null,
        active: u.active !== false,
      });
    }
  }

  for (let i = 1; i <= TOTAL_UNIDADES_BASE; i++) {
    const code = codigoUnidadAc(i);
    if (!mapa.has(code)) {
      mapa.set(code, {
        id: code,
        code,
        name: `UNIDAD ${code}`,
        area: 'BASE GENERAL',
        tipo_equipo: 'SPLIT',
        btu: '18.000 BTU',
        marca: '',
        serial: '',
        placa: '',
        machinery_id: null,
        company_id: null,
        freq_days: 30,
        freq_prev_days: null,
        prev_responsable: 'CAMIÓN DE LAVADO',
        estado_operativo: 'operativo',
        last_maint_manual: null,
        last_prev_manual: null,
        notes: '',
        active: true,
      });
    }
  }

  return Array.from(mapa.values()).sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

/**
 * Extrae el catálogo de unidades desde el registro maestro en `servicios`
 * (código `AC-CATALOG-MASTER`).
 */
export function extraerCatalogoAiresDeServicios(servicios: ServicioRecord[]): AcUnit[] {
  const master = (servicios || []).find((s) => s.code === AC_MASTER_CODE);
  if (!master || !Array.isArray(master.items)) {
    return [];
  }
  const guardadas: AcUnit[] = [];
  for (const raw of master.items as any[]) {
    if (raw && typeof raw.code === 'string' && raw.code.trim()) {
      const freqPrev = Number(raw.freq_prev_days);
      guardadas.push({
        id: String(raw.id || raw.code).toUpperCase(),
        code: String(raw.code).toUpperCase(),
        name: String(raw.name || `UNIDAD ${raw.code}`).trim(),
        area: String(raw.area || 'BASE GENERAL').trim(),
        tipo_equipo: (raw.tipo_equipo as AcTipoEquipo) || 'SPLIT',
        btu: String(raw.btu || '18.000 BTU').trim(),
        marca: String(raw.marca || '').trim(),
        serial: String(raw.serial || '').trim(),
        placa: String(raw.placa || '').trim().toUpperCase(),
        machinery_id: raw.machinery_id || null,
        company_id: raw.company_id || null,
        freq_days: Number(raw.freq_days) > 0 ? Number(raw.freq_days) : 30,
        freq_prev_days: Number.isFinite(freqPrev) && freqPrev > 0 ? freqPrev : null,
        prev_responsable: String(raw.prev_responsable || 'CAMIÓN DE LAVADO').trim().toUpperCase(),
        estado_operativo: (raw.estado_operativo as AcEstadoOperativo) || 'operativo',
        last_maint_manual: raw.last_maint_manual || null,
        last_prev_manual: raw.last_prev_manual || null,
        notes: String(raw.notes || '').trim(),
        active: raw.active !== false,
      });
    }
  }
  return guardadas.sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

/**
 * Empaqueta la lista de unidades `AcUnit[]` como items JSONB compatibles con `public.servicios`
 * (con `usa_inventario: false` para que el trigger de inventario lo ignore por completo).
 */
export function serializarCatalogoAiresParaServicios(unidades: AcUnit[]): any[] {
  return unidades.map((u) => ({
    ...u,
    categoria: 'CATALOGO_SISTEMA_AC',
    tipo: u.tipo_equipo,
    machine_label: `${u.code}${u.placa ? ` [PLACA: ${u.placa}]` : ''} · ${u.area} · ${u.btu}`,
    qty: 0,
    price: 0,
    usa_inventario: false,
    item_id: null,
    item_name: '',
    detalle: u.notes || '',
  }));
}

function extraerCondicionesInterna(nota?: string | null): string {
  if (!nota) return '';
  const m = String(nota).match(/\[CONDICIONES_PAGO:\s*([^\]]*)\]/i);
  return m && m[1] ? m[1].trim() : '';
}

function extraerIvaInterna(nota?: string | null): number | null {
  if (!nota) return null;
  const m = String(nota).match(/\[IVA_CUENTA:\s*(\d+(?:[.,]\d+)?)\s*\]/i);
  if (!m || !m[1]) return null;
  const val = Number(m[1].replace(',', '.'));
  return Number.isFinite(val) && val >= 0 ? val : null;
}

export function extraerPresupuestosDeServicioAc(
  s?: ServicioRecord | null,
  it?: (ServicioItem & Record<string, any>) | null,
): AcPresupuestoAdjunto[] {
  const out: AcPresupuestoAdjunto[] = [];
  const seen = new Set<string>();
  const pushItem = (raw: any, fallbackIdx: number) => {
    if (!raw || !raw.url) return;
    const url = String(raw.url).trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    const isPdf = raw.kind === 'pdf' || raw.tipo === 'pdf' || /\.pdf($|\?)/i.test(url);
    out.push({
      id: String(raw.id || `pres-${fallbackIdx}`),
      url,
      kind: isPdf ? 'pdf' : 'image',
      name: String(raw.name || raw.nombre || (isPdf ? 'Presupuesto.pdf' : 'Presupuesto')).trim(),
    });
  };

  if (it && Array.isArray(it.ac_presupuestos)) {
    it.ac_presupuestos.forEach((p: any, i: number) => pushItem(p, i));
  }

  const nota = s?.note || '';
  const m = String(nota).match(/\[\[FORMATOS_ADJUNTOS:([\s\S]*?):FIN_FORMATOS\]\]/);
  if (m && m[1]) {
    try {
      const parsed = JSON.parse(m[1]);
      if (Array.isArray(parsed)) {
        parsed.forEach((p: any, i: number) => pushItem(p, i + 100));
      }
    } catch {}
  }

  if (s?.factura_url) {
    pushItem(
      {
        id: `srv-fac-${s.id || '0'}`,
        url: s.factura_url,
        kind: (s as any).factura_type === 'pdf' || /\.pdf($|\?)/i.test(s.factura_url) ? 'pdf' : 'image',
        name: (s as any).factura_name || 'Presupuesto / Factura',
      },
      999,
    );
  }

  return out;
}

export function separarDetalleLibreDeChecklist(detalle?: string | null, checklist?: string[] | null): string {
  const raw = String(detalle || '').trim();
  if (!raw) return '';
  if (Array.isArray(checklist) && checklist.length > 0) {
    const pref = `[${checklist.join(', ')}]`;
    if (raw.startsWith(pref)) {
      return raw.slice(pref.length).replace(/^\s*·\s*/, '').trim();
    }
  }
  return raw.replace(/^\[[^\]]*\]\s*(?:·\s*)?/, '').trim();
}

export function limpiarNotaInterna(nota?: string | null): string {
  if (!nota) return '';
  return String(nota)
    .replace(/\[CONDICIONES_PAGO:[^\]]*\]/gi, '')
    .replace(/\[IVA_CUENTA:[^\]]*\]/gi, '')
    .replace(/\[EMPRESA:[^\]]*\]/gi, '')
    .replace(/\[PRESUPUESTO_CUENTA:[^\]]*\]/gi, '')
    .replace(/\[APROBADO_CXP:[^\]]*\]/gi, '')
    .replace(/\[ENVIADO_CXP:[^\]]*\]/gi, '')
    .replace(/\[\[FORMATOS_ADJUNTOS:[\s\S]*?:FIN_FORMATOS\]\]/gi, '')
    .replace(/\[\[HISTORIAL_COMPRA:[\s\S]*?:FIN_HISTORIAL\]\]/gi, '')
    .trim();
}

/**
 * ¿El renglón de `servicios` es un mantenimiento de AIRE? (31-oct-2026)
 * Solo cuentan los que se registraron desde este módulo: categoría de aires o
 * con el código de la unidad guardado. Un servicio de taller de la MISMA máquina
 * (p. ej. reparación del gato hidráulico) NO es un mantenimiento del aire.
 */
export function esRenglonDeAire(item: (ServicioItem & Record<string, any>) | null | undefined): boolean {
  if (!item) return false;
  if (String(item.ac_unit_code || '').trim() || String(item.ac_unit_id || '').trim()) return true;
  return String(item.categoria || '').trim().toUpperCase() === AC_CATEGORIA_SERVICIO;
}

/**
 * Determina si un renglón de `servicios` corresponde a una unidad `AcUnit`
 *
 * 31-oct-2026: antes cruzaba CUALQUIER servicio por la máquina vinculada o por
 * el código dentro de la etiqueta («JUMBO 320 · …»), y el historial de un aire
 * recién creado se llenaba con los servicios de taller de esa máquina. Ahora:
 *  - renglón que no es de aires → nunca;
 *  - renglón con código de unidad → solo si es ESE código (exacto);
 *  - renglón viejo de aires sin código → por máquina o por el código en el texto.
 */
export function itemCorrespondeAUnidadAc(item: ServicioItem & Record<string, any>, unit: AcUnit): boolean {
  if (!esRenglonDeAire(item)) return false;
  const codeUpper = unit.code.toUpperCase();
  const idItem = String(item.ac_unit_id || '').trim().toUpperCase();
  const codeItem = String(item.ac_unit_code || '').trim().toUpperCase();
  if (idItem || codeItem) return idItem === codeUpper || codeItem === codeUpper;
  if (unit.machinery_id && item.machinery_id && String(item.machinery_id) === String(unit.machinery_id)) return true;
  const labelUpper = String(item.machine_label || '').toUpperCase();
  const detUpper = String(item.detalle || '').toUpperCase();
  const regex = new RegExp(`\\b${codeUpper.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\\-/g, '[-\\s]?')}\\b`, 'i');
  return regex.test(labelUpper) || regex.test(detUpper);
}

/**
 * Cruza las unidades con todos los servicios registrados y calcula tanto el
 * Semáforo Riguroso como el Semáforo Preventivo (Camión de Lavado).
 */
export function calcularSemaforoAires(
  unidades: AcUnit[],
  servicios: ServicioRecord[],
  hoyISO: string = hoyAcISO(),
): AcUnitCalc[] {
  const reales = (servicios || []).filter((s) => s.code !== AC_MASTER_CODE);

  return unidades.map((u) => {
    const historial: AcMaintHistoryEntry[] = [];

    for (const s of reales) {
      const fechaSrv = String(s.service_date || '').slice(0, 10);
      const items = Array.isArray(s.items) ? s.items : [];
      for (const rawIt of items) {
        const it = rawIt as ServicioItem & Record<string, any>;
        if (itemCorrespondeAUnidadAc(it, u)) {
          const costoLinea = (Number(it.qty) || 1) * (Number(it.price) || 0);
          const checklist = Array.isArray(it.ac_checklist) ? it.ac_checklist : [];
          const tipoStr = it.tipo || 'MANTENIMIENTO PREVENTIVO RIGUROSO';
          const detStr = it.detalle || '';
          const detLibre =
            typeof it.ac_detalle_libre === 'string'
              ? it.ac_detalle_libre
              : separarDetalleLibreDeChecklist(detStr, checklist);
          const ivaTag = extraerIvaInterna(s.note);
          const alicuotaIva =
            typeof it.ac_alicuota_iva === 'number'
              ? it.ac_alicuota_iva
              : ivaTag != null
                ? ivaTag
                : 16;
          const ivaModo: AcModoIva =
            it.ac_iva_modo === 'mas_iva' || it.ac_iva_modo === 'exento' || it.ac_iva_modo === 'incluye_iva'
              ? it.ac_iva_modo
              : alicuotaIva === 0
                ? 'exento'
                : 'incluye_iva';
          const subtotalUsd =
            typeof it.ac_subtotal_usd === 'number' && Number.isFinite(it.ac_subtotal_usd)
              ? it.ac_subtotal_usd
              : alicuotaIva > 0
                ? Math.round((costoLinea / (1 + alicuotaIva / 100)) * 100) / 100
                : costoLinea;
          const ivaUsd =
            typeof it.ac_iva_usd === 'number' && Number.isFinite(it.ac_iva_usd)
              ? it.ac_iva_usd
              : Math.round(Math.max(0, costoLinea - subtotalUsd) * 100) / 100;
          const presupuestos = extraerPresupuestosDeServicioAc(s, it);

          historial.push({
            servicioId: s.id,
            servicioCode: s.code,
            fecha: fechaSrv,
            supplierId: s.supplier_id,
            companyId: s.company_id,
            tipo: tipoStr,
            detalle: detStr,
            detalleLibre: detLibre,
            checklist,
            costoUsd: costoLinea,
            totalServicioUsd: Number(s.total) || costoLinea,
            ivaModo,
            alicuotaIva,
            subtotalUsd,
            ivaUsd,
            monedaCaptura: it.ac_moneda === 'VES' ? 'VES' : 'USD',
            tasaBcv: typeof it.ac_tasa_bcv === 'number' ? it.ac_tasa_bcv : null,
            modoPrecio: it.ac_modo_precio === 'total' ? 'total' : 'unitario',
            usaInventario: Boolean(it.usa_inventario),
            itemId: it.item_id || null,
            itemName: it.item_name || '',
            facturaUrl: s.factura_url || presupuestos[0]?.url || null,
            facturaType: (s as any).factura_type || presupuestos[0]?.kind || null,
            facturaName: (s as any).factura_name || presupuestos[0]?.name || null,
            presupuestos,
            condicionesPago: extraerCondicionesInterna(s.note),
            notaServicio: limpiarNotaInterna(s.note),
            esPreventivoLavado: Boolean(it.ac_es_preventivo_lavado) || esIntervencionPreventivaLavado(tipoStr, detStr),
          });
        }
      }
    }

    historial.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));

    // Historial riguroso (excluye lavados rápidos de camión de lavado, salvo que no tenga ciclo preventivo)
    const tieneCicloPrev = Number(u.freq_prev_days) > 0;
    const histRiguroso = tieneCicloPrev ? historial.filter((h) => !h.esPreventivoLavado) : historial;
    const ultHistRig = histRiguroso[0] || null;
    const ultHistAny = historial[0] || null;

    let ultimaFecha: string | null = ultHistRig?.fecha || null;
    if (u.last_maint_manual && (!ultimaFecha || u.last_maint_manual > ultimaFecha)) {
      ultimaFecha = u.last_maint_manual;
    }

    const freq = Number(u.freq_days) > 0 ? Number(u.freq_days) : 30;
    let proximaFecha: string | null = null;
    let diasTranscurridos: number | null = null;
    let diasRestantes: number | null = null;
    let semaforo: AcSemaforo = 'sin_registro';
    let semaforoLabel = '⚪ Sin registro';

    if (ultimaFecha && /^\d{4}-\d{2}-\d{2}$/.test(ultimaFecha)) {
      proximaFecha = sumarDiasAc(ultimaFecha, freq);
      diasTranscurridos = diasEntreAc(ultimaFecha, hoyISO);
      diasRestantes = diasEntreAc(hoyISO, proximaFecha);
      const umbralProximo = Math.max(5, Math.round(freq * 0.2));

      if (diasRestantes < 0) {
        semaforo = 'vencido';
        semaforoLabel = `🔴 Vencido (${Math.abs(diasRestantes)}d)`;
      } else if (diasRestantes <= umbralProximo) {
        semaforo = 'proximo';
        semaforoLabel = diasRestantes === 0 ? '🟠 Toca HOY' : `🟠 En ${diasRestantes}d`;
      } else {
        semaforo = 'al_dia';
        semaforoLabel = `🟢 Al día (${diasRestantes}d)`;
      }
    }

    // Cálculo del ciclo Preventivo (Camión de Lavado, ej. cada 2 días)
    const freqPrev = Number(u.freq_prev_days) > 0 ? Number(u.freq_prev_days) : 0;
    let ultimaFechaPrev: string | null = null;
    let proximaFechaPrev: string | null = null;
    let diasTranscurridosPrev: number | null = null;
    let diasRestantesPrev: number | null = null;
    let semaforoPrev: AcSemaforo | 'no_aplica' = 'no_aplica';
    let semaforoPrevLabel = '—';

    if (freqPrev > 0) {
      // Cualquier intervención (lavado preventivo o mantenimiento riguroso) cuenta como lavado
      const candidatosPrev = [
        ultHistAny?.fecha || null,
        u.last_prev_manual || null,
        u.last_maint_manual || null,
      ].filter((f): f is string => Boolean(f && /^\d{4}-\d{2}-\d{2}$/.test(f)));
      candidatosPrev.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
      ultimaFechaPrev = candidatosPrev[0] || null;

      if (ultimaFechaPrev) {
        proximaFechaPrev = sumarDiasAc(ultimaFechaPrev, freqPrev);
        diasTranscurridosPrev = diasEntreAc(ultimaFechaPrev, hoyISO);
        diasRestantesPrev = diasEntreAc(hoyISO, proximaFechaPrev);
        const umbralPrev = freqPrev <= 3 ? 0 : Math.max(1, Math.round(freqPrev * 0.25));

        if (diasRestantesPrev < 0) {
          semaforoPrev = 'vencido';
          semaforoPrevLabel = `🔴 Lavado vencido (${Math.abs(diasRestantesPrev)}d)`;
        } else if (diasRestantesPrev <= umbralPrev) {
          semaforoPrev = 'proximo';
          semaforoPrevLabel = diasRestantesPrev === 0 ? '🟠 Lavado HOY' : `🟠 Lavado en ${diasRestantesPrev}d`;
        } else {
          semaforoPrev = 'al_dia';
          semaforoPrevLabel = `🟢 Lavado al día (${diasRestantesPrev}d)`;
        }
      } else {
        semaforoPrev = 'sin_registro';
        semaforoPrevLabel = '⚪ Sin lavado reg.';
      }
    }

    // Si el equipo está marcado como dañado, resaltar en prioridad vencido/urgente
    if (u.estado_operativo === 'dañado') {
      semaforo = 'vencido';
      semaforoLabel = '🔴 Dañado / Urgente';
    }

    const gastoAcumuladoUsd = historial.reduce((acc, h) => acc + (Number(h.costoUsd) || 0), 0);
    const preventivosCount = historial.filter((h) => h.esPreventivoLavado).length;

    return {
      ...u,
      ultimaFecha,
      proximaFecha,
      diasTranscurridos,
      diasRestantes,
      semaforo,
      semaforoLabel,
      ultimaFechaPrev,
      proximaFechaPrev,
      diasTranscurridosPrev,
      diasRestantesPrev,
      semaforoPrev,
      semaforoPrevLabel,
      mantenimientosCount: historial.length,
      preventivosCount,
      gastoAcumuladoUsd,
      ultimoTrabajo: ultHistAny
        ? ultHistAny.tipo || ultHistAny.detalle || 'Mantenimiento'
        : u.last_maint_manual
          ? 'Registro base manual'
          : '—',
      ultimoSupplierId: ultHistAny?.supplierId ?? null,
      historial,
    };
  });
}

const esc = (s: any) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const money = (n: number) =>
  `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const CSS_PDF_AIRES = `
  .ac-kpis{display:flex;gap:8px;margin:4px 0 12px}
  .ac-kpi{flex:1;border:1px solid #CBD5E1;border-top:3px solid #1E3A5F;border-radius:6px;padding:8px 6px;text-align:center;background:#F8FAFC}
  .ac-kpi .v{font-size:16px;font-weight:900;color:#1E3A5F}
  .ac-kpi .t{font-size:8.5px;font-weight:800;color:#475569;margin-top:3px;letter-spacing:.3px}
  .ac-sec{font-size:12px;font-weight:800;color:#1E3A5F;margin:12px 0 6px;text-transform:uppercase;letter-spacing:.4px}
  table.ac{width:100%;border-collapse:collapse;font-size:8.5px;margin-bottom:10px}
  table.ac th{background:#1E3A5F;color:#fff;padding:5px 6px;text-align:left;font-size:8px}
  table.ac td{border:1px solid #CBD5E1;padding:4px 6px;vertical-align:top}
  table.ac td.c,table.ac th.c{text-align:center}
  table.ac td.r,table.ac th.r{text-align:right;white-space:nowrap}
  tr.ac-venc td{background:#FEF2F2}
  tr.ac-prox td{background:#FFFBEB}
  .st-al_dia{color:#15803D;font-weight:800}
  .st-proximo{color:#B45309;font-weight:800}
  .st-vencido{color:#B91C1C;font-weight:800}
  .st-sin_registro{color:#64748B;font-weight:700}
`;

export function reporteAiresHtml(args: {
  unidades: AcUnitCalc[];
  hoyISO: string;
  filtroLabel?: string;
  supplierNameOf: (id: string | null) => string;
  companyNameOf: (id: string | null) => string;
}): string {
  const { unidades, hoyISO, filtroLabel, supplierNameOf, companyNameOf } = args;
  const nTotal = unidades.length;
  const nAlDia = unidades.filter((u) => u.semaforo === 'al_dia').length;
  const nProximo = unidades.filter((u) => u.semaforo === 'proximo').length;
  const nVencido = unidades.filter((u) => u.semaforo === 'vencido').length;
  const nSinReg = unidades.filter((u) => u.semaforo === 'sin_registro').length;
  const gastoTotal = unidades.reduce((s, u) => s + (u.gastoAcumuladoUsd || 0), 0);

  const filasUnidades = unidades
    .map((u) => {
      const rowCls = u.semaforo === 'vencido' ? ' class="ac-venc"' : u.semaforo === 'proximo' ? ' class="ac-prox"' : '';
      const placaHtml = u.placa ? `<br/><span style="color:#0369A1;font-weight:800">Placa: ${esc(u.placa)}</span>` : '';
      const prevHtml =
        u.freq_prev_days && u.freq_prev_days > 0
          ? `Cada ${u.freq_prev_days}d (${esc(u.prev_responsable || 'CAMIÓN DE LAVADO')})<br/>Últ: ${esc(fmtFechaAc(u.ultimaFechaPrev))} · Próx: ${esc(fmtFechaAc(u.proximaFechaPrev))}<br/><span class="st-${u.semaforoPrev}">${esc(u.semaforoPrevLabel)}</span>`
          : '—';
      return `<tr${rowCls}>
        <td class="c"><b>${esc(u.code)}</b>${placaHtml}</td>
        <td><b>${esc(u.area)}</b>${u.name && u.name !== `UNIDAD ${u.code}` ? `<br/><span style="color:#475569">${esc(u.name)}</span>` : ''}</td>
        <td>${esc(u.tipo_equipo)} · ${esc(u.btu)}${u.marca ? ` · ${esc(u.marca)}` : ''}</td>
        <td>${esc(u.company_id ? companyNameOf(u.company_id) : '—')}</td>
        <td class="c">Cada ${u.freq_days}d<br/>Últ: ${esc(fmtFechaAc(u.ultimaFecha))}<br/>Próx: ${esc(fmtFechaAc(u.proximaFecha))}</td>
        <td class="c">${prevHtml}</td>
        <td class="c st-${u.semaforo}">${esc(u.semaforoLabel)}</td>
        <td>${esc(u.ultimoTrabajo)}${u.ultimoSupplierId ? `<br/><span style="color:#64748B">🏭 ${esc(supplierNameOf(u.ultimoSupplierId))}</span>` : ''}</td>
        <td class="r">${u.gastoAcumuladoUsd > 0 ? esc(money(u.gastoAcumuladoUsd)) : '—'}</td>
      </tr>`;
    })
    .join('');

  const body = `
    <div class="ac-kpis">
      <div class="ac-kpi"><div class="v">${nTotal}</div><div class="t">UNIDADES EN CONTROL</div></div>
      <div class="ac-kpi"><div class="v" style="color:#15803D">${nAlDia}</div><div class="t">🟢 AL DÍA</div></div>
      <div class="ac-kpi"><div class="v" style="color:#B45309">${nProximo}</div><div class="t">🟠 PRÓXIMOS</div></div>
      <div class="ac-kpi"><div class="v" style="color:#B91C1C">${nVencido}</div><div class="t">🔴 VENCIDOS / URGENTES</div></div>
      <div class="ac-kpi"><div class="v" style="color:#64748B">${nSinReg}</div><div class="t">⚪ SIN REGISTRO</div></div>
      <div class="ac-kpi"><div class="v">${esc(money(gastoTotal))}</div><div class="t">INVERSIÓN ACUMULADA</div></div>
    </div>

    <div class="ac-sec">Semáforo Riguroso y Preventivo de Unidades de Aire Acondicionado${filtroLabel ? ` (${esc(filtroLabel)})` : ''}</div>
    <table class="ac">
      <thead>
        <tr>
          <th class="c">Código / Placa</th>
          <th>Área / Referencia</th>
          <th>Tipo / Capacidad / Compresor</th>
          <th>Empresa</th>
          <th class="c">Ciclo Riguroso</th>
          <th class="c">Ciclo Preventivo (Lavado)</th>
          <th class="c">Semáforo</th>
          <th>Última Intervención</th>
          <th class="r">Acumulado</th>
        </tr>
      </thead>
      <tbody>
        ${filasUnidades || '<tr><td colspan="9" class="c">Sin unidades para este filtro.</td></tr>'}
      </tbody>
    </table>
  `;

  return pdfDocument({
    title: 'CONTROL RIGUROSO DE MANTENIMIENTO DE AIRES ACONDICIONADOS',
    subtitle: `Situación al ${fmtFechaAc(hoyISO)}${filtroLabel ? ` · ${filtroLabel}` : ''}`,
    extraCss: CSS_PDF_AIRES,
    body,
  });
}

// ── 31-oct-2026: crear un aire nuevo NUNCA pisa a otro ─────────────────────────
// La ficha se guardaba con «si el código ya existe, reemplázalo». Al vincular un
// aire a una máquina el código se copia de la máquina, así que el segundo aire de
// esa máquina (o uno con el mismo código) reemplazaba la ficha del primero.
export type ResultadoFichaAc = { ok: true; unidades: AcUnit[] } | { ok: false; error: string };

export function aplicarFichaUnidadAc(
  base: AcUnit[],
  unidad: AcUnit,
  codigoOriginal: string | null,
  historialOriginal = 0,
): ResultadoFichaAc {
  const code = String(unidad.code || '').trim().toUpperCase();
  if (!code) return { ok: false, error: 'El código de la unidad es obligatorio.' };
  const lista = Array.isArray(base) ? base : [];
  const existe = (c: string) => lista.some((u) => String(u.code || '').toUpperCase() === c);

  // Unidad NUEVA: el código no puede estar ocupado.
  if (!codigoOriginal) {
    if (existe(code)) {
      return {
        ok: false,
        error: `Ya existe un aire con el código ${code}. Ponle otro código (por ejemplo ${code}-2) para no reemplazar al que ya está.`,
      };
    }
    return { ok: true, unidades: [...lista, { ...unidad, id: code, code }] };
  }

  // EDICIÓN: se reemplaza solo la ficha que se abrió.
  const orig = codigoOriginal.trim().toUpperCase();
  if (!existe(orig)) {
    return { ok: false, error: `La unidad ${orig} ya no está en la lista (otra persona la eliminó). Recarga la pantalla.` };
  }
  if (code !== orig) {
    if (existe(code)) {
      return { ok: false, error: `Ya existe otro aire con el código ${code}. Elige un código distinto.` };
    }
    if (historialOriginal > 0) {
      return {
        ok: false,
        error: `${orig} tiene mantenimientos registrados y su historial va enlazado por el código: no se puede cambiar el código.`,
      };
    }
  }
  return {
    ok: true,
    unidades: lista.map((u) => (String(u.code || '').toUpperCase() === orig ? { ...unidad, id: code, code } : u)),
  };
}

// ── 31-oct-2026: ¿esta cuenta por pagar es la de ESE mantenimiento? ────────────
// Antes bastaba con que el concepto «contuviera» el código; ahora el código debe
// estar completo (SRV-0003 no es la cuenta de SRV-00031).
export function cuentaEsDelServicioAc(
  c: { tipo?: string | null; documento?: string | null; concepto?: string | null } | null | undefined,
  srvCode: string | null | undefined,
): boolean {
  const code = String(srvCode || '').trim().toUpperCase();
  if (!c || !code || c.tipo !== 'por_pagar') return false;
  if (String(c.documento || '').trim().toUpperCase() === code) return true;
  const esc = code.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  return new RegExp(`(^|[^A-Z0-9-])${esc}($|[^A-Z0-9-])`).test(String(c.concepto || '').toUpperCase());
}

// ── 31-oct-2026: solo se abren adjuntos del Storage del proyecto ────────────────
// La vista previa ponía la URL guardada directo en un <iframe>, window.open y
// Linking.openURL. Una URL «javascript:», «data:» o de otro sitio no se abre.
export function urlAdjuntoAcSegura(url: string | null | undefined, supabaseUrl?: string | null): string | null {
  const raw = String(url || '').trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  let hostPermitido = '';
  try {
    hostPermitido = supabaseUrl ? new URL(String(supabaseUrl)).host.toLowerCase() : '';
  } catch {
    hostPermitido = '';
  }
  if (hostPermitido) return u.host.toLowerCase() === hostPermitido ? u.toString() : null;
  // Sin la URL del proyecto a mano, al menos exigimos https.
  return u.protocol === 'https:' ? u.toString() : null;
}
