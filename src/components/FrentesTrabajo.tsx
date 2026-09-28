// ⛏️ FRENTES DE TRABAJO (28-sep-2026) — subsección de «🏗️ Obras y ubicaciones».
//
// El FRENTE es de DÓNDE recogen los camiones el material que después llevan a
// los CDT/CDF (las obras/ubicaciones son el destino; el frente, el origen).
// Pedido del cliente, con sus cuatro piezas:
//   1) CREAR frentes (y apagarlos sin borrar, como los tipos de viaje).
//   2) ASIGNAR el frente DEL DÍA a cada camión, a varios de una vez o a un
//      grupo — con BUSCADOR de camiones (placa, código, serial, empresa…).
//   3) Cada viaje que se registre ese día CONGELA el frente de su camión
//      (eso lo hace la pantalla al registrar; acá solo se administra).
//   4) A un viaje YA HECHO el frente se le pone en ✏️ Editar (en la pantalla).
//
// ⚠️ REASIGNAR NO TOCA LO REGISTRADO: cada viaje se llevó su frente puesto al
//    grabarse (misma regla que la obra y la placa). Cambiar la asignación del
//    camión a mediodía solo afecta los viajes que registre DESPUÉS.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { DateField } from './DateField';
import {
  listAsignacionesFrente, asignarFrente, quitarAsignacionFrente,
  crearFrente, setActivoFrente,
  type FrenteTrabajo, type AsignacionFrente,
} from '../lib/camionViajes';

/** Lo que hace falta de cada camión para el buscador de la asignación. */
export type CamionParaFrente = {
  id: string;
  code: string;
  plate?: string | null;
  serial?: string | null;
  companyName?: string | null;
  marca?: string | null;
  modelo?: string | null;
};

type Props = {
  frentes: FrenteTrabajo[];
  faltaSql: boolean;
  canFull: boolean;
  camiones: CamionParaFrente[];
  /** La jornada de HOY (negocio, 7am a 7am), para arrancar el día correcto. */
  jornadaHoy: string;
  uid: string | null;
  userName: string | null;
  /** Recarga los frentes Y las asignaciones que la pantalla congela al registrar. */
  onCambio: () => void;
};

const norm = (s: unknown) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function FrentesTrabajo({ frentes, faltaSql, canFull, camiones, jornadaHoy, uid, userName, onCambio }: Props) {
  const { colors } = useTheme();
  const toast = useToast();

  const [nuevo, setNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);
  // ── La asignación del día ──
  const [fecha, setFecha] = useState(jornadaHoy);
  const [frenteSel, setFrenteSel] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [asignaciones, setAsignaciones] = useState<AsignacionFrente[]>([]);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return;
    listAsignacionesFrente(fecha).then((r) => {
      if (!vivo) return;
      setAsignaciones(r.asignaciones);
      if (r.error && !r.missing) console.warn('[frentes] no se pudo leer las asignaciones:', r.error);
    });
    return () => { vivo = false; };
  }, [fecha, recarga]);

  const activos = useMemo(() => frentes.filter((f) => f.activo), [frentes]);
  const asignadoA = useMemo(() => new Map(asignaciones.map((a) => [a.machineryId, a])), [asignaciones]);

  // El buscador: por código, placa, serial, empresa, marca o modelo — el mismo
  // criterio del buscador de taras, porque el problema es el mismo (treinta
  // camiones que se llaman todos «CAMION VOLTEO TORONTO»).
  const camionesFiltrados = useMemo(() => {
    const q = norm(query).trim();
    if (!q) return camiones;
    return camiones.filter((c) =>
      [c.code, c.plate, c.serial, c.companyName, c.marca, c.modelo].some((v) => norm(v).includes(q)));
  }, [camiones, query]);

  const toggleCamion = (id: string) =>
    setMarcados((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const crear = async () => {
    setGuardando(true);
    const { error } = await crearFrente(nuevo, uid, userName);
    setGuardando(false);
    if (error) { toast.error(error); return; }
    setNuevo('');
    toast.success('Frente creado.');
    onCambio();
  };

  const alternar = async (f: FrenteTrabajo) => {
    const { error } = await setActivoFrente(f.id, !f.activo, userName);
    if (error) { toast.error(error); return; }
    toast.success(f.activo
      ? 'Frente desactivado: deja de ofrecerse, pero los viajes que ya lo llevan no cambian.'
      : 'Frente activado.');
    onCambio();
  };

  const asignar = async () => {
    if (!frenteSel) { toast.error('Elige primero el frente.'); return; }
    if (marcados.size === 0) { toast.error('Marca al menos un camión (usa el buscador).'); return; }
    setGuardando(true);
    const { error } = await asignarFrente(fecha, Array.from(marcados), frenteSel, uid, userName);
    setGuardando(false);
    if (error) { toast.error(error); return; }
    const nombre = activos.find((f) => f.id === frenteSel)?.nombre ?? '';
    toast.success(`${marcados.size} camión(es) al frente «${nombre}» el ${fecha.split('-').reverse().join('/')}. Los viajes ya registrados no cambian.`);
    setMarcados(new Set());
    setRecarga((n) => n + 1);
    onCambio();
  };

  const quitar = async (a: AsignacionFrente) => {
    const { error } = await quitarAsignacionFrente(fecha, a.machineryId);
    if (error) { toast.error(error); return; }
    setRecarga((n) => n + 1);
    onCambio();
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text } as const;
  const codigoDe = (id: string) => {
    const c = camiones.find((x) => x.id === id);
    return c ? `${c.code}${c.plate ? ` · ${c.plate}` : c.serial ? ` · ${c.serial}` : ''}` : '(camión fuera del catálogo)';
  };

  return (
    <View style={{ marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>⛏️ FRENTES DE TRABAJO · {activos.length}</Text>
      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
        El frente es DE DÓNDE recogen los camiones lo que llevan a los CDT/CDF. Asigna el frente del
        día a cada camión (o a varios de una vez): cada viaje que se registre ese día queda con ese
        frente congelado. Reasignar no toca los viajes ya registrados; a uno viejo se le pone en ✏️ Editar.
      </Text>

      {faltaSql ? (
        <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12, marginTop: spacing.xs }}>
          ⚠️ Falta correr el SQL de los frentes en la base. Avisa al administrador.
        </Text>
      ) : (
        <>
          {/* ── El catálogo ── */}
          {canFull ? (
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
              <TextInput
                value={nuevo}
                onChangeText={setNuevo}
                placeholder="Nombre del frente nuevo (ej. Frente norte)"
                placeholderTextColor={colors.muted}
                style={[input, { flex: 1 }]}
              />
              <TouchableOpacity disabled={guardando} onPress={crear}
                style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, justifyContent: 'center', opacity: guardando ? 0.6 : 1 }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>+ Crear</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {frentes.length === 0 ? (
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Todavía no hay frentes creados.</Text>
          ) : (
            <View style={{ marginTop: spacing.xs }}>
              {frentes.map((f) => (
                <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ color: f.activo ? colors.text : colors.muted, fontWeight: '700', fontSize: 12.5, flex: 1 }}>
                    ⛏️ {f.nombre}{f.activo ? '' : ' · DESACTIVADO'}
                  </Text>
                  {canFull ? (
                    <TouchableOpacity onPress={() => alternar(f)}>
                      <Text style={{ color: f.activo ? colors.danger : colors.success, fontWeight: '800', fontSize: 12 }}>
                        {f.activo ? '🚫 Desactivar' : '✓ Activar'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
            </View>
          )}

          {/* ── La asignación del día ── */}
          {canFull && activos.length > 0 ? (
            <View style={{ marginTop: spacing.md }}>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>ASIGNAR EL FRENTE DEL DÍA</Text>
              <View style={{ marginTop: spacing.xs }}>
                <DateField value={fecha} onChange={setFecha} />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                {activos.map((f) => {
                  const on = frenteSel === f.id;
                  return (
                    <TouchableOpacity key={f.id} onPress={() => setFrenteSel(on ? null : f.id)}
                      style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5 }}>
                      <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>⛏️ {f.nombre}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="🔎 Buscar camión: placa, código, serial, empresa…"
                placeholderTextColor={colors.muted}
                style={[input, { marginTop: spacing.xs }]}
                autoCorrect={false}
              />
              <ScrollView style={{ maxHeight: 240, marginTop: spacing.xs }} nestedScrollEnabled>
                {camionesFiltrados.length === 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Ningún camión coincide con la búsqueda.</Text>
                ) : camionesFiltrados.map((c) => {
                  const on = marcados.has(c.id);
                  const ya = asignadoA.get(c.id);
                  return (
                    <TouchableOpacity key={c.id} onPress={() => toggleCamion(c.id)}
                      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <Text style={{ fontSize: 14, width: 24 }}>{on ? '☑️' : '⬜'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12.5 }}>
                          🚜 {c.code}{c.plate ? ` · ${c.plate}` : c.serial ? ` · ${c.serial}` : ''}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 10.5 }}>
                          {[c.companyName, [c.marca, c.modelo].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || ' '}
                          {ya ? `  · ya: ⛏️ ${ya.frenteNombre}` : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <TouchableOpacity disabled={guardando} onPress={asignar}
                style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: guardando ? 0.6 : 1 }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>
                  ⛏️ Asignar {marcados.size > 0 ? `${marcados.size} camión(es)` : ''} al frente
                </Text>
              </TouchableOpacity>

              {/* Lo asignado ese día, agrupado por frente, con su ✕. */}
              {asignaciones.length > 0 ? (
                <View style={{ marginTop: spacing.sm }}>
                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>ASIGNADOS ESE DÍA · {asignaciones.length}</Text>
                  {activos.filter((f) => asignaciones.some((a) => a.frenteId === f.id)).map((f) => (
                    <View key={`g-${f.id}`} style={{ marginTop: 4 }}>
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>⛏️ {f.nombre}</Text>
                      {asignaciones.filter((a) => a.frenteId === f.id).map((a) => (
                        <View key={a.machineryId} style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.sm, paddingVertical: 2 }}>
                          <Text style={{ color: colors.text, fontSize: 12, flex: 1 }}>🚜 {codigoDe(a.machineryId)}</Text>
                          <TouchableOpacity onPress={() => quitar(a)}>
                            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}
