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
  company: string;       // empresa (para colorear el pin y la leyenda)
  route: [number, number][];
};

function buildHtml(pins: MapPin[]): string {
  const data = JSON.stringify(pins);
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<link rel="stylesheet" href="https://unpkg.com/leaflet-control-geocoder@2.4.0/dist/Control.Geocoder.css"/>
<script src="https://unpkg.com/leaflet-control-geocoder@2.4.0/dist/Control.Geocoder.js"></script>
<style>html,body,#map{height:100%;margin:0}.leaflet-control-geocoder{min-width:260px}.leaflet-control-geocoder-form input{width:230px}</style></head>
<body><div id="map"></div><script>
  var pins = ${data};
  var map = L.map('map').setView([6.42, -66.58], 6); // Venezuela
  // Capa satelital (Esri World Imagery) + nombres de calles/lugares encima.
  var sat = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Tiles © Esri'
    }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19
    })
  ]);
  var calles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap'
  });
  sat.addTo(map); // Satélite por defecto
  L.control.layers({ 'Satélite': sat, 'Calles': calles }, null, { collapsed: false }).addTo(map);

  // Buscador de lugares (estados, municipios, parroquias, calles…) limitado a Venezuela.
  if (L.Control && L.Control.Geocoder) {
    var geocoder = L.Control.Geocoder.nominatim({
      geocodingQueryParams: { countrycodes: 've', 'accept-language': 'es', addressdetails: 1, limit: 8 }
    });
    L.Control.geocoder({
      geocoder: geocoder,
      defaultMarkGeocode: true,
      collapsed: false,
      placeholder: 'Buscar estado, municipio, parroquia, calle…',
      errorMessage: 'No se encontró el lugar'
    }).addTo(map);
  }
  function pin(color){return L.divIcon({className:'',iconSize:[28,28],iconAnchor:[14,28],popupAnchor:[0,-26],
    html:'<svg width="28" height="28" viewBox="0 0 24 24"><path fill="'+color+'" stroke="white" stroke-width="1.2" d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/><circle cx="12" cy="9" r="2.6" fill="white"/></svg>'});}
  // Paleta de colores por EMPRESA (cada empresa un color distinto).
  var PALETTE = ['#2563EB','#DC2626','#16A34A','#D97706','#7C3AED','#DB2777','#0891B2','#65A30D','#EA580C','#0D9488','#9333EA','#CA8A04','#4F46E5','#BE123C','#15803D','#B45309'];
  var companyColor = {}; var companyCount = {}; var companyOrder = [];
  pins.forEach(function(p){
    var co = p.company || 'Sin empresa';
    if (!(co in companyColor)) { companyColor[co] = PALETTE[companyOrder.length % PALETTE.length]; companyOrder.push(co); }
    companyCount[co] = (companyCount[co] || 0) + 1;
  });

  // Grupo con TODAS las rutas (para poder verlas/ocultarlas con un botón).
  var routeGroup = L.layerGroup();
  var bounds = [];
  pins.forEach(function(p){
    var co = p.company || 'Sin empresa';
    var color = companyColor[co];
    if (p.route && p.route.length > 1){
      L.polyline(p.route, {color:color, weight:3, opacity:0.7}).addTo(routeGroup);
    }
    var mk = L.marker([p.lat, p.lng], {icon: pin(color)}).addTo(map);
    // Popup con botón para eliminar la ubicación (avisa a la app por postMessage).
    var div = document.createElement('div');
    div.innerHTML = '<b>'+p.name+'</b><br/>🏢 '+co+'<br/>'+p.lat+', '+p.lng+'<br/>Activa: '+p.active+'<br/>Estado: '+(p.operational?'Operativa':'No operativa');
    var btn = document.createElement('button');
    btn.textContent = '🗑️ Eliminar ubicación';
    btn.style.cssText = 'margin-top:8px;background:#B91C1C;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:700';
    btn.onclick = function(){ try { parent.postMessage({type:'map-delete-pin', id: p.id, name: p.name}, '*'); } catch(e){} };
    div.appendChild(document.createElement('br'));
    div.appendChild(btn);
    mk.bindPopup(div);
    bounds.push([p.lat, p.lng]);
  });
  if (bounds.length) map.fitBounds(bounds, {padding:[40,40], maxZoom:13});

  // ── Botón VER / OCULTAR RUTA (icono de ojo, SVG — no emoji) ──────────────
  routeGroup.addTo(map); // rutas visibles por defecto
  var EYE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1E3A5F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B91C1C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  var routesOn = true;
  var RouteToggle = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function(){
      var c = L.DomUtil.create('div', 'leaflet-bar');
      var a = L.DomUtil.create('a', '', c);
      a.href = '#';
      a.title = 'Ver / ocultar ruta';
      a.style.cssText = 'width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:#fff';
      a.innerHTML = EYE;
      L.DomEvent.on(a, 'click', function(e){
        L.DomEvent.stop(e);
        routesOn = !routesOn;
        if (routesOn){ routeGroup.addTo(map); a.innerHTML = EYE; a.title = 'Ocultar ruta'; }
        else { map.removeLayer(routeGroup); a.innerHTML = EYE_OFF; a.title = 'Ver ruta'; }
      });
      return c;
    }
  });
  map.addControl(new RouteToggle());

  // ── LEYENDA por empresa: color + cantidad de máquinas ubicadas ───────────
  var Legend = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function(){
      var c = L.DomUtil.create('div', '');
      c.style.cssText = 'background:rgba(255,255,255,0.95);border-radius:8px;padding:8px 10px;box-shadow:0 1px 6px rgba(0,0,0,0.3);font:12px/1.4 Tahoma,Arial,sans-serif;color:#111;max-height:190px;overflow:auto;min-width:150px';
      var total = pins.length;
      var rows = companyOrder.slice().sort(function(a,b){ return companyCount[b]-companyCount[a] || a.localeCompare(b); }).map(function(co){
        return '<div style="display:flex;align-items:center;gap:6px;margin:2px 0">'
          + '<span style="width:12px;height:12px;border-radius:50%;background:'+companyColor[co]+';border:1px solid #0003;flex:0 0 auto"></span>'
          + '<span style="flex:1">'+co+'</span>'
          + '<b style="margin-left:6px">'+companyCount[co]+'</b></div>';
      }).join('');
      c.innerHTML = '<div style="font-weight:800;margin-bottom:4px">Máquinas por empresa</div>'+rows
        + '<div style="border-top:1px solid #ddd;margin-top:5px;padding-top:4px;display:flex;justify-content:space-between"><span>Total ubicadas</span><b>'+total+'</b></div>';
      L.DomEvent.disableClickPropagation(c);
      L.DomEvent.disableScrollPropagation(c);
      return c;
    }
  });
  map.addControl(new Legend());
</script></body></html>`;
}

export function VenezuelaMap({ pins, onDelete }: { pins: MapPin[]; onDelete?: (id: string, name?: string) => void }) {
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
            <Text style={{ color: colors.primary, fontSize: 12 }}>🏢 {p.company}</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{p.lat}, {p.lng} · Activa {p.active}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
              <TouchableOpacity
                onPress={() => Linking.openURL(`https://www.google.com/maps?q=${p.lat},${p.lng}`)}
                style={{ flex: 1, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}
              >
                <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>Google Maps</Text>
              </TouchableOpacity>
              {onDelete ? (
                <TouchableOpacity
                  onPress={() => onDelete(p.id, p.name)}
                  style={{ flex: 1, backgroundColor: colors.danger, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>🗑️ Eliminar ubicación</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </Card>
        ))
      )}
    </View>
  );
}
