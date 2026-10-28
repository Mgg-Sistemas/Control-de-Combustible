// ============================================================================
// 💾 ALMACENAMIENTO DE PERSONALIZACIÓN DE FICHAS TÉCNICAS.
//
// Permite guardar y recuperar las personalizaciones de la ficha técnica de cada
// máquina (campos extra, observaciones, títulos personalizados) en AsyncStorage
// SIN alterar la tabla `machinery` ni dañar el flujo de trabajo del catálogo.
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
  proximoServicioTexto,
  resolverNuevoRenglon,
  aplicarPendientesFicha,
  sincronizarFichaConCatalogo,
} from './fichaTecnicaMaquina';
import { dmy } from './informeTecnico';

export { resolverNuevoRenglon, aplicarPendientesFicha, sincronizarFichaConCatalogo };

const PREFIX = '@ficha_tecnica_custom_';
const TABLA_CONFIG = 'tique_config';

function limpiarParaNube(data: FichaPersonalizada): FichaPersonalizada {
  const esDataUrl = (u?: string | null) => typeof u === 'string' && u.startsWith('data:');
  return {
    ...data,
    fotoPrincipalUrl: esDataUrl(data.fotoPrincipalUrl) ? undefined : data.fotoPrincipalUrl,
    fotoSecundariaUrl: esDataUrl(data.fotoSecundariaUrl) ? undefined : data.fotoSecundariaUrl,
    fotosExtra: (data.fotosExtra ?? []).filter((f) => !esDataUrl(f.url)),
  };
}

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
        const combinado: FichaPersonalizada = {
          ...remoto,
          ...local,
          renglones: (local?.renglones && local.renglones.length >= (remoto.renglones?.length ?? 0))
            ? local.renglones
            : (remoto.renglones ?? local?.renglones),
          metricas: (local?.metricas && local.metricas.length >= (remoto.metricas?.length ?? 0))
            ? local.metricas
            : (remoto.metricas ?? local?.metricas),
          observaciones: (local?.observaciones && local.observaciones.length >= (remoto.observaciones?.length ?? 0))
            ? local.observaciones
            : (remoto.observaciones ?? local?.observaciones),
          fotoPrincipalUrl: local?.fotoPrincipalUrl ?? remoto.fotoPrincipalUrl,
          fotoSecundariaUrl: local?.fotoSecundariaUrl ?? remoto.fotoSecundariaUrl,
          fotosExtra: (local?.fotosExtra && local.fotosExtra.length > 0) ? local.fotosExtra : (remoto.fotosExtra ?? []),
        };
        await AsyncStorage.setItem(`${PREFIX}${machineId}`, JSON.stringify(combinado)).catch(() => {});
        return combinado;
      }
    }
  } catch {
    // Si falla la red, devolvemos lo local
  }

  return local;
}

/** Guarda la personalización de la ficha de una máquina en el almacenamiento local y sincroniza los textos/renglones. */
export async function saveFichaPersonalizada(machineId: string, data: FichaPersonalizada): Promise<void> {
  if (!machineId) return;
  try {
    await AsyncStorage.setItem(`${PREFIX}${machineId}`, JSON.stringify(data));
  } catch (e) {
    console.warn('[fichaTecnicaStorage] error guardando:', e);
  }

  try {
    const { data: row } = await supabase.from(TABLA_CONFIG).select('campos').eq('id', true).maybeSingle();
    if (row) {
      const dc = (row.campos && typeof row.campos === 'object') ? { ...(row.campos as any) } : {};
      const mapa = (dc.fichasTecnicasCustom && typeof dc.fichasTecnicasCustom === 'object')
        ? { ...dc.fichasTecnicasCustom }
        : {};
      mapa[machineId] = limpiarParaNube(data);
      dc.fichasTecnicasCustom = mapa;
      await supabase.from(TABLA_CONFIG).update({
        campos: dc,
        updated_at: new Date().toISOString(),
      }).eq('id', true);
    }
  } catch {
    // Queda guardado en el dispositivo aunque falle la red
  }
}

/** Elimina la personalización de la ficha para volver a los datos por defecto del catálogo. */
export async function deleteFichaPersonalizada(machineId: string): Promise<void> {
  if (!machineId) return;
  try {
    await AsyncStorage.removeItem(`${PREFIX}${machineId}`);
  } catch (e) {
    console.warn('[fichaTecnicaStorage] error eliminando:', e);
  }

  try {
    const { data: row } = await supabase.from(TABLA_CONFIG).select('campos').eq('id', true).maybeSingle();
    if (row?.campos && typeof row.campos === 'object') {
      const dc = { ...(row.campos as any) };
      if (dc.fichasTecnicasCustom && typeof dc.fichasTecnicasCustom === 'object') {
        const mapa = { ...dc.fichasTecnicasCustom };
        delete mapa[machineId];
        dc.fichasTecnicasCustom = mapa;
        await supabase.from(TABLA_CONFIG).update({
          campos: dc,
          updated_at: new Date().toISOString(),
        }).eq('id', true);
      }
    }
  } catch {
    // Ignorar error de red al borrar
  }
}

/**
 * Construye la estructura inicial de personalización a partir de los datos que
 * YA están cargados en el catálogo de maquinaria.
 */
export function construirFichaInicial(
  m: MaquinaFichaTecnica,
  op: OpcionesFichaTecnica = {}
): FichaPersonalizada {
  const nombre = nombreDeMaquina(m);
  const subtituloDefecto =
    String(m.clasificacion ?? '').trim() ||
    String(m.tipo ?? '').trim() ||
    String(op.fallbackSubtitulo ?? '').trim() ||
    'Maquinaria pesada';
  const horas =
    m.last_horometro != null
      ? `${(Math.round(Number(m.last_horometro) * 10) / 10).toLocaleString('es-VE')} h`
      : null;
  const estado = String(op.estado ?? '').trim();
  const proximo = proximoServicioTexto(m);

  // 1. Tarjetas métricas superiores clave (estilo ficha técnica moderna)
  const metricas: FichaMetrica[] = [
    horas
      ? { id: 'm-horas', titulo: 'HORAS DE TRABAJO', subtitulo: 'ACUMULADAS', valor: horas }
      : null,
    estado ? { id: 'm-estado', titulo: 'ESTADO ACTUAL', valor: estado } : null,
    proximo
      ? { id: 'm-proximo', titulo: 'PRÓXIMO SERVICIO', subtitulo: '(250 H)', valor: proximo }
      : null,
    m.weight_ton
      ? { id: 'm-peso', titulo: 'PESO TOTAL', subtitulo: 'OPERATIVO', valor: pesoTexto(m) || '' }
      : null,
  ].filter(Boolean) as FichaMetrica[];

  // 2. Renglones de especificaciones técnicas
  const renglones: FichaRenglon[] = [
    m.marca
      ? { id: 'r-marca', categoria: 'Datos Generales', etiqueta: 'Fabricante / Marca', valor: m.marca }
      : null,
    m.modelo
      ? { id: 'r-modelo', categoria: 'Datos Generales', etiqueta: 'Modelo', valor: m.modelo }
      : null,
    m.code
      ? { id: 'r-codigo', categoria: 'Datos Generales', etiqueta: 'Código en el sistema', valor: m.code }
      : null,
    m.clasificacion
      ? { id: 'r-clasif', categoria: 'Datos Generales', etiqueta: 'Clasificación', valor: m.clasificacion }
      : null,
    m.serial
      ? { id: 'r-serial', categoria: 'Componentes Principales', etiqueta: 'Número de Serie (Serial / PIN)', valor: m.serial }
      : null,
    m.plate
      ? { id: 'r-placa', categoria: 'Componentes Principales', etiqueta: 'Placa', valor: m.plate }
      : null,
    m.identifier
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

  // Subtítulo con formato de metadatos en línea
  const metaLinea = [
    m.marca ? `Marca: ${m.marca}` : null,
    m.modelo ? `Modelo: ${m.modelo}` : null,
    m.clasificacion || m.tipo || null,
  ]
    .filter(Boolean)
    .join(' | ');

  return {
    titulo: String(m.tipo ?? '').trim() || nombre,
    subtitulo: metaLinea || subtituloDefecto,
    badgeSuperior: String(m.modelo ?? '').trim() || estado || nombre,
    subcodigo: m.code ? `CÓDIGO: ${m.code}` : null,
    seccionTitulo: 'ESPECIFICACIONES TÉCNICAS PRINCIPALES',
    seccionTag: 'Placa de Identificación',
    seccionFotosTitulo: 'VISTA GENERAL DEL EQUIPO',
    seccionFotosTag: m.clasificacion || 'Vista en Terreno',
    fotoPrincipalUrl: m.photo_url || null,
    fotoPrincipalLeyenda: m.photo_url ? 'Vista general de la unidad en campo operativo' : null,
    fotoSecundariaUrl: null,
    fotoSecundariaLeyenda: null,
    metricas,
    renglones,
    observaciones: [],
    fotosExtra: [],
  };
}
