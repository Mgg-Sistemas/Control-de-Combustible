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
  ayudaCampoFicha,
  ordenarRenglonesComoReferencia,
  SECCIONES_ANEXO_SUGERIDAS,
  nombreDeMaquina,
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

  /** Guarda un momento después de dejar de escribir. */
  const programarGuardado = (next: FichaPersonalizada) => {
    if (temporizadorGuardado.current) clearTimeout(temporizadorGuardado.current);
    temporizadorGuardado.current = setTimeout(() => {
      temporizadorGuardado.current = null;
      saveFichaPersonalizada(mid, next).then(avisarSiNoLlegoALaNube).catch(() => {});
    }, 800);
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
      saveFichaPersonalizada(mid, data).then(avisarSiNoLlegoALaNube).catch(() => {});
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

  // Manejo de fotos de Página 1
  const tomarFotoP1 = async (slot: 1 | 2, via: 'camara' | 'galeria') => {
    if (fotoTomando) return;
    setFotoTomando(true);
    try {
      const res = via === 'galeria' ? await elegirFotoLocal() : await capturarFotoLocal();
      if (res.ok && res.dataUrl) {
        if (slot === 1) {
          setData((d) => (d ? {
            ...d,
            fotoPrincipalUrl: res.dataUrl,
            fotoPrincipalLeyenda: d.fotoPrincipalLeyenda || 'Vista general de la unidad en campo operativo',
          } : null));
        } else {
          setData((d) => (d ? {
            ...d,
            fotoSecundariaUrl: res.dataUrl,
            fotoSecundariaLeyenda: d.fotoSecundariaLeyenda || 'Vista posterior / lateral del equipo',
          } : null));
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
      setData((d) => (d ? { ...d, fotoPrincipalUrl: null, fotoPrincipalLeyenda: null } : null));
    } else {
      setData((d) => (d ? { ...d, fotoSecundariaUrl: null, fotoSecundariaLeyenda: null } : null));
    }
    toast.info(`Foto ${slot} de Página 1 quitada.`);
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
      as.map((a) => (a.id === secId ? { ...a, fotos: (a.fotos ?? []).map((f) => (f.id === fotoId ? { ...f, ...patch } : f)) } : a))
    );

  const eliminarFotoAnexo = (secId: string, fotoId: string) =>
    cambiarAnexos((as) => as.map((a) => (a.id === secId ? { ...a, fotos: (a.fotos ?? []).filter((f) => f.id !== fotoId) } : a)));

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
                  Van debajo de las observaciones. Con una sola foto sale a todo lo ancho; con dos, lado a lado. Título y leyenda vacíos = la foto sale sola, como la ficha de referencia.
                </Text>

                {/* 🖼️ Cómo entran las fotos (04-nov-2026): completas por defecto; vale para TODAS las fotos de la ficha. */}
                <View style={{ flexDirection: 'row', gap: 4, marginBottom: spacing.sm, flexWrap: 'wrap', alignItems: 'center' }}>
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

                {/* Grid con las 2 fotos de Página 1 */}
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {/* FOTO 1: PRINCIPAL */}
                  <View style={{ flex: 1, minWidth: 240, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 11 }}>Foto 1 · Principal (Vista Lateral / Frontal)</Text>
                      {data.fotoPrincipalUrl ? (
                        <TouchableOpacity onPress={() => eliminarFotoP1(1)} style={{ padding: 2 }}>
                          <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 11 }}>✕ Quitar</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {data.fotoPrincipalUrl ? (
                      <View style={{ height: 110, borderRadius: radius.sm, overflow: 'hidden', marginBottom: 6, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: colors.border }}>
                        <Image source={{ uri: data.fotoPrincipalUrl }} style={{ width: '100%', height: '100%', resizeMode: 'cover' }} />
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
                  <View style={{ flex: 1, minWidth: 240, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Text style={{ color: '#16324F', fontWeight: '800', fontSize: 11 }}>Foto 2 · Secundaria (Vista Posterior / Cabina)</Text>
                      {data.fotoSecundariaUrl ? (
                        <TouchableOpacity onPress={() => eliminarFotoP1(2)} style={{ padding: 2 }}>
                          <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 11 }}>✕ Quitar</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {data.fotoSecundariaUrl ? (
                      <View style={{ height: 110, borderRadius: radius.sm, overflow: 'hidden', marginBottom: 6, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: colors.border }}>
                        <Image source={{ uri: data.fotoSecundariaUrl }} style={{ width: '100%', height: '100%', resizeMode: 'cover' }} />
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
                  Cada sección sale en su propia página, numerada («1. VISTAS ESTRUCTURALES…»), con sus fotos en 2 o 3 columnas. A cada foto ponle un título (sale en negrita debajo) y, si hace falta, una explicación. Las fotos se suben a la nube; la sección sin fotos no sale.
                </Text>

                {(data.anexos ?? []).map((a, ai) => (
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
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={{ color: colors.muted, fontSize: 10 }}>Fotos por fila:</Text>
                      {([2, 3] as const).map((n) => {
                        const activo = (a.columnas === 3 ? 3 : 2) === n;
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
                    </View>

                    {(a.fotos ?? []).map((f) => (
                      <View key={f.id} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 }}>
                        <Image source={{ uri: f.url }} style={{ width: 72, height: 56, borderRadius: radius.sm, backgroundColor: colors.background }} />
                        <View style={{ flex: 1, gap: 4 }}>
                          <TextInput
                            value={f.leyenda ?? ''}
                            onChangeText={(t) => actualizarFotoAnexo(a.id, f.id, { leyenda: t })}
                            placeholder="Título de la foto (ej. FILTRO DE AIRE)"
                            placeholderTextColor={colors.muted}
                            autoCapitalize="characters"
                            style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 5, fontSize: 10.5, fontWeight: '700', color: colors.text }}
                          />
                          <TextInput
                            value={f.descripcion ?? ''}
                            onChangeText={(t) => actualizarFotoAnexo(a.id, f.id, { descripcion: t })}
                            placeholder="Qué se ve (opcional, ej. Parte N° 800194923)"
                            placeholderTextColor={colors.muted}
                            style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 5, fontSize: 10.5, color: colors.text }}
                          />
                        </View>
                        <TouchableOpacity onPress={() => eliminarFotoAnexo(a.id, f.id)} style={{ padding: 4 }}>
                          <Text style={{ color: colors.danger, fontWeight: '900' }}>✕</Text>
                        </TouchableOpacity>
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
                ))}

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
                        width: 110,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.sm,
                        overflow: 'hidden',
                        backgroundColor: colors.surface,
                      }}
                    >
                      <Image source={{ uri: f.url }} style={{ width: 110, height: 80 }} />
                      <View style={{ padding: 4 }}>
                        <Text style={{ color: colors.text, fontSize: 9.5 }} numberOfLines={2}>{f.leyenda || 'Foto'}</Text>
                        <TouchableOpacity onPress={() => eliminarFotoExtra(f.id)} style={{ alignSelf: 'flex-end', marginTop: 2 }}>
                          <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 11 }}>Eliminar</Text>
                        </TouchableOpacity>
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
