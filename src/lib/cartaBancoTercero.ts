// CARTA DE AUTORIZACIÓN PARA PAGO DE NÓMINA EN CUENTA BANCARIA DE TERCERO (13-nov-2026)
//
// Lógica pura (sin red ni dependencias de React Native) para:
// 1. Detectar cuándo la cuenta bancaria de un empleado pertenece a un tercero
//    (porque se marcó explícitamente o porque el titular / cédula del titular difiere del trabajador).
// 2. Normalizar y serializar los datos de la autorización (`CartaBancoTerceroData`) y sus soportes
//    (fotos o PDFs de la carta firmada, copia de cédula del titular, firmas digitales, etc.).
// 3. Generar el HTML imprimible (PDF tamaño Carta) con membrete seleccionable, interruptores
//    de «qué sale y qué se oculta», recuadro de huella dactilar y cláusulas de liberación de pago.

import { MEMBRETES_CONSTANCIA, MEMBRETE_POR_DEFECTO, MembreteConstancia } from './constancia';
import { norm, onlyDigits } from './text';

export const PREFIX_CARTA_BANCO_TERCERO = '__carta_banco_tercero__:';

export const BANCOS_VE_LIST: readonly string[] = [
  '0102 - BANCO DE VENEZUELA',
  '0104 - VENEZOLANO DE CRÉDITO',
  '0105 - MERCANTIL',
  '0108 - BBVA PROVINCIAL',
  '0114 - BANCARIBE',
  '0115 - BANCO EXTERIOR',
  '0128 - BANCO CARONÍ',
  '0134 - BANESCO',
  '0137 - SOFITASA',
  '0138 - BANCO PLAZA',
  '0146 - BANGENTE',
  '0151 - BFC BANCO FONDO COMÚN',
  '0156 - 100% BANCO',
  '0157 - DELSUR',
  '0163 - BANCO DEL TESORO',
  '0166 - BANCO AGRÍCOLA DE VENEZUELA',
  '0168 - BANCRECER',
  '0169 - MI BANCO',
  '0171 - BANCO ACTIVO',
  '0172 - BANCAMIGA',
  '0173 - BANCO INTERNACIONAL DE DESARROLLO',
  '0174 - BANPLUS',
  '0175 - BANCO BICENTENARIO',
  '0177 - BANFANB',
  '0178 - N58 BANCO DIGITAL',
  '0191 - BANCO NACIONAL DE CRÉDITO (BNC)',
];

export type TipoCuentaTercero = 'corriente' | 'ahorro' | 'pago_movil' | 'ambos';

export const TIPOS_CUENTA_TERCERO: readonly { key: TipoCuentaTercero; label: string; shortLabel: string }[] = [
  { key: 'corriente', label: '🏦 Cuenta Corriente', shortLabel: 'Corriente' },
  { key: 'ahorro', label: '🐷 Cuenta de Ahorro', shortLabel: 'Ahorro' },
  { key: 'pago_movil', label: '📲 Solo Pago Móvil', shortLabel: 'Pago Móvil' },
  { key: 'ambos', label: '🏦+📲 Cuenta + Pago Móvil', shortLabel: 'Cuenta y Pago Móvil' },
];

export const PARENTESCOS_TERCERO: readonly string[] = [
  'Esposo(a) / Concubino(a)',
  'Madre / Padre',
  'Hijo(a)',
  'Hermano(a)',
  'Abuelo(a) / Nieto(a)',
  'Tío(a) / Sobrino(a)',
  'Primo(a) / Familiar',
  'Compañero(a) de trabajo',
  'Otro tercero autorizado',
];

export const MOTIVOS_AUTORIZACION_TERCERO: readonly string[] = [
  'No poseer cuenta bancaria propia activa al momento del pago',
  'Cuenta bancaria propia bloqueada, vencida o en trámite de apertura',
  'Pérdida, deterioro o extravío de tarjeta / credenciales bancarias',
  'Facilidad de cobro familiar autorizada expresamente por el trabajador',
];

export const MOTIVO_AUTORIZACION_DEFECTO = MOTIVOS_AUTORIZACION_TERCERO[0];

export type SoporteCartaBancoTercero = {
  id: string;
  url: string;
  nombre: string;
  tipo: 'image' | 'pdf';
  fecha: string;
  subidoPor?: string | null;
};

export type CartaBancoTerceroData = {
  esTercero: boolean;
  codigo?: string | null;
  fechaAutorizacion?: string | null; // YYYY-MM-DD
  lugar?: string | null;
  membreteKey?: string | null;
  bancoNombre: string;
  numeroCuenta: string;
  tipoCuenta: TipoCuentaTercero;
  titularNombre: string;
  titularCedula: string;
  titularTelefono?: string | null;
  parentesco: string;
  pagoMovilBanco?: string | null;
  pagoMovilTelefono?: string | null;
  pagoMovilCedula?: string | null;
  motivo: string;
  observaciones?: string | null;
  testigoNombre?: string | null;
  testigoCedula?: string | null;
  autorizadoEnRrhhPor?: string | null;
  firmaTrabajadorUrl?: string | null;
  firmaTerceroUrl?: string | null;
  soportes: SoporteCartaBancoTercero[];
  updatedAt?: string | null;
  updatedBy?: string | null;
};

export type OpcionesCartaBancoTercero = {
  mostrarLogo: boolean;
  mostrarCargoYDepartamento: boolean;
  mostrarFechaIngreso: boolean;
  mostrarSalario: boolean;
  mostrarPagoMovil: boolean;
  mostrarClausulaLiberacion: boolean;
  mostrarRecuadroHuella: boolean;
  mostrarFirmaTercero: boolean;
  mostrarTestigo: boolean;
  mostrarRecepcionRrhh: boolean;
  mostrarSoportesAdjuntos: boolean;
  modoPlanillaEnBlanco: boolean;
};

export const OPCIONES_CARTA_BANCO_TERCERO_DEFECTO: OpcionesCartaBancoTercero = {
  mostrarLogo: true,
  mostrarCargoYDepartamento: true,
  mostrarFechaIngreso: true,
  mostrarSalario: false,
  mostrarPagoMovil: true,
  mostrarClausulaLiberacion: true,
  mostrarRecuadroHuella: true,
  mostrarFirmaTercero: true,
  mostrarTestigo: true,
  mostrarRecepcionRrhh: true,
  mostrarSoportesAdjuntos: false,
  modoPlanillaEnBlanco: false,
};

export type MapaCartasBancoTercero = Record<string, CartaBancoTerceroData>;

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export function escHtmlCarta(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fechaLargaCarta(iso?: string | null): string {
  if (!iso) return '';
  const limpio = String(iso).trim().slice(0, 10);
  const [y, m, d] = limpio.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d || m < 1 || m > 12) return '';
  return `${d} de ${MESES[m - 1]} de ${y}`;
}

function hoyLargo(): string {
  const d = new Date();
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

function selloImpresion(): string {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const fecha = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
  let h = d.getHours();
  const ampm = h < 12 ? 'a. m.' : 'p. m.';
  h = h % 12 || 12;
  return `${fecha}, ${p2(h)}:${p2(d.getMinutes())} ${ampm}`;
}

/** Genera un código único legible para la carta de autorización bancaria. */
export function generarCodigoCartaBancoTercero(cedula?: string | null, fechaIso?: string | null): string {
  const f = (fechaIso ? String(fechaIso).slice(0, 10) : new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  const dig = onlyDigits(String(cedula ?? '')).slice(-4) || String(Math.floor(1000 + Math.random() * 9000));
  return `AUT-BCO-${f}-${dig}`;
}

export function normalizarTipoCuentaTercero(raw?: unknown): TipoCuentaTercero {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'ahorro' || s.includes('ahorr')) return 'ahorro';
  if (s === 'pago_movil' || s.includes('movil') || s.includes('móvil')) return 'pago_movil';
  if (s === 'ambos' || s.includes('ambos')) return 'ambos';
  return 'corriente';
}

export function etiquetaTipoCuentaTercero(tipo?: TipoCuentaTercero | string | null): string {
  const normTipo = normalizarTipoCuentaTercero(tipo);
  return TIPOS_CUENTA_TERCERO.find((t) => t.key === normTipo)?.shortLabel ?? 'Corriente';
}

export function limpiarSoportesCarta(raw: unknown): SoporteCartaBancoTercero[] {
  if (!Array.isArray(raw)) return [];
  const out: SoporteCartaBancoTercero[] = [];
  const vistos = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i];
    if (!it || typeof it !== 'object') continue;
    const url = String((it as any).url ?? '').trim();
    if (!url || vistos.has(url)) continue;
    vistos.add(url);
    const tipoRaw = String((it as any).tipo ?? (it as any).kind ?? '').toLowerCase();
    const esPdf = tipoRaw === 'pdf' || /\.pdf(\?|$)/i.test(url);
    out.push({
      id: String((it as any).id || `sop_${i}_${Date.now()}`),
      url,
      nombre: String((it as any).nombre ?? (it as any).name ?? (esPdf ? `Carta_firmada_${i + 1}.pdf` : `Soporte_${i + 1}.jpg`)).trim(),
      tipo: esPdf ? 'pdf' : 'image',
      fecha: String((it as any).fecha ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
      subidoPor: (it as any).subidoPor ? String((it as any).subidoPor).trim() : null,
    });
  }
  return out;
}

/**
 * Normaliza un objeto parcial o JSON de `CartaBancoTerceroData`, rellenando con los datos
 * bancarios actuales del empleado (`bank_name`, `bank_account`, `bank_holder`, `bank_cedula`)
 * cuando falten en el JSON.
 */
export function normalizarCartaBancoTercero(
  raw: unknown,
  empFallback?: {
    id?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    cedula?: string | null;
    bank_name?: string | null;
    bank_account?: string | null;
    bank_holder?: string | null;
    bank_cedula?: string | null;
    carta_banco_tercero?: unknown;
  } | null
): CartaBancoTerceroData {
  let obj: any = raw;
  if (typeof obj === 'string') {
    const t = obj.trim();
    if (t.startsWith('{')) {
      try {
        obj = JSON.parse(t);
      } catch {
        obj = null;
      }
    } else {
      obj = null;
    }
  }
  if ((!obj || typeof obj !== 'object') && empFallback?.carta_banco_tercero) {
    const fb = empFallback.carta_banco_tercero;
    if (typeof fb === 'string') {
      try { obj = JSON.parse(fb); } catch { obj = null; }
    } else if (fb && typeof fb === 'object') {
      obj = fb;
    }
  }
  if (!obj || typeof obj !== 'object') obj = {};

  const bancoNombre = String(obj.bancoNombre ?? empFallback?.bank_name ?? '').trim();
  const numeroCuenta = String(obj.numeroCuenta ?? empFallback?.bank_account ?? '').trim();
  const titularNombre = String(obj.titularNombre ?? empFallback?.bank_holder ?? '').trim();
  const titularCedula = String(obj.titularCedula ?? empFallback?.bank_cedula ?? '').trim();

  const detectadoPorDiferencia = detectarTitularDistintoAlEmpleado(empFallback, titularNombre, titularCedula);
  const esTercero =
    typeof obj.esTercero === 'boolean'
      ? obj.esTercero || detectadoPorDiferencia
      : detectadoPorDiferencia;

  return {
    esTercero,
    codigo: obj.codigo ? String(obj.codigo).trim() : generarCodigoCartaBancoTercero(empFallback?.cedula, obj.fechaAutorizacion),
    fechaAutorizacion: String(obj.fechaAutorizacion || new Date().toISOString().slice(0, 10)).slice(0, 10),
    lugar: String(obj.lugar ?? 'CAMURI CHICO, EDO. LA GUAIRA').trim() || 'CAMURI CHICO, EDO. LA GUAIRA',
    membreteKey: String(obj.membreteKey || MEMBRETE_POR_DEFECTO.key).trim(),
    bancoNombre,
    numeroCuenta,
    tipoCuenta: normalizarTipoCuentaTercero(obj.tipoCuenta),
    titularNombre,
    titularCedula,
    titularTelefono: obj.titularTelefono ? String(obj.titularTelefono).trim() : null,
    parentesco: String(obj.parentesco ?? '').trim(),
    pagoMovilBanco: obj.pagoMovilBanco ? String(obj.pagoMovilBanco).trim() : null,
    pagoMovilTelefono: obj.pagoMovilTelefono ? String(obj.pagoMovilTelefono).trim() : null,
    pagoMovilCedula: obj.pagoMovilCedula ? String(obj.pagoMovilCedula).trim() : null,
    motivo: String(obj.motivo ?? '').trim() || MOTIVO_AUTORIZACION_DEFECTO,
    observaciones: obj.observaciones ? String(obj.observaciones).trim() : null,
    testigoNombre: obj.testigoNombre ? String(obj.testigoNombre).trim() : null,
    testigoCedula: obj.testigoCedula ? String(obj.testigoCedula).trim() : null,
    autorizadoEnRrhhPor: obj.autorizadoEnRrhhPor ? String(obj.autorizadoEnRrhhPor).trim() : null,
    firmaTrabajadorUrl: obj.firmaTrabajadorUrl ? String(obj.firmaTrabajadorUrl).trim() : null,
    firmaTerceroUrl: obj.firmaTerceroUrl ? String(obj.firmaTerceroUrl).trim() : null,
    soportes: limpiarSoportesCarta(obj.soportes),
    updatedAt: obj.updatedAt ? String(obj.updatedAt) : null,
    updatedBy: obj.updatedBy ? String(obj.updatedBy) : null,
  };
}

/**
 * Compara el nombre y la cédula del titular bancario contra el nombre y la cédula del trabajador.
 * Devuelve `true` cuando el titular bancario está cargado y claramente NO es el propio trabajador.
 */
export function detectarTitularDistintoAlEmpleado(
  emp?: {
    first_name?: string | null;
    last_name?: string | null;
    cedula?: string | null;
    bank_holder?: string | null;
    bank_cedula?: string | null;
  } | null,
  overrideHolder?: string | null,
  overrideCedula?: string | null
): boolean {
  if (!emp) return false;
  const empCedDigits = onlyDigits(String(emp.cedula ?? ''));
  const titCedDigits = onlyDigits(String(overrideCedula ?? emp.bank_cedula ?? ''));

  if (empCedDigits.length >= 5 && titCedDigits.length >= 5) {
    if (empCedDigits !== titCedDigits) return true;
  }

  const empNombre = norm(`${emp.first_name ?? ''} ${emp.last_name ?? ''}`).replace(/\s+/g, ' ').trim();
  const titNombre = norm(String(overrideHolder ?? emp.bank_holder ?? '')).replace(/\s+/g, ' ').trim();

  if (empNombre && titNombre && titNombre.length >= 3) {
    if (empNombre === titNombre) return false;
    // Si la cédula del titular coincide exactamente con la del empleado, es la misma persona
    // (aunque haya abreviado el segundo nombre en el titular).
    if (empCedDigits.length >= 5 && titCedDigits === empCedDigits) return false;
    return true;
  }
  return false;
}

/**
 * Determina si un empleado cobra en cuenta bancaria de un tercero, combinando su ficha
 * (`bank_holder`, `bank_cedula`, `carta_banco_tercero`) y el mapa sincronizado.
 */
export function esCuentaDeTercero(
  emp?: {
    id?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    cedula?: string | null;
    bank_name?: string | null;
    bank_account?: string | null;
    bank_holder?: string | null;
    bank_cedula?: string | null;
    carta_banco_tercero?: unknown;
  } | null,
  cartaOmapa?: CartaBancoTerceroData | MapaCartasBancoTercero | null
): boolean {
  if (!emp) return false;
  const carta = resolverCartaDeEmpleado(emp, cartaOmapa);
  if (detectarTitularDistintoAlEmpleado(emp, carta?.titularNombre || emp.bank_holder, carta?.titularCedula || emp.bank_cedula)) {
    return true;
  }
  return Boolean(carta?.esTercero);
}

/**
 * Obtiene la `CartaBancoTerceroData` de un empleado desde:
 * 1) un objeto `CartaBancoTerceroData` directo, o
 * 2) un `MapaCartasBancoTercero` indexado por `emp.id`, o
 * 3) la propiedad `emp.carta_banco_tercero`.
 */
export function resolverCartaDeEmpleado(
  emp?: {
    id?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    cedula?: string | null;
    bank_name?: string | null;
    bank_account?: string | null;
    bank_holder?: string | null;
    bank_cedula?: string | null;
    carta_banco_tercero?: unknown;
  } | null,
  cartaOmapa?: CartaBancoTerceroData | MapaCartasBancoTercero | null
): CartaBancoTerceroData | null {
  if (!emp) return null;
  if (cartaOmapa && typeof cartaOmapa === 'object') {
    if ('esTercero' in cartaOmapa || 'titularNombre' in cartaOmapa || 'soportes' in cartaOmapa) {
      return normalizarCartaBancoTercero(cartaOmapa, emp);
    }
    const id = String(emp.id ?? '').trim();
    if (id && (cartaOmapa as MapaCartasBancoTercero)[id]) {
      return normalizarCartaBancoTercero((cartaOmapa as MapaCartasBancoTercero)[id], emp);
    }
  }
  if (emp.carta_banco_tercero) {
    return normalizarCartaBancoTercero(emp.carta_banco_tercero, emp);
  }
  if (detectarTitularDistintoAlEmpleado(emp)) {
    return normalizarCartaBancoTercero({ esTercero: true }, emp);
  }
  return null;
}

export type EstadoCartaBancoTerceroResumen = {
  esTercero: boolean;
  tieneCartaConfigurada: boolean;
  tieneSoporteFirmado: boolean;
  cantidadSoportes: number;
  tieneFirmaDigital: boolean;
  parentesco: string;
  titularNombre: string;
  titularCedula: string;
  bancoNombre: string;
  numeroCuenta: string;
  tipoCuenta: TipoCuentaTercero;
  pagoMovilTelefono: string;
  etiqueta: string;
  etiquetaCorta: string;
  tono: 'success' | 'warning' | 'muted';
  carta: CartaBancoTerceroData | null;
};

/**
 * Devuelve el diagnóstico completo de la cuenta bancaria del empleado para mostrar badges,
 * alertas y botones en Empleados, Pago por Persona, Pago a Personal, Ficha y Reportes.
 */
export function estadoCartaBancoTercero(
  emp?: {
    id?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    cedula?: string | null;
    bank_name?: string | null;
    bank_account?: string | null;
    bank_holder?: string | null;
    bank_cedula?: string | null;
    carta_banco_tercero?: unknown;
  } | null,
  cartaOmapa?: CartaBancoTerceroData | MapaCartasBancoTercero | null
): EstadoCartaBancoTerceroResumen {
  const carta = resolverCartaDeEmpleado(emp, cartaOmapa);
  const esTercero = esCuentaDeTercero(emp, carta);
  const cantidadSoportes = carta?.soportes?.length ?? 0;
  const tieneFirmaDigital = Boolean(carta?.firmaTrabajadorUrl);
  const tieneSoporteFirmado = cantidadSoportes > 0 || tieneFirmaDigital;
  const parentesco = String(carta?.parentesco ?? '').trim();
  const titularNombre = String(carta?.titularNombre || emp?.bank_holder || '').trim();
  const titularCedula = String(carta?.titularCedula || emp?.bank_cedula || '').trim();
  const bancoNombre = String(carta?.bancoNombre || emp?.bank_name || '').trim();
  const numeroCuenta = String(carta?.numeroCuenta || emp?.bank_account || '').trim();
  const tipoCuenta = carta?.tipoCuenta ?? 'corriente';
  const pagoMovilTelefono = String(carta?.pagoMovilTelefono ?? '').trim();
  const tieneCartaConfigurada = Boolean(esTercero && titularNombre && titularCedula && (parentesco || tieneSoporteFirmado));

  if (!esTercero) {
    return {
      esTercero: false,
      tieneCartaConfigurada: false,
      tieneSoporteFirmado: false,
      cantidadSoportes: 0,
      tieneFirmaDigital: false,
      parentesco: '',
      titularNombre,
      titularCedula,
      bancoNombre,
      numeroCuenta,
      tipoCuenta,
      pagoMovilTelefono: '',
      etiqueta: '👤 Cuenta propia del trabajador',
      etiquetaCorta: '👤 Cuenta propia',
      tono: 'muted',
      carta,
    };
  }

  const parTxt = parentesco ? ` (${parentesco})` : '';
  if (tieneSoporteFirmado) {
    const detSop = cantidadSoportes > 0 ? `${cantidadSoportes} doc.` : 'Firmada';
    return {
      esTercero: true,
      tieneCartaConfigurada: true,
      tieneSoporteFirmado: true,
      cantidadSoportes,
      tieneFirmaDigital,
      parentesco,
      titularNombre,
      titularCedula,
      bancoNombre,
      numeroCuenta,
      tipoCuenta,
      pagoMovilTelefono,
      etiqueta: `🤝 Cuenta de Tercero${parTxt} · ✅ Carta autorizada (${detSop})`,
      etiquetaCorta: `🤝 Tercero${parTxt} · ✅ Carta`,
      tono: 'success',
      carta,
    };
  }

  return {
    esTercero: true,
    tieneCartaConfigurada,
    tieneSoporteFirmado: false,
    cantidadSoportes: 0,
    tieneFirmaDigital: false,
    parentesco,
    titularNombre,
    titularCedula,
    bancoNombre,
    numeroCuenta,
    tipoCuenta,
    pagoMovilTelefono,
    etiqueta: `⚠️ Cuenta de Tercero${parTxt} · Falta adjuntar/firmar carta`,
    etiquetaCorta: `⚠️ Tercero${parTxt} · Sin carta firmada`,
    tono: 'warning',
    carta,
  };
}

/**
 * Serializa y extrae filas ocultas `__carta_banco_tercero__:<employeeId>:<json>` en `payroll_companies`.
 */
export function construirPayloadCartaEmpresa(employeeId: string, carta: CartaBancoTerceroData): string {
  return `${PREFIX_CARTA_BANCO_TERCERO}${String(employeeId).trim()}:${JSON.stringify(carta)}`;
}

export function extraerMapaCartasDeEmpresas(
  rows?: readonly { id?: string; name?: string | null }[] | null
): MapaCartasBancoTercero {
  const out: MapaCartasBancoTercero = {};
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    const name = String(r?.name ?? '');
    if (!name.startsWith(PREFIX_CARTA_BANCO_TERCERO)) continue;
    const resto = name.slice(PREFIX_CARTA_BANCO_TERCERO.length);
    const idx = resto.indexOf(':');
    if (idx <= 0) continue;
    const empId = resto.slice(0, idx).trim();
    const jsonStr = resto.slice(idx + 1).trim();
    if (!empId || !jsonStr) continue;
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === 'object') {
        out[empId] = normalizarCartaBancoTercero(parsed);
      }
    } catch {}
  }
  return out;
}

/**
 * Construye el nombre del archivo PDF reflejando el trabajador, el membrete y si es planilla en blanco.
 */
export function nombreArchivoCartaBancoTercero(
  trabajadorNombre: string,
  membrete?: MembreteConstancia | null,
  opciones?: Partial<OpcionesCartaBancoTercero> | null
): string {
  const op = { ...OPCIONES_CARTA_BANCO_TERCERO_DEFECTO, ...(opciones ?? {}) };
  const partes = ['Carta autorizacion banco tercero'];
  const nom = String(trabajadorNombre ?? '').trim();
  if (op.modoPlanillaEnBlanco) {
    partes.push('Planilla en blanco');
  } else if (nom) {
    partes.push(nom);
  }
  if (membrete && membrete.key !== MEMBRETE_POR_DEFECTO.key) {
    partes.push(membrete.nombre);
  }
  if (!op.mostrarLogo) {
    partes.push('sin logo');
  }
  if (op.mostrarSalario) {
    partes.push('con salario');
  }
  return partes.join(' - ');
}

export type GenerarCartaBancoTerceroInput = {
  trabajadorNombre: string;
  trabajadorCedula?: string | null;
  trabajadorCargo?: string | null;
  trabajadorDepartamento?: string | null;
  trabajadorFicha?: string | null;
  trabajadorFechaIngreso?: string | null;
  trabajadorTelefono?: string | null;
  trabajadorSalarioTexto?: string | null;
  carta: CartaBancoTerceroData;
  membrete?: MembreteConstancia | null;
  opciones?: Partial<OpcionesCartaBancoTercero> | null;
};

/**
 * Genera el HTML completo tamaño Carta de la
 * «CARTA DE AUTORIZACIÓN PARA PAGO DE NÓMINA EN CUENTA BANCARIA DE TERCERO».
 * Todo texto ingresado por el usuario se escapa con `escHtmlCarta` antes de inyectarse.
 */
export function generarCartaBancoTerceroHtml(input: GenerarCartaBancoTerceroInput): string {
  const op: OpcionesCartaBancoTercero = {
    ...OPCIONES_CARTA_BANCO_TERCERO_DEFECTO,
    ...(input.opciones ?? {}),
  };
  const carta = normalizarCartaBancoTercero(input.carta);
  const memb =
    input.membrete ??
    MEMBRETES_CONSTANCIA.find((m) => m.key === carta.membreteKey) ??
    MEMBRETE_POR_DEFECTO;

  const blanco = op.modoPlanillaEnBlanco;
  const linea = (val: string | null | undefined, ancho = '____________________') => {
    if (blanco) return ancho;
    const limpio = String(val ?? '').trim();
    return limpio ? escHtmlCarta(limpio) : ancho;
  };

  const codigo = escHtmlCarta(carta.codigo || generarCodigoCartaBancoTercero(input.trabajadorCedula, carta.fechaAutorizacion));
  const lugar = linea(carta.lugar || 'CAMURI CHICO, EDO. LA GUAIRA', '__________________________');
  const fechaDoc = blanco
    ? '____ de ________________ de 202__'
    : escHtmlCarta(fechaLargaCarta(carta.fechaAutorizacion) || hoyLargo());
  const impreso = escHtmlCarta(selloImpresion());

  const trabNombre = linea(input.trabajadorNombre, '________________________________________');
  const trabCedula = linea(input.trabajadorCedula, '__________________');
  const trabCargo = linea(input.trabajadorCargo, '__________________________');
  const trabDepto = linea(input.trabajadorDepartamento, '__________________________');
  const trabFicha = linea(input.trabajadorFicha, '____________');
  const trabIngreso = linea(fechaLargaCarta(input.trabajadorFechaIngreso) || input.trabajadorFechaIngreso, '__________________');
  const trabTel = linea(input.trabajadorTelefono, '__________________');
  const trabSalario = linea(input.trabajadorSalarioTexto, '__________________');

  const titNombre = linea(carta.titularNombre, '________________________________________');
  const titCedula = linea(carta.titularCedula, '__________________');
  const titParentesco = linea(carta.parentesco, '__________________________');
  const titTelefono = linea(carta.titularTelefono, '__________________');
  const bancoNombre = linea(carta.bancoNombre, '________________________________');
  const numeroCuenta = linea(carta.numeroCuenta, '________________________________________');
  const tipoCuentaTxt = blanco ? '☐ Corriente   ☐ Ahorro   ☐ Pago Móvil' : escHtmlCarta(etiquetaTipoCuentaTercero(carta.tipoCuenta));

  const tienePagoMovil =
    blanco ||
    carta.tipoCuenta === 'pago_movil' ||
    carta.tipoCuenta === 'ambos' ||
    Boolean(carta.pagoMovilTelefono || carta.pagoMovilBanco || carta.pagoMovilCedula);

  const pmBanco = linea(carta.pagoMovilBanco || carta.bancoNombre, '__________________________');
  const pmTel = linea(carta.pagoMovilTelefono || carta.titularTelefono, '__________________________');
  const pmCed = linea(carta.pagoMovilCedula || carta.titularCedula, '__________________________');

  const motivoTxt = blanco
    ? '________________________________________________________________________________________________________________________'
    : escHtmlCarta(carta.motivo || MOTIVO_AUTORIZACION_DEFECTO);

  const obsTxt = !blanco && carta.observaciones ? escHtmlCarta(carta.observaciones) : '';

  const imagenesSoportes = op.mostrarSoportesAdjuntos
    ? (carta.soportes || []).filter((s) => s.tipo === 'image' && s.url)
    : [];

  return `<!doctype html><html><head><meta charset="utf-8"/><title>Carta de Autorización de Banco de Tercero</title>
  <style>
    @page{ margin:1.4cm 1.7cm; size:letter }
    *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact }
    html,body{ margin:0; padding:0 }
    body{ font-family:Tahoma, Geneva, Verdana, sans-serif; color:#111827; font-size:9.8pt; line-height:1.36; display:flex; flex-direction:column; min-height:100vh }
    @media screen{ body{ padding:20px 28px; background:#fff; max-width:860px; margin:0 auto } }
    .head{ display:flex; align-items:center; justify-content:space-between; border-bottom:2.5px solid #1E3A5F; padding-bottom:8px; margin-bottom:10px; gap:12px }
    .head-left{ display:flex; align-items:center; gap:12px }
    .head-left img{ height:52px; width:auto; object-fit:contain }
    .co-title{ color:#1E3A5F; font-weight:800; font-size:11pt; letter-spacing:.2px }
    .co-sub{ color:#4B5563; font-size:8.5pt; margin-top:2px }
    .code-box{ text-align:right; font-size:8.5pt; color:#374151; background:#F1F5F9; border:1px solid #CBD5E1; border-radius:6px; padding:5px 9px }
    .code-box b{ color:#1E3A5F; font-size:9.5pt; display:block }
    h1{ font-size:11.5pt; text-align:center; color:#1E3A5F; margin:4px 0 2px; text-transform:uppercase; letter-spacing:.3px }
    .subtitle{ text-align:center; color:#4B5563; font-size:8.8pt; margin-bottom:10px; font-style:italic }
    .dest{ margin:4px 0 8px; font-size:9.5pt; font-weight:700; color:#1E3A5F }
    p{ text-align:justify; margin:6px 0 }
    .sec-title{ font-size:9.5pt; font-weight:800; color:#fff; background:#1E3A5F; padding:4px 8px; border-radius:4px 4px 0 0; margin-top:8px; text-transform:uppercase; letter-spacing:.2px }
    table.kv{ width:100%; border-collapse:collapse; font-size:9.2pt; margin-bottom:6px }
    table.kv td{ border:1px solid #CBD5E1; padding:4px 7px; vertical-align:middle }
    table.kv td.k{ background:#F1F5F9; color:#1E3A5F; font-weight:700; width:22%; white-space:nowrap }
    table.kv td.v{ color:#111827; font-weight:600; width:28% }
    .clauses{ border:1px solid #CBD5E1; border-radius:6px; padding:7px 10px; background:#F8FAFC; margin-top:6px; font-size:9pt }
    .clauses ol{ margin:4px 0; padding-left:18px }
    .clauses li{ margin:4px 0; text-align:justify }
    .sign-area{ margin-top:auto; padding-top:12px }
    .sign-grid{ display:flex; gap:14px; align-items:stretch; justify-content:space-between; margin-top:8px }
    .sign-card{ flex:1; border:1px solid #CBD5E1; border-radius:6px; padding:8px; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; min-height:115px; background:#fff }
    .sign-img{ max-height:48px; max-width:160px; object-fit:contain; margin-bottom:4px }
    .sign-line{ width:92%; border-top:1px solid #111827; padding-top:4px; text-align:center; font-size:8.5pt; font-weight:700; color:#1E3A5F }
    .sign-meta{ font-size:8pt; color:#4B5563; text-align:center; margin-top:2px }
    .huella-card{ width:105px; border:1px solid #94A3B8; border-radius:6px; padding:6px; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; min-height:115px; background:#FAFAFA }
    .huella-box{ flex:1; width:100%; border:1px dashed #CBD5E1; border-radius:4px; margin-bottom:4px }
    .huella-lbl{ font-size:7.5pt; font-weight:700; color:#475569; text-align:center }
    .rrhh-box{ margin-top:8px; border:1px solid #CBD5E1; border-radius:6px; padding:6px 10px; background:#F8FAFC; font-size:8.5pt; display:flex; justify-content:space-between; gap:16px }
    .foot{ margin-top:8px; text-align:center; color:#64748B; font-size:7.8pt; border-top:1px solid #E2E8F0; padding-top:4px }
    .anexos{ page-break-before:always; padding-top:12px }
    .anexos-grid{ display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:10px }
    .anexo-item{ border:1px solid #CBD5E1; border-radius:6px; padding:8px; text-align:center }
    .anexo-item img{ max-width:100%; max-height:320px; object-fit:contain }
  </style></head><body>
    <div class="head">
      <div class="head-left">
        ${op.mostrarLogo && memb.logo ? `<img src="${memb.logo}" alt="Logo"/>` : ''}
        <div>
          <div class="co-title">${escHtmlCarta(memb.cabecera || memb.nombre)}</div>
          <div class="co-sub">Departamento de Administración, Nómina y Recursos Humanos</div>
        </div>
      </div>
      <div class="code-box">
        <b>${codigo}</b>
        <div>Lugar: ${lugar}</div>
        <div>Fecha: ${fechaDoc}</div>
      </div>
    </div>

    <h1>Carta de Autorización para Pago en Cuenta Bancaria de Tercero</h1>
    <div class="subtitle">Autorización expresa de depósito / transferencia / Pago Móvil de beneficios laborales</div>

    <div class="dest">
      A: ADMINISTRACIÓN Y RECURSOS HUMANOS — ${escHtmlCarta(memb.nombre)}
    </div>

    <p>
      Yo, <b>${trabNombre}</b>, venezolano(a), mayor de edad, titular de la Cédula de Identidad N° <b>${trabCedula}</b>${
        op.mostrarCargoYDepartamento
          ? `, desempeñando el cargo de <b>${trabCargo}</b>${input.trabajadorDepartamento || blanco ? ` adscrito(a) al departamento de <b>${trabDepto}</b>` : ''}`
          : ''
      }${
        op.mostrarFechaIngreso && (input.trabajadorFechaIngreso || blanco)
          ? `, con fecha de ingreso <b>${trabIngreso}</b>`
          : ''
      }, por medio de la presente <b>AUTORIZO DE MANERA EXPRESA, VOLUNTARIA E IRREVOCABLE</b> a <b>${escHtmlCarta(memb.nombre)}</b> para que los pagos correspondientes a mi salario, jornada laboral, bonificaciones, adelantos y demás beneficios laborales sean depositados, transferidos o abonados vía Pago Móvil en la cuenta bancaria perteneciente al tercero que identifico a continuación:
    </p>

    <div class="sec-title">1. Datos del Trabajador Autorizante</div>
    <table class="kv"><tbody>
      <tr>
        <td class="k">Nombre y Apellido</td><td class="v">${trabNombre}</td>
        <td class="k">Cédula de Identidad</td><td class="v">${trabCedula}</td>
      </tr>
      ${
        op.mostrarCargoYDepartamento
          ? `<tr>
              <td class="k">Cargo</td><td class="v">${trabCargo}</td>
              <td class="k">Departamento / Ficha</td><td class="v">${trabDepto}${input.trabajadorFicha ? ` · Ficha ${trabFicha}` : ''}</td>
            </tr>`
          : ''
      }
      ${
        op.mostrarSalario || input.trabajadorTelefono || blanco
          ? `<tr>
              <td class="k">Teléfono del Trabajador</td><td class="v">${trabTel}</td>
              ${op.mostrarSalario ? `<td class="k">Remuneración Ref.</td><td class="v">${trabSalario}</td>` : `<td class="k">N° de Ficha</td><td class="v">${trabFicha}</td>`}
            </tr>`
          : ''
      }
    </tbody></table>

    <div class="sec-title">2. Datos del Tercero Titular y Cuenta Bancaria Autorizada</div>
    <table class="kv"><tbody>
      <tr>
        <td class="k">Nombre del Titular (Tercero)</td><td class="v"><b>${titNombre}</b></td>
        <td class="k">Cédula del Titular (C.I. / RIF)</td><td class="v"><b>${titCedula}</b></td>
      </tr>
      <tr>
        <td class="k">Parentesco / Vínculo</td><td class="v"><b>${titParentesco}</b></td>
        <td class="k">Teléfono del Titular</td><td class="v">${titTelefono}</td>
      </tr>
      <tr>
        <td class="k">Entidad Bancaria</td><td class="v"><b>${bancoNombre}</b></td>
        <td class="k">Modalidad / Tipo de Cuenta</td><td class="v"><b>${tipoCuentaTxt}</b></td>
      </tr>
      <tr>
        <td class="k">Número de Cuenta (20 dígitos)</td>
        <td class="v" colspan="3" style="font-family:monospace;font-size:10.5pt;letter-spacing:.6px"><b>${numeroCuenta}</b></td>
      </tr>
      ${
        op.mostrarPagoMovil && tienePagoMovil
          ? `<tr>
              <td class="k">Pago Móvil Autorizado</td>
              <td class="v" colspan="3">Banco: <b>${pmBanco}</b> &nbsp;·&nbsp; Teléfono: <b>${pmTel}</b> &nbsp;·&nbsp; C.I. Titular: <b>${pmCed}</b></td>
            </tr>`
          : ''
      }
    </tbody></table>

    <div class="clauses">
      <b>3. DECLARACIÓN EXPRESA Y CONDICIONES DE LA AUTORIZACIÓN:</b>
      <ol>
        <li><b>Motivo de la solicitud:</b> El trabajador declara que solicita el pago en la cuenta antes descrita por: <b>${motivoTxt}</b>.</li>
        <li><b>Veracidad de los datos:</b> El trabajador certifica que los datos bancarios y de identificación del tercero titular suministrados en este documento son exactos y verdaderos, asumiendo total responsabilidad en caso de error en los dígitos de cuenta, cédula o teléfono suministrados.</li>
        ${
          op.mostrarClausulaLiberacion
            ? `<li><b>Efecto liberatorio del pago:</b> El trabajador reconoce y acepta que todo comprobante de transferencia bancaria, depósito o Pago Móvil emitido por <b>${escHtmlCarta(memb.nombre)}</b> a favor de la cuenta y titular aquí autorizados constituirá prueba plena, suficiente y liberatoria del pago oportuno de sus salarios y beneficios laborales, eximiendo a la empresa de cualquier reclamo por inconvenientes personales, retenciones bancarias o diferencias entre el trabajador y el titular de la cuenta receptora.</li>`
            : ''
        }
        <li><b>Vigencia:</b> La presente autorización se mantendrá vigente para todos los pagos sucesivos de nómina hasta tanto el trabajador notifique por escrito a Administración / Recursos Humanos el cambio a una cuenta bancaria propia o distinta.</li>
      </ol>
      ${obsTxt ? `<div style="margin-top:4px;border-top:1px dashed #CBD5E1;padding-top:4px"><b>Observaciones adicionales:</b> ${obsTxt}</div>` : ''}
    </div>

    <div class="sign-area">
      <div class="sign-grid">
        <div class="sign-card">
          ${!blanco && carta.firmaTrabajadorUrl ? `<img class="sign-img" src="${escHtmlCarta(carta.firmaTrabajadorUrl)}" alt="Firma trabajador"/>` : '<div style="flex:1"></div>'}
          <div class="sign-line">FIRMA DEL TRABAJADOR AUTORIZANTE</div>
          <div class="sign-meta"><b>${trabNombre}</b></div>
          <div class="sign-meta">C.I. N°: ${trabCedula}</div>
        </div>

        ${
          op.mostrarRecuadroHuella
            ? `<div class="huella-card">
                <div class="huella-box"></div>
                <div class="huella-lbl">HUELLA DACTILAR<br/>TRABAJADOR</div>
              </div>`
            : ''
        }

        ${
          op.mostrarFirmaTercero
            ? `<div class="sign-card">
                ${!blanco && carta.firmaTerceroUrl ? `<img class="sign-img" src="${escHtmlCarta(carta.firmaTerceroUrl)}" alt="Firma titular"/>` : '<div style="flex:1"></div>'}
                <div class="sign-line">CONFORMIDAD DEL TITULAR DE LA CUENTA</div>
                <div class="sign-meta"><b>${titNombre}</b></div>
                <div class="sign-meta">C.I. N°: ${titCedula} · ${titParentesco}</div>
              </div>`
            : ''
        }

        ${
          op.mostrarTestigo
            ? `<div class="sign-card">
                <div style="flex:1"></div>
                <div class="sign-line">TESTIGO / VERIFICACIÓN</div>
                <div class="sign-meta"><b>${linea(carta.testigoNombre, '__________________________')}</b></div>
                <div class="sign-meta">C.I. N°: ${linea(carta.testigoCedula, '__________________')}</div>
              </div>`
            : ''
        }
      </div>

      ${
        op.mostrarRecepcionRrhh
          ? `<div class="rrhh-box">
              <div><b>Recibido y verificado en Nómina / RRHH por:</b> ${linea(carta.autorizadoEnRrhhPor, '_______________________________')}</div>
              <div><b>Fecha de recepción:</b> ${fechaDoc} &nbsp;·&nbsp; <b>Firma y Sello:</b> _______________________</div>
            </div>`
          : ''
      }

      <div class="foot">
        ${escHtmlCarta(memb.nombre)} · Código: ${codigo} · Impreso el ${impreso} · Soportes en expediente digital: ${carta.soportes.length}
      </div>
    </div>

    ${
      imagenesSoportes.length > 0
        ? `<div class="anexos">
            <div class="sec-title">Anexos y Soportes Digitalizados (${imagenesSoportes.length}) — ${trabNombre}</div>
            <div class="anexos-grid">
              ${imagenesSoportes
                .map(
                  (s, idx) => `<div class="anexo-item">
                    <img src="${escHtmlCarta(s.url)}" alt="Soporte ${idx + 1}"/>
                    <div style="font-size:8.5pt;font-weight:700;margin-top:4px;color:#1E3A5F">${escHtmlCarta(s.nombre)} (${escHtmlCarta(s.fecha)})</div>
                  </div>`
                )
                .join('')}
            </div>
          </div>`
        : ''
    }
  </body></html>`;
}
