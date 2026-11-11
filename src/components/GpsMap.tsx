// 📡 El mapa del GPS (10-nov-2026). Un Leaflet aparte del mapa de máquinas (mismas capas:
// satélite de Esri y calles de OpenStreetMap), para no tocar el 🗺️ Mapa de siempre.
// Solo pinta los puntos que la pantalla ya consultó: no pide nada por su cuenta.
// En el teléfono con la app nativa (sin navegador) sale una lista con «Google Maps».
import React, { useMemo } from 'react';
import { Platform, View, Text, TouchableOpacity, Linking } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

export type PuntoGps = {
  id: string;
  nombre: string;
  lat: number;
  lng: number;
  /** En gris: la última posición tiene más de 1 hora (equipo fuera de línea). */
  viejo: boolean;
  enMarcha: boolean;
  rumbo: number | null;
  /** Líneas para la ventanita del punto (ya escritas). */
  lineas: string[];
  /** Para abrir la página de iTrackSafeX (recorrido completo). */
  url: string | null;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

function armarHtml(puntos: PuntoGps[], seleccion: string | null): string {
  const datos = JSON.stringify(puntos.map((p) => ({
    id: p.id, lat: p.lat, lng: p.lng, viejo: p.viejo, enMarcha: p.enMarcha, rumbo: p.rumbo,
    nombre: esc(p.nombre),
    html: '<b>' + esc(p.nombre) + '</b><br/>' + p.lineas.map(esc).join('<br/>')
      + '<br/><a href="https://www.google.com/maps?q=' + p.lat + ',' + p.lng + '" target="_blank" rel="noopener">Google Maps</a>'
      + (p.url ? ' · <a href="' + esc(p.url) + '" target="_blank" rel="noopener">Ver en iTrackSafeX</a>' : ''),
  }))).replace(/</g, '\\u003c');
  const sel = JSON.stringify(seleccion);
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<style>html,body,#map{height:100%;margin:0;font-family:system-ui,Arial,sans-serif}
.gpsLbl{background:rgba(17,24,39,.8);color:#fff;border:0;border-radius:4px;font-weight:700;font-size:11px;padding:2px 6px;box-shadow:none;white-space:nowrap}
.gpsLbl:before{display:none}
.leaflet-popup-content{font-size:13px;line-height:1.45}</style></head>
<body><div id="map"></div><script>
  var puntos = ${datos};
  var seleccion = ${sel};
  var map = L.map('map').setView([8.2, -63.5], 7);
  var sat = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles © Esri' }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 })
  ]);
  var calles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
  calles.addTo(map);
  L.control.layers({ 'Calles': calles, 'Satélite': sat }, null, { collapsed: true, position: 'topleft' }).addTo(map);
  var bounds = [];
  var abrir = null;
  puntos.forEach(function (p) {
    var color = p.viejo ? '#6B7280' : (p.enMarcha ? '#16A34A' : '#2563EB');
    var m = L.circleMarker([p.lat, p.lng], { radius: 9, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.95 }).addTo(map);
    m.bindPopup(p.html);
    m.bindTooltip(p.nombre, { permanent: true, direction: 'top', offset: [0, -10], className: 'gpsLbl' });
    bounds.push([p.lat, p.lng]);
    if (seleccion && p.id === seleccion) abrir = m;
  });
  if (abrir) { map.setView(abrir.getLatLng(), 15); abrir.openPopup(); }
  else if (bounds.length === 1) map.setView(bounds[0], 15);
  else if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
</script></body></html>`;
}

export function GpsMap({ puntos, seleccion = null, height = 420 }: { puntos: PuntoGps[]; seleccion?: string | null; height?: number }) {
  const { colors } = useTheme();
  const html = useMemo(() => armarHtml(puntos, seleccion), [puntos, seleccion]);

  if (Platform.OS === 'web') {
    return React.createElement('iframe' as any, {
      srcDoc: html,
      title: 'Mapa GPS',
      allow: 'fullscreen',
      style: { width: '100%', height, border: `1px solid ${colors.border}`, borderRadius: radius.md },
    } as any);
  }

  // App nativa: lista con «Google Maps» (mismo criterio que el mapa de máquinas).
  return (
    <View style={{ gap: spacing.xs }}>
      {puntos.length === 0 ? <Text style={{ color: colors.muted }}>Toca «Actualizar» para ver dónde están.</Text> : null}
      {puntos.map((p) => (
        <TouchableOpacity key={p.id} onPress={() => Linking.openURL(`https://www.google.com/maps?q=${p.lat},${p.lng}`)}
          style={{ padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
          <Text style={{ color: p.viejo ? colors.muted : colors.text, fontWeight: '800' }}>📍 {p.nombre}</Text>
          {p.lineas.map((l, i) => <Text key={i} style={{ color: colors.muted, fontSize: 12 }}>{l}</Text>)}
          <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '800' }}>Abrir en Google Maps</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default GpsMap;
