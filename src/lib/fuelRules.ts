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
  equipoSerial?: string | null;
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
  fotos?: string[] | null;
  incluirFotosEnTexto?: boolean;
}

export function construirMensajeWhatsapp(d: DatosMensajeCombustible): string {
  const lineas: string[] = [];
  const fechaStr = d.fecha || new Date().toISOString().slice(0, 10);
  const horaStr = d.hora || new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

  if (d.tipo === 'surtido') {
    lineas.push('⛽ *COMPROBANTE DE SURTIDO - COMBUSTIBLE*');
    lineas.push('');
    lineas.push(`⛽ *Tanque origen:* ${d.tanqueNombre}`);
    const codigoStr = String(d.equipoCodigo || '').trim() || 'Vehículo general';
    const placaStr = String(d.equipoPlaca || '').trim() || 'S/P';
    const serialStr = String(d.equipoSerial || '').trim();
    const eqLabel = [
      codigoStr,
      `(Placa: ${placaStr})`,
      serialStr ? `(Serial: ${serialStr})` : '',
    ]
      .filter(Boolean)
      .join(' ');
    lineas.push(`🚜 *Equipo / Maquinaria:* ${eqLabel}`);
    lineas.push(`🚗 *Placa:* ${placaStr}`);
    lineas.push(`🔢 *Serial:* ${serialStr || 'S/S'}`);
    lineas.push(`💧 *Litros surtidos:* ${d.litros.toLocaleString('es-VE')} L`);
    if (d.contadorIni != null || d.contadorFin != null) {
      lineas.push(`🔢 *Contador bomba:* ${d.contadorIni ?? '—'} → ${d.contadorFin ?? '—'}`);
    }
    if (d.horometroIni != null || d.horometroFin != null) {
      const horas = d.horasTrabajadas != null ? ` (${d.horasTrabajadas} h trab.)` : '';
      lineas.push(`🕒 *Horómetro:* ${d.horometroIni ?? '—'} → ${d.horometroFin ?? '—'}${horas}`);
    }
    if (d.kilometraje != null) {
      lineas.push(`🚗 *Odómetro:* ${d.kilometraje.toLocaleString('es-VE')} km`);
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
      lineas.push(`🔢 *Contador bomba:* ${d.contadorIni ?? '—'} → ${d.contadorFin ?? '—'}`);
    }
    if (d.autorizadoPor) lineas.push(`👤 *Responsable:* ${d.autorizadoPor}`);
  } else {
    lineas.push('📥 *RECEPCIÓN DE COMBUSTIBLE*');
    lineas.push('');
    lineas.push(`⛽ *Tanque receptor:* ${d.tanqueNombre}`);
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
 * Enlace de WhatsApp con el mensaje. Se usa api.whatsapp.com/send y NO wa.me:
 * wa.me redirige y en la redirección los emojis (pares sustitutos UTF-16)
 * llegaban como un rombo con signo de interrogación. El texto completo va con encodeURIComponent y con saltos
 * de línea reales (\n → %0A), así cada dato queda en su línea.
 */
export function urlWhatsapp(texto: string): string {
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;
}

/**
 * Abre WhatsApp con el mensaje estructurado pre-cargado.
 */
export async function compartirPorWhatsapp(d: DatosMensajeCombustible): Promise<void> {
  const texto = construirMensajeWhatsapp(d);
  // 01-nov-2026: api.whatsapp.com/send en vez de wa.me — la redirección de wa.me
  // dañaba los emojis (rombo con signo de interrogación). Ver urlWhatsapp.
  const url = urlWhatsapp(texto);
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

/**
 * Construye `DatosMensajeCombustible` completos (Nombre/Código de maquinaria,
 * Placa, Serial, Tanque, Litros, Contador, Horómetro, Autorizado, Fecha/Hora y Fotos)
 * a partir de una fila de `dispatches` y las listas opcionales de catálogo.
 */
export function armarDatosMensajeDesdeDespacho(
  d: any,
  opts?: {
    machineryList?: any[] | null;
    vehiclesList?: any[] | null;
    tanksList?: any[] | null;
    registradoPor?: string | null;
  }
): DatosMensajeCombustible {
  const maq =
    d?.machine ||
    (opts?.machineryList || []).find((x: any) => x && x.id === d?.machinery_id) ||
    null;
  const veh =
    d?.vehicle ||
    (opts?.vehiclesList || []).find((x: any) => x && x.id === d?.vehicle_id) ||
    null;
  const tank =
    d?.tank ||
    (opts?.tanksList || []).find((x: any) => x && x.id === d?.tank_id) ||
    null;

  const apoyoNom = String(d?.apoyo_nombre || '').trim();
  const apoyoEmp = String(d?.apoyo_empresa || '').trim();
  const esApoyo = !maq && !veh && !d?.machinery_id && !d?.vehicle_id && Boolean(apoyoNom);

  let equipoCodigo = 'Vehículo general';
  let equipoPlaca: string | null = null;
  let equipoSerial: string | null = null;

  if (maq) {
    equipoCodigo = String(maq.code || 'MAQUINARIA').trim();
    equipoPlaca = String(maq.plate || '').trim() || null;
    equipoSerial = String(maq.serial || maq.identifier || '').trim() || null;
  } else if (veh) {
    equipoCodigo = String(veh.name || veh.model || 'Vehículo').trim();
    equipoPlaca = String(veh.plate || '').trim() || null;
    equipoSerial = String(veh.serial || veh.identifier || '').trim() || null;
  } else if (esApoyo) {
    equipoCodigo = `🆘 ${apoyoNom}${apoyoEmp ? ` (${apoyoEmp})` : ''}`;
    equipoPlaca = String(d?.apoyo_placa || '').trim() || null;
    equipoSerial = String(d?.apoyo_serial || '').trim() || null;
  } else if (d?.equipoCodigo) {
    equipoCodigo = String(d.equipoCodigo).trim();
    equipoPlaca = String(d?.equipoPlaca || '').trim() || null;
    equipoSerial = String(d?.equipoSerial || '').trim() || null;
  }

  const fotosRaw = [
    ...(Array.isArray(d?.photos) ? d.photos : []),
    ...(Array.isArray(d?.apoyo_fotos) ? d.apoyo_fotos : []),
  ]
    .map((u: any) => String(u || '').trim())
    .filter(Boolean);
  const fotos = Array.from(new Set(fotosRaw));

  const fechaStr = d?.dispatch_date ? String(d.dispatch_date).slice(0, 10) : null;
  const horaStr = d?.created_at
    ? new Date(d.created_at).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
    : null;

  return {
    tipo: 'surtido',
    tanqueNombre: tank?.name ? String(tank.name).trim() : 'Bomba directa',
    equipoCodigo,
    equipoPlaca,
    equipoSerial,
    litros: Number(d?.liters) || 0,
    contadorIni: d?.fuel_start ?? null,
    contadorFin: d?.fuel_end ?? null,
    horometroFin: d?.hourmeter_h ?? null,
    kilometraje: d?.odometer_km ?? null,
    autorizadoPor: d?.driver_operator ? String(d.driver_operator).trim() : null,
    registradoPor: opts?.registradoPor || null,
    fecha: fechaStr,
    hora: horaStr,
    nota: d?.notes ? String(d.notes).trim() : null,
    fotos,
    incluirFotosEnTexto: true,
  };
}

/**
 * Copia el texto del mensaje de combustible al portapapeles (Web y móvil).
 */
export async function copiarMensajeCombustible(
  dOrTexto: DatosMensajeCombustible | string
): Promise<boolean> {
  const texto = typeof dOrTexto === 'string' ? dOrTexto : construirMensajeWhatsapp(dOrTexto);
  try {
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(texto);
      return true;
    }
    const doc: any = typeof document !== 'undefined' ? document : null;
    if (doc?.createElement) {
      const ta = doc.createElement('textarea');
      ta.value = texto;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      doc.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = doc.execCommand('copy');
      doc.body.removeChild(ta);
      return Boolean(ok);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Convierte una imagen remota (URL de Supabase Storage) a un Blob PNG en el navegador
 * para poder copiarla al portapapeles con `ClipboardItem` y pegarla (Ctrl+V) en WhatsApp.
 */
async function obtenerImagenComoPngBlob(imageUrl: string): Promise<Blob | null> {
  try {
    const doc: any = typeof document !== 'undefined' ? document : null;
    const ImgCtor: any = (globalThis as any).Image;
    if (!doc || !ImgCtor) return null;

    return await new Promise<Blob | null>((resolve) => {
      const img = new ImgCtor();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = doc.createElement('canvas');
          canvas.width = img.naturalWidth || img.width || 800;
          canvas.height = img.naturalHeight || img.height || 600;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0);
          canvas.toBlob((blob: Blob | null) => resolve(blob), 'image/png');
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = imageUrl;
    });
  } catch {
    return null;
  }
}

/**
 * Copia la imagen subida del despacho directamente al portapapeles para pegarla (Ctrl+V)
 * junto con el mensaje en WhatsApp Web / Desktop.
 */
export async function copiarImagenDespachoPortapapeles(
  imageUrl: string
): Promise<{ ok: boolean; msg: string }> {
  const url = String(imageUrl || '').trim();
  if (!url) return { ok: false, msg: 'No hay imagen disponible para copiar.' };
  try {
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    const ClipItem: any = (globalThis as any).ClipboardItem;
    if (nav?.clipboard?.write && ClipItem) {
      const pngBlob = await obtenerImagenComoPngBlob(url);
      if (pngBlob) {
        await nav.clipboard.write([new ClipItem({ 'image/png': pngBlob })]);
        return {
          ok: true,
          msg: '🖼️ Imagen copiada al portapapeles. Pégala (Ctrl+V) directamente en el chat de WhatsApp.',
        };
      }
    }
    return {
      ok: false,
      msg: 'Tu navegador no permite copiar imágenes directo al portapapeles; usa «Descargar foto» o «Enviar imagen + mensaje».',
    };
  } catch {
    return {
      ok: false,
      msg: 'No se pudo copiar la imagen al portapapeles; usa «Descargar foto».',
    };
  }
}

/**
 * Descarga (o abre) la imagen subida en el despacho.
 */
export async function descargarImagenDespacho(
  imageUrl: string,
  nombreArchivo = 'comprobante-despacho-combustible.jpg'
): Promise<void> {
  const url = String(imageUrl || '').trim();
  if (!url) return;
  try {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      try {
        const resp = await fetch(url, { mode: 'cors' });
        if (resp.ok) {
          const blob = await resp.blob();
          const objUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = objUrl;
          a.download = nombreArchivo;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
          return;
        }
      } catch {
        // Fallback abrir en pestaña
      }
      window.open(url, '_blank');
    } else {
      await Linking.openURL(url);
    }
  } catch {
    // Ignore
  }
}

/**
 * Envía/comparte la imagen subida en la aplicación ADEMÁS del mensaje de combustible:
 * - Si el dispositivo/navegador soporta Web Share API con archivos (`navigator.canShare({ files })`),
 *   abre el menú de compartir nativo con la foto adjunta + el texto completo del mensaje.
 * - En PC / WhatsApp Web, copia el texto al portapapeles, descarga la foto para adjuntarla
 *   y abre WhatsApp con el mensaje completo (que también lleva el enlace directo a la foto).
 */
export async function compartirImagenYMensajeCombustible(
  d: DatosMensajeCombustible,
  fotoUrlEspecifica?: string | null
): Promise<{ modo: 'nativo_archivos' | 'descargado_y_whatsapp' | 'whatsapp'; msg: string }> {
  const texto = construirMensajeWhatsapp(d);
  await copiarMensajeCombustible(texto);

  const fotos = (d.fotos || []).map((u) => String(u || '').trim()).filter(Boolean);
  const targetUrl = String(fotoUrlEspecifica || fotos[0] || '').trim();

  if (targetUrl && typeof navigator !== 'undefined') {
    const nav: any = navigator;
    if (typeof nav.share === 'function') {
      try {
        const resp = await fetch(targetUrl, { mode: 'cors' });
        if (resp.ok) {
          const blob = await resp.blob();
          const ext = blob.type.includes('png') ? 'png' : 'jpg';
          const file = new File([blob], `despacho-combustible.${ext}`, {
            type: blob.type || 'image/jpeg',
          });
          if (!nav.canShare || nav.canShare({ files: [file] })) {
            await nav.share({
              title: 'Comprobante de Surtido - Combustible',
              text: texto,
              files: [file],
            });
            return {
              modo: 'nativo_archivos',
              msg: '✅ Imagen y mensaje compartidos (el texto también quedó copiado en el portapapeles).',
            };
          }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return {
            modo: 'nativo_archivos',
            msg: '📋 El mensaje quedó copiado en el portapapeles.',
          };
        }
      }
    }
  }

  if (targetUrl) {
    await descargarImagenDespacho(
      targetUrl,
      `despacho-${String(d.equipoCodigo || 'equipo').replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`
    );
    await compartirPorWhatsapp(d);
    return {
      modo: 'descargado_y_whatsapp',
      msg: '✅ Mensaje copiado y abierto en WhatsApp + foto descargada lista para adjuntar.',
    };
  }

  await compartirPorWhatsapp(d);
  return {
    modo: 'whatsapp',
    msg: '✅ Mensaje copiado y abierto en WhatsApp.',
  };
}

/* ============================================================
   Identificación de Maquinaria / Vehículo con Placa y Serial
   y Ajustes Internos de Nivel de Tanque
   ============================================================ */

export const MARCADOR_AJUSTE_TANQUE = '[AJUSTE_TANQUE_OCULTO]';

const normTxt = (s: any): string =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Detecta el registro legado colocado como "ajuste manual visible" o "ajuste visible"
 * para convertirlo/ocultarlo de Consumos SIN reponer los litros al tanque.
 */
export function esAjusteManualVisibleLegado(row: any): boolean {
  if (!row || typeof row !== 'object') return false;
  const raw = [
    row.driver_operator,
    row.justification,
    row.authorized_by,
    row.area,
    row.station,
    row.supplier,
    row.notes,
    row.invoice_no,
    row.reason,
    row.machine?.code,
    row.vehicle?.name,
    row.vehicle?.plate,
  ]
    .map((v) => String(v ?? ''))
    .join(' | ');
  if (raw.includes(MARCADOR_AJUSTE_TANQUE)) return false;
  const n = normTxt(raw);
  return (
    /ajuste\s+manual\s+visible/.test(n) ||
    /ajuste\s+visible/.test(n) ||
    /ajuste\s+manual\s+de\s+tanque/.test(n)
  );
}

/**
 * Indica si una fila de `dispatches` o `fuel_intakes` corresponde a un ajuste directo
 * de nivel de tanque (o un consumo eliminado sin reponer al tanque) y NO debe mostrarse
 * como consumo de maquinaria ni ingreso regular.
 */
export function esRegistroAjusteTanque(row: any): boolean {
  if (!row || typeof row !== 'object') return false;
  const raw = [
    row.driver_operator,
    row.justification,
    row.authorized_by,
    row.area,
    row.station,
    row.supplier,
    row.notes,
    row.invoice_no,
    row.reason,
  ]
    .map((v) => String(v ?? ''))
    .join(' | ');
  if (raw.includes(MARCADOR_AJUSTE_TANQUE) || /\[AJUSTE_TANQUE/i.test(raw)) {
    return true;
  }
  return esAjusteManualVisibleLegado(row);
}

export interface EtiquetaEquipoCombustible {
  clave: string;
  codigo: string;
  placa: string;
  serial: string;
  etiquetaGrafica: string;
  etiquetaCompleta: string;
}

/**
 * Formatea siempre el equipo (maquinaria o vehículo) mostrando Código + Placa + Serial.
 * En maquinaria pesada sin placa (S/P), muestra siempre su Serial o Identificador para
 * distinguir unidades homónimas (ej. dos JUMBO CON MARTILLO distintos).
 */
export function etiquetaEquipoCombustible(d: any): EtiquetaEquipoCombustible {
  const mach = d?.machine;
  const veh = d?.vehicle;

  if (mach || d?.asset_kind === 'maquinaria' || d?.machinery_id) {
    const codigo = String(mach?.code || 'MAQUINARIA').trim();
    const placaReal = String(mach?.plate || '').trim();
    const placa = placaReal || 'S/P';
    const serial = String(mach?.serial || mach?.identifier || '').trim();

    let etiquetaGrafica = `${codigo} · 🚗 ${placa}`;
    if (serial) {
      etiquetaGrafica =
        placaReal
          ? `${codigo} · 🚗 ${placaReal} · 🔢 ${serial}`
          : `${codigo} · 🚗 S/P · 🔢 ${serial}`;
    }

    const etiquetaCompleta = `${codigo} · 🚗 PLACA: ${placa} · 🔢 SERIAL: ${serial || 'S/S'}`;
    const clave = d?.machinery_id
      ? `maq:${d.machinery_id}`
      : `maq_lbl:${codigo}|${placa}|${serial}`;

    return {
      clave,
      codigo,
      placa,
      serial: serial || 'S/S',
      etiquetaGrafica,
      etiquetaCompleta,
    };
  }

  if (veh || d?.asset_kind === 'vehiculo' || d?.vehicle_id) {
    const nombre = String(veh?.name || veh?.model || 'VEHÍCULO').trim();
    const placaReal = String(veh?.plate || '').trim();
    const placa = placaReal || 'S/P';
    const serial = String(veh?.serial || veh?.identifier || '').trim();

    const etiquetaGrafica = serial
      ? `${nombre} · 🚗 ${placa} · 🔢 ${serial}`
      : `${nombre} · 🚗 ${placa}`;
    const etiquetaCompleta = `${nombre} · 🚗 PLACA: ${placa}${serial ? ` · 🔢 SERIAL: ${serial}` : ''}`;
    const clave = d?.vehicle_id
      ? `veh:${d.vehicle_id}`
      : `veh_lbl:${nombre}|${placa}|${serial}`;

    return {
      clave,
      codigo: nombre,
      placa,
      serial: serial || 'S/S',
      etiquetaGrafica,
      etiquetaCompleta,
    };
  }

  return {
    clave: 'sin_equipo',
    codigo: '—',
    placa: 'S/P',
    serial: 'S/S',
    etiquetaGrafica: '— · 🚗 S/P',
    etiquetaCompleta: '— · 🚗 PLACA: S/P · 🔢 SERIAL: S/S',
  };
}

/**
 * Agrupa los consumos por unidad física (machinery_id / vehicle_id) mostrando siempre
 * su Placa y/o Serial en la gráfica "🚜 LITROS POR MÁQUINA (TOP)".
 */
export function agruparLitrosPorMaquinaTop(
  rows: any[]
): { key: string; label: string; value: number }[] {
  const map = new Map<string, { key: string; label: string; value: number }>();
  for (const r of rows || []) {
    if (esRegistroAjusteTanque(r)) continue;
    // En la gráfica de Litros por Máquina, priorizar maquinarias; si no tiene machine ni vehicle, ignorar ajustes
    if (!r?.machine && !r?.machinery_id && !r?.vehicle && !r?.vehicle_id) continue;
    // Si tiene machine o es maquinaria (o vehículo cuando no hay machine):
    if (!r?.machine && r?.asset_kind !== 'maquinaria' && !r?.machinery_id) continue;

    const info = etiquetaEquipoCombustible(r);
    const prev = map.get(info.clave);
    const litros = Number(r?.liters) || 0;
    if (prev) {
      prev.value = r2(prev.value + litros);
    } else {
      map.set(info.clave, {
        key: info.clave,
        label: info.etiquetaGrafica,
        value: r2(litros),
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.value - a.value);
}

export interface ResultadoCalculoAjusteTanque {
  litrosActuales: number;
  nuevoNivel: number;
  delta: number;
  pctNuevo: number;
  excedeCapacidad: boolean;
  esNegativo: boolean;
  sinCambio: boolean;
}

/**
 * Calcula la diferencia exacta (delta) para ajustar el nivel actual de un tanque.
 */
export function calcularDiferenciaAjusteTanque(
  litrosActuales: number | null | undefined,
  nuevoNivel: number | null | undefined,
  capacidadLitros?: number | null
): ResultadoCalculoAjusteTanque {
  const act = r2(Math.max(0, Number(litrosActuales) || 0));
  const nvo = r2(Number(nuevoNivel) || 0);
  const delta = r2(nvo - act);
  const cap = Number(capacidadLitros) || 0;
  const pctNuevo = cap > 0 ? Math.round((nvo / cap) * 1000) / 10 : 0;
  return {
    litrosActuales: act,
    nuevoNivel: nvo,
    delta,
    pctNuevo,
    excedeCapacidad: cap > 0 && nvo > cap + 0.01,
    esNegativo: nvo < 0,
    sinCambio: Math.abs(delta) < 0.01,
  };
}
