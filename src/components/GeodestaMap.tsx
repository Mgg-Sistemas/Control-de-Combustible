// Mapa del módulo de GEODESTA. En WEB dibuja un mapa Leaflet real (satélite + calles)
// con los puntos del levantamiento coloreados por capa; puede superponer una capa
// GeoJSON (curvas de nivel, mapa de diferencias…) que le pasen las fases siguientes.
// En NATIVO cae a una lista (el mapa interactivo del sistema es solo web, igual que
// VenezuelaMap).
import React, { useMemo, useRef } from 'react';
import { Platform, View, Text, TouchableOpacity, Linking } from 'react-native';
import { Card } from './ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

export type GeoMapPoint = {
  id: string; lat: number; lng: number;
  code?: string | null; z?: number | null; layer?: string | null;
  color?: string; isGcp?: boolean; excluded?: boolean;
};

function buildHtml(points: GeoMapPoint[], overlay?: any): string {
  const data = JSON.stringify(points);
  const ov = JSON.stringify(overlay ?? null);
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{height:100%;margin:0}</style></head>
<body><div id="map"></div><script>
  var pts = ${data};
  var overlay = ${ov};
  var map = L.map('map').setView([10.60, -66.93], 13);
  var sat = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, attribution: 'Tiles © Esri' }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20 })
  ]);
  var calles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, attribution: '© OpenStreetMap' });
  sat.addTo(map);
  L.control.layers({ 'Satélite': sat, 'Calles': calles }, null, { collapsed: true }).addTo(map);

  var group = [];
  pts.forEach(function(p){
    if (p.lat == null || p.lng == null) return;
    var color = p.color || '#2563EB';
    var opacity = p.excluded ? 0.35 : 1;
    var m;
    if (p.isGcp) {
      m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className:'', iconSize:[18,18], iconAnchor:[9,9],
        html:'<div style="width:16px;height:16px;background:'+color+';border:2px solid #fff;transform:rotate(45deg);box-shadow:0 0 2px #0006;opacity:'+opacity+'"></div>' }) });
    } else {
      m = L.circleMarker([p.lat, p.lng], { radius:5, color:'#fff', weight:1, fillColor:color, fillOpacity:opacity });
    }
    var z = (p.z==null?'':('<br>Z: '+p.z+' m'));
    var cap = (p.layer?('<br>Capa: '+p.layer):'');
    var gcp = (p.isGcp?'<br><b>Punto de control (GCP)</b>':'');
    var exc = (p.excluded?'<br><i>Excluido</i>':'');
    m.bindPopup('<b>'+(p.code||'punto')+'</b>'+z+cap+gcp+exc);
    m.addTo(map); group.push([p.lat, p.lng]);
  });
  if (overlay) { try { L.geoJSON(overlay, { style: function(f){ return (f.properties&&f.properties.style)||{ color:'#B45309', weight:1 }; },
      onEachFeature: function(f,l){ if(f.properties&&f.properties.label){ l.bindTooltip(String(f.properties.label),{permanent:false}); } } }).addTo(map); } catch(e){} }
  if (group.length) { try { map.fitBounds(group, { padding:[30,30], maxZoom:19 }); } catch(e){} }
</script></body></html>`;
}

export function GeodestaMap({ points, overlay, height }: { points: GeoMapPoint[]; overlay?: any; height?: number }) {
  const { colors } = useTheme();
  const iframeRef = useRef<any>(null);
  const html = useMemo(() => buildHtml(points, overlay), [points, overlay]);

  if (Platform.OS === 'web') {
    return React.createElement('iframe' as any, {
      ref: iframeRef,
      srcDoc: html,
      allow: 'geolocation; fullscreen',
      style: { width: '100%', height: height ?? 360, border: `1px solid ${colors.border}`, borderRadius: radius.md },
    } as any);
  }
  // Fallback nativo.
  const withCoords = points.filter((p) => p.lat != null && p.lng != null);
  return (
    <View style={{ gap: spacing.xs }}>
      {withCoords.length === 0 ? (
        <Card><Text style={{ color: colors.muted }}>Sin puntos con coordenadas para el mapa.</Text></Card>
      ) : (
        withCoords.slice(0, 60).map((p) => (
          <Card key={p.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{p.isGcp ? '◆' : '●'} {p.code || 'punto'}{p.layer ? ` · ${p.layer}` : ''}</Text>
              <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps?q=${p.lat},${p.lng}`)}>
                <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>Ver en mapa</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{p.lat?.toFixed(6)}, {p.lng?.toFixed(6)}{p.z != null ? ` · Z ${p.z} m` : ''}</Text>
          </Card>
        ))
      )}
      {withCoords.length > 60 ? <Text style={{ color: colors.muted, fontSize: 11 }}>Mostrando 60 de {withCoords.length} puntos (usa la versión web para el mapa completo).</Text> : null}
    </View>
  );
}
