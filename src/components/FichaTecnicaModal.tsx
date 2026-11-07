// ============================================================================
// 📄 MODAL PARA PERSONALIZAR Y EXPORTAR FICHA TÉCNICA.
//
// Permite modificar el título, subtítulo, badge superior, renglones de
// especificaciones, métricas destacadas, cuadros de texto / observaciones
// y fotos extras antes de exportar el PDF con el estilo moderno de alta calidad
// (similar al Grupo Electrógeno Metro).
//
// Todo se almacena localmente vía `AsyncStorage` SIN alterar la base de datos de
// `machinery` ni romper el flujo de trabajo del catálogo.
//
// 01-nov-2026: la ficha arranca con los CAMPOS FIJOS de las fichas de
// referencia ya puestos (Fabricante, Modelo / Serie, Placa, Tipo / Combustible,
// Año, Ejes / Tren, Capacidad, Equipamiento, País de origen, Horómetro), las tres
// tarjetas y los tres cuadros de observaciones, todos editables en su sitio y
// con un ejemplo en gris. Lo que quede vacío no sale en el PDF. Se guarda un
// momento después de dejar de escribir (no en cada tecla) y, si la nube no lo
// acepta, se avisa en vez de callarlo.
// ============================================================================
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import {
  FichaPersonalizada,
  FichaRenglon,
  FichaMetrica,
  FichaObservacion,
  FichaFoto,
  MaquinaFichaTecnica,
  OpcionesFichaTecnica,
  FichaAnexo,
  OrigenFotoFicha,
  DestinoFotoFicha,
  ayudaCampoFicha,
  ordenarRenglonesComoReferencia,
  SECCIONES_ANEXO_SUGERIDAS,
  nombreDeMaquina,
  ajustarTransformFoto,
  reordenarFotoEnLista,
  intercambiarFotosP1,
  moverFotoEntrePaginas,
} from '../lib/fichaTecnicaMaquina';
import {
  GuardadoFicha,
  getFichaPersonalizada,
  saveFichaPersonalizada,
  deleteFichaPersonalizada,
  construirFichaInicial,
  resolverNuevoRenglon,
  aplicarPendientesFicha,
  sincronizarFichaConCatalogo,
} from '../lib/fichaTecnicaStorage';
import { capturarFotoLocal, elegirFotoLocal, takePhotoAndUpload, pickPhotoFromGalleryAndUpload } from '../lib/photo';

export function FichaTecnicaModal({
  visible,
  machine,
  machineId,
  options,
  onClose,
  onExport,
}: {
  visible: boolean;
  machine: MaquinaFichaTecnica | null;
  machineId: string | null;
  options: OpcionesFichaTecnica;
  onClose: () => void;
  onExport: (personalizada: FichaPersonalizada) => Promise<void>;
}) {
  const { colors } = useTheme();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [data, setData] = useState<FichaPersonalizada | null>(null);

  // Estados para formulario de agregar renglón
  const [catRenglonSel, setCatRenglonSel] = useState<'Datos Generales' | 'Componentes Principales' | '__otra__'>('Componentes Principales');
  const [nuevoCampoCat, setNuevoCampoCat] = useState('');
  const [nuevoCampoEtq, setNuevoCampoEtq] = useState('');
  const [nuevoCampoVal, setNuevoCampoVal] = useState('');

  // Estados para formulario de agregar métrica
  const [nuevaMetricaTit, setNuevaMetricaTit] = useState('');
  const [nuevaMetricaSub, setNuevaMetricaSub] = useState('');
  const [nuevaMetricaVal, setNuevaMetricaVal] = useState('');

  // Estados para formulario de agregar observación
  const [nuevaObsTit, setNuevaObsTit] = useState('');
  const [nuevaObsTxt, setNuevaObsTxt] = useState('');

  // Estados para foto extra
  const [fotoTomando, setFotoTomando] = useState(false);
  const [nuevaFotoLeyenda, setNuevaFotoLeyenda] = useState('');
  // Sección del anexo que está subiendo una foto (para el aviso «Subiendo…»).
  const [subiendoEn, setSubiendoEn] = useState<string | null>(null);
  // Foto que tiene abierto el panel de movimiento libre / zoom o el de cambiar de página
  const [fotoAjustandoId, setFotoAjustandoId] = useState<string | null>(null);
  const [fotoMoviendoId, setFotoMoviendoId] = useState<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);
  // La ficha que está abierta AHORA: si mientras sube una foto se cierra y se
  // abre otra, la foto no debe caer en la ficha nueva.
  const fichaAbiertaRef = useRef<string | null>(null);
  fichaAbiertaRef.current = visible ? machineId : null;

  // Guardado diferido: se guarda ~0,8 s después de la última tecla, no en cada
  // una (cada guardado es una llamada a la base). El aviso de que la nube no lo
  // aceptó sale una sola vez por apertura, no en cada tecla.
  const temporizadorGuardado = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avisoNubeDado = useRef(false);
  useEffect(() => () => {
    if (temporizadorGuardado.current) clearTimeout(temporizadorGuardado.current);
  }, []);
  useEffect(() => {
    if (visible) avisoNubeDado.current = false;
  }, [visible]);

  // Cargar personalización previa o inicial
  useEffect(() => {
    if (!visible || !machine) return;
    setLoading(true);
    const mid = machineId || machine.code || 'default';
    const inicial = construirFichaInicial(machine, options);
    getFichaPersonalizada(mid)
      .then((saved) => {
        if (saved) {
          const sincronizada = sincronizarFichaConCatalogo(saved, inicial);
          setData({
            ...sincronizada,
            fotoPrincipalUrl: saved.fotoPrincipalUrl !== undefined ? saved.fotoPrincipalUrl : (machine.photo_url || null),
            fotoPrincipalLeyenda: saved.fotoPrincipalLeyenda !== undefined ? saved.fotoPrincipalLeyenda : (machine.photo_url ? 'Vista general de la unidad en campo operativo' : null),
            // `??` y no `||`: un título vacío a propósito (sin franja, como la
            // ficha de referencia) no debe volver al texto por defecto.
            seccionFotosTitulo: saved.seccionFotosTitulo ?? 'VISTA GENERAL DEL EQUIPO',
            seccionFotosTag: saved.seccionFotosTag ?? (machine.clasificacion || 'Vista en Terreno'),
          });
        } else {
          setData(inicial);
        }
      })
      .catch(() => {
        setData(inicial);
      })
      .finally(() => setLoading(false));
  }, [visible, machine, machineId]);

  if (!visible || !machine) return null;

  const mid = machineId || machine.code || 'default';

  const consolidarDatosActuales = (actual: FichaPersonalizada): FichaPersonalizada => {
    const res = aplicarPendientesFicha(actual, {
      categoriaSeleccionada: catRenglonSel === '__otra__' ? (nuevoCampoCat.trim() || 'Componentes Principales') : catRenglonSel,
      nuevoCampoCat: catRenglonSel === '__otra__' ? nuevoCampoCat : '',
      nuevoCampoEtq,
      nuevoCampoVal,
      nuevaMetricaTit,
      nuevaMetricaSub,
      nuevaMetricaVal,
      nuevaObsTit,
      nuevaObsTxt,
    });
    if (res.agregados.renglon) {
      setNuevoCampoEtq('');
      setNuevoCampoVal('');
      if (catRenglonSel === '__otra__') setNuevoCampoCat('');
    }
    if (res.agregados.metrica) {
      setNuevaMetricaTit('');
      setNuevaMetricaSub('');
      setNuevaMetricaVal('');
    }
    if (res.agregados.observacion) {
      setNuevaObsTit('');
      setNuevaObsTxt('');
    }
    return res.data;
  };

  const avisarSiNoLlegoALaNube = (res: GuardadoFicha) => {
    if (res.nube || avisoNubeDado.current) return;
    avisoNubeDado.current = true;
    toast.error(`La ficha quedó guardada solo en este dispositivo: ${res.error ?? 'la nube no la aceptó.'}`);
  };

  // 💾 07-nov-2026 (el disco de Supabase se llenó): cada guardado de la ficha reescribe la
  // configuración compartida y deja un registro en la auditoría. El guardado automático
  // esperaba solo 0,8 s y guardaba aunque nada hubiera cambiado: una ficha llenada a mano
  // dejaba decenas de registros. Ahora espera 2,5 s sin escribir y NO guarda si la ficha
  // es igual a la última que se mandó.
  const ultimoGuardado = useRef<string | null>(null);
  const guardarSiCambio = (next: FichaPersonalizada) => {
    const huella = JSON.stringify(next);
    if (huella === ultimoGuardado.current) return;
    ultimoGuardado.current = huella;
    saveFichaPersonalizada(mid, next).then(avisarSiNoLlegoALaNube).catch(() => {});
  };

  /** Guarda un momento después de dejar de escribir. */
  const programarGuardado = (next: FichaPersonalizada) => {
    if (temporizadorGuardado.current) clearTimeout(temporizadorGuardado.current);
    temporizadorGuardado.current = setTimeout(() => {
      temporizadorGuardado.current = null;
      guardarSiCambio(next);
    }, 2500);
  };

  const cancelarGuardadoPendiente = () => {
    if (temporizadorGuardado.current) clearTimeout(temporizadorGuardado.current);
    temporizadorGuardado.current = null;
  };

  // Guardar personalización
  const guardar = async () => {
    if (!data) return;
    cancelarGuardadoPendiente();
    const finalData = consolidarDatosActuales(data);
    setData(finalData);
    ultimoGuardado.current = JSON.stringify(finalData);
    const res = await saveFichaPersonalizada(mid, finalData);
    if (res.nube) toast.success('Ficha técnica guardada.');
    else toast.error(`La ficha quedó guardada solo en este dispositivo: ${res.error ?? 'la nube no la aceptó.'}`);
  };

  // Restablecer al catálogo
  const restablecer = async () => {
    cancelarGuardadoPendiente();
    const res = await deleteFichaPersonalizada(mid);
    const inicial = construirFichaInicial(machine, options);
    setData(inicial);
    setNuevoCampoEtq('');
    setNuevoCampoVal('');
    setNuevoCampoCat('');
    if (res.nube) toast.info('Valores restablecidos a los datos originales del catálogo.');
    else toast.error(`Se restableció en este dispositivo, pero no en la nube: ${res.error ?? 'sin conexión.'}`);
  };

  // Cerrar sin perder lo último escrito si el guardado diferido no había salido.
  const cerrar = () => {
    if (temporizadorGuardado.current && data) {
      cancelarGuardadoPendiente();
      guardarSiCambio(data);
    }
    onClose();
  };

  // Exportar PDF (vuelca cualquier campo escrito pendiente y guarda automáticamente)
  const handleExport = async () => {
    if (!data || exporting) return;
    setExporting(true);
    try {
      cancelarGuardadoPendiente();
      const finalData = consolidarDatosActuales(data);
      setData(finalData);
      ultimoGuardado.current = JSON.stringify(finalData);
      avisarSiNoLlegoALaNube(await saveFichaPersonalizada(mid, finalData));
      await onExport(finalData);
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo exportar la ficha.');
    } finally {
      setExporting(false);
    }
  };

  // Modificadores de estado
  const setTitulo = (t: string) => setData((d) => (d ? { ...d, titulo: t } : null));
  const setSubtitulo = (s: string) => setData((d) => (d ? { ...d, subtitulo: s } : null));
  const setBadgeSuperior = (b: string) => setData((d) => (d ? { ...d, badgeSuperior: b } : null));
  const setSubcodigo = (c: string) => setData((d) => (d ? { ...d, subcodigo: c } : null));
  const setSeccionTitulo = (t: string) => setData((d) => (d ? { ...d, seccionTitulo: t } : null));
  const setSeccionTag = (t: string) => setData((d) => (d ? { ...d, seccionTag: t } : null));
  const setSeccionFotosTitulo = (t: string) => setData((d) => (d ? { ...d, seccionFotosTitulo: t } : null));
  const setSeccionFotosTag = (t: string) => setData((d) => (d ? { ...d, seccionFotosTag: t } : null));
  const setFotoPrincipalLeyenda = (l: string) => setData((d) => (d ? { ...d, fotoPrincipalLeyenda: l } : null));
  const setFotoSecundariaLeyenda = (l: string) => setData((d) => (d ? { ...d, fotoSecundariaLeyenda: l } : null));

  // Manejo de fotos de Página 1 (sube a Storage si hay machineId para que se vea en cualquier equipo)
  const elegirOSubirFoto = async (via: 'camara' | 'galeria'): Promise<{ ok: boolean; url?: string; error?: string }> => {
    if (machineId) {
      const up = via === 'galeria'
        ? await pickPhotoFromGalleryAndUpload(machineId, 'ficha-anexo')
        : await takePhotoAndUpload(machineId, 'ficha-anexo');
      if (up.ok && up.url) return { ok: true, url: up.url };
      if (up.error && !/cancel/i.test(up.error)) {
        // Si falla Storage por red, cae a foto local para no bloquear al usuario
        const loc = via === 'galeria' ? await elegirFotoLocal() : await capturarFotoLocal();
        if (loc.ok && loc.dataUrl) return { ok: true, url: loc.dataUrl };
      }
      return { ok: false, error: up.error };
    }
    const loc = via === 'galeria' ? await elegirFotoLocal() : await capturarFotoLocal();
    return { ok: loc.ok, url: loc.dataUrl, error: loc.error };
  };

  const tomarFotoP1 = async (slot: 1 | 2, via: 'camara' | 'galeria') => {
    if (fotoTomando) return;
    setFotoTomando(true);
    try {
      const res = await elegirOSubirFoto(via);
      if (res.ok && res.url) {
        if (slot === 1) {
          setData((d) => {
            if (!d) return null;
            const next: FichaPersonalizada = {
              ...d,
              fotoPrincipalUrl: res.url,
              fotoPrincipalOculta: false,
              fotoPrincipalLeyenda: d.fotoPrincipalLeyenda || 'Vista general de la unidad en campo operativo',
            };
            programarGuardado(next);
            return next;
          });
        } else {
          setData((d) => {
            if (!d) return null;
            const next: FichaPersonalizada = {
              ...d,
              fotoSecundariaUrl: res.url,
              fotoSecundariaLeyenda: d.fotoSecundariaLeyenda || 'Vista posterior / lateral del equipo',
            };
            programarGuardado(next);
            return next;
          });
        }
        toast.success(`Foto ${slot} de Página 1 actualizada.`);
      } else if (res.error) {
        toast.error(res.error);
      }
    } finally {
      setFotoTomando(false);
    }
  };

  const eliminarFotoP1 = (slot: 1 | 2) => {
    if (slot === 1) {
      setData((d) => {
        if (!d) return null;
        const next: FichaPersonalizada = { ...d, fotoPrincipalUrl: null, fotoPrincipalLeyenda: null, fotoPrincipalConfig: null, fotoPrincipalOculta: true };
        programarGuardado(next);
        return next;
      });
    } else {
      setData((d) => {
        if (!d) return null;
        const next: FichaPersonalizada = { ...d, fotoSecundariaUrl: null, fotoSecundariaLeyenda: null, fotoSecundariaConfig: null };
        programarGuardado(next);
        return next;
      });
    }
    toast.info(`Foto ${slot} de Página 1 quitada.`);
  };

  const actualizarConfigFotoP1 = (slot: 1 | 2, patch: Partial<FichaFoto>) => {
    setData((d) => {
      if (!d) return null;
      const actual = slot === 1 ? d.fotoPrincipalConfig : d.fotoSecundariaConfig;
      const ajustada = ajustarTransformFoto(actual, patch);
      const next: FichaPersonalizada = slot === 1
        ? { ...d, fotoPrincipalConfig: ajustada }
        : { ...d, fotoSecundariaConfig: ajustada };
      programarGuardado(next);
      return next;
    });
  };

  const subirFotoExtraP1 = async (via: 'camara' | 'galeria') => {
    if (fotoTomando) return;
    setFotoTomando(true);
    try {
      const res = await elegirOSubirFoto(via);
      if (res.ok && res.url) {
        setData((d) => {
          if (!d) return null;
          // Si Foto 1 o Foto 2 están libres, ocupa primero esos lugares; si no, agrega como foto adicional en Página 1
          if (!d.fotoPrincipalUrl) {
            const next: FichaPersonalizada = {
              ...d,
              fotoPrincipalUrl: res.url,
              fotoPrincipalOculta: false,
              fotoPrincipalLeyenda: d.fotoPrincipalLeyenda || 'Vista general del equipo',
            };
            programarGuardado(next);
            return next;
          }
          if (!d.fotoSecundariaUrl) {
            const next: FichaPersonalizada = {
              ...d,
              fotoSecundariaUrl: res.url,
              fotoSecundariaLeyenda: d.fotoSecundariaLeyenda || 'Vista complementaria del equipo',
            };
            programarGuardado(next);
            return next;
          }
          const nueva: FichaFoto = {
            id: `fp1-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            url: res.url!,
            leyenda: '',
          };
          const next: FichaPersonalizada = {
            ...d,
            fotosPagina1: [...(d.fotosPagina1 ?? []), nueva],
          };
          programarGuardado(next);
          return next;
        });
        toast.success('Foto agregada a la Página 1.');
      } else if (res.error) {
        toast.error(res.error);
      }
    } finally {
      setFotoTomando(false);
    }
  };

  const actualizarFotoExtraP1 = (fotoId: string, patch: Partial<FichaFoto>) => {
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = {
        ...d,
        fotosPagina1: (d.fotosPagina1 ?? []).map((f) =>
          f.id === fotoId ? { ...f, ...ajustarTransformFoto(f, patch), ...(patch.leyenda !== undefined ? { leyenda: patch.leyenda } : {}), ...(patch.descripcion !== undefined ? { descripcion: patch.descripcion } : {}) } : f
        ),
      };
      programarGuardado(next);
      return next;
    });
  };

  const eliminarFotoExtraP1 = (fotoId: string) => {
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = {
        ...d,
        fotosPagina1: (d.fotosPagina1 ?? []).filter((f) => f.id !== fotoId),
      };
      programarGuardado(next);
      return next;
    });
  };

  const moverOrdenFotoP1Extra = (fotoId: string, delta: -1 | 1) => {
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = {
        ...d,
        fotosPagina1: reordenarFotoEnLista(d.fotosPagina1 ?? [], fotoId, delta),
      };
      programarGuardado(next);
      return next;
    });
  };

  const handleIntercambiarFotosP1 = () => {
    setData((d) => {
      if (!d) return null;
      const next = intercambiarFotosP1(d);
      programarGuardado(next);
      return next;
    });
    toast.info('Se intercambiaron la Foto 1 y la Foto 2.');
  };

  const handleMoverFotoEntrePaginas = (origen: OrigenFotoFicha, destino: DestinoFotoFicha, nombreDestino: string) => {
    setData((d) => {
      if (!d) return null;
      const next = moverFotoEntrePaginas(d, origen, destino, machine.photo_url);
      programarGuardado(next);
      return next;
    });
    setFotoMoviendoId(null);
    toast.success(`Foto movida a ${nombreDestino}.`);
  };

  // Agregar / editar / quitar renglón
  const agregarRenglon = () => {
    const catActiva = catRenglonSel === '__otra__' ? (nuevoCampoCat.trim() || 'Componentes Principales') : catRenglonSel;
    const nuevo = resolverNuevoRenglon({
      categoriaSeleccionada: catActiva,
      categoria: catRenglonSel === '__otra__' ? nuevoCampoCat : '',
      etiqueta: nuevoCampoEtq,
      valor: nuevoCampoVal,
    });
    if (!nuevo) {
      toast.error('Escribe el nombre del campo o su valor para añadir el renglón.');
      return;
    }
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = { ...d, renglones: [...(d.renglones ?? []), nuevo] };
      programarGuardado(next);
      return next;
    });
    setNuevoCampoEtq('');
    setNuevoCampoVal('');
    toast.success(`Renglón "${nuevo.etiqueta}" agregado.`);
  };

  const agregarFilaDirecta = (categoria: 'Datos Generales' | 'Componentes Principales') => {
    const nuevo: FichaRenglon = {
      id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      categoria,
      etiqueta: 'Nuevo campo',
      valor: '',
    };
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = { ...d, renglones: [...(d.renglones ?? []), nuevo] };
      return next;
    });
  };

  const actualizarRenglon = (id: string, patch: Partial<FichaRenglon>) => {
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = {
        ...d,
        renglones: (d.renglones ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
      };
      programarGuardado(next);
      return next;
    });
  };

  const alternarCategoriaRenglon = (id: string) => {
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = {
        ...d,
        renglones: (d.renglones ?? []).map((r) => {
          if (r.id !== id) return r;
          const catActual = String(r.categoria ?? '').trim();
          const nuevaCat = catActual === 'Datos Generales' ? 'Componentes Principales' : 'Datos Generales';
          return { ...r, categoria: nuevaCat };
        }),
      };
      programarGuardado(next);
      return next;
    });
  };

  const eliminarRenglon = (id: string) => {
    setData((d) => {
      if (!d) return null;
      const ocultos = new Set(d.renglonesOcultos ?? []);
      ocultos.add(id);
      const next: FichaPersonalizada = {
        ...d,
        renglones: (d.renglones ?? []).filter((r) => r.id !== id),
        renglonesOcultos: Array.from(ocultos),
      };
      programarGuardado(next);
      return next;
    });
  };

  // Agregar / quitar métrica
  const agregarMetrica = () => {
    if (!nuevaMetricaTit.trim() || !nuevaMetricaVal.trim()) {
      toast.error('Indica el título de la métrica y su valor.');
      return;
    }
    const nueva: FichaMetrica = {
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      titulo: nuevaMetricaTit.trim(),
      subtitulo: nuevaMetricaSub.trim() || undefined,
      valor: nuevaMetricaVal.trim(),
    };
    setData((d) => (d ? { ...d, metricas: [...(d.metricas ?? []), nueva] } : null));
    setNuevaMetricaTit('');
    setNuevaMetricaSub('');
    setNuevaMetricaVal('');
    toast.success('Métrica agregada.');
  };

  const eliminarMetrica = (id: string) => {
    setData((d) => (d ? { ...d, metricas: (d.metricas ?? []).filter((m) => m.id !== id) } : null));
  };

  // Las tarjetas se editan en su sitio (las tres fijas llegan vacías si el
  // catálogo no sabe el dato; vacías no salen en el PDF).
  const actualizarMetrica = (id: string, patch: Partial<FichaMetrica>) => {
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = {
        ...d,
        metricas: (d.metricas ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)),
      };
      programarGuardado(next);
      return next;
    });
  };

  const setEncuadreFotos = (encuadreFotos: 'completa' | 'rellenar') => {
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = { ...d, encuadreFotos };
      programarGuardado(next);
      return next;
    });
  };

  const setDiseno = (diseno: 'tabla' | 'columnas') => {
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = { ...d, diseno };
      programarGuardado(next);
      return next;
    });
  };

  // Agregar / quitar observación
  const agregarObservacion = () => {
    if (!nuevaObsTxt.trim()) {
      toast.error('Escribe el texto de la observación.');
      return;
    }
    const nueva: FichaObservacion = {
      id: `o-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      titulo: nuevaObsTit.trim(),
      texto: nuevaObsTxt.trim(),
    };
    setData((d) => (d ? { ...d, observaciones: [...(d.observaciones ?? []), nueva] } : null));
    setNuevaObsTit('');
    setNuevaObsTxt('');
    toast.success('Observación agregada.');
  };

  const actualizarObservacion = (id: string, patch: Partial<FichaObservacion>) => {
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = {
        ...d,
        observaciones: (d.observaciones ?? []).map((o) => (o.id === id ? { ...o, ...patch } : o)),
      };
      programarGuardado(next);
      return next;
    });
  };

  const eliminarObservacion = (id: string) => {
    // Se anota como oculta para que un cuadro fijo borrado no vuelva solo.
    setData((d) => (d ? {
      ...d,
      observaciones: (d.observaciones ?? []).filter((o) => o.id !== id),
      renglonesOcultos: Array.from(new Set([...(d.renglonesOcultos ?? []), id])),
    } : null));
  };

  // Fotos extras
  const tomarFotoExtra = async (via: 'camara' | 'galeria') => {
    if (fotoTomando) return;
    setFotoTomando(true);
    try {
      const res = via === 'galeria' ? await elegirFotoLocal() : await capturarFotoLocal();
      if (res.ok && res.dataUrl) {
        const nueva: FichaFoto = {
          id: `f-${Date.now()}`,
          url: res.dataUrl,
          leyenda: nuevaFotoLeyenda.trim() || 'Foto de componente / sistema',
        };
        setData((d) => (d ? { ...d, fotosExtra: [...(d.fotosExtra ?? []), nueva] } : null));
        setNuevaFotoLeyenda('');
        toast.success('Foto agregada a la ficha.');
      } else if (res.error) {
        toast.error(res.error);
      }
    } finally {
      setFotoTomando(false);
    }
  };

  const eliminarFotoExtra = (id: string) => {
    setData((d) => (d ? { ...d, fotosExtra: (d.fotosExtra ?? []).filter((f) => f.id !== id) } : null));
  };

  // ── 📎 ANEXO FOTOGRÁFICO POR SECCIONES (01-nov-2026) ──────────────────────
  // Las fotos del anexo se SUBEN a la nube (Storage) al tomarlas: así la ficha
  // sale igual desde cualquier equipo. Las fotos «de antes» quedaban solo en el
  // teléfono que las tomó. (`subiendoEn` se declara arriba, con los demás estados.)

  const cambiarAnexos = (fn: (a: FichaAnexo[]) => FichaAnexo[]) => {
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = { ...d, anexos: fn(d.anexos ?? []) };
      programarGuardado(next);
      return next;
    });
  };

  const agregarSeccionAnexo = (titulo = '') => {
    cambiarAnexos((as) => [
      ...as,
      { id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, titulo: titulo.toUpperCase(), columnas: 2, fotos: [] },
    ]);
  };

  const actualizarSeccionAnexo = (id: string, patch: Partial<FichaAnexo>) =>
    cambiarAnexos((as) => as.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  const eliminarSeccionAnexo = (id: string) => cambiarAnexos((as) => as.filter((a) => a.id !== id));

  const moverSeccionAnexo = (id: string, delta: -1 | 1) =>
    cambiarAnexos((as) => {
      const i = as.findIndex((a) => a.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= as.length) return as;
      const copia = [...as];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });

  const agregarFotoASeccion = (secId: string, url: string, leyenda = '') =>
    cambiarAnexos((as) =>
      as.map((a) =>
        a.id === secId
          ? { ...a, fotos: [...(a.fotos ?? []), { id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, url, leyenda }] }
          : a
      )
    );

  const subirFotoASeccion = async (secId: string, via: 'camara' | 'galeria') => {
    if (subiendoEn) return;
    // La carpeta en la nube es el id del equipo; sin id no se sube (un código con
    // espacios, tildes o «/» no sirve como nombre de carpeta).
    if (!machineId) {
      toast.error('No se puede subir la foto: falta identificar el equipo. Cierra y vuelve a abrir la ficha.');
      return;
    }
    const fichaDeLaFoto = machineId;
    setSubiendoEn(secId);
    try {
      const res = via === 'galeria'
        ? await pickPhotoFromGalleryAndUpload(fichaDeLaFoto, 'ficha-anexo')
        : await takePhotoAndUpload(fichaDeLaFoto, 'ficha-anexo');
      if (fichaAbiertaRef.current !== fichaDeLaFoto) {
        if (res.ok) toast.info('La foto se subió, pero la ficha ya se había cerrado: vuelve a agregarla.');
        return;
      }
      if (res.ok && res.url) {
        agregarFotoASeccion(secId, res.url);
        toast.success('Foto agregada al anexo. Escríbele su título debajo.');
      } else if (res.error) {
        toast.error(res.error);
      }
    } finally {
      setSubiendoEn(null);
    }
  };

  const actualizarFotoAnexo = (secId: string, fotoId: string, patch: Partial<FichaFoto>) =>
    cambiarAnexos((as) =>
      as.map((a) =>
        a.id === secId
          ? {
              ...a,
              fotos: (a.fotos ?? []).map((f) =>
                f.id === fotoId
                  ? {
                      ...f,
                      ...ajustarTransformFoto(f, patch),
                      ...(patch.leyenda !== undefined ? { leyenda: patch.leyenda } : {}),
                      ...(patch.descripcion !== undefined ? { descripcion: patch.descripcion } : {}),
                    }
                  : f
              ),
            }
          : a
      )
    );

  const moverFotoEnSeccionAnexo = (secId: string, fotoId: string, delta: -1 | 1) =>
    cambiarAnexos((as) =>
      as.map((a) => (a.id === secId ? { ...a, fotos: reordenarFotoEnLista(a.fotos ?? [], fotoId, delta) } : a))
    );

  const eliminarFotoAnexo = (secId: string, fotoId: string) =>
    cambiarAnexos((as) => as.map((a) => (a.id === secId ? { ...a, fotos: (a.fotos ?? []).filter((f) => f.id !== fotoId) } : a)));

  /**
   * Barra interactiva de Tamaño, Ancho, Movimiento Libre (Arrastrar + Flechas + Zoom)
   * y Cambio de Página para cualquier foto (de Página 1 o del Anexo).
   */
  const renderControlesFoto = ({
    uid,
    url,
    cfg,
    altoDefaultPx,
    origen,
    onPatch,
    onMoveOrder,
    canMovePrev,
    canMoveNext,
  }: {
    uid: string;
    url: string;
    cfg: Partial<FichaFoto>;
    altoDefaultPx: number;
    origen: OrigenFotoFicha;
    onPatch: (patch: Partial<FichaFoto>) => void;
    onMoveOrder?: (delta: -1 | 1) => void;
    canMovePrev?: boolean;
    canMoveNext?: boolean;
  }) => {
    const abiertoAjuste = fotoAjustandoId === uid;
    const abiertoMover = fotoMoviendoId === uid;
    const altoActual = cfg.altoPx && cfg.altoPx > 0 ? Math.round(cfg.altoPx) : altoDefaultPx;
    const zoomActual = cfg.zoom && cfg.zoom > 0 ? Number(cfg.zoom) : 1;
    const posXActual = cfg.posX ? Number(cfg.posX) : 0;
    const posYActual = cfg.posY ? Number(cfg.posY) : 0;
    const encuadreEfectivo =
      cfg.encuadre === 'rellenar' || (!cfg.encuadre && data?.encuadreFotos === 'rellenar')
        ? 'cover'
        : 'contain';
    const previewH = Math.max(90, Math.min(220, Math.round(altoActual * 0.55)));

    return (
      <View style={{ marginTop: 4, gap: 6 }}>
        {/* Vista previa interactiva (con soporte de arrastrar cuando está abierto Movimiento Libre) */}
        <View
          onStartShouldSetResponder={() => abiertoAjuste}
          onMoveShouldSetResponder={() => abiertoAjuste}
          onResponderGrant={(e) => {
            dragStartRef.current = {
              x: e.nativeEvent.pageX,
              y: e.nativeEvent.pageY,
              posX: posXActual,
              posY: posYActual,
            };
          }}
          onResponderMove={(e) => {
            if (!dragStartRef.current) return;
            const dx = (e.nativeEvent.pageX - dragStartRef.current.x) * 0.45;
            const dy = (e.nativeEvent.pageY - dragStartRef.current.y) * 0.45;
            onPatch({
              posX: Math.round((dragStartRef.current.posX + dx) * 10) / 10,
              posY: Math.round((dragStartRef.current.posY + dy) * 10) / 10,
            });
          }}
          onResponderRelease={() => {
            dragStartRef.current = null;
          }}
          style={{
            height: previewH,
            borderRadius: radius.sm,
            overflow: 'hidden',
            backgroundColor: '#f1f5f9',
            borderWidth: abiertoAjuste ? 2 : 1,
            borderColor: abiertoAjuste ? '#0284c7' : colors.border,
            position: 'relative',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Image
            source={{ uri: url }}
            style={{
              width: '100%',
              height: '100%',
              resizeMode: encuadreEfectivo,
              transform: [
                { translateX: (posXActual / 100) * 160 },
                { translateY: (posYActual / 100) * previewH },
                { scale: zoomActual },
              ],
            }}
          />
          {abiertoAjuste ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                bottom: 4,
                left: 6,
                right: 6,
                backgroundColor: 'rgba(22,50,79,0.82)',
                borderRadius: 4,
                paddingVertical: 2,
                paddingHorizontal: 6,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 9.5, fontWeight: '700', textAlign: 'center' }}>
                🖐️ Arrastra la imagen con el dedo o el mouse para correrla libremente
              </Text>
            </View>
          ) : null}
        </View>

        {/* Fila 1: Tamaño rápido (- / +), Orden y botones de Movimiento Libre y Mover de Página */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          <TouchableOpacity
            onPress={() => onPatch({ altoPx: Math.max(90, altoActual - 25) })}
            style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 7 }}
          >
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 10 }}>➖ Achicar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onPatch({ altoPx: null })}
            style={{ backgroundColor: cfg.altoPx ? '#e0f2fe' : colors.surface, borderWidth: 1, borderColor: cfg.altoPx ? '#0284c7' : colors.border, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 6 }}
          >
            <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 9.5 }}>
              Alto: {cfg.altoPx ? `${altoActual}px` : `Auto (${altoDefaultPx}px)`}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onPatch({ altoPx: Math.min(620, altoActual + 25) })}
            style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 7 }}
          >
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 10 }}>➕ Agrandar</Text>
          </TouchableOpacity>

          {onMoveOrder ? (
            <>
              <TouchableOpacity
                onPress={() => onMoveOrder(-1)}
                disabled={!canMovePrev}
                style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 6, opacity: canMovePrev ? 1 : 0.35 }}
              >
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 10 }}>◀ Ant.</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onMoveOrder(1)}
                disabled={!canMoveNext}
                style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 6, opacity: canMoveNext ? 1 : 0.35 }}
              >
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 10 }}>Sig. ▶</Text>
              </TouchableOpacity>
            </>
          ) : null}

          <TouchableOpacity
            onPress={() => {
              setFotoAjustandoId(abiertoAjuste ? null : uid);
              setFotoMoviendoId(null);
            }}
            style={{
              backgroundColor: abiertoAjuste ? '#0284c7' : colors.surfaceAlt,
              borderWidth: 1,
              borderColor: abiertoAjuste ? '#0284c7' : colors.border,
              borderRadius: radius.sm,
              paddingVertical: 4,
              paddingHorizontal: 7,
            }}
          >
            <Text style={{ color: abiertoAjuste ? '#fff' : colors.text, fontWeight: '800', fontSize: 10 }}>
              🖐️ Mover libre / Tamaño
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setFotoMoviendoId(abiertoMover ? null : uid);
              setFotoAjustandoId(null);
            }}
            style={{
              backgroundColor: abiertoMover ? '#16324F' : colors.surfaceAlt,
              borderWidth: 1,
              borderColor: abiertoMover ? '#16324F' : colors.border,
              borderRadius: radius.sm,
              paddingVertical: 4,
              paddingHorizontal: 7,
            }}
          >
            <Text style={{ color: abiertoMover ? '#fff' : colors.text, fontWeight: '800', fontSize: 10 }}>
              📦 Cambiar de página
            </Text>
          </TouchableOpacity>
        </View>

        {/* Panel desplegable 1: Movimiento libre, Zoom, Ancho y Encuadre individual */}
        {abiertoAjuste ? (
          <View style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: '#0284c7', borderRadius: radius.sm, padding: 8, gap: 6 }}>
            {/* Presets de tamaño (alto) y ancho en la fila */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontSize: 9.5, fontWeight: '700', marginRight: 2 }}>Tamaño rápido:</Text>
              {([
                [null, 'Auto'],
                [140, 'Pequeña'],
                [210, 'Mediana'],
                [290, 'Grande'],
                [380, 'Extra grande'],
              ] as const).map(([hVal, lbl]) => {
                const act = (cfg.altoPx ?? null) === hVal;
                return (
                  <TouchableOpacity
                    key={String(lbl)}
                    onPress={() => onPatch({ altoPx: hVal })}
                    style={{
                      paddingHorizontal: 7,
                      paddingVertical: 3,
                      borderRadius: radius.pill,
                      backgroundColor: act ? '#16324F' : colors.surface,
                      borderWidth: 1,
                      borderColor: act ? '#16324F' : colors.border,
                    }}
                  >
                    <Text style={{ color: act ? '#fff' : colors.text, fontSize: 9.5, fontWeight: '700' }}>{lbl}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontSize: 9.5, fontWeight: '700', marginRight: 2 }}>Ancho en la hoja:</Text>
              {([
                [null, 'Auto (según fila)'],
                [25, '1/4 (25%)'],
                [33, '1/3 (33%)'],
                [50, 'Mitad (50%)'],
                [75, '3/4 (75%)'],
                [100, 'Ancho completo (100%)'],
              ] as const).map(([wVal, lbl]) => {
                const act = (cfg.anchoPct ?? null) === wVal;
                return (
                  <TouchableOpacity
                    key={String(lbl)}
                    onPress={() => onPatch({ anchoPct: wVal })}
                    style={{
                      paddingHorizontal: 7,
                      paddingVertical: 3,
                      borderRadius: radius.pill,
                      backgroundColor: act ? '#16324F' : colors.surface,
                      borderWidth: 1,
                      borderColor: act ? '#16324F' : colors.border,
                    }}
                  >
                    <Text style={{ color: act ? '#fff' : colors.text, fontSize: 9.5, fontWeight: '700' }}>{lbl}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Encuadre individual de esta foto */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontSize: 9.5, fontWeight: '700', marginRight: 2 }}>Encuadre de esta foto:</Text>
              {([
                [null, 'Usar general'],
                ['completa', '🖼️ Entera (sin cortar)'],
                ['rellenar', '✂️ Llenar cuadro'],
              ] as const).map(([encVal, lbl]) => {
                const act = (cfg.encuadre ?? null) === encVal;
                return (
                  <TouchableOpacity
                    key={String(lbl)}
                    onPress={() => onPatch({ encuadre: encVal })}
                    style={{
                      paddingHorizontal: 7,
                      paddingVertical: 3,
                      borderRadius: radius.pill,
                      backgroundColor: act ? '#16324F' : colors.surface,
                      borderWidth: 1,
                      borderColor: act ? '#16324F' : colors.border,
                    }}
                  >
                    <Text style={{ color: act ? '#fff' : colors.text, fontSize: 9.5, fontWeight: '700' }}>{lbl}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Controles de Movimiento libre (flechas) y Zoom */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontSize: 9.5, fontWeight: '700', marginRight: 2 }}>Correr imagen:</Text>
              <TouchableOpacity
                onPress={() => onPatch({ posX: posXActual - 6 })}
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 8 }}
              >
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 10 }}>⬅️ Izq</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onPatch({ posY: posYActual - 6 })}
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 8 }}
              >
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 10 }}>⬆️ Arriba</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onPatch({ posY: posYActual + 6 })}
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 8 }}
              >
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 10 }}>⬇️ Abajo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onPatch({ posX: posXActual + 6 })}
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 8 }}
              >
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 10 }}>➡️ Der</Text>
              </TouchableOpacity>

              <Text style={{ color: colors.muted, fontSize: 9.5, fontWeight: '700', marginLeft: 4 }}>Zoom:</Text>
              <TouchableOpacity
                onPress={() => onPatch({ zoom: Math.max(0.5, Math.round((zoomActual - 0.1) * 100) / 100) })}
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 7 }}
              >
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 10 }}>🔍 −</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 10 }}>{Math.round(zoomActual * 100)}%</Text>
              <TouchableOpacity
                onPress={() => onPatch({ zoom: Math.min(3, Math.round((zoomActual + 0.1) * 100) / 100) })}
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 7 }}
              >
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 10 }}>🔍 +</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => onPatch({ zoom: null, posX: null, posY: null, altoPx: null, anchoPct: null, encuadre: null, alineacion: null })}
                style={{ backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fca5a5', borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 7, marginLeft: 'auto' }}
              >
                <Text style={{ color: '#991b1b', fontWeight: '800', fontSize: 9.5 }}>🔄 Restablecer foto</Text>
              </TouchableOpacity>
            </View>

            {/* Alineación en la hoja y salto de página individual */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontSize: 9.5, fontWeight: '700', marginRight: 2 }}>Posición en la hoja:</Text>
              {([
                ['izquierda', '⬅️ Izquierda'],
                ['centro', '⏺️ Centrada'],
                ['derecha', '➡️ Derecha'],
              ] as const).map(([alVal, lbl]) => {
                const act = cfg.alineacion === alVal;
                return (
                  <TouchableOpacity
                    key={alVal}
                    onPress={() => onPatch({ alineacion: act ? null : alVal })}
                    style={{
                      paddingHorizontal: 7,
                      paddingVertical: 3,
                      borderRadius: radius.pill,
                      backgroundColor: act ? '#16324F' : colors.surface,
                      borderWidth: 1,
                      borderColor: act ? '#16324F' : colors.border,
                    }}
                  >
                    <Text style={{ color: act ? '#fff' : colors.text, fontSize: 9.5, fontWeight: '700' }}>{lbl}</Text>
                  </TouchableOpacity>
                );
              })}

              <TouchableOpacity
                onPress={() => onPatch({ saltoPaginaAntes: !cfg.saltoPaginaAntes })}
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: radius.pill,
                  backgroundColor: cfg.saltoPaginaAntes ? '#0284c7' : colors.surface,
                  borderWidth: 1,
                  borderColor: cfg.saltoPaginaAntes ? '#0284c7' : colors.border,
                  marginLeft: 'auto',
                }}
              >
                <Text style={{ color: cfg.saltoPaginaAntes ? '#fff' : colors.text, fontSize: 9.5, fontWeight: '700' }}>
                  {cfg.saltoPaginaAntes ? '📄 Empezando en página nueva' : '📄 Pasar esta foto a página nueva'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* Panel desplegable 2: Mover esta foto a otra página / sección */}
        {abiertoMover ? (
          <View style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: '#16324F', borderRadius: radius.sm, padding: 8, gap: 5 }}>
            <Text style={{ color: '#16324F', fontSize: 10, fontWeight: '800' }}>
              📦 ¿A qué página o sección quieres pasar esta foto?
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
              {origen.tipo !== 'p1-slot' && origen.tipo !== 'p1-extra' ? (
                <TouchableOpacity
                  onPress={() => handleMoverFotoEntrePaginas(origen, { tipo: 'p1' }, 'Página 1 (Vista General)')}
                  style={{ backgroundColor: '#0284c7', borderRadius: radius.sm, paddingVertical: 5, paddingHorizontal: 9 }}
                >
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>➔ Pasar a Página 1 (Vista General)</Text>
                </TouchableOpacity>
              ) : null}

              {(data?.anexos ?? []).map((sec, idx) => {
                if (origen.tipo === 'anexo' && origen.seccionId === sec.id) return null;
                const nom = `${idx + 1}. ${(sec.titulo || 'Sección').slice(0, 28)}`;
                return (
                  <TouchableOpacity
                    key={sec.id}
                    onPress={() => handleMoverFotoEntrePaginas(origen, { tipo: 'anexo', seccionId: sec.id }, `Sección ${idx + 1}`)}
                    style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 5, paddingHorizontal: 8 }}
                  >
                    <Text style={{ color: colors.text, fontSize: 10, fontWeight: '700' }}>➔ Sección {nom}</Text>
                  </TouchableOpacity>
                );
              })}

              <TouchableOpacity
                onPress={() => handleMoverFotoEntrePaginas(origen, { tipo: 'nueva-seccion' }, 'Nueva página del anexo')}
                style={{ backgroundColor: '#16324F', borderRadius: radius.sm, paddingVertical: 5, paddingHorizontal: 9 }}
              >
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>➕ Enviar a una página nueva</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  const setSeccionObsTitulo = (t: string) =>
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = { ...d, seccionObsTitulo: t };
      programarGuardado(next);
      return next;
    });

  const setPieTexto = (t: string) =>
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = { ...d, pieTexto: t };
      programarGuardado(next);
      return next;
    });

  const ordenarComoReferencia = () => {
    setData((d) => {
      if (!d) return null;
      const next: FichaPersonalizada = { ...d, renglones: ordenarRenglonesComoReferencia(d.renglones ?? []) };
      programarGuardado(next);
      return next;
    });
    toast.info('Renglones ordenados como la ficha de referencia.');
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={cerrar}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: spacing.md }}>
        <View
          style={{
            backgroundColor: colors.background,
            borderRadius: radius.lg,
            maxHeight: '92%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Cabecera del modal */}
          <View
            style={{
              padding: spacing.md,
              backgroundColor: '#16324F',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>
                📄 Personalizar Ficha Técnica · {machine.code || 'Equipo'}
              </Text>
              <Text style={{ color: '#AFC4DB', fontSize: 11, marginTop: 2 }}>
                Edita títulos, especificaciones, observaciones y fotos con el estilo moderno de alta calidad
              </Text>
            </View>
            <TouchableOpacity onPress={cerrar} style={{ padding: 6 }}>
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>✕</Text>
            </TouchableOpacity>
          </View>

          {loading || !data ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={{ color: colors.muted, marginTop: spacing.sm }}>Cargando datos de la ficha…</Text>
            </View>
          ) : (
            <ScrollView style={{ padding: spacing.md }} keyboardShouldPersistTaps="handled">
              {/* SECCIÓN 1: CABECERA Y TÍTULO */}
              <View style={{ marginBottom: spacing.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 12, marginBottom: spacing.xs, textTransform: 'uppercase' }}>
                  🏷️ Título y Encabezado Principal
                </Text>

                <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Título del documento:</Text>
                <TextInput
                  value={data.titulo ?? ''}
                  onChangeText={setTitulo}
                  placeholder="Ej. GRUPO ELECTRÓGENO DIESEL"
                  placeholderTextColor={colors.muted}
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8, color: colors.text, marginBottom: spacing.xs }}
                />

                <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Subtítulo / Metadatos en línea:</Text>
                <TextInput
                  value={data.subtitulo ?? ''}
                  onChangeText={setSubtitulo}
                  placeholder="Ej. Marca: METRO | Motor: Cummins NTA855 | Alt: Stamford"
                  placeholderTextColor={colors.muted}
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8, color: colors.text, marginBottom: spacing.xs }}
                />

                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Insignia dorada superior (badge):</Text>
                    <TextInput
                      value={data.badgeSuperior ?? ''}
                      onChangeText={setBadgeSuperior}
                      placeholder="Ej. 350 kVA, 70 TON, OPERATIVA"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8, color: colors.text }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Subcódigo o Modelo:</Text>
                    <TextInput
                      value={data.subcodigo ?? ''}
                      onChangeText={setSubcodigo}
                      placeholder="Ej. MODELO: MXGA350-1DY"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8, color: colors.text }}
                    />
                  </View>
                </View>

                {/* 📄 Pie de cada página (01-nov-2026): a la derecha va solo «Página X de Y» */}
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs, marginBottom: 2 }}>
                  Pie de cada página (a la derecha sale «Página X de Y»; vacío = sin texto):
                </Text>
                <TextInput
                  value={data.pieTexto ?? `Ficha Técnica - ${nombreDeMaquina(machine)}`}
                  onChangeText={setPieTexto}
                  placeholder="Ej. Ficha Técnica - Excavadora XCMG XE225BR"
                  placeholderTextColor={colors.muted}
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8, color: colors.text }}
                />
              </View>

              {/* SECCIÓN 2: TARJETAS MÉTRICAS SUPERIORES */}
              <View style={{ marginBottom: spacing.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 12, marginBottom: spacing.xs, textTransform: 'uppercase' }}>
                  📊 Métricas Clave Superiores (Fila de tarjetas)
                </Text>
                <Text style={{ color: colors.muted, fontSize: 10.5, marginBottom: spacing.xs }}>
                  Cuadros destacados en la parte superior. Escribe el valor en cada tarjeta; la que quede vacía no sale en el PDF.
                </Text>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm }}>
                  {(data.metricas ?? []).map((m) => (
                    <View
                      key={m.id}
                      style={{
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.sm,
                        padding: 8,
                        minWidth: 130,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <View style={{ flex: 1, gap: 3 }}>
                        <TextInput
                          value={m.titulo}
                          onChangeText={(txt) => actualizarMetrica(m.id, { titulo: txt })}
                          placeholder="Título de la tarjeta"
                          placeholderTextColor={colors.muted}
                          style={{ color: colors.muted, fontWeight: '700', fontSize: 9.5, padding: 2, borderBottomWidth: 1, borderBottomColor: colors.border }}
                        />
                        <TextInput
                          value={m.valor}
                          onChangeText={(txt) => actualizarMetrica(m.id, { valor: txt })}
                          placeholder={ayudaCampoFicha(m.id) ?? 'Valor'}
                          placeholderTextColor={colors.muted}
                          style={{ color: colors.text, fontWeight: '900', fontSize: 13, padding: 2, backgroundColor: colors.background, borderRadius: radius.sm }}
                        />
                        {m.subtitulo ? <Text style={{ color: colors.muted, fontSize: 8.5 }}>{m.subtitulo}</Text> : null}
                      </View>
                      <TouchableOpacity onPress={() => eliminarMetrica(m.id)} style={{ padding: 4 }}>
                        <Text style={{ color: colors.danger, fontWeight: '900', fontSize: 12 }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>

                {/* Formulario para añadir métrica */}
                <View style={{ backgroundColor: colors.surface, padding: spacing.xs, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11, marginBottom: 4 }}>+ Agregar métrica clave:</Text>
                  <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
                    <TextInput
                      value={nuevaMetricaTit}
                      onChangeText={setNuevaMetricaTit}
                      placeholder="Título (ej. POTENCIA NOMINAL)"
                      placeholderTextColor={colors.muted}
                      style={{ flex: 1, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                    <TextInput
                      value={nuevaMetricaSub}
                      onChangeText={setNuevaMetricaSub}
                      placeholder="Sub (ej. PRIME, opcional)"
                      placeholderTextColor={colors.muted}
                      style={{ flex: 1, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <TextInput
                      value={nuevaMetricaVal}
                      onChangeText={setNuevaMetricaVal}
                      placeholder="Valor (ej. 350 kVA / 280 kW)"
                      placeholderTextColor={colors.muted}
                      style={{ flex: 2, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                    <TouchableOpacity
                      onPress={agregarMetrica}
                      style={{ flex: 1, backgroundColor: colors.primary, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center', paddingVertical: 6 }}
                    >
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 11 }}>Añadir</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* SECCIÓN 3: ESPECIFICACIONES TÉCNICAS (RENGLONES) */}
              <View style={{ marginBottom: spacing.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 12, marginBottom: spacing.xs, textTransform: 'uppercase' }}>
                  📋 Especificaciones Técnicas (Campos y Renglones)
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs }}>
                  <View style={{ flex: 2 }}>
                    <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 2 }}>Título de sección:</Text>
                    <TextInput
                      value={data.seccionTitulo ?? ''}
                      onChangeText={setSeccionTitulo}
                      placeholder="ESPECIFICACIONES TÉCNICAS PRINCIPALES"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 2 }}>Etiqueta lateral:</Text>
                    <TextInput
                      value={data.seccionTag ?? ''}
                      onChangeText={setSeccionTag}
                      placeholder="Placa de Identificación"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                  </View>
                </View>

                {/* Cómo sale la tabla en el PDF: una sola (como las fichas de referencia) o por columnas */}
                <View style={{ flexDirection: 'row', gap: 4, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Text style={{ color: colors.muted, fontSize: 10, marginRight: 2 }}>En el PDF:</Text>
                  {([['tabla', 'Una sola tabla'], ['columnas', 'Columnas por sección']] as const).map(([valor, label]) => {
                    const activo = (data.diseno ?? 'tabla') === valor;
                    return (
                      <TouchableOpacity
                        key={valor}
                        onPress={() => setDiseno(valor)}
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          borderRadius: radius.pill,
                          backgroundColor: activo ? '#16324F' : colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: activo ? '#16324F' : colors.border,
                        }}
                      >
                        <Text style={{ color: activo ? '#fff' : colors.text, fontSize: 10, fontWeight: '700' }}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  <Text style={{ color: colors.muted, fontSize: 10 }}>· Los campos vacíos no salen en el PDF.</Text>
                </View>

                {/* Lista de renglones existentes (editables en vivo) */}
                <View style={{ maxHeight: 420, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface, marginBottom: spacing.xs }}>
                  <ScrollView nestedScrollEnabled style={{ padding: 6 }}>
                    {(data.renglones ?? []).map((r, idx) => (
                      <View
                        key={r.id}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          paddingVertical: 5,
                          paddingHorizontal: 4,
                          borderBottomWidth: idx === (data.renglones ?? []).length - 1 ? 0 : 1,
                          borderBottomColor: colors.border,
                        }}
                      >
                        <View style={{ flex: 1, gap: 4 }}>
                          <View style={{ flexDirection: 'row', gap: 4 }}>
                            <TextInput
                              value={r.etiqueta}
                              onChangeText={(txt) => actualizarRenglon(r.id, { etiqueta: txt })}
                              placeholder="Nombre del campo"
                              placeholderTextColor={colors.muted}
                              style={{
                                flex: 1,
                                backgroundColor: colors.background,
                                borderWidth: 1,
                                borderColor: colors.border,
                                borderRadius: radius.sm,
                                paddingHorizontal: 6,
                                paddingVertical: 4,
                                fontSize: 11,
                                fontWeight: '700',
                                color: colors.text,
                              }}
                            />
                            <TextInput
                              value={r.valor}
                              onChangeText={(txt) => actualizarRenglon(r.id, { valor: txt })}
                              placeholder={ayudaCampoFicha(r.id) ?? 'Valor'}
                              placeholderTextColor={colors.muted}
                              style={{
                                flex: 1.3,
                                backgroundColor: colors.background,
                                borderWidth: 1,
                                borderColor: colors.border,
                                borderRadius: radius.sm,
                                paddingHorizontal: 6,
                                paddingVertical: 4,
                                fontSize: 11,
                                color: colors.text,
                              }}
                            />
                          </View>
                          {/* La columna solo importa si el PDF sale por columnas */}
                          {data.diseno === 'columnas' ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <TouchableOpacity
                              onPress={() => alternarCategoriaRenglon(r.id)}
                              style={{
                                backgroundColor: colors.surfaceAlt,
                                paddingHorizontal: 6,
                                paddingVertical: 2,
                                borderRadius: radius.sm,
                                borderWidth: 1,
                                borderColor: colors.border,
                              }}
                            >
                              <Text style={{ color: colors.muted, fontSize: 9.5, fontWeight: '700' }}>
                                📂 {r.categoria || 'Componentes Principales'} (toca para cambiar columna)
                              </Text>
                            </TouchableOpacity>
                          </View>
                          ) : null}
                        </View>
                        <TouchableOpacity onPress={() => eliminarRenglon(r.id)} style={{ padding: 6 }}>
                          <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 13 }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    {(data.renglones ?? []).length === 0 ? (
                      <Text style={{ color: colors.muted, padding: 10, textAlign: 'center', fontSize: 11 }}>
                        Sin renglones cargados. Agrega uno abajo.
                      </Text>
                    ) : null}
                  </ScrollView>
                </View>

                {/* ↕ 01-nov-2026: pone los campos en el orden de la ficha de referencia */}
                <TouchableOpacity
                  onPress={ordenarComoReferencia}
                  style={{ alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 5, paddingHorizontal: 10, marginBottom: spacing.xs }}
                >
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 10.5 }}>↕ Ordenar como la ficha de referencia</Text>
                </TouchableOpacity>

                {/* Botones rápidos para insertar fila directo en cada columna */}
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: spacing.xs, flexWrap: 'wrap' }}>
                  <TouchableOpacity
                    onPress={() => agregarFilaDirecta('Datos Generales')}
                    style={{
                      flex: 1,
                      minWidth: 160,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      paddingVertical: 5,
                      paddingHorizontal: 8,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 10.5 }}>
                      + Fila en Datos Generales
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => agregarFilaDirecta('Componentes Principales')}
                    style={{
                      flex: 1,
                      minWidth: 160,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      paddingVertical: 5,
                      paddingHorizontal: 8,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 10.5 }}>
                      + Fila en Componentes Principales
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Formulario para agregar renglón */}
                <View style={{ backgroundColor: colors.surface, padding: spacing.xs, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11, marginBottom: 4 }}>
                    + Agregar campo o renglón a la tabla:
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 4, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Text style={{ color: colors.muted, fontSize: 10, marginRight: 2 }}>Columna:</Text>
                    {(['Datos Generales', 'Componentes Principales', '__otra__'] as const).map((opCat) => {
                      const activo = catRenglonSel === opCat;
                      const label = opCat === '__otra__' ? 'Otra sección…' : opCat;
                      return (
                        <TouchableOpacity
                          key={opCat}
                          onPress={() => setCatRenglonSel(opCat)}
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                            borderRadius: radius.pill,
                            backgroundColor: activo ? '#16324F' : colors.surfaceAlt,
                            borderWidth: 1,
                            borderColor: activo ? '#16324F' : colors.border,
                          }}
                        >
                          <Text style={{ color: activo ? '#fff' : colors.text, fontSize: 10, fontWeight: '700' }}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {catRenglonSel === '__otra__' ? (
                    <TextInput
                      value={nuevoCampoCat}
                      onChangeText={setNuevoCampoCat}
                      placeholder="Nombre de la sección (ej. Sistema Hidráulico)"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text, marginBottom: 4 }}
                    />
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <TextInput
                      value={nuevoCampoEtq}
                      onChangeText={setNuevoCampoEtq}
                      placeholder="Nombre del campo (ej. Motor, Voltaje, Capacidad)"
                      placeholderTextColor={colors.muted}
                      style={{ flex: 1.2, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                    <TextInput
                      value={nuevoCampoVal}
                      onChangeText={setNuevoCampoVal}
                      onSubmitEditing={agregarRenglon}
                      placeholder="Valor (ej. Cummins 6BT, 1.2 m³)"
                      placeholderTextColor={colors.muted}
                      style={{ flex: 1.4, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                    <TouchableOpacity
                      onPress={agregarRenglon}
                      style={{ flex: 0.7, backgroundColor: '#16324F', borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 8 }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 11 }}>+ Añadir</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* SECCIÓN 4: FOTOS DE LA PRIMERA PÁGINA (VISTA GENERAL DEL EQUIPO) */}
              <View style={{ marginBottom: spacing.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                  <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 12, textTransform: 'uppercase' }}>
                    🖼️ Fotos de Página 1 (Vista General del Equipo)
                  </Text>
                  <View style={{ backgroundColor: '#0284c7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>PÁGINA 1</Text>
                  </View>
                </View>
                <Text style={{ color: colors.muted, fontSize: 10.5, marginBottom: spacing.xs }}>
                  Van debajo de las observaciones. Puedes poner 1, 2, 3 o más fotos en la Página 1, cambiarles el tamaño (achicar o agrandar), moverlas libremente o pasarlas a otra página.
                </Text>

                {/* 🖼️ Cómo entran las fotos (04-nov-2026): completas por defecto; vale para TODAS las fotos de la ficha. */}
                <View style={{ flexDirection: 'row', gap: 4, marginBottom: spacing.xs, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Text style={{ color: colors.muted, fontSize: 10, marginRight: 2 }}>Fotos en el PDF:</Text>
                  {([['completa', '🖼️ Completas (sin recortar)'], ['rellenar', '✂️ Rellenar el cuadro (recorta los bordes)']] as const).map(([valor, label]) => {
                    const activo = (data.encuadreFotos ?? 'completa') === valor;
                    return (
                      <TouchableOpacity
                        key={valor}
                        onPress={() => setEncuadreFotos(valor)}
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          borderRadius: radius.pill,
                          backgroundColor: activo ? '#16324F' : colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: activo ? '#16324F' : colors.border,
                        }}
                      >
                        <Text style={{ color: activo ? '#fff' : colors.text, fontSize: 10, fontWeight: '700' }}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Disposición rápida y tamaño general en Página 1 */}
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: spacing.sm, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Text style={{ color: colors.muted, fontSize: 10 }}>Fotos por fila en Pág. 1:</Text>
                  {([
                    [null, 'Auto'],
                    [1, '1 (Ancho completo)'],
                    [2, '2 por fila'],
                    [3, '3 por fila'],
                    [4, '4 por fila'],
                  ] as const).map(([colsVal, lbl]) => {
                    const act = (data.fotosP1Columnas ?? null) === colsVal;
                    return (
                      <TouchableOpacity
                        key={String(lbl)}
                        onPress={() => {
                          setData((d) => {
                            if (!d) return null;
                            const next: FichaPersonalizada = { ...d, fotosP1Columnas: colsVal };
                            programarGuardado(next);
                            return next;
                          });
                        }}
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          borderRadius: radius.pill,
                          backgroundColor: act ? '#16324F' : colors.surface,
                          borderWidth: 1,
                          borderColor: act ? '#16324F' : colors.border,
                        }}
                      >
                        <Text style={{ color: act ? '#fff' : colors.text, fontSize: 10, fontWeight: '700' }}>{lbl}</Text>
                      </TouchableOpacity>
                    );
                  })}

                  {data.fotoPrincipalUrl && data.fotoSecundariaUrl ? (
                    <TouchableOpacity
                      onPress={handleIntercambiarFotosP1}
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: radius.pill,
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: colors.border,
                        marginLeft: 'auto',
                      }}
                    >
                      <Text style={{ color: '#16324F', fontSize: 10, fontWeight: '800' }}>⇄ Intercambiar Foto 1 y 2</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                  <View style={{ flex: 2 }}>
                    <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 2 }}>Título de la sección de fotos:</Text>
                    <TextInput
                      value={data.seccionFotosTitulo ?? ''}
                      onChangeText={setSeccionFotosTitulo}
                      placeholder="VISTA GENERAL DEL EQUIPO"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 2 }}>Etiqueta lateral:</Text>
                    <TextInput
                      value={data.seccionFotosTag ?? ''}
                      onChangeText={setSeccionFotosTag}
                      placeholder="Vista en Terreno"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text }}
                    />
                  </View>
                </View>

                {/* Grid con las fotos de Página 1 */}
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {/* FOTO 1: PRINCIPAL */}
                  <View style={{ flex: 1, minWidth: 250, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 11 }}>Foto 1 · Principal (Vista Lateral / Frontal)</Text>
                      {data.fotoPrincipalUrl ? (
                        <TouchableOpacity onPress={() => eliminarFotoP1(1)} style={{ padding: 2 }}>
                          <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 11 }}>✕ Quitar</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {data.fotoPrincipalUrl ? (
                      <View style={{ marginBottom: 6 }}>
                        {renderControlesFoto({
                          uid: 'p1-slot-1',
                          url: data.fotoPrincipalUrl,
                          cfg: data.fotoPrincipalConfig ?? {},
                          altoDefaultPx: data.fotoSecundariaUrl || (data.fotosPagina1 ?? []).length > 0 ? 165 : 260,
                          origen: { tipo: 'p1-slot', slot: 1 },
                          onPatch: (patch) => actualizarConfigFotoP1(1, patch),
                        })}
                      </View>
                    ) : (
                      <View style={{ height: 70, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginBottom: 6, backgroundColor: colors.background }}>
                        <Text style={{ color: colors.muted, fontSize: 10 }}>Sin foto principal</Text>
                      </View>
                    )}

                    <TextInput
                      value={data.fotoPrincipalLeyenda ?? ''}
                      onChangeText={setFotoPrincipalLeyenda}
                      placeholder="Leyenda (ej. Vista general en campo operativo)"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 5, fontSize: 10.5, color: colors.text, marginBottom: 6 }}
                    />

                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      <TouchableOpacity
                        onPress={() => tomarFotoP1(1, 'camara')}
                        disabled={fotoTomando}
                        style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 5, alignItems: 'center' }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 10.5 }}>📷 Cámara</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => tomarFotoP1(1, 'galeria')}
                        disabled={fotoTomando}
                        style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 5, alignItems: 'center' }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 10.5 }}>🖼️ Galería</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* FOTO 2: SECUNDARIA */}
                  <View style={{ flex: 1, minWidth: 250, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 11 }}>Foto 2 · Secundaria (Vista Posterior / Cabina)</Text>
                      {data.fotoSecundariaUrl ? (
                        <TouchableOpacity onPress={() => eliminarFotoP1(2)} style={{ padding: 2 }}>
                          <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 11 }}>✕ Quitar</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {data.fotoSecundariaUrl ? (
                      <View style={{ marginBottom: 6 }}>
                        {renderControlesFoto({
                          uid: 'p1-slot-2',
                          url: data.fotoSecundariaUrl,
                          cfg: data.fotoSecundariaConfig ?? {},
                          altoDefaultPx: 165,
                          origen: { tipo: 'p1-slot', slot: 2 },
                          onPatch: (patch) => actualizarConfigFotoP1(2, patch),
                        })}
                      </View>
                    ) : (
                      <View style={{ height: 70, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginBottom: 6, backgroundColor: colors.background }}>
                        <Text style={{ color: colors.muted, fontSize: 10 }}>Opcional: si se omite, la Foto 1 ocupará el ancho</Text>
                      </View>
                    )}

                    <TextInput
                      value={data.fotoSecundariaLeyenda ?? ''}
                      onChangeText={setFotoSecundariaLeyenda}
                      placeholder="Leyenda (ej. Vista posterior de equipos auxiliares)"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 5, fontSize: 10.5, color: colors.text, marginBottom: 6 }}
                    />

                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      <TouchableOpacity
                        onPress={() => tomarFotoP1(2, 'camara')}
                        disabled={fotoTomando}
                        style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 5, alignItems: 'center' }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 10.5 }}>📷 Cámara</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => tomarFotoP1(2, 'galeria')}
                        disabled={fotoTomando}
                        style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 5, alignItems: 'center' }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 10.5 }}>🖼️ Galería</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                {/* Fotos adicionales en Página 1 (3ra, 4ta, etc.) */}
                {(data.fotosPagina1 ?? []).length > 0 ? (
                  <View style={{ marginTop: 8, gap: 8 }}>
                    <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 11 }}>
                      ➕ Más fotos en Página 1 ({(data.fotosPagina1 ?? []).length}):
                    </Text>
                    {(data.fotosPagina1 ?? []).map((fp, fpi) => (
                      <View
                        key={fp.id}
                        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8, gap: 5 }}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 11 }}>
                            Foto {fpi + 3} de Página 1
                          </Text>
                          <TouchableOpacity onPress={() => eliminarFotoExtraP1(fp.id)} style={{ padding: 2 }}>
                            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 11 }}>✕ Quitar</Text>
                          </TouchableOpacity>
                        </View>

                        {renderControlesFoto({
                          uid: `p1-extra-${fp.id}`,
                          url: fp.url,
                          cfg: fp,
                          altoDefaultPx: 165,
                          origen: { tipo: 'p1-extra', fotoId: fp.id },
                          onPatch: (patch) => actualizarFotoExtraP1(fp.id, patch),
                          onMoveOrder: (delta) => moverOrdenFotoP1Extra(fp.id, delta),
                          canMovePrev: fpi > 0,
                          canMoveNext: fpi < (data.fotosPagina1 ?? []).length - 1,
                        })}

                        <TextInput
                          value={fp.leyenda ?? ''}
                          onChangeText={(t) => actualizarFotoExtraP1(fp.id, { leyenda: t })}
                          placeholder="Título / Leyenda de la foto"
                          placeholderTextColor={colors.muted}
                          style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 5, fontSize: 10.5, fontWeight: '700', color: colors.text }}
                        />
                        <TextInput
                          value={fp.descripcion ?? ''}
                          onChangeText={(t) => actualizarFotoExtraP1(fp.id, { descripcion: t })}
                          placeholder="Explicación adicional (opcional)"
                          placeholderTextColor={colors.muted}
                          style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 5, fontSize: 10.5, color: colors.text }}
                        />
                      </View>
                    ))}
                  </View>
                ) : null}

                {/* Botón para agregar más fotos en la Página 1 */}
                <View style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '700' }}>+ Agregar más fotos en Página 1:</Text>
                  <TouchableOpacity
                    onPress={() => subirFotoExtraP1('camara')}
                    disabled={fotoTomando}
                    style={{ backgroundColor: '#16324F', borderRadius: radius.sm, paddingVertical: 5, paddingHorizontal: 10 }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 10.5 }}>📷 Cámara (+ Foto en Pág. 1)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => subirFotoExtraP1('galeria')}
                    disabled={fotoTomando}
                    style={{ backgroundColor: '#16324F', borderRadius: radius.sm, paddingVertical: 5, paddingHorizontal: 10 }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 10.5 }}>🖼️ Galería (+ Foto en Pág. 1)</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* SECCIÓN 5: APARTADO DE OBSERVACIONES Y CUADROS DE TEXTO (PÁGINA 2) */}
              <View style={{ marginBottom: spacing.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12, textTransform: 'uppercase' }}>
                    📝 Observaciones de inspección
                  </Text>
                  <View style={{ backgroundColor: '#0284c7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>PÁGINA 1</Text>
                  </View>
                </View>
                <Text style={{ color: colors.muted, fontSize: 10.5, marginBottom: spacing.xs }}>
                  Salen en un solo recuadro debajo de las especificaciones, cada una como «Título: texto». Estado General, Componentes y Anexo ya vienen puestos; la que quede vacía no sale en el PDF.
                </Text>
                <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 2 }}>Título del recuadro:</Text>
                <TextInput
                  value={data.seccionObsTitulo ?? 'OBSERVACIONES DE INSPECCIÓN'}
                  onChangeText={setSeccionObsTitulo}
                  placeholder="OBSERVACIONES DE INSPECCIÓN"
                  placeholderTextColor={colors.muted}
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text, marginBottom: spacing.xs }}
                />

                {(data.observaciones ?? []).map((o) => (
                  <View
                    key={o.id}
                    style={{
                      backgroundColor: colors.surface,
                      borderLeftWidth: 4,
                      borderLeftColor: '#EAB308',
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      padding: 8,
                      marginBottom: 6,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <TextInput
                        value={o.titulo}
                        onChangeText={(txt) => actualizarObservacion(o.id, { titulo: txt })}
                        placeholder="Título (ej. Estado General)"
                        placeholderTextColor={colors.muted}
                        style={{ flex: 1, color: colors.text, fontWeight: '800', fontSize: 11.5, padding: 2 }}
                      />
                      <TouchableOpacity onPress={() => eliminarObservacion(o.id)} style={{ padding: 4 }}>
                        <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      value={o.texto}
                      onChangeText={(txt) => actualizarObservacion(o.id, { texto: txt })}
                      multiline
                      placeholder={ayudaCampoFicha(o.id) ?? 'Escribe la observación…'}
                      placeholderTextColor={colors.muted}
                      style={{ color: colors.text, fontSize: 11, marginTop: 2, padding: 6, minHeight: 40, backgroundColor: colors.background, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}
                    />
                  </View>
                ))}

                {/* Formulario para agregar observación */}
                <View style={{ backgroundColor: colors.surface, padding: spacing.xs, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11, marginBottom: 4 }}>+ Agregar observación / cuadro de texto:</Text>
                  <TextInput
                    value={nuevaObsTit}
                    onChangeText={setNuevaObsTit}
                    placeholder="Título (ej. Cabina Super Silenciosa o Condiciones)"
                    placeholderTextColor={colors.muted}
                    style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text, marginBottom: 4 }}
                  />
                  <TextInput
                    value={nuevaObsTxt}
                    onChangeText={setNuevaObsTxt}
                    multiline
                    numberOfLines={3}
                    placeholder="Detalles y observaciones del equipo…"
                    placeholderTextColor={colors.muted}
                    style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text, marginBottom: 6, minHeight: 48 }}
                  />
                  <TouchableOpacity
                    onPress={agregarObservacion}
                    style={{ backgroundColor: colors.primary, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center', paddingVertical: 6 }}
                  >
                    <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 11 }}>Añadir Observación</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* SECCIÓN 6: 📎 ANEXO FOTOGRÁFICO POR SECCIONES (01-nov-2026) */}
              <View style={{ marginBottom: spacing.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12, textTransform: 'uppercase' }}>
                    📎 Anexo fotográfico por secciones
                  </Text>
                  <View style={{ backgroundColor: '#64748b', paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>PÁGINA 2 EN ADELANTE</Text>
                  </View>
                </View>
                <Text style={{ color: colors.muted, fontSize: 10.5, marginBottom: spacing.xs }}>
                  Cada sección puede empezar en página nueva o seguir en la misma página anterior (para no dejar hojas en blanco). Elige 1, 2, 3 o 4 fotos por fila, cámbiales el tamaño (➖/➕), muévelas libremente o pásalas de una página a otra.
                </Text>

                {(data.anexos ?? []).map((a, ai) => {
                  const colsAct = a.columnas === 1 ? 1 : a.columnas === 3 ? 3 : a.columnas === 4 ? 4 : 2;
                  const altoBaseSeccion = a.altoFotosPx && a.altoFotosPx > 0
                    ? Math.round(a.altoFotosPx)
                    : colsAct === 1 ? 360 : colsAct === 3 ? 190 : colsAct === 4 ? 145 : 290;
                  return (
                  <View
                    key={a.id}
                    style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8, marginBottom: 8, gap: 6 }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ color: colors.text, fontWeight: '900', fontSize: 12 }}>{ai + 1}.</Text>
                      <TextInput
                        value={a.titulo}
                        onChangeText={(t) => actualizarSeccionAnexo(a.id, { titulo: t })}
                        placeholder="Título de la sección (ej. CABINA DE MANDO Y PANEL DE INSTRUMENTOS)"
                        placeholderTextColor={colors.muted}
                        autoCapitalize="characters"
                        style={{ flex: 1, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, fontWeight: '800', color: colors.text }}
                      />
                      <TouchableOpacity onPress={() => moverSeccionAnexo(a.id, -1)} disabled={ai === 0} style={{ padding: 4, opacity: ai === 0 ? 0.3 : 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '900' }}>▲</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => moverSeccionAnexo(a.id, 1)} disabled={ai === (data.anexos ?? []).length - 1} style={{ padding: 4, opacity: ai === (data.anexos ?? []).length - 1 ? 0.3 : 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '900' }}>▼</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => eliminarSeccionAnexo(a.id)} style={{ padding: 4 }}>
                        <Text style={{ color: colors.danger, fontWeight: '900' }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      value={a.subtitulo ?? ''}
                      onChangeText={(t) => actualizarSeccionAnexo(a.id, { subtitulo: t })}
                      placeholder="Explicación de la sección (opcional)"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 10.5, color: colors.text }}
                    />

                    {/* Controles de la sección: Fotos por fila (1, 2, 3, 4), Salto de página y Tamaño general */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                      <Text style={{ color: colors.muted, fontSize: 10 }}>Fotos por fila:</Text>
                      {([1, 2, 3, 4] as const).map((n) => {
                        const activo = colsAct === n;
                        return (
                          <TouchableOpacity
                            key={n}
                            onPress={() => actualizarSeccionAnexo(a.id, { columnas: n })}
                            style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: activo ? '#16324F' : colors.surfaceAlt, borderWidth: 1, borderColor: activo ? '#16324F' : colors.border }}
                          >
                            <Text style={{ color: activo ? '#fff' : colors.text, fontSize: 10, fontWeight: '700' }}>{n}</Text>
                          </TouchableOpacity>
                        );
                      })}

                      <Text style={{ color: colors.muted, fontSize: 10, marginLeft: 4 }}>Tamaño sección:</Text>
                      <TouchableOpacity
                        onPress={() => actualizarSeccionAnexo(a.id, { altoFotosPx: Math.max(90, altoBaseSeccion - 25) })}
                        style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}
                      >
                        <Text style={{ color: colors.text, fontSize: 9.5, fontWeight: '800' }}>➖</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => actualizarSeccionAnexo(a.id, { altoFotosPx: null })}
                        style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: a.altoFotosPx ? '#e0f2fe' : colors.surfaceAlt, borderWidth: 1, borderColor: a.altoFotosPx ? '#0284c7' : colors.border }}
                      >
                        <Text style={{ color: '#16324F', fontSize: 9.5, fontWeight: '800' }}>
                          {a.altoFotosPx ? `${altoBaseSeccion}px` : 'Auto'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => actualizarSeccionAnexo(a.id, { altoFotosPx: Math.min(600, altoBaseSeccion + 25) })}
                        style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}
                      >
                        <Text style={{ color: colors.text, fontSize: 9.5, fontWeight: '800' }}>➕</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => actualizarSeccionAnexo(a.id, { mismaPagina: !a.mismaPagina })}
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          borderRadius: radius.pill,
                          backgroundColor: a.mismaPagina ? '#0284c7' : colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: a.mismaPagina ? '#0284c7' : colors.border,
                          marginLeft: 'auto',
                        }}
                      >
                        <Text style={{ color: a.mismaPagina ? '#fff' : colors.text, fontSize: 9.5, fontWeight: '800' }}>
                          {a.mismaPagina ? '⬆️ Sigue en la misma página anterior' : '📄 Empieza en página nueva'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {(a.fotos ?? []).map((f, fi) => (
                      <View key={f.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, gap: 5 }}>
                        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                          <Text style={{ color: '#16324F', fontWeight: '900', fontSize: 10.5 }}>
                            Foto {fi + 1}
                          </Text>
                          <TextInput
                            value={f.leyenda ?? ''}
                            onChangeText={(t) => actualizarFotoAnexo(a.id, f.id, { leyenda: t })}
                            placeholder="Título de la foto (ej. FILTRO DE AIRE)"
                            placeholderTextColor={colors.muted}
                            autoCapitalize="characters"
                            style={{ flex: 1, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 5, fontSize: 10.5, fontWeight: '700', color: colors.text }}
                          />
                          <TouchableOpacity onPress={() => eliminarFotoAnexo(a.id, f.id)} style={{ padding: 4 }}>
                            <Text style={{ color: colors.danger, fontWeight: '900' }}>✕ Quitar</Text>
                          </TouchableOpacity>
                        </View>

                        <TextInput
                          value={f.descripcion ?? ''}
                          onChangeText={(t) => actualizarFotoAnexo(a.id, f.id, { descripcion: t })}
                          placeholder="Qué se ve / explicación (opcional, ej. Parte N° 800194923)"
                          placeholderTextColor={colors.muted}
                          style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 5, fontSize: 10.5, color: colors.text }}
                        />

                        {renderControlesFoto({
                          uid: `anx-${a.id}-${f.id}`,
                          url: f.url,
                          cfg: f,
                          altoDefaultPx: altoBaseSeccion,
                          origen: { tipo: 'anexo', seccionId: a.id, fotoId: f.id },
                          onPatch: (patch) => actualizarFotoAnexo(a.id, f.id, patch),
                          onMoveOrder: (delta) => moverFotoEnSeccionAnexo(a.id, f.id, delta),
                          canMovePrev: fi > 0,
                          canMoveNext: fi < (a.fotos ?? []).length - 1,
                        })}
                      </View>
                    ))}

                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      <TouchableOpacity
                        onPress={() => subirFotoASeccion(a.id, 'camara')}
                        disabled={!!subiendoEn}
                        style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 5, paddingHorizontal: 8 }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 10.5 }}>{subiendoEn === a.id ? 'Subiendo…' : '📷 Cámara'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => subirFotoASeccion(a.id, 'galeria')}
                        disabled={!!subiendoEn}
                        style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 5, paddingHorizontal: 8 }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 10.5 }}>🖼️ Galería</Text>
                      </TouchableOpacity>
                      {machine.photo_serial_url ? (
                        <TouchableOpacity
                          onPress={() => agregarFotoASeccion(a.id, machine.photo_serial_url!, 'PLACA DE IDENTIFICACIÓN DEL EQUIPO')}
                          style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 5, paddingHorizontal: 8 }}
                        >
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 10.5 }}>🔖 Foto de la placa (catálogo)</Text>
                        </TouchableOpacity>
                      ) : null}
                      {machine.fotoHorometroUrl ? (
                        <TouchableOpacity
                          onPress={() => agregarFotoASeccion(a.id, machine.fotoHorometroUrl!, 'LECTURA DEL HORÓMETRO')}
                          style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 5, paddingHorizontal: 8 }}
                        >
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 10.5 }}>⏱️ Última foto del horómetro</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                  );
                })}

                <Text style={{ color: colors.muted, fontSize: 10, marginBottom: 4 }}>+ Agregar sección:</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {SECCIONES_ANEXO_SUGERIDAS.map((t) => (
                    <TouchableOpacity
                      key={t}
                      onPress={() => agregarSeccionAnexo(t)}
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10 }}
                    >
                      <Text style={{ color: colors.text, fontSize: 10.5, fontWeight: '700' }}>{t}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    onPress={() => agregarSeccionAnexo('')}
                    style={{ backgroundColor: '#16324F', borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10 }}
                  >
                    <Text style={{ color: '#fff', fontSize: 10.5, fontWeight: '800' }}>+ Sección en blanco</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* SECCIÓN 7: FOTOS EXTRAS DE ANTES (sin sección). Solo aparece si la
                  ficha todavía tiene alguna; en el PDF salen como una sección más del anexo. */}
              {(data.fotosExtra ?? []).length > 0 ? (
              <View style={{ marginBottom: spacing.md, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                  <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 12, textTransform: 'uppercase' }}>
                    📷 Fotos de Componentes y Detalles (Página 2 / Anexo)
                  </Text>
                  <View style={{ backgroundColor: '#64748b', paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>PÁGINA 2</Text>
                  </View>
                </View>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm }}>
                  {(data.fotosExtra ?? []).map((f) => (
                    <View
                      key={f.id}
                      style={{
                        width: 150,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.sm,
                        overflow: 'hidden',
                        backgroundColor: colors.surface,
                      }}
                    >
                      <Image source={{ uri: f.url }} style={{ width: 150, height: 90 }} />
                      <View style={{ padding: 5, gap: 4 }}>
                        <Text style={{ color: colors.text, fontSize: 9.5 }} numberOfLines={2}>{f.leyenda || 'Foto'}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'space-between' }}>
                          <TouchableOpacity
                            onPress={() => handleMoverFotoEntrePaginas({ tipo: 'fotos-extra', fotoId: f.id }, { tipo: 'p1' }, 'Página 1')}
                            style={{ backgroundColor: '#0284c7', borderRadius: 4, paddingVertical: 2, paddingHorizontal: 5 }}
                          >
                            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 9 }}>➔ Pág. 1</Text>
                          </TouchableOpacity>
                          {(data.anexos ?? [])[0] ? (
                            <TouchableOpacity
                              onPress={() => handleMoverFotoEntrePaginas({ tipo: 'fotos-extra', fotoId: f.id }, { tipo: 'anexo', seccionId: data.anexos![0].id }, 'Sección 1')}
                              style={{ backgroundColor: '#16324F', borderRadius: 4, paddingVertical: 2, paddingHorizontal: 5 }}
                            >
                              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 9 }}>➔ Sec. 1</Text>
                            </TouchableOpacity>
                          ) : null}
                          <TouchableOpacity onPress={() => eliminarFotoExtra(f.id)}>
                            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 10 }}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>

                {/* Formulario para agregar foto extra */}
                <View style={{ backgroundColor: colors.surface, padding: spacing.xs, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11, marginBottom: 4 }}>+ Agregar foto de componente / detalle:</Text>
                  <TextInput
                    value={nuevaFotoLeyenda}
                    onChangeText={setNuevaFotoLeyenda}
                    placeholder="Leyenda (ej. Vista Posterior - Atenuación Acústica)"
                    placeholderTextColor={colors.muted}
                    style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, fontSize: 11, color: colors.text, marginBottom: 6 }}
                  />
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity
                      onPress={() => tomarFotoExtra('camara')}
                      disabled={fotoTomando}
                      style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, alignItems: 'center' }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>📷 Tomar Foto</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => tomarFotoExtra('galeria')}
                      disabled={fotoTomando}
                      style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 6, alignItems: 'center' }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>🖼️ Elegir Galería</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
              ) : null}
            </ScrollView>
          )}

          {/* Pie de acciones del modal */}
          <View
            style={{
              padding: spacing.md,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              backgroundColor: colors.surface,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: spacing.xs,
              flexWrap: 'wrap',
            }}
          >
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <TouchableOpacity
                onPress={guardar}
                style={{ paddingHorizontal: spacing.sm, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}
              >
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>💾 Guardar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={restablecer}
                style={{ paddingHorizontal: spacing.sm, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}
              >
                <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>🔄 Restablecer</Text>
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <TouchableOpacity
                onPress={cerrar}
                style={{ paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}
              >
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Cerrar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleExport}
                disabled={exporting}
                style={{
                  paddingHorizontal: spacing.lg,
                  paddingVertical: 8,
                  borderRadius: radius.sm,
                  backgroundColor: '#16324F',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  opacity: exporting ? 0.6 : 1,
                }}
              >
                {exporting ? <ActivityIndicator size="small" color="#fff" /> : null}
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>
                  {exporting ? 'Generando…' : '📄 Exportar PDF'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
