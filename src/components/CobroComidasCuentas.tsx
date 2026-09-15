// COBRO DE COMIDAS · cuentas (15-sep-2026).
//
// Pestaña «👤 Cuentas» de la ventana de precios. Por cada empresa y cada departamento de
// la nómina propia, desde una fecha: si SE COBRA o es CONSUMO INTERNO, y quién es su
// ENCARGADO (el catálogo de encargados de Mangueras). Es historial: cambiar agrega una
// fila y no toca lo anterior. Sin configurar, una empresa se cobra y la nómina no.
//
// Las reglas (qué configuración rige) viven en src/lib/cobroComidas.ts.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Card } from './ui';
import { DateField } from './DateField';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { cmpText, norm } from '../lib/text';
import { configCuentaEn, indexarConfigCuentas, seCobraPorDefecto, ConfigCuenta, TipoCuenta } from '../lib/cobroComidas';
import {
  cargarConfigCuentas,
  cargarCuentasCatalogo,
  cargarEncargados,
  guardarConfigCuentas,
  CuentasCatalogo,
  EncargadoCatalogo,
} from '../lib/cobroComidasDb';

type Props = {
  canEdit: boolean;
  hoy: string;
  /** Se llama después de guardar, para que el cobro recalcule. */
  onChanged: () => void;
};

type FilaCuenta = { tipo: TipoCuenta; clave: string; nombre: string; foodOnly?: boolean };

const dmy = (iso?: string | null) => {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
};

export function CobroComidasCuentas({ canEdit, hoy, onChanged }: Props) {
  const { colors } = useTheme();
  const [catalogo, setCatalogo] = useState<CuentasCatalogo | null>(null);
  const [encargados, setEncargados] = useState<EncargadoCatalogo[]>([]);
  const [config, setConfig] = useState<ConfigCuenta[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [fecha, setFecha] = useState(hoy);
  const [buscar, setBuscar] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [cat, enc, cfg] = await Promise.all([cargarCuentasCatalogo(), cargarEncargados(), cargarConfigCuentas()]);
      setCatalogo(cat);
      setEncargados(enc);
      setConfig(cfg);
      setError(null);
    } catch (e: any) {
      setError(`No se pudieron leer las cuentas (${e?.message ?? 'revisa la conexión'}).`);
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const idx = useMemo(() => indexarConfigCuentas(config), [config]);
  const nombreEncargado = useMemo(() => new Map(encargados.map((e) => [e.id, e.name])), [encargados]);
  const activos = useMemo(() => encargados.filter((e) => e.active).sort((a, b) => cmpText(a.name, b.name)), [encargados]);

  const filas = useMemo(() => {
    if (!catalogo) return { empresas: [] as FilaCuenta[], departamentos: [] as FilaCuenta[] };
    const q = norm(buscar.trim());
    const pasa = (f: FilaCuenta) => !q || norm(f.nombre).includes(q);
    return {
      empresas: catalogo.empresas
        .map((e) => ({ tipo: 'empresa' as const, clave: e.id, nombre: e.name, foodOnly: e.foodOnly }))
        .filter(pasa)
        .sort((a, b) => cmpText(a.nombre, b.nombre)),
      departamentos: catalogo.departamentos
        .map((d) => ({ tipo: 'departamento' as const, clave: d, nombre: d }))
        .filter(pasa),
    };
  }, [catalogo, buscar]);

  const estado = (f: FilaCuenta) => {
    const cfg = configCuentaEn(idx, f.tipo, f.clave, fecha);
    return { cfg, seCobra: cfg ? cfg.se_cobra : seCobraPorDefecto(f.tipo), encargadoId: cfg?.encargado_id ?? null };
  };

  const guardar = async (f: FilaCuenta, cambio: { seCobra?: boolean; encargadoId?: string | null }) => {
    const actual = estado(f);
    const seCobra = cambio.seCobra ?? actual.seCobra;
    const encargadoId = cambio.encargadoId !== undefined ? cambio.encargadoId : actual.encargadoId;
    const k = `${f.tipo}|${f.clave}`;
    setGuardando(k);
    setAviso(null);
    const { error: err } = await guardarConfigCuentas([{ tipo: f.tipo, clave: f.clave, desde: fecha, encargadoId, seCobra }]);
    setGuardando(null);
    if (err) { setAviso(`❌ ${err}`); return; }
    setAbierto(null);
    setAviso(`✅ ${f.nombre}: ${seCobra ? '💵 se cobra' : '🏠 consumo interno'} · 👤 ${encargadoId ? nombreEncargado.get(encargadoId) ?? 'encargado' : 'sin encargado'}, desde el ${dmy(fecha)}. Lo anterior no cambia.`);
    await cargar();
    onChanged();
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const chip = (activo: boolean) => ({ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: activo ? colors.brand : colors.border, backgroundColor: activo ? colors.brand : colors.surface });
  const chipTxt = (activo: boolean) => ({ color: activo ? colors.brandContrast : colors.text, fontWeight: '700' as const, fontSize: 12 });

  const fila = (f: FilaCuenta) => {
    const { cfg, seCobra, encargadoId } = estado(f);
    const k = `${f.tipo}|${f.clave}`;
    const ocupado = guardando === k;
    return (
      <View key={k} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4 }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
          {f.nombre}{f.foodOnly ? <Text style={{ color: colors.muted, fontWeight: '400' }}>  · 🍽️ solo comidas</Text> : null}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 11 }}>
          {seCobra ? '💵 Se cobra' : '🏠 Consumo interno'}{cfg ? ` desde ${dmy(cfg.desde)}` : ' (por defecto)'} · 👤 {encargadoId ? nombreEncargado.get(encargadoId) ?? 'encargado' : 'sin encargado'}
          {cfg?.created_by_nombre ? ` · ${cfg.created_by_nombre}` : ''}
        </Text>
        {canEdit ? (
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: 4 }}>
            <TouchableOpacity disabled={ocupado} onPress={() => guardar(f, { seCobra: !seCobra })} style={{ ...chip(seCobra), opacity: ocupado ? 0.6 : 1 }}>
              <Text style={chipTxt(seCobra)}>{seCobra ? '💵 Se cobra' : '🏠 No se cobra'}</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={ocupado} onPress={() => setAbierto(abierto === k ? null : k)} style={chip(abierto === k)}>
              <Text style={chipTxt(abierto === k)}>👤 Encargado {abierto === k ? '▲' : '▾'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {abierto === k ? (
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: 4 }}>
            {activos.map((e) => (
              <TouchableOpacity key={e.id} disabled={ocupado} onPress={() => guardar(f, { encargadoId: e.id })} style={chip(encargadoId === e.id)}>
                <Text style={chipTxt(encargadoId === e.id)}>{e.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity disabled={ocupado} onPress={() => guardar(f, { encargadoId: null })} style={chip(!encargadoId)}>
              <Text style={chipTxt(!encargadoId)}>✕ Sin encargado</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <ScrollView style={{ flex: 1 }}>
      {aviso ? (
        <TouchableOpacity onPress={() => setAviso(null)} style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: aviso.startsWith('❌') ? colors.danger : colors.success, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
          <Text style={{ color: colors.text, fontSize: 13 }}>{aviso}</Text>
        </TouchableOpacity>
      ) : null}
      {error ? (
        <View style={{ borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.dangerSoftBg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
          <Text style={{ color: colors.danger, fontWeight: '700' }}>⚠️ {error}</Text>
        </View>
      ) : null}

      <Card>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Los cambios rigen desde</Text>
        <DateField value={fecha} onChange={setFecha} />
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
          Lo que ves en cada cuenta es lo que rige en esa fecha. Sin configurar, una empresa se cobra y la nómina propia es
          consumo interno (se valora, pero no suma al total a cobrar). El encargado es el del catálogo de Mangueras.
        </Text>
        <TextInput value={buscar} onChangeText={setBuscar} placeholder="🔎 Buscar empresa o departamento…" placeholderTextColor={colors.muted} style={{ ...input, marginTop: spacing.sm }} />
      </Card>

      {cargando && !catalogo ? <Text style={{ color: colors.muted, marginTop: spacing.sm }}>Cargando…</Text> : null}

      {catalogo ? (
        <>
          <Card>
            <Text style={{ color: colors.text, fontWeight: '900' }}>🏢 Empresas</Text>
            {filas.empresas.length ? filas.empresas.map(fila) : <Text style={{ color: colors.muted, fontSize: 12 }}>Ninguna coincide.</Text>}
          </Card>
          <Card>
            <Text style={{ color: colors.text, fontWeight: '900' }}>🏠 Nómina propia · por departamento</Text>
            {filas.departamentos.length ? filas.departamentos.map(fila) : <Text style={{ color: colors.muted, fontSize: 12 }}>Ninguno coincide.</Text>}
          </Card>
        </>
      ) : null}
      <View style={{ height: spacing.lg }} />
    </ScrollView>
  );
}
