/**
 * Reglas de negocio y fórmulas para el módulo de Combustible (inspirado en Golden Touch y adaptado a SOS).
 *
 * 1. CONTADOR DE SURTIDOR: El contador físico de la bomba es un totalizador continuo.
 *    Lo que marca al terminar un despacho es donde arranca el siguiente.
 * 2. HORÓMETRO DE EQUIPO: Las horas trabajadas son horometro_fin - horometro_ini.
 *    El horómetro final no puede ser menor que el inicial.
 * 3. MERMAS DE RECEPCIÓN: Diferencia entre lo enviado en guía/factura y lo recibido en tanque.
 *    Alerta si supera el margen técnico (por defecto 10%).
 * 4. CUBICACIÓN GEOMÉTRICA: Conversión matemática de altura en centímetros (vara) a litros.
 * 5. MENSAJES PARA WHATSAPP: Formateo limpio con emojis estándar para compartir comprobantes al instante.
 */
import { Linking, Platform } from 'react-native';

export const MARGEN_MERMA_DEFECTO = 10; // 10% por defecto

export interface MermaRecepcion {
  merma: number;      // Litros perdidos (enviados - recibidos)
  pct: number;        // % de merma
  excede: boolean;     // ¿Supera el margen del tanque?
}

const num = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);

const r2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Propone el contador final: inicial + litros dispensados.
 */
export function contadorFinalPropuesto(
  ini: number | null | undefined,
  litros: number | null | undefined
): number | null {
  const i = num(ini);
  const l = num(litros);
  if (i === null || l === null || l <= 0) return null;
  return r2(i + l);
}

/**
 * Horas trabajadas = horómetro final - horómetro inicial.
 */
export function horasTrabajadas(
  hi: number | null | undefined,
  hf: number | null | undefined
): number | null {
  const i = num(hi);
  const f = num(hf);
  if (i === null || f === null) return null;
  return r2(f - i);
}

/**
 * Valida si hay error en las lecturas de horómetro (el final no puede retroceder).
 */
export function errorHorometro(
  hi: number | null | undefined,
  hf: number | null | undefined
): string | null {
  const h = horasTrabajadas(hi, hf);
  if (h === null || h >= 0) return null;
  return `El horómetro final (${num(hf)}) no puede ser menor que el inicial (${num(hi)}). Las horas trabajadas saldrían negativas.`;
}

/**
 * Calcula la merma de una recepción (guía vs recibido).
 */
export function mermaDeRecepcion(
  enviados: number,
  recibidos: number | null | undefined,
  margenPct: number = MARGEN_MERMA_DEFECTO
): { ok: MermaRecepcion | null; error: string | null } {
  if (recibidos == null || !Number.isFinite(Number(recibidos))) return { ok: null, error: null };
  const env = Number(enviados) || 0;
  const rec = Number(recibidos);
  if (!(env > 0)) return { ok: null, error: 'Para anotar lo recibido, los litros de guía deben ser mayores a 0.' };
  if (rec < 0) return { ok: null, error: 'Los litros recibidos no pueden ser negativos.' };
  if (rec > env) return { ok: null, error: `No pueden llegar más litros (${rec}) de los enviados en la guía (${env}).` };
  const merma = r2(env - rec);
  const pct = r2((merma / env) * 100);
  return { ok: { merma, pct, excede: pct > margenPct + 1e-9 }, error: null };
}

/* ============================================================
   Cubicación Geométrica de Tanques (cm -> Litros)
   ============================================================ */
export type TipoGeometriaTanque = 'cilindrico_horizontal' | 'rectangular' | 'cilindrico_vertical';

export interface GeometriaTanque {
  tipo: TipoGeometriaTanque;
  radio_m?: number | null; // o diámetro / 2
  largo_m?: number | null;
  ancho_m?: number | null;
  alto_m?: number | null;
}

/**
 * Convierte altura de líquido (en centímetros) a litros exactos según la forma del tanque.
 */
export function cubicarLitros(g: GeometriaTanque, alturaCm: number): number {
  const h = Math.max(0, (num(alturaCm) || 0) / 100); // en metros
  if (g.tipo === 'cilindrico_horizontal') {
    const R = num(g.radio_m) || 0;
    const L = num(g.largo_m) || 0;
    if (R <= 0 || L <= 0) return 0;
    const hh = Math.min(h, 2 * R); // no puede pasar del diámetro
    const theta = 2 * Math.acos(Math.min(1, Math.max(-1, (R - hh) / R)));
    const area = 0.5 * R * R * (theta - Math.sin(theta));
    return r2(area * L * 1000);
  }
  if (g.tipo === 'cilindrico_vertical') {
    const R = num(g.radio_m) || 0;
    const alto = num(g.alto_m) || 0;
    if (R <= 0) return 0;
    const hh = alto > 0 ? Math.min(h, alto) : h;
    const area = Math.PI * R * R;
    return r2(area * hh * 1000);
  }
  // rectangular
  const L = num(g.largo_m) || 0;
  const A = num(g.ancho_m) || 0;
  const alto = num(g.alto_m) || 0;
  if (L <= 0 || A <= 0) return 0;
  const hh = alto > 0 ? Math.min(h, alto) : h;
  return r2(L * A * hh * 1000);
}

/**
 * Capacidad total calculada llenando el tanque al 100% de su altura.
 */
export function capacidadCalculada(g: GeometriaTanque): number {
  if (g.tipo === 'cilindrico_horizontal') {
    const R = num(g.radio_m) || 0;
    return cubicarLitros(g, R * 2 * 100);
  }
  return cubicarLitros(g, (num(g.alto_m) || 0) * 100);
}

/* ============================================================
   Comprobante estructurado para WhatsApp
   ============================================================ */
export interface DatosMensajeCombustible {
  tipo: 'surtido' | 'traslado' | 'entrada' | 'retorno';
  tanqueNombre: string;
  tanqueDestinoNombre?: string | null;
  equipoCodigo?: string | null;
  equipoPlaca?: string | null;
  litros: number;
  contadorIni?: number | null;
  contadorFin?: number | null;
  horometroIni?: number | null;
  horometroFin?: number | null;
  horasTrabajadas?: number | null;
  kilometraje?: number | null;
  autorizadoPor?: string | null;
  registradoPor?: string | null;
  fecha?: string | null;
  hora?: string | null;
  nota?: string | null;
}

export function construirMensajeWhatsapp(d: DatosMensajeCombustible): string {
  const lineas: string[] = [];
  const fechaStr = d.fecha || new Date().toISOString().slice(0, 10);
  const horaStr = d.hora || new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

  if (d.tipo === 'surtido') {
    lineas.push('⛽ *COMPROBANTE DE SURTIDO - COMBUSTIBLE*');
    lineas.push('');
    lineas.push(`🛢️ *Tanque origen:* ${d.tanqueNombre}`);
    const eqLabel = [d.equipoCodigo, d.equipoPlaca ? `(Placa: ${d.equipoPlaca})` : ''].filter(Boolean).join(' ');
    lineas.push(`🚜 *Equipo / Maquinaria:* ${eqLabel || 'Vehículo general'}`);
    lineas.push(`💧 *Litros surtidos:* ${d.litros.toLocaleString('es-VE')} L`);
    if (d.contadorIni != null || d.contadorFin != null) {
      lineas.push(`🔢 *Contador bomba:* ${d.contadorIni ?? '—'} ➔ ${d.contadorFin ?? '—'}`);
    }
    if (d.horometroIni != null || d.horometroFin != null) {
      const horas = d.horasTrabajadas != null ? ` (${d.horasTrabajadas} h trab.)` : '';
      lineas.push(`⏱️ *Horómetro:* ${d.horometroIni ?? '—'} ➔ ${d.horometroFin ?? '—'}${horas}`);
    }
    if (d.kilometraje != null) {
      lineas.push(`🛣️ *Odómetro:* ${d.kilometraje.toLocaleString('es-VE')} km`);
    }
    if (d.autorizadoPor) {
      lineas.push(`👤 *Autorizado por:* ${d.autorizadoPor}`);
    }
  } else if (d.tipo === 'traslado') {
    lineas.push('🔄 *TRASLADO ENTRE TANQUES DE COMBUSTIBLE*');
    lineas.push('');
    lineas.push(`📤 *Tanque origen:* ${d.tanqueNombre}`);
    lineas.push(`📥 *Tanque destino:* ${d.tanqueDestinoNombre || 'Tanque receptor'}`);
    lineas.push(`💧 *Litros trasladados:* ${d.litros.toLocaleString('es-VE')} L`);
    if (d.contadorIni != null || d.contadorFin != null) {
      lineas.push(`🔢 *Contador bomba:* ${d.contadorIni ?? '—'} ➔ ${d.contadorFin ?? '—'}`);
    }
    if (d.autorizadoPor) lineas.push(`👤 *Responsable:* ${d.autorizadoPor}`);
  } else {
    lineas.push('📥 *RECEPCIÓN DE COMBUSTIBLE*');
    lineas.push('');
    lineas.push(`🛢️ *Tanque receptor:* ${d.tanqueNombre}`);
    lineas.push(`💧 *Litros recibidos:* ${d.litros.toLocaleString('es-VE')} L`);
    if (d.autorizadoPor) lineas.push(`👤 *Recibido por:* ${d.autorizadoPor}`);
  }

  lineas.push(`📅 *Fecha y hora:* ${fechaStr} ${horaStr}`);
  if (d.nota) lineas.push(`📝 *Nota:* ${d.nota}`);
  lineas.push('');
  lineas.push(`🏢 *SOS La Guaira / BCV*${d.registradoPor ? ` · Reg.: ${d.registradoPor}` : ''}`);

  return lineas.join('\n');
}

/**
 * Abre WhatsApp con el mensaje estructurado pre-cargado.
 */
export async function compartirPorWhatsapp(d: DatosMensajeCombustible): Promise<void> {
  const texto = construirMensajeWhatsapp(d);
  const url = `https://wa.me/?text=${encodeURIComponent(texto)}`;
  try {
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
    } else {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) await Linking.openURL(url);
      else await Linking.openURL(`whatsapp://send?text=${encodeURIComponent(texto)}`);
    }
  } catch (err) {
    console.warn('No se pudo abrir WhatsApp:', err);
  }
}
