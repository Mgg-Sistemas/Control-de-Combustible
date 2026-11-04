// 🖨️ IMPRIMIR LISTADO DE PROVEEDORES (03-nov-2026, a pedido). Panel plegable
// dentro de Compras → Proveedores: se eligen los rubros, qué columnas salen y
// los logos, y se descarga el PDF. Solo lee la lista que la pestaña ya cargó.
import React, { useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Card } from './ui';
import { Toggle } from './CubicajeTab';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { caracasToday } from '../lib/caracasDay';
import {
  CSS_LISTADO_PROVEEDORES, OPCIONES_LISTADO_PROVEEDORES_INICIAL, OpcionesListadoProveedores, ProveedorListado,
  conteoPorRubro, cuerpoListadoProveedores, filtrarProveedores, nombreArchivoListadoProveedores, subtituloListadoProveedores,
} from '../lib/proveedoresListado';

type Logos = { bcv: boolean; sos: boolean; golden: boolean; renace: boolean; jhenzaen: boolean };
const LOGOS_POR_DEFECTO: Logos = { bcv: false, sos: false, golden: true, renace: false, jhenzaen: false };
const LOGOS: { k: keyof Logos; label: string }[] = [
  { k: 'golden', label: '✨ Golden Touch' },
  { k: 'bcv', label: '🏦 Banco Central de Venezuela' },
  { k: 'sos', label: '🛟 SOS La Guaira' },
  { k: 'renace', label: '🇻🇪 Plan Venezuela Renace' },
  { k: 'jhenzaen', label: '🏗️ Jhenzaen 2.012 C.A' },
];
const COLUMNAS: { k: keyof OpcionesListadoProveedores; label: string }[] = [
  { k: 'sinTelefono', label: '📞 Teléfono' },
  { k: 'sinDireccion', label: '📍 Dirección' },
  { k: 'sinRif', label: '🪪 RIF' },
  { k: 'sinCorreo', label: '✉️ Correo' },
  { k: 'sinRubros', label: '🏷️ Otros rubros' },
  { k: 'sinResumen', label: '🔢 Cuadro de cuántos hay por rubro' },
];

export function ListadoProveedoresPdf({ proveedores }: { proveedores: readonly ProveedorListado[] }) {
  const { colors } = useTheme();
  const [abierto, setAbierto] = useState(false);
  const [rubrosSel, setRubrosSel] = useState<string[]>([]);
  const [opciones, setOpciones] = useState<OpcionesListadoProveedores>(OPCIONES_LISTADO_PROVEEDORES_INICIAL);
  const [logos, setLogos] = useState<Logos>(LOGOS_POR_DEFECTO);
  const [titulo, setTitulo] = useState('Listado de proveedores');
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conteo = useMemo(() => conteoPorRubro(proveedores.filter((p) => p.active !== false)), [proveedores]);
  const elegidos = useMemo(() => filtrarProveedores(proveedores, rubrosSel), [proveedores, rubrosSel]);

  const alternarRubro = (r: string) =>
    setRubrosSel((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  const alternar = (k: keyof OpcionesListadoProveedores) => setOpciones((p) => ({ ...p, [k]: !p[k] }));

  const descargar = async () => {
    setDescargando(true);
    setError(null);
    try {
      const hoy = caracasToday();
      const html = pdfDocument({
        title: titulo.trim() || 'Listado de proveedores',
        subtitle: subtituloListadoProveedores(rubrosSel),
        extraCss: CSS_LISTADO_PROVEEDORES,
        logos,
        marcaTexto: false,
        body: cuerpoListadoProveedores({ proveedores: elegidos, rubrosSel, opciones }),
      });
      await exportPdf(html, nombreArchivoListadoProveedores(rubrosSel, hoy.split('-').reverse().join('-')));
    } catch (e: any) {
      setError(e?.message || 'No se pudo generar el PDF.');
    } finally {
      setDescargando(false);
    }
  };

  const pastilla = (key: string, label: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity key={key} onPress={onPress}
      style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: on ? colors.brand : colors.surfaceAlt, borderWidth: 1, borderColor: on ? colors.brand : colors.border }}>
      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Card>
      <TouchableOpacity onPress={() => setAbierto((v) => !v)}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🖨️ Imprimir listado de proveedores (PDF) {abierto ? '▲' : '▼'}</Text>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
          Para tenerlo en físico: elige los rubros (ferretería, limpieza…) y sale cada proveedor con su teléfono y su dirección corta.
        </Text>
      </TouchableOpacity>

      {abierto ? (
        <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>🏷️ ¿Qué rubros? (sin elegir ninguno salen todos)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {pastilla('__todos', `Todos (${proveedores.filter((p) => p.active !== false).length})`, rubrosSel.length === 0, () => setRubrosSel([]))}
            {conteo.map((c) => pastilla(c.rubro, `${c.rubro} (${c.n})`, rubrosSel.includes(c.rubro), () => alternarRubro(c.rubro)))}
          </View>

          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12, marginTop: spacing.xs }}>📄 Cómo sale</Text>
          <Toggle on={opciones.agrupar} label="Una tabla por rubro (con cuántos hay de cada uno)" onPress={() => alternar('agrupar')} />
          <Toggle on={opciones.direccionCorta} label="✂️ Dirección corta (una línea)" onPress={() => alternar('direccionCorta')} />
          {COLUMNAS.map((c) => (
            <Toggle key={c.k} on={!opciones[c.k]} label={c.label} onPress={() => alternar(c.k)} />
          ))}

          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12, marginTop: spacing.xs }}>🖼️ Logos</Text>
          {LOGOS.map((l) => (
            <Toggle key={l.k} on={logos[l.k]} label={l.label} onPress={() => setLogos((p) => ({ ...p, [l.k]: !p[l.k] }))} />
          ))}

          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Título</Text>
          <TextInput value={titulo} onChangeText={setTitulo} placeholder="Listado de proveedores" placeholderTextColor={colors.muted}
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />

          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>
            Saldrán {elegidos.length} proveedor(es){rubrosSel.length ? ` de ${rubrosSel.length} rubro(s)` : ''}.
            {elegidos.length > 0 && !opciones.sinTelefono ? ` ${elegidos.filter((p) => !(p.phone || p.pago_movil_phone)).length} no tienen teléfono cargado (sale «—»).` : ''}
          </Text>
          {error ? <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>⚠️ {error}</Text> : null}
          <TouchableOpacity onPress={() => void descargar()} disabled={descargando || elegidos.length === 0}
            style={{ backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: spacing.sm, alignItems: 'center', opacity: descargando || elegidos.length === 0 ? 0.5 : 1, marginTop: spacing.xs }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{descargando ? 'Generando…' : '📄 Descargar el listado (PDF)'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </Card>
  );
}
