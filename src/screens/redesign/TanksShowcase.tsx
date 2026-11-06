import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Modal, TextInput, Pressable, Platform } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { useTable } from '../../hooks/useTable';
import { Tank, TankLevel as TankLevelType, Machinery } from '../../types/database';
import { TankLevel, tankStatus } from '../../components/TankLevel';
import { cmpText, norm } from '../../lib/text';
import { family, useBrandFonts } from '../../components/redesign/fonts';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../components/ToastProvider';
import { useAuth } from '../../context/AuthContext';
import {
  MARCADOR_AJUSTE_TANQUE,
  calcularDiferenciaAjusteTanque,
  esAjusteManualVisibleLegado,
} from '../../lib/fuelRules';

// Umbral mínimo por defecto (la vista tank_levels aún no expone umbral por tanque).
const LOW_PCT = 20;

/**
 * SHOWCASE DE PLANTILLA — Tanques con el tratamiento COMPLETO del rediseño:
 *   1) Tipografía de marca real (Barlow Condensed títulos · IBM Plex Mono cifras).
 *   2) Banda de KPIs arriba (cifras grandes).
 *   3) Tarjetas "firma": franja de estado a la izquierda + jerarquía clara.
 *
 * MISMA información, mismos datos (nivel DERIVADO de tank_levels, no editable) y
 * misma facilidad: nada cambia de sitio, solo se ve mejor. Aislado en su archivo.
 */
export default function TanksShowcase() {
  const { colors } = useTheme();
  const fontsReady = useBrandFonts();
  const { data, loading, refetch } = useTable<TankLevelType>('tank_levels', { realtimeFrom: ['stock_movements', 'tanks', 'dispatches', 'fuel_intakes', 'transfers'] });
  // Usuarios que tienen combustible (conductores/choferes de combustible) para
  // vincular el RESPONSABLE del tanque a una persona real en vez de texto libre.
  const { data: usuarios } = useTable<any>('profiles', { orderBy: 'full_name' });
  const candidatos = useMemo(
    () => (usuarios ?? [])
      .filter((u: any) => u.active !== false && u.role === 'conductor' && String(u.full_name ?? '').trim())
      .map((u: any) => String(u.full_name).trim())
      .filter((v: string, i: number, arr: string[]) => arr.indexOf(v) === i)
      .sort(cmpText),
    [usuarios],
  );
  const [filter, setFilter] = useState<'all' | 'diesel' | 'gasolina' | 'low'>('all');
  // Edición del RESPONSABLE del tanque directamente desde la tarjeta (toca el renglón
  // "Responsable"). Actualiza `tanks.responsable` (la vista tank_levels es de solo
  // lectura, pero el id coincide). Tras guardar refrescamos nosotros mismos (refetch):
  // la vista `tank_levels` no siempre está en la publicación de realtime, así que no
  // dependemos de que el evento llegue solo — el que edita ve su cambio al instante.
  const [editTank, setEditTank] = useState<{ id: string; name: string } | null>(null);
  const [respInput, setRespInput] = useState('');
  const [savingResp, setSavingResp] = useState(false);
  const openEditResp = (t: TankLevelType) => { setEditTank({ id: t.id, name: t.name }); setRespInput(String(t.responsable ?? '')); };
  const saveResp = async () => {
    if (!editTank || savingResp) return;
    setSavingResp(true);
    const clean = respInput.trim();
    const { error } = await supabase.from('tanks').update({ responsable: clean || null }).eq('id', editTank.id);
    setSavingResp(false);
    if (!error) { setEditTank(null); refetch(); }
  };

  const toast = useToast();
  const { session } = useAuth();
  const { data: fullTanks, refetch: refetchFullTanks } = useTable<Tank>('tanks', { realtimeFrom: ['tanks'] });
  const { data: machineryList } = useTable<Machinery>('machinery', { orderBy: 'code' });

  // Limpieza automática del registro colocado como "ajuste manual visible" o "ajuste visible"
  // SIN borrar la fila de `dispatches` (así el trigger NO repone los litros en el tanque),
  // marcándola como ajuste interno de tanque para que desaparezca de Consumos.
  const cleanedLegacyRef = useRef(false);
  useEffect(() => {
    if (cleanedLegacyRef.current) return;
    cleanedLegacyRef.current = true;
    (async () => {
      try {
        const { data: dispRows } = await supabase
          .from('dispatches')
          .select('id, driver_operator');
        const legados = (dispRows || []).filter((r: any) => esAjusteManualVisibleLegado(r));
        for (const r of legados) {
          const prev = String((r as any).driver_operator || '').trim();
          await supabase
            .from('dispatches')
            .update({
              driver_operator: `${MARCADOR_AJUSTE_TANQUE} ${prev || 'Ajuste directo de tanque'}`,
            })
            .eq('id', (r as any).id);
        }
      } catch {
        // Silencioso si no hay sesión o red
      }
    })();
  }, []);

  // Modal para Crear / Editar Tanque y Ajustar Litros en el Tanque
  const [tankModalOpen, setTankModalOpen] = useState(false);
  const [editingTankId, setEditingTankId] = useState<string | null>(null);

  const [tankName, setTankName] = useState('');
  const [tankFuel, setTankFuel] = useState<'diesel' | 'gasolina'>('diesel');
  const [tankCapacity, setTankCapacity] = useState('');
  const [tankIsMobile, setTankIsMobile] = useState(false);
  const [tankLocation, setTankLocation] = useState('');
  const [tankResponsable, setTankResponsable] = useState('');
  const [tankChofer, setTankChofer] = useState('');
  const [tankMachineryId, setTankMachineryId] = useState<string | null>(null);
  const [tankSaldoInicial, setTankSaldoInicial] = useState('');
  const [tankOriginalLiters, setTankOriginalLiters] = useState<number>(0);
  const [tankNuevoNivelLiters, setTankNuevoNivelLiters] = useState('');
  const [tankAjusteMotivo, setTankAjusteMotivo] = useState('');
  const [searchMachineryQuery, setSearchMachineryQuery] = useState('');
  const [savingTank, setSavingTank] = useState(false);

  const filteredMachinery = useMemo(() => {
    const q = norm(searchMachineryQuery);
    if (!q) return (machineryList || []).slice(0, 15);
    return (machineryList || [])
      .filter((m: any) => {
        return (
          norm(m.code).includes(q) ||
          norm(m.plate || '').includes(q) ||
          norm(m.serial || '').includes(q) ||
          norm(m.identifier || '').includes(q) ||
          norm(m.tipo || '').includes(q)
        );
      })
      .slice(0, 20);
  }, [machineryList, searchMachineryQuery]);

  const openCreateTank = () => {
    setEditingTankId(null);
    setTankName('');
    setTankFuel('diesel');
    setTankCapacity('');
    setTankIsMobile(false);
    setTankLocation('');
    setTankResponsable('');
    setTankChofer('');
    setTankMachineryId(null);
    setTankSaldoInicial('');
    setTankOriginalLiters(0);
    setTankNuevoNivelLiters('');
    setTankAjusteMotivo('');
    setSearchMachineryQuery('');
    setTankModalOpen(true);
  };

  const openEditFullTank = (tankId: string) => {
    const full = (fullTanks || []).find((t) => t.id === tankId);
    const lvl = (data || []).find((t) => t.id === tankId);
    const base = full || (lvl as any);
    if (!base) return;
    const curL = Math.round((Number(lvl?.current_l ?? 0) || 0) * 100) / 100;
    setEditingTankId(base.id);
    setTankName(base.name || '');
    setTankFuel((base.fuel as 'diesel' | 'gasolina') || 'diesel');
    setTankCapacity(String(base.capacity_l ?? ''));
    setTankIsMobile(!!base.is_mobile);
    setTankLocation(base.location || '');
    setTankResponsable(base.responsable || '');
    setTankChofer(base.chofer || '');
    setTankMachineryId(base.machinery_id || null);
    setTankSaldoInicial('');
    setTankOriginalLiters(curL);
    setTankNuevoNivelLiters(String(curL));
    setTankAjusteMotivo('');
    setSearchMachineryQuery('');
    setTankModalOpen(true);
  };

  /**
   * Ajusta el nivel de litros (`current_l`) de un tanque al valor exacto indicado por el usuario,
   * sin ensuciar la pestaña de Consumos ni Ingresos.
   */
  const aplicarAjusteNivelTanque = async (
    tankId: string,
    fuelType: 'diesel' | 'gasolina',
    litrosActuales: number,
    nuevoNivel: number,
    motivo: string
  ) => {
    const calc = calcularDiferenciaAjusteTanque(litrosActuales, nuevoNivel);
    if (calc.sinCambio) return;

    const todayStr = new Date().toISOString().slice(0, 10);
    const notaEtiqueta = `${MARCADOR_AJUSTE_TANQUE} ${motivo.trim() || `Ajuste directo en tanque (${calc.litrosActuales} L -> ${calc.nuevoNivel} L)`}`;

    if (calc.delta > 0) {
      let restanteMas = calc.delta;
      // 1. Si existen ajustes negativos internos en dispatches para este tanque, reducirlos o quitarlos primero
      const { data: adjDispatches } = await supabase
        .from('dispatches')
        .select('id, liters, driver_operator')
        .eq('tank_id', tankId);

      const ocultosDisp = (adjDispatches || []).filter((d: any) =>
        String(d.driver_operator || '').includes(MARCADOR_AJUSTE_TANQUE)
      );

      for (const d of ocultosDisp) {
        if (restanteMas <= 0.009) break;
        const lDisp = Number((d as any).liters) || 0;
        if (lDisp <= restanteMas + 0.009) {
          const { error: delErr } = await supabase.from('dispatches').delete().eq('id', (d as any).id);
          if (!delErr) restanteMas = Math.round((restanteMas - lDisp) * 100) / 100;
        } else {
          const nuevoLDisp = Math.round((lDisp - restanteMas) * 100) / 100;
          const { error: upErr } = await supabase
            .from('dispatches')
            .update({ liters: nuevoLDisp, driver_operator: notaEtiqueta })
            .eq('id', (d as any).id);
          if (!upErr) restanteMas = 0;
        }
      }

      // 2. Si aún falta sumar litros al tanque, insertar ingreso de ajuste oculto
      if (restanteMas > 0.009) {
        const { error: inErr } = await supabase.from('fuel_intakes').insert({
          tank_id: tankId,
          intake_date: todayStr,
          supplier: notaEtiqueta,
          fuel: fuelType,
          liters: restanteMas,
          unit_cost: 0,
          total_cost: 0,
          created_by: session?.user?.id || null,
        });
        if (inErr) throw new Error(inErr.message);
      }
    } else {
      // calc.delta < 0: rebajar litros del tanque sin mostrarlo en Consumos
      let restanteMenos = Math.abs(calc.delta);

      // 1. Primero intentar rebajar de ingresos de apertura o ajustes internos de este tanque
      const { data: intakesTank } = await supabase
        .from('fuel_intakes')
        .select('id, liters, supplier')
        .eq('tank_id', tankId)
        .order('created_at', { ascending: false });

      const intakesAjustables = (intakesTank || []).filter((i: any) => {
        const sup = String(i.supplier || '');
        return sup.includes(MARCADOR_AJUSTE_TANQUE) || /saldo inicial|apertura/i.test(sup);
      });

      for (const ing of intakesAjustables) {
        if (restanteMenos <= 0.009) break;
        const lIng = Number((ing as any).liters) || 0;
        if (lIng > restanteMenos + 0.009) {
          const nuevoLIng = Math.round((lIng - restanteMenos) * 100) / 100;
          const { error: upErr } = await supabase
            .from('fuel_intakes')
            .update({ liters: nuevoLIng })
            .eq('id', (ing as any).id);
          if (!upErr) restanteMenos = 0;
        } else if (lIng > 0) {
          const { error: delErr } = await supabase.from('fuel_intakes').delete().eq('id', (ing as any).id);
          if (!delErr) restanteMenos = Math.round((restanteMenos - lIng) * 100) / 100;
        }
      }

      // 2. Si aún falta rebajar litros, actualizar un dispatch oculto existente o crear uno nuevo oculto
      if (restanteMenos > 0.009) {
        const { data: adjDispatches } = await supabase
          .from('dispatches')
          .select('id, liters, driver_operator')
          .eq('tank_id', tankId);

        const existenteOculto = (adjDispatches || []).find((d: any) =>
          String(d.driver_operator || '').includes(MARCADOR_AJUSTE_TANQUE)
        );

        if (existenteOculto) {
          const sumado = Math.round(((Number((existenteOculto as any).liters) || 0) + restanteMenos) * 100) / 100;
          const { error: upErr } = await supabase
            .from('dispatches')
            .update({ liters: sumado, driver_operator: notaEtiqueta })
            .eq('id', (existenteOculto as any).id);
          if (upErr) throw new Error(upErr.message);
        } else {
          // Buscar cualquier vehículo existente para cumplir el CHECK de dispatches sin activar el bloqueo diario de maquinaria
          const { data: vehs } = await supabase.from('vehicles').select('id').limit(1);
          let vehId = (vehs && vehs[0] ? (vehs[0] as any).id : null) as string | null;
          if (!vehId) {
            const { data: newVeh } = await supabase
              .from('vehicles')
              .insert({ plate: 'AJUSTE-TANQUE', name: 'AJUSTE INTERNO TANQUE', en_espera: true } as any)
              .select('id')
              .single();
            vehId = (newVeh as any)?.id || null;
          }
          if (vehId) {
            const { error: insErr } = await supabase.from('dispatches').insert({
              dispatch_date: todayStr,
              asset_kind: 'vehiculo',
              vehicle_id: vehId,
              tank_id: tankId,
              liters: restanteMenos,
              driver_operator: notaEtiqueta,
              created_by: session?.user?.id || null,
            });
            if (insErr) throw new Error(insErr.message);
          }
        }
      }
    }
  };

  const handleSaveTank = async () => {
    const cleanName = tankName.trim();
    const cap = Number(tankCapacity.replace(',', '.'));
    if (!cleanName) {
      toast.error('Indica el nombre del tanque.');
      return;
    }
    if (!cap || cap <= 0) {
      toast.error('Indica una capacidad válida en litros (mayor a 0).');
      return;
    }

    const tieneNuevoNivel = editingTankId && tankNuevoNivelLiters.trim() !== '';
    const nuevoNivelNum = tieneNuevoNivel ? Number(tankNuevoNivelLiters.replace(',', '.')) : tankOriginalLiters;
    if (editingTankId && (!Number.isFinite(nuevoNivelNum) || nuevoNivelNum < 0)) {
      toast.error('El nivel actual en litros no puede ser negativo.');
      return;
    }

    setSavingTank(true);
    try {
      if (editingTankId) {
        const { error } = await supabase.from('tanks').update({
          name: cleanName,
          fuel: tankFuel,
          capacity_l: cap,
          is_mobile: tankIsMobile,
          location: tankLocation.trim() || null,
          responsable: tankResponsable.trim() || null,
          chofer: tankIsMobile ? (tankChofer.trim() || null) : null,
          machinery_id: tankIsMobile ? (tankMachineryId || null) : null,
        }).eq('id', editingTankId);

        if (error) throw new Error(error.message);

        if (tieneNuevoNivel && Math.abs(nuevoNivelNum - tankOriginalLiters) >= 0.01) {
          await aplicarAjusteNivelTanque(
            editingTankId,
            tankFuel,
            tankOriginalLiters,
            nuevoNivelNum,
            tankAjusteMotivo
          );
          toast.success(`Tanque actualizado y nivel ajustado a ${nuevoNivelNum.toLocaleString()} L.`);
        } else {
          toast.success('Tanque actualizado con éxito.');
        }
      } else {
        const { data: newTank, error } = await supabase.from('tanks').insert({
          name: cleanName,
          fuel: tankFuel,
          capacity_l: cap,
          is_mobile: tankIsMobile,
          location: tankLocation.trim() || null,
          responsable: tankResponsable.trim() || null,
          chofer: tankIsMobile ? (tankChofer.trim() || null) : null,
          machinery_id: tankIsMobile ? (tankMachineryId || null) : null,
          active: true,
        }).select().single();

        if (error) throw new Error(error.message);

        const saldoIni = Number(tankSaldoInicial.replace(',', '.')) || 0;
        if (newTank && saldoIni > 0) {
          await supabase.from('fuel_intakes').insert({
            tank_id: newTank.id,
            intake_date: new Date().toISOString().slice(0, 10),
            supplier: 'Saldo Inicial / Apertura',
            fuel: tankFuel,
            liters: saldoIni,
            created_by: session?.user?.id || null,
          });
        }

        toast.success('Tanque creado con éxito.');
      }

      setTankModalOpen(false);
      refetch();
      refetchFullTanks();
    } catch (err: any) {
      toast.error('Error al guardar tanque: ' + (err?.message || 'Error'));
    } finally {
      setSavingTank(false);
    }
  };

  const tanks = useMemo(() => {
    const list = [...(data ?? [])].sort((a, b) => cmpText(a.name, b.name));
    if (filter === 'diesel') return list.filter((t) => /dies/i.test(t.fuel));
    if (filter === 'gasolina') return list.filter((t) => /gasol/i.test(t.fuel));
    if (filter === 'low') return list.filter((t) => (Number(t.pct) || 0) <= LOW_PCT);
    return list;
  }, [data, filter]);

  const kpis = useMemo(() => {
    const all = data ?? [];
    const bajos = all.filter((t) => (Number(t.pct) || 0) <= LOW_PCT).length;
    const litros = all.reduce((s, t) => s + (Number(t.current_l) || 0), 0);
    return { total: all.length, bajos, litros };
  }, [data]);

  // Fuente segura: si aún no cargan las de marca, usa la del sistema (no rompe nada).
  const f = (fam: string) => (fontsReady ? { fontFamily: fam } : {});

  const chipTone = (tone: 'ok' | 'warn' | 'crit') =>
    tone === 'ok'
      ? { bg: colors.successSoftBg, fg: colors.successSoftText, stripe: colors.tankFill }
      : tone === 'warn'
      ? { bg: colors.accentSoftBg, fg: colors.accentSoftText, stripe: colors.tankWarn }
      : { bg: colors.dangerSoftBg, fg: colors.dangerSoftText, stripe: colors.tankCrit };

  const FILTERS: { k: typeof filter; label: string }[] = [
    { k: 'all', label: 'Todos' },
    { k: 'diesel', label: 'Diésel' },
    { k: 'gasolina', label: 'Gasolina' },
    { k: 'low', label: 'Bajos' },
  ];

  const Kpi = ({ n, label, tone }: { n: React.ReactNode; label: string; tone?: 'plain' | 'warn' }) => (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={[{ color: tone === 'warn' && Number(kpis.bajos) > 0 ? colors.accent : colors.brandContrast, fontSize: 30, lineHeight: 34, fontWeight: '900' }, f(family.monoSemi)]}>
        {n}
      </Text>
      <Text style={[{ color: colors.brandContrast, opacity: 0.8, fontSize: 11, letterSpacing: 1, marginTop: 2, textTransform: 'uppercase', fontWeight: '800' }, f(family.bodySemi)]}>
        {label}
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Banda navy con título de marca + KPIs grandes + Botón Crear Tanque. */}
      <View style={{ backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[{ color: colors.brandContrast, fontSize: 26, letterSpacing: 0.5, fontWeight: '900' }, f(family.display)]}>TANQUES</Text>
          <TouchableOpacity
            onPress={openCreateTank}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: colors.primary,
              paddingHorizontal: spacing.md,
              paddingVertical: 7,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.3)',
            }}
          >
            <Text style={{ fontSize: 13 }}>➕</Text>
            <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 13 }}>Crear Tanque</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md, gap: spacing.sm }}>
          <Kpi n={kpis.total} label="Tanques" />
          <View style={{ width: 1, backgroundColor: colors.brandContrast, opacity: 0.2 }} />
          <Kpi n={kpis.bajos} label="Bajo umbral" tone="warn" />
          <View style={{ width: 1, backgroundColor: colors.brandContrast, opacity: 0.2 }} />
          <Kpi n={`${Math.round(kpis.litros).toLocaleString()}`} label="Litros" />
        </View>
      </View>

      {/* Chips de filtro. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: spacing.sm, gap: spacing.xs }}>
        {FILTERS.map((ff) => {
          const on = filter === ff.k;
          return (
            <TouchableOpacity key={ff.k} onPress={() => setFilter(ff.k)} style={{ paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
              <Text style={[{ color: on ? colors.brandContrast : colors.text, fontSize: 12.5 }, f(family.bodySemi)]}>{ff.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={{ paddingTop: spacing.xl, alignItems: 'center' }}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.sm, paddingBottom: spacing.xl }}>
          {tanks.length === 0 ? (
            <View style={{ alignItems: 'center', padding: spacing.xl, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, marginTop: spacing.md }}>
              <Text style={{ fontSize: 26, color: colors.muted }}>🛢️</Text>
              <Text style={[{ color: colors.text, marginTop: spacing.xs, fontSize: 15, fontWeight: '900' }, f(family.displayBold)]}>Sin tanques</Text>
              <Text style={[{ color: colors.muted, fontSize: 12, marginTop: 2 }, f(family.body)]}>No hay tanques para este filtro.</Text>
            </View>
          ) : (
            tanks.map((t) => {
              const pct = Number(t.pct) || 0;
              const st = tankStatus(pct, LOW_PCT);
              const tone = chipTone(st.tone);
              const low = pct <= LOW_PCT;
              return (
                <View key={t.id} style={{ flexDirection: 'row', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginBottom: spacing.sm, overflow: 'hidden' }}>
                  {/* Franja de estado a la izquierda (la FORMA comunica el estado). */}
                  <View style={{ width: 5, backgroundColor: tone.stripe }} />
                  <View style={{ flex: 1, padding: spacing.md }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs }}>
                      <Text numberOfLines={2} style={[{ color: colors.text, fontSize: 17, flex: 1, minWidth: 135, fontWeight: '900' }, f(family.displayBold)]}>{t.name}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, flexShrink: 1, maxWidth: '100%' }}>
                        <TouchableOpacity
                          onPress={() => openEditFullTank(t.id)}
                          style={{
                            backgroundColor: colors.primary,
                            paddingHorizontal: 9,
                            paddingVertical: 4,
                            borderRadius: radius.pill,
                          }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: '900', color: colors.primaryContrast }}>⚖️ Ajustar Litros / ✏️ Editar</Text>
                        </TouchableOpacity>
                        <View style={{ backgroundColor: tone.bg, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
                          <Text style={[{ color: tone.fg, fontSize: 10, letterSpacing: 0.5 }, f(family.bodySemi)]}>{st.label.toUpperCase()}</Text>
                        </View>
                      </View>
                    </View>
                    <Text style={[{ color: colors.muted, fontSize: 12, marginTop: 2, textTransform: 'capitalize' }, f(family.body)]}>
                      {t.fuel} · cap. {Number(t.capacity_l).toLocaleString()} L · umbral {LOW_PCT}%
                    </Text>
                    {/* Ubicación del tanque (si la tiene) — ayuda a distinguir tanques con
                        el mismo nombre. */}
                    {t.location && String(t.location).trim() ? (
                      <Text style={[{ color: colors.muted, fontSize: 12, marginTop: 2 }, f(family.body)]}>📍 {t.location}</Text>
                    ) : null}
                    {/* Responsable / encargado — EDITABLE: toca el renglón para asignarlo. */}
                    <TouchableOpacity onPress={() => openEditResp(t)} activeOpacity={0.6} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, marginBottom: spacing.sm }}>
                      <Text style={[{ color: t.responsable ? colors.text : colors.muted, fontSize: 12, fontWeight: t.responsable ? '700' : '400', flexShrink: 1 }, f(family.bodySemi)]}>
                        👤 Responsable: {t.responsable && String(t.responsable).trim() ? t.responsable : 'sin asignar'}
                      </Text>
                      <Text style={[{ color: colors.brandText, fontSize: 11, fontWeight: '800' }, f(family.bodySemi)]}>✏️ {t.responsable ? 'cambiar' : 'asignar'}</Text>
                    </TouchableOpacity>

                    {/* Cifra grande en mono + % a la derecha. */}
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={[{ color: low ? colors.tankCrit : colors.text, fontSize: 22, fontWeight: '900' }, f(family.monoSemi)]}>
                        {Number(t.current_l).toLocaleString()} <Text style={[{ fontSize: 13, color: colors.muted }, f(family.mono)]}>L</Text>
                      </Text>
                      <Text style={[{ color: low ? colors.tankCrit : colors.muted, fontSize: 16, fontWeight: '900' }, f(family.monoSemi)]}>{Math.round(pct)}%</Text>
                    </View>
                    <TankLevel pct={pct} thresholdPct={LOW_PCT} height={10} />
                  </View>
                </View>
              );
            })
          )}

          {/* Nota discreta de que es una vista de muestra. */}
          <Text style={[{ color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: spacing.sm }, f(family.body)]}>
            Vista de muestra (plantilla nueva) · misma información y datos
          </Text>
        </ScrollView>
      )}

      {/* Modal para asignar/cambiar el RESPONSABLE del tanque (escribe el nombre). */}
      <Modal visible={editTank != null} transparent animationType="fade" onRequestClose={() => setEditTank(null)}>
        <Pressable onPress={() => setEditTank(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm }}>
            <Text style={[{ color: colors.text, fontSize: 16, fontWeight: '900' }, f(family.displayBold)]}>Responsable del tanque</Text>
            <Text style={[{ color: colors.muted, fontSize: 12.5 }, f(family.body)]}>{editTank?.name}</Text>
            <TextInput
              value={respInput}
              onChangeText={setRespInput}
              placeholder="Buscar o escribir el encargado…"
              placeholderTextColor={colors.muted}
              autoFocus
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.text, fontSize: 15 }}
            />
            {/* Usuarios de combustible: toca uno para asignarlo (o escribe arriba). */}
            {(() => {
              const q = respInput.trim().toLowerCase();
              const lista = q ? candidatos.filter((n) => n.toLowerCase().includes(q)) : candidatos;
              if (lista.length === 0) return null;
              return (
                <View style={{ maxHeight: 180, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' }}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                    {lista.map((n) => {
                      const on = n.toLowerCase() === respInput.trim().toLowerCase();
                      return (
                        <TouchableOpacity key={n} onPress={() => setRespInput(n)}
                          style={{ paddingVertical: 10, paddingHorizontal: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: on ? colors.primary : 'transparent' }}>
                          <Text style={[{ color: on ? colors.primaryContrast : colors.text, fontSize: 14, fontWeight: on ? '800' : '500' }, f(family.bodySemi)]}>👤 {n}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              );
            })()}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
              <TouchableOpacity onPress={() => setEditTank(null)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 11, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveResp} disabled={savingResp} style={{ flex: 1, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 11, alignItems: 'center', opacity: savingResp ? 0.6 : 1 }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '900' }}>{savingResp ? 'Guardando…' : 'Guardar'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal para CREAR / EDITAR TANQUE COMPLETO */}
      <Modal visible={tankModalOpen} transparent animationType="slide" onRequestClose={() => setTankModalOpen(false)}>
        <Pressable onPress={() => setTankModalOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.md }}>
          <Pressable onPress={(e) => e.stopPropagation?.()} style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, maxHeight: '90%' }}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[{ color: colors.text, fontSize: 18, fontWeight: '900' }, f(family.displayBold)]}>
                  {editingTankId ? '✏️ Editar Tanque' : '➕ Crear Nuevo Tanque'}
                </Text>
                <TouchableOpacity onPress={() => setTankModalOpen(false)}>
                  <Text style={{ fontSize: 18, fontWeight: 'bold', color: colors.muted }}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Nombre del Tanque */}
              <View>
                <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text, marginBottom: 2 }}>Nombre del Tanque *</Text>
                <TextInput
                  value={tankName}
                  onChangeText={setTankName}
                  placeholder="Ej. Tanque Principal Patio, Cisterna Móvil 01…"
                  placeholderTextColor={colors.muted}
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: 14 }}
                />
              </View>

              {/* Tipo de Combustible */}
              <View>
                <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text, marginBottom: 4 }}>Tipo de Combustible *</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <TouchableOpacity
                    onPress={() => setTankFuel('diesel')}
                    style={{
                      flex: 1,
                      paddingVertical: 9,
                      alignItems: 'center',
                      borderRadius: radius.md,
                      backgroundColor: tankFuel === 'diesel' ? colors.primary : colors.surface,
                      borderWidth: 1,
                      borderColor: tankFuel === 'diesel' ? colors.primary : colors.border,
                    }}
                  >
                    <Text style={{ fontWeight: '800', color: tankFuel === 'diesel' ? colors.primaryContrast : colors.text }}>⛽ Diésel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setTankFuel('gasolina')}
                    style={{
                      flex: 1,
                      paddingVertical: 9,
                      alignItems: 'center',
                      borderRadius: radius.md,
                      backgroundColor: tankFuel === 'gasolina' ? colors.primary : colors.surface,
                      borderWidth: 1,
                      borderColor: tankFuel === 'gasolina' ? colors.primary : colors.border,
                    }}
                  >
                    <Text style={{ fontWeight: '800', color: tankFuel === 'gasolina' ? colors.primaryContrast : colors.text }}>🚗 Gasolina</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Capacidad en Litros */}
              <View>
                <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text, marginBottom: 2 }}>Capacidad Nominal (Litros) *</Text>
                <TextInput
                  value={tankCapacity}
                  onChangeText={setTankCapacity}
                  keyboardType="numeric"
                  placeholder="Ej. 10000"
                  placeholderTextColor={colors.muted}
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: 15, fontWeight: '800' }}
                />
              </View>

              {/* Saldo Inicial (solo al crear) o Edición Directa de Litros Actuales (al editar) */}
              {!editingTankId ? (
                <View style={{ backgroundColor: colors.surfaceAlt, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text, marginBottom: 2 }}>Saldo Inicial de Apertura (Litros)</Text>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>Litros actuales en el tanque al momento de registrarlo (opcional).</Text>
                  <TextInput
                    value={tankSaldoInicial}
                    onChangeText={setTankSaldoInicial}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={colors.muted}
                    style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, color: colors.primary, fontSize: 15, fontWeight: '800' }}
                  />
                </View>
              ) : (
                <View
                  style={{
                    backgroundColor: colors.surfaceAlt,
                    padding: spacing.md,
                    borderRadius: radius.md,
                    borderWidth: 1.5,
                    borderColor: colors.primary,
                    gap: spacing.xs,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '900', color: colors.primary }}>
                    ⚖️ Modificar / Editar Litros Actuales en el Tanque
                  </Text>
                  <Text style={{ fontSize: 11.5, color: colors.muted }}>
                    Cambia directamente el saldo actual del tanque sin generar consumos visibles en la pestaña de Consumos.
                  </Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                    <Text style={{ fontSize: 12, color: colors.muted, fontWeight: '700' }}>Saldo actual registrado:</Text>
                    <Text style={{ fontSize: 14, color: colors.text, fontWeight: '900' }}>
                      {tankOriginalLiters.toLocaleString()} L
                    </Text>
                  </View>
                  <View style={{ marginTop: 4 }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text, marginBottom: 3 }}>
                      Nuevo nivel real en el tanque (Litros) *
                    </Text>
                    <TextInput
                      value={tankNuevoNivelLiters}
                      onChangeText={setTankNuevoNivelLiters}
                      keyboardType="numeric"
                      placeholder={String(tankOriginalLiters)}
                      placeholderTextColor={colors.muted}
                      style={{
                        backgroundColor: colors.surface,
                        borderWidth: 1.5,
                        borderColor: colors.primary,
                        borderRadius: radius.sm,
                        padding: spacing.sm,
                        color: colors.text,
                        fontSize: 17,
                        fontWeight: '900',
                      }}
                    />
                  </View>
                  {(() => {
                    const nvoNum =
                      tankNuevoNivelLiters.trim() !== ''
                        ? Number(tankNuevoNivelLiters.replace(',', '.'))
                        : tankOriginalLiters;
                    const capNum = Number(tankCapacity.replace(',', '.')) || 0;
                    const info = calcularDiferenciaAjusteTanque(tankOriginalLiters, nvoNum, capNum);
                    if (info.sinCambio) {
                      return (
                        <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                          El nivel del tanque se mantiene en {tankOriginalLiters.toLocaleString()} L.
                        </Text>
                      );
                    }
                    return (
                      <View
                        style={{
                          backgroundColor: colors.surface,
                          borderRadius: radius.sm,
                          padding: spacing.sm,
                          borderWidth: 1,
                          borderColor: info.delta > 0 ? colors.success : colors.accent,
                          marginTop: 4,
                          gap: 3,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: '900',
                            color: info.delta > 0 ? colors.success : colors.accent,
                          }}
                        >
                          {info.delta > 0 ? `➕ Se sumarán +${info.delta.toLocaleString()} L` : `➖ Se descontarán ${info.delta.toLocaleString()} L`}{' '}
                          en el tanque ({info.pctNuevo}% de capacidad)
                        </Text>
                        <TextInput
                          value={tankAjusteMotivo}
                          onChangeText={setTankAjusteMotivo}
                          placeholder="Motivo u observación del ajuste (opcional)…"
                          placeholderTextColor={colors.muted}
                          style={{
                            backgroundColor: colors.surfaceAlt,
                            borderWidth: 1,
                            borderColor: colors.border,
                            borderRadius: radius.sm,
                            paddingHorizontal: spacing.sm,
                            paddingVertical: 6,
                            fontSize: 12,
                            color: colors.text,
                            marginTop: 2,
                          }}
                        />
                      </View>
                    );
                  })()}
                </View>
              )}

              {/* ¿Es Cisterna Móvil? */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surfaceAlt, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                <View style={{ flex: 1, marginRight: spacing.sm }}>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text }}>¿Es Cisterna Móvil?</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>Tanque montado en camión/chuto que se desplaza por los frentes.</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setTankIsMobile(!tankIsMobile)}
                  style={{
                    backgroundColor: tankIsMobile ? colors.primary : colors.surface,
                    paddingHorizontal: spacing.md,
                    paddingVertical: 6,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: tankIsMobile ? colors.primary : colors.border,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '800', color: tankIsMobile ? colors.primaryContrast : colors.text }}>
                    {tankIsMobile ? 'SÍ (MÓVIL)' : 'NO (FIJO)'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Si es cisterna móvil: chofer y vehículo del catálogo */}
              {tankIsMobile && (
                <View style={{ gap: spacing.sm, backgroundColor: colors.surfaceAlt, padding: spacing.md, borderRadius: radius.md }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text }}>Datos de la Cisterna Móvil</Text>
                  
                  <View>
                    <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Chofer de la Cisterna</Text>
                    <TextInput
                      value={tankChofer}
                      onChangeText={setTankChofer}
                      placeholder="Nombre del chofer responsable…"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, fontSize: 13, color: colors.text }}
                    />
                  </View>

                  {/* Selector con Buscador de Maquinaria vinculada (REGLA DEL PROYECTO: Código + PLACA + SERIAL) */}
                  <View>
                    <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Vincular a Maquinaria del Catálogo (Chuto / Cisterna)</Text>
                    <TextInput
                      value={searchMachineryQuery}
                      onChangeText={setSearchMachineryQuery}
                      placeholder="Buscar por código, placa, serial o tipo…"
                      placeholderTextColor={colors.muted}
                      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.sm, fontSize: 13, color: colors.text }}
                    />

                    {tankMachineryId && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, padding: spacing.sm, borderRadius: radius.sm, marginTop: 4, borderWidth: 1, borderColor: colors.primary }}>
                        {(() => {
                          const m: any = (machineryList || []).find((x) => x.id === tankMachineryId);
                          const sn = String(m?.serial || m?.identifier || '').trim();
                          return (
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontWeight: '800', color: colors.text, fontSize: 12 }}>{m?.code || 'Maquinaria vinculada'}</Text>
                              <Text style={{ fontSize: 11, fontWeight: '800', color: colors.danger }}>
                                🚗 PLACA: {m?.plate || 'S/P'}{sn ? ` · 🔢 SERIAL: ${sn}` : ''}
                              </Text>
                            </View>
                          );
                        })()}
                        <TouchableOpacity onPress={() => setTankMachineryId(null)}>
                          <Text style={{ fontSize: 11, color: colors.danger, fontWeight: '800' }}>Desvincular</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {!tankMachineryId && searchMachineryQuery.trim() !== '' && (
                      <View style={{ maxHeight: 140, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, marginTop: 2 }}>
                        <ScrollView nestedScrollEnabled>
                          {filteredMachinery.map((m: any) => {
                            const sn = String(m?.serial || m?.identifier || '').trim();
                            return (
                              <TouchableOpacity
                                key={m.id}
                                onPress={() => {
                                  setTankMachineryId(m.id);
                                  setSearchMachineryQuery('');
                                }}
                                style={{ padding: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}
                              >
                                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text, flex: 1 }}>{m.code}</Text>
                                <Text style={{ fontSize: 11, fontWeight: '800', color: colors.danger }}>
                                  🚗 {m.plate || 'S/P'}{sn ? ` · 🔢 ${sn}` : ''}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {/* Ubicación y Responsable */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                <View style={{ flex: 1, minWidth: 135 }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text, marginBottom: 2 }}>Ubicación / Patio</Text>
                  <TextInput
                    value={tankLocation}
                    onChangeText={setTankLocation}
                    placeholder="Ej. Patio Mina, Frente 1…"
                    placeholderTextColor={colors.muted}
                    style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: 13 }}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 135 }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text, marginBottom: 2 }}>Responsable</Text>
                  <TextInput
                    value={tankResponsable}
                    onChangeText={setTankResponsable}
                    placeholder="Encargado del tanque…"
                    placeholderTextColor={colors.muted}
                    style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: 13 }}
                  />
                </View>
              </View>

              {/* Botones de acción */}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                <TouchableOpacity
                  onPress={() => setTankModalOpen(false)}
                  style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' }}
                >
                  <Text style={{ color: colors.text, fontWeight: '800' }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSaveTank}
                  disabled={savingTank}
                  style={{ flex: 1, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', opacity: savingTank ? 0.6 : 1 }}
                >
                  {savingTank ? (
                    <ActivityIndicator color={colors.primaryContrast} />
                  ) : (
                    <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 14 }}>
                      {editingTankId ? 'Guardar Cambios' : 'Crear Tanque'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
