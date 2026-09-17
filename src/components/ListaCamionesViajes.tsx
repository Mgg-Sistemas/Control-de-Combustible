// QUÉ MÁQUINAS SALEN EN VIAJES DE CAMIONES (17-sep-2026). Solo el ADMIN.
//
// Vive en el panel de información de Viajes de camiones. Por cada máquina del catálogo
// dice si le sale al listero y deja ponerla o quitarla, o volver a lo automático (la
// regla por código: volteo, volqueta, toronto). La regla vive en src/lib/viajesListaCamiones.ts.
//
// ⚠️ Quitar una máquina NO toca sus viajes ya registrados ni el pago por viaje: solo deja
//    de ofrecérsela al listero para registrar nuevos.
import React, { useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { norm, cmpText } from '../lib/text';
import { estadoEnLista, etiquetaEstadoEnLista, saleEnViajes, type IndiceAjustesLista } from '../lib/viajesListaCamiones';
import { guardarAjusteListaViajes } from '../lib/viajesListaCamionesDb';

export type MaquinaParaLista = { id: string; code: string; plate: string | null; serial: string | null; companyName: string };

type Filtro = 'salen' | 'no_salen' | 'a_mano';

type Props = {
  catalogo: MaquinaParaLista[];
  ajustes: IndiceAjustesLista;
  /** La tabla todavía no existe en la base: se avisa en vez de dejar tocar botones que fallarían. */
  faltaSql: boolean;
  onChanged: () => void;
};

const MAX_FILAS = 60;

export function ListaCamionesViajes({ catalogo, ajustes, faltaSql, onChanged }: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('salen');
  const [guardando, setGuardando] = useState<string | null>(null);

  const conteo = useMemo(() => {
    let salen = 0, aMano = 0;
    catalogo.forEach((m) => { if (saleEnViajes(m.code, ajustes.get(m.id))) salen++; if (ajustes.has(m.id)) aMano++; });
    return { salen, noSalen: catalogo.length - salen, aMano };
  }, [catalogo, ajustes]);

  const filas = useMemo(() => {
    const nq = norm(q.trim());
    return catalogo
      .filter((m) => {
        const sale = saleEnViajes(m.code, ajustes.get(m.id));
        // Con búsqueda se busca en TODO el catálogo: si escribes, es porque buscas una máquina concreta.
        if (!nq) {
          if (filtro === 'salen' && !sale) return false;
          if (filtro === 'no_salen' && sale) return false;
          if (filtro === 'a_mano' && !ajustes.has(m.id)) return false;
        }
        return !nq || [m.code, m.plate, m.serial, m.companyName].some((f) => f != null && norm(String(f)).includes(nq));
      })
      .sort((a, b) => cmpText(a.companyName, b.companyName) || cmpText(a.code, b.code));
  }, [catalogo, ajustes, q, filtro]);

  const cambiar = async (m: MaquinaParaLista, visible: boolean | null) => {
    setGuardando(m.id);
    const { error } = await guardarAjusteListaViajes(m.id, visible);
    setGuardando(null);
    if (error) { toast.error(error); return; }
    toast.success(visible === null
      ? `${m.code}: vuelve a lo automático.`
      : visible
        ? `${m.code}: ahora le sale al listero en Viajes.`
        : `${m.code}: ya no le sale al listero. Sus viajes ya registrados no se tocan.`);
    onChanged();
  };

  const chip = (activo: boolean) => ({
    paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1,
    borderColor: activo ? colors.primary : colors.border, backgroundColor: activo ? colors.primary : colors.surface,
  });
  const chipTxt = (activo: boolean) => ({ color: activo ? colors.primaryContrast : colors.text, fontWeight: '700' as const, fontSize: 12 });

  if (faltaSql) {
    return (
      <Text style={{ color: colors.warning, fontSize: 12 }}>
        Falta crear la tabla en la base (SQL «viajes-lista-camiones»). Mientras tanto la lista sigue saliendo como siempre: por el código de cada máquina.
      </Text>
    );
  }

  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ color: colors.muted, fontSize: 12 }}>
        Decide qué máquinas le salen al listero para registrar viajes. Lo automático es por el código (volteo, volqueta, toronto);
        lo que pongas o quites a mano manda. Quitar una máquina no borra sus viajes ni la saca del pago.
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
        {([['salen', `✅ Salen · ${conteo.salen}`], ['no_salen', `🚫 No salen · ${conteo.noSalen}`], ['a_mano', `✋ Cambiadas a mano · ${conteo.aMano}`]] as const).map(([k, label]) => (
          <TouchableOpacity key={k} onPress={() => setFiltro(k)} style={chip(filtro === k && !q.trim())}>
            <Text style={chipTxt(filtro === k && !q.trim())}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="🔎 Buscar en todo el catálogo: código, placa, serial o empresa…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text }}
      />
      {filas.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12 }}>Sin máquinas en esta vista.</Text> : null}
      {filas.slice(0, MAX_FILAS).map((m) => {
        const ajuste = ajustes.get(m.id);
        const sale = saleEnViajes(m.code, ajuste);
        const estado = estadoEnLista(m.code, ajuste);
        const ocupado = guardando === m.id;
        return (
          <View key={m.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
              {m.code}{m.plate ? ` · ${m.plate}` : m.serial ? ` · ${m.serial}` : ''} · {m.companyName}
            </Text>
            <Text style={{ color: sale ? colors.success : colors.muted, fontSize: 11 }}>
              {etiquetaEstadoEnLista(estado)}{ajuste?.updated_by_nombre ? ` · ${ajuste.updated_by_nombre}` : ''}
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' }}>
              <TouchableOpacity disabled={ocupado} onPress={() => cambiar(m, !sale)} style={{ ...chip(false), opacity: ocupado ? 0.5 : 1 }}>
                <Text style={chipTxt(false)}>{sale ? '🚫 Quitar de Viajes' : '✅ Poner en Viajes'}</Text>
              </TouchableOpacity>
              {ajuste ? (
                <TouchableOpacity disabled={ocupado} onPress={() => cambiar(m, null)} style={{ ...chip(false), opacity: ocupado ? 0.5 : 1 }}>
                  <Text style={chipTxt(false)}>↺ Volver a lo automático</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        );
      })}
      {filas.length > MAX_FILAS ? (
        <Text style={{ color: colors.muted, fontSize: 11 }}>Se muestran {MAX_FILAS} de {filas.length}. Escribe en el buscador para encontrar la que buscas.</Text>
      ) : null}
    </View>
  );
}
