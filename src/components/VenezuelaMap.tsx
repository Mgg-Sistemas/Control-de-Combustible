import React from 'react';
import { Platform, View, Text, TouchableOpacity, Linking } from 'react-native';
import { Card } from './ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

export type MapPin = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  active: string;        // "tiempo activa" ya formateado
  operational: boolean;
  route: [number, number][];
};

function buildHtml(pins: MapPin[]): string {
  const data = JSON.stringify(pins);
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{height:100%;margin:0}</style></head>
<body><div id="map"></div><script>
  var pins = ${data};
  var map = L.map('map').setView([6.42, -66.58], 6); // Venezuela
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap'
  }).addTo(map);
  function pin(color){return L.divIcon({className:'',iconSize:[28,28],iconAnchor:[14,28],popupAnchor:[0,-26],
    html:'<svg width="28" height="28" viewBox="0 0 24 24"><path fill="'+color+'" stroke="white" stroke-width="1.2" d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/><circle cx="12" cy="9" r="2.6" fill="white"/></svg>'});}
  var bounds = [];
  pins.forEach(function(p){
    var color = p.operational ? '#15803D' : '#B91C1C';
    if (p.route && p.route.length > 1){
      L.polyline(p.route, {color:'#2563EB', weight:3, opacity:0.7}).addTo(map);
    }
    var mk = L.marker([p.lat, p.lng], {icon: pin(color)}).addTo(map);
    mk.bindPopup('<b>'+p.name+'</b><br/>'+p.lat+', '+p.lng+'<br/>Activa: '+p.active+'<br/>Estado: '+(p.operational?'Operativa':'No operativa'));
    bounds.push([p.lat, p.lng]);
  });
  if (bounds.length) map.fitBounds(bounds, {padding:[40,40], maxZoom:13});
</script></body></html>`;
}

export function VenezuelaMap({ pins }: { pins: MapPin[] }) {
  const { colors } = useTheme();

  if (Platform.OS === 'web') {
    return React.createElement('iframe' as any, {
      srcDoc: buildHtml(pins),
      style: {
        width: '100%',
        height: 460,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.md,
      },
    } as any);
  }

  // Fallback nativo: lista con enlace a Google Maps.
  return (
    <View style={{ gap: spacing.sm }}>
      {pins.length === 0 ? (
        <Card><Text style={{ color: colors.muted }}>Sin máquinas con ubicación.</Text></Card>
      ) : (
        pins.map((p) => (
          <Card key={p.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700', color: colors.text }}>📍 {p.name}</Text>
              <Text style={{ color: p.operational ? colors.success : colors.danger, fontWeight: '700' }}>
                {p.operational ? 'Operativa' : 'No operativa'}
              </Text>
            </View>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{p.lat}, {p.lng} · Activa {p.active}</Text>
            <TouchableOpacity
              onPress={() => Linking.openURL(`https://www.google.com/maps?q=${p.lat},${p.lng}`)}
              style={{ marginTop: spacing.xs, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}
            >
              <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>Abrir en Google Maps</Text>
            </TouchableOpacity>
          </Card>
        ))
      )}
    </View>
  );
}
