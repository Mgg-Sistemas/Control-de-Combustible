// ============================================================================
// 💾 ALMACENAMIENTO DE PERSONALIZACIÓN DE FICHAS TÉCNICAS.
//
// Permite guardar y recuperar las personalizaciones de la ficha técnica de cada
// máquina (campos extra, observaciones, títulos personalizados) en AsyncStorage
// SIN alterar la tabla `machinery` ni dañar el flujo de trabajo del catálogo.
//
// La copia de la nube vive en `tique_config.campos.fichasTecnicasCustom` y se
// escribe SOLO por las funciones `guardar_ficha_tecnica` / `borrar_ficha_tecnica`
// (01-nov-2026), que tocan la ficha de una máquina sin reescribir las demás.
// ============================================================================
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import {
  FichaPersonalizada,
  FichaRenglon,
  FichaMetrica,
  MaquinaFichaTecnica,
  OpcionesFichaTecnica,
  nombreDeMaquina,
  pesoTexto,
  dimensionesTexto,
  tapaTexto,
  aceiteTexto,
  resolverNuevoRenglon,
  aplicarPendientesFicha,
  sincronizarFichaConCatalogo,
  camposFijosDeMaquina,
  estadoSinEmoji,
  METRICAS_FIJAS_FICHA,
  OBSERVACIONES_FIJAS_FICHA,
  elegirFichaMasReciente,
  limpiarFichaParaNube,
  SECCIONES_ANEXO_SUGERIDAS,
} from './fichaTecnicaMaquina';
import { dmy } from './informeTecnico';

export { resolverNuevoRenglon, aplicarPendientesFicha, sincronizarFichaConCatalogo };

const PREFIX = '@ficha_tecnica_custom_';
const TABLA_CONFIG = 'tique_config';

const limpiarParaNube = limpiarFichaParaNube;

/** Recupera la personalización guardada para una máquina, o null si no existe. */
export async function getFichaPersonalizada(machineId: string): Promise<FichaPersonalizada | null> {
  if (!machineId) return null;
  let local: FichaPersonalizada | null = null;
  try {
    const raw = await AsyncStorage.getItem(`${PREFIX}${machineId}`);
    if (raw) local = JSON.parse(raw);
  } catch (e) {
    console.warn('[fichaTecnicaStorage] error leyendo local:', e);
  }

  try {
    const { data, error } = await supabase.from(TABLA_CONFIG).select('campos').eq('id', true).maybeSingle();
    if (!error && data?.campos && typeof data.campos === 'object') {
      const remotos = (data.campos as any).fichasTecnicasCustom;
      const remoto: FichaPersonalizada | undefined = remotos && typeof remotos === 'object' ? remotos[machineId] : undefined;
      if (remoto && typeof remoto === 'object') {
        const elegida = elegirFichaMasReciente(local, remoto);
        await AsyncStorage.setItem(`${PREFIX}${machineId}`, JSON.stringify(elegida)).catch(() => {});
        return elegida;
      }
    }
  } catch {
    // Si falla la red, devolvemos lo local
  }

  return local;
}

/** Resultado de guardar: `nube` dice si llegó a la base; si no, `error` dice por qué. */
export type GuardadoFicha = { nube: boolean; error?: string };

/**
 * Guarda la ficha en el teléfono y en la nube. La nube se escribe con
 * `guardar_ficha_tecnica`, que toca SOLO la ficha de esta máquina en una
 * sentencia: antes se leía toda la fila de `tique_config`, se modificaba y se
 * reescribía, y dos personas guardando a la vez se pisaban. Y si el permiso no
 * alcanzaba, la base no escribía nada y nadie se enteraba — ahora el error
 * vuelve y la pantalla lo dice.
 */
export async function saveFichaPersonalizada(machineId: string, data: FichaPersonalizada): Promise<GuardadoFicha> {
  if (!machineId) return { nube: false, error: 'Falta indicar de qué equipo es la ficha.' };
  const conFecha: FichaPersonalizada = { ...data, actualizadoEn: new Date().toISOString() };
  try {
    await AsyncStorage.setItem(`${PREFIX}${machineId}`, JSON.stringify(conFecha));
  } catch (e) {
    console.warn('[fichaTecnicaStorage] error guardando:', e);
  }

  try {
    const { error } = await supabase.rpc('guardar_ficha_tecnica', {
      p_machine_id: machineId,
      p_ficha: limpiarParaNube(conFecha),
    });
    if (error) return { nube: false, error: error.message };
    return { nube: true };
  } catch (e: any) {
    return { nube: false, error: e?.message ?? 'Sin conexión: la ficha quedó guardada solo en este dispositivo.' };
  }
}

/** Elimina la personalización de la ficha para volver a los datos por defecto del catálogo. */
export async function deleteFichaPersonalizada(machineId: string): Promise<GuardadoFicha> {
  if (!machineId) return { nube: false };
  try {
    await AsyncStorage.removeItem(`${PREFIX}${machineId}`);
  } catch (e) {
    console.warn('[fichaTecnicaStorage] error eliminando:', e);
  }

  try {
    const { error } = await supabase.rpc('borrar_ficha_tecnica', { p_machine_id: machineId });
    if (error) return { nube: false, error: error.message };
    return { nube: true };
  } catch (e: any) {
    return { nube: false, error: e?.message ?? 'Sin conexión: no se pudo restablecer la ficha en la nube.' };
  }
}

/**
 * Construye la estructura inicial de personalización a partir de los datos que
 * YA están cargados en el catálogo de maquinaria.
 *
 * Desde el 01-nov-2026 arranca con el formato de las fichas de referencia del
 * equipo: cabecera «FICHA TÉCNICA» con el sello del estado, las tres tarjetas
 * (Horómetro / Capacidad / Estado general), los diez campos fijos de la tabla y
 * los tres cuadros de observaciones. Lo que el catálogo sabe viene precargado,
 * lo demás queda vacío para teclearlo — y lo vacío no sale en el PDF.
 */
export function construirFichaInicial(
  m: MaquinaFichaTecnica,
  op: OpcionesFichaTecnica = {}
): FichaPersonalizada {
  const nombre = nombreDeMaquina(m);
  const horas =
    m.last_horometro != null
      ? `${(Math.round(Number(m.last_horometro) * 10) / 10).toLocaleString('es-VE')} h`
      : '';
  const estado = estadoSinEmoji(op.estado);

  // 1. Las tres tarjetas de las fichas de referencia, con lo que se sepa.
  const valorMetrica: Record<string, string> = {
    'm-horas': horas,
    'm-peso': pesoTexto(m) || '',
    'm-estado': estado.toUpperCase(),
  };
  const metricas: FichaMetrica[] = METRICAS_FIJAS_FICHA.map((mf) => ({
    id: mf.id,
    titulo: mf.titulo,
    valor: valorMetrica[mf.id] ?? '',
  }));

  // 2. Los campos fijos primero, en el orden de las fichas de referencia; luego
  //    «otros datos» del catálogo. Marca, modelo, serial y placa ya van dentro
  //    de los campos fijos, así que no se repiten abajo.
  const placaEnFijo = String(m.plate ?? '').trim() ? 'plate' : (String(m.identifier ?? '').trim() ? 'identifier' : null);
  const otros: FichaRenglon[] = [
    m.code
      ? { id: 'r-codigo', categoria: 'Datos Generales', etiqueta: 'Código en el sistema', valor: m.code }
      : null,
    m.clasificacion
      ? { id: 'r-clasif', categoria: 'Datos Generales', etiqueta: 'Clasificación', valor: m.clasificacion }
      : null,
    m.identifier && placaEnFijo !== 'identifier'
      ? { id: 'r-ident', categoria: 'Componentes Principales', etiqueta: 'Identificador', valor: m.identifier }
      : null,
    pesoTexto(m)
      ? { id: 'r-peso', categoria: 'Datos Generales', etiqueta: 'Peso operativo', valor: pesoTexto(m)! }
      : null,
    dimensionesTexto(m)
      ? { id: 'r-dim', categoria: 'Datos Generales', etiqueta: 'Dimensiones (L × An × Al)', valor: dimensionesTexto(m)! }
      : null,
    m.companyName
      ? { id: 'r-emp', categoria: 'Datos Generales', etiqueta: 'Empresa supervisora', valor: `${m.companyName}${m.companyRif ? ` (RIF: ${m.companyRif})` : ''}` }
      : null,
    m.encargado
      ? { id: 'r-encargado', categoria: 'Datos Generales', etiqueta: 'Encargado', valor: m.encargado }
      : null,
    m.zona
      ? { id: 'r-zona', categoria: 'Datos Generales', etiqueta: 'A disposición de', valor: m.zona }
      : null,
    m.grupo
      ? { id: 'r-grupo', categoria: 'Datos Generales', etiqueta: 'Grupo', valor: m.grupo }
      : null,
    aceiteTexto(m)
      ? { id: 'r-aceite', categoria: 'Componentes Principales', etiqueta: 'Aceite del motor', valor: aceiteTexto(m)! }
      : null,
    m.oil_notes
      ? { id: 'r-oilnotes', categoria: 'Componentes Principales', etiqueta: 'Nota de lubricación', valor: m.oil_notes }
      : null,
    tapaTexto(m)
      ? { id: 'r-tapa', categoria: 'Componentes Principales', etiqueta: 'Tapa', valor: tapaTexto(m)! }
      : null,
    m.expected_lph != null && Number(m.expected_lph) > 0
      ? { id: 'r-lph', categoria: 'Datos Generales', etiqueta: 'Rendimiento esperado', valor: `${m.expected_lph} L/h` }
      : null,
    m.expected_kml != null && Number(m.expected_kml) > 0
      ? { id: 'r-kml', categoria: 'Datos Generales', etiqueta: 'Rendimiento esperado (km/L)', valor: `${m.expected_kml} km/L` }
      : null,
    m.tank_capacity_l != null && Number(m.tank_capacity_l) > 0
      ? { id: 'r-tanque', categoria: 'Datos Generales', etiqueta: 'Capacidad del tanque', valor: `${m.tank_capacity_l} L` }
      : null,
    m.entry_date
      ? { id: 'r-ingreso', categoria: 'Datos Generales', etiqueta: 'Fecha de ingreso al sistema', valor: dmy(m.entry_date) }
      : null,
  ].filter(Boolean) as FichaRenglon[];
  const renglones: FichaRenglon[] = [...camposFijosDeMaquina(m), ...otros];

  // Subtítulo como el de las fichas de referencia: clase de equipo + marca + modelo.
  const subtitulo = [
    String(m.clasificacion ?? '').trim() || String(m.tipo ?? '').trim() || String(op.fallbackSubtitulo ?? '').trim(),
    String(m.marca ?? '').trim(),
    String(m.modelo ?? '').trim(),
  ]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();

  return {
    titulo: 'FICHA TÉCNICA',
    subtitulo: subtitulo || 'MAQUINARIA PESADA',
    badgeSuperior: estado.toUpperCase() || String(m.modelo ?? '').trim() || nombre,
    subcodigo: m.code ? `CÓDIGO: ${m.code}` : null,
    seccionTitulo: 'ESPECIFICACIONES TÉCNICAS PRINCIPALES',
    seccionTag: 'Placa de Identificación',
    // Como la ficha de referencia: la foto del equipo va sola, a todo lo ancho,
    // debajo de las observaciones (sin franja de título ni leyenda; se pueden poner).
    seccionFotosTitulo: '',
    seccionFotosTag: null,
    fotoPrincipalUrl: m.photo_url || null,
    fotoPrincipalLeyenda: null,
    fotoSecundariaUrl: null,
    fotoSecundariaLeyenda: null,
    diseno: 'tabla',
    seccionObsTitulo: 'OBSERVACIONES DE INSPECCIÓN',
    // El anexo arranca con las secciones de la ficha de referencia, vacías (las
    // que no lleven fotos no salen en el PDF).
    anexos: SECCIONES_ANEXO_SUGERIDAS.slice(0, 3).map((titulo, i) => ({
      id: `a-${i + 1}`,
      titulo: titulo.toUpperCase(),
      columnas: i === 2 ? 3 : 2,
      fotos: [],
    })),
    metricas,
    renglones,
    observaciones: OBSERVACIONES_FIJAS_FICHA.map((o) => ({ id: o.id, titulo: o.titulo, texto: '' })),
    fotosExtra: [],
  };
}
