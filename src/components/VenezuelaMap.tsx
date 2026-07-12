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
  tipo?: string | null;          // modelo
  clasificacion?: string | null; // clasificación
  plate?: string | null;         // placa
  serial?: string | null;        // serial
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
<style>html,body,#map{height:100%;margin:0}.leaflet-control-geocoder{min-width:260px}.leaflet-control-geocoder-form input{width:230px}
.zoneLbl{background:rgba(17,24,39,.72);color:#fff;border:0;border-radius:4px;font-weight:700;font-size:11px;padding:2px 6px;box-shadow:none;white-space:nowrap}
.zoneLbl:before{display:none}</style></head>
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

  // Marcadores y rutas guardados con su empresa, para poder FILTRAR por empresa.
  var routeGroup = L.layerGroup();
  var allMarkers = []; // {marker, company, latlng}
  var allRoutes = [];  // {layer, company}
  pins.forEach(function(p){
    var co = p.company || 'Sin empresa';
    var color = companyColor[co];
    if (p.route && p.route.length > 1){
      allRoutes.push({ layer: L.polyline(p.route, {color:color, weight:3, opacity:0.7}), company: co });
    }
    var mk = L.marker([p.lat, p.lng], {icon: pin(color)});
    // Popup con botón para eliminar la ubicación (avisa a la app por postMessage).
    var esc = function(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    var placaSerial = [p.plate ? 'Placa: '+esc(p.plate) : '', p.serial ? 'Serial: '+esc(p.serial) : ''].filter(Boolean).join(' · ');
    var div = document.createElement('div');
    div.innerHTML = '<b>'+esc(p.name)+'</b><br/>🏢 '+esc(co)
      + (p.tipo ? '<br/>🏷️ Modelo: '+esc(p.tipo) : '')
      + (p.clasificacion ? '<br/>🗃️ Clasificación: '+esc(p.clasificacion) : '')
      + (placaSerial ? '<br/>🔖 '+placaSerial : '')
      + '<br/>📍 '+p.lat+', '+p.lng
      + '<br/>Activa: '+esc(p.active)
      + '<br/>Estado: '+(p.operational?'Operativa':'No operativa');
    var btn = document.createElement('button');
    btn.textContent = '🗑️ Eliminar ubicación';
    btn.style.cssText = 'margin-top:8px;background:#B91C1C;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:700';
    btn.onclick = function(){ try { parent.postMessage({type:'map-delete-pin', id: p.id, name: p.name}, '*'); } catch(e){} };
    div.appendChild(document.createElement('br'));
    div.appendChild(btn);
    mk.bindPopup(div);
    allMarkers.push({ marker: mk, company: co, latlng: [p.lat, p.lng] });
  });

  // Estado del filtro: empresa seleccionada (null = todas) y si las rutas están visibles.
  var currentCompany = null;
  var routesOn = true;
  var legendCollapsed = false;
  // Aplica el filtro: muestra solo los pines/rutas de la empresa elegida (o todas) y reencuadra.
  function refresh(){
    var bounds = [];
    allMarkers.forEach(function(o){
      if (currentCompany === null || o.company === currentCompany){ o.marker.addTo(map); bounds.push(o.latlng); }
      else { map.removeLayer(o.marker); }
    });
    routeGroup.clearLayers();
    allRoutes.forEach(function(o){
      if (currentCompany === null || o.company === currentCompany){ o.layer.addTo(routeGroup); }
    });
    if (routesOn){ routeGroup.addTo(map); } else { map.removeLayer(routeGroup); }
    if (bounds.length) map.fitBounds(bounds, {padding:[40,40], maxZoom:13});
  }

  // ── Botón VER / OCULTAR RUTA (icono de ojo, SVG — no emoji) ──────────────
  var EYE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1E3A5F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B91C1C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
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
        a.innerHTML = routesOn ? EYE : EYE_OFF;
        a.title = routesOn ? 'Ocultar ruta' : 'Ver ruta';
        refresh();
      });
      return c;
    }
  });
  map.addControl(new RouteToggle());

  // ── LEYENDA por empresa (clicable): filtra el mapa a esa empresa; "General" = todas ──
  var Legend = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function(){
      var c = L.DomUtil.create('div', '');
      c.style.cssText = 'background:rgba(255,255,255,0.95);border-radius:8px;padding:8px 10px;box-shadow:0 1px 6px rgba(0,0,0,0.3);font:12px/1.4 Tahoma,Arial,sans-serif;color:#111;max-height:210px;overflow:auto;min-width:170px';
      var ordered = companyOrder.slice().sort(function(a,b){ return a.localeCompare(b, 'es', {sensitivity:'base'}); });
      function render(){
        var total = pins.length;
        var genActive = currentCompany === null;
        // Encabezado con botón para ocultar/mostrar (colapsar) la lista.
        var head = '<div data-toggle="1" style="display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;font-weight:800;'+(legendCollapsed?'':'margin-bottom:4px')+'">'
          + '<span>Máquinas por empresa</span>'
          + '<span style="font-size:14px;color:#1E3A5F">'+(legendCollapsed?'▸':'▾')+'</span></div>';
        if (legendCollapsed){ c.style.overflow='visible'; c.innerHTML = head; return; }
        c.style.overflow='auto';
        var gen = '<div data-co="__all__" style="display:flex;align-items:center;gap:6px;margin:2px 0;cursor:pointer;padding:3px 4px;border-radius:5px;'+(genActive?'background:#1E3A5F;color:#fff;':'')+'">'
          + '<span style="width:12px;height:12px;border-radius:50%;background:#1E3A5F;border:1px solid #0003;flex:0 0 auto"></span>'
          + '<span style="flex:1;font-weight:700">🌐 General (todas)</span>'
          + '<b style="margin-left:6px">'+total+'</b></div>';
        var rows = ordered.map(function(co){
          var active = currentCompany === co;
          return '<div data-co="'+encodeURIComponent(co)+'" style="display:flex;align-items:center;gap:6px;margin:2px 0;cursor:pointer;padding:3px 4px;border-radius:5px;'+(active?'background:'+companyColor[co]+';color:#fff;':'')+'">'
            + '<span style="width:12px;height:12px;border-radius:50%;background:'+companyColor[co]+';border:1px solid #0003;flex:0 0 auto"></span>'
            + '<span style="flex:1">'+co+'</span>'
            + '<b style="margin-left:6px">'+companyCount[co]+'</b></div>';
        }).join('');
        var shownN = genActive ? total : (companyCount[currentCompany] || 0);
        c.innerHTML = head+gen+rows
          + '<div style="border-top:1px solid #ddd;margin-top:5px;padding-top:4px;display:flex;justify-content:space-between"><span>'+(genActive?'Total ubicadas':'Mostrando')+'</span><b>'+shownN+'</b></div>';
      }
      render();
      L.DomEvent.on(c, 'click', function(e){
        var el = e.target;
        // ¿Se tocó el encabezado? → ocultar/mostrar la lista.
        var t = e.target;
        while (t && t !== c && !(t.getAttribute && t.getAttribute('data-toggle'))) t = t.parentNode;
        if (t && t !== c){ legendCollapsed = !legendCollapsed; render(); return; }
        while (el && el !== c && !(el.getAttribute && el.getAttribute('data-co'))) el = el.parentNode;
        if (!el || el === c) return;
        var co = el.getAttribute('data-co');
        currentCompany = (co === '__all__') ? null : decodeURIComponent(co);
        render();
        refresh();
      });
      L.DomEvent.disableClickPropagation(c);
      L.DomEvent.disableScrollPropagation(c);
      return c;
    }
  });
  map.addControl(new Legend());

  // ── SUB-SECTORES (zonas de La Guaira · Sector Este) — ver/ocultar cada una ──
  // Cada zona se define por dos límites (coordenadas convertidas de DMS a decimal).
  var SUBSECTORS = [
    { n:'Subsector 1: Álamo', color:'#F97316',
      a:{ lbl:'Límite Oeste', name:'Punta Mulato', lat:10.603567, lng:-66.912374 },
      b:{ lbl:'Límite Este', name:'Río Macuto', lat:10.607051, lng:-66.896534 } },
    { n:'Subsector 2: Macuto', color:'#22C55E',
      a:{ lbl:'Límite Oeste', name:'Río Macuto', lat:10.607051, lng:-66.896534 },
      b:{ lbl:'Límite Este', name:'Quebrada El Cojo', lat:10.611158, lng:-66.887963 } },
    { n:'Subsector 3: Camurí Chico', color:'#3B82F6',
      a:{ lbl:'Límite Oeste', name:'Quebrada El Cojo', lat:10.611158, lng:-66.887963 },
      b:{ lbl:'Límite Este', name:'Quebrada Camurí Chico', lat:10.611496, lng:-66.870785 } },
    { n:'Subsector 4: El Palmar', color:'#EAB308',
      a:{ lbl:'Límite Oeste', name:'Quebrada Camurí Chico', lat:10.611496, lng:-66.870785 },
      b:{ lbl:'Límite Este', name:'Quebrada San Juan', lat:10.612721, lng:-66.852966 } },
    { n:'Subsector 5: Caraballeda', color:'#EC4899',
      a:{ lbl:'Límite Oeste', name:'Quebrada San Juan', lat:10.612721, lng:-66.852966 },
      b:{ lbl:'Límite Nor-Este', name:'Av. Principal de Caribe', lat:10.614999, lng:-66.842238 } },
    { n:'Subsector 6: Caribe', color:'#8B5CF6',
      a:{ lbl:'Límite Sur', name:'Av. 10 A', lat:10.613268, lng:-66.857451 },
      b:{ lbl:'Límite Este', name:'Quebrada San Juan', lat:10.612721, lng:-66.852966 } },
    { n:'Subsector 7: Tanaguarena', color:'#06B6D4',
      a:{ lbl:'Límite Nor-Oeste', name:'Punta Caraballeda', lat:10.619689, lng:-66.846207 },
      b:{ lbl:'Límite Este', name:'Punta Tanaguarena', lat:10.611003, lng:-66.818581 } },
  ];
  var sectorLayers = {}; // índice -> layerGroup (polígono + 2 marcadores de límite)
  var zonesOn = {};      // índice -> visible?
  SUBSECTORS.forEach(function(s, i){
    var D = 0.007; // ancho de la banda hacia el sur (tierra adentro) para dar cuerpo visible a la zona
    var poly = L.polygon([
      [s.a.lat, s.a.lng], [s.b.lat, s.b.lng], [s.b.lat - D, s.b.lng], [s.a.lat - D, s.a.lng]
    ], { color: s.color, weight: 2, fillColor: s.color, fillOpacity: 0.25 });
    poly.bindTooltip(s.n, { permanent: true, direction: 'center', className: 'zoneLbl' });
    var mkr = function(pt){
      var m = L.circleMarker([pt.lat, pt.lng], { radius:6, color:'#fff', weight:2, fillColor:s.color, fillOpacity:1 });
      m.bindPopup('<b>'+s.n+'</b><br/>'+pt.lbl+': <b>'+pt.name+'</b><br/>📍 '+pt.lat.toFixed(6)+', '+pt.lng.toFixed(6));
      return m;
    };
    sectorLayers[i] = L.layerGroup([poly, mkr(s.a), mkr(s.b)]);
  });
  function setZone(i, on){
    zonesOn[i] = on;
    if (on){ sectorLayers[i].addTo(map); } else { map.removeLayer(sectorLayers[i]); }
  }

  // Panel de zonas: encabezado colapsable + "Ver/Ocultar todas" + una fila por sub-sector.
  var ZonesPanel = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function(){
      var c = L.DomUtil.create('div', '');
      c.style.cssText = 'background:rgba(255,255,255,0.95);border-radius:8px;padding:8px 10px;box-shadow:0 1px 6px rgba(0,0,0,0.3);font:12px/1.4 Tahoma,Arial,sans-serif;color:#111;max-height:280px;overflow:auto;min-width:215px';
      var collapsed = true;
      function render(){
        var head = '<div data-ztoggle="1" style="display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;font-weight:800;'+(collapsed?'':'margin-bottom:6px')+'">'
          + '<span>🗺️ Sectores (zonas)</span>'
          + '<span style="font-size:14px;color:#1E3A5F">'+(collapsed?'▸':'▾')+'</span></div>';
        if (collapsed){ c.style.overflow='visible'; c.innerHTML = head; return; }
        c.style.overflow='auto';
        var anyOn = SUBSECTORS.some(function(_, i){ return zonesOn[i]; });
        var all = '<div data-zall="1" style="display:flex;align-items:center;gap:6px;margin:0 0 6px;cursor:pointer;font-weight:700;color:#1E3A5F">'
          + '<span>'+(anyOn ? '🚫 Ocultar todas' : '👁️ Ver todas')+'</span></div>';
        var rows = SUBSECTORS.map(function(s, i){
          var on = !!zonesOn[i];
          return '<div data-zi="'+i+'" style="display:flex;align-items:center;gap:6px;margin:2px 0;cursor:pointer;padding:3px 4px;border-radius:5px">'
            + '<span style="width:13px;height:13px;border-radius:3px;background:'+(on?s.color:'transparent')+';border:2px solid '+s.color+';flex:0 0 auto"></span>'
            + '<span style="flex:1">'+s.n+'</span></div>';
        }).join('');
        c.innerHTML = head + all + rows;
      }
      render();
      L.DomEvent.on(c, 'click', function(e){
        var el = e.target;
        while (el && el !== c && !(el.getAttribute && (el.hasAttribute('data-ztoggle') || el.hasAttribute('data-zall') || el.hasAttribute('data-zi')))) el = el.parentNode;
        if (!el || el === c) return;
        if (el.hasAttribute('data-ztoggle')){ collapsed = !collapsed; render(); return; }
        if (el.hasAttribute('data-zall')){
          var anyOn = SUBSECTORS.some(function(_, i){ return zonesOn[i]; });
          SUBSECTORS.forEach(function(_, i){ setZone(i, !anyOn); });
          if (!anyOn){
            var bb = []; SUBSECTORS.forEach(function(s){ bb.push([s.a.lat, s.a.lng]); bb.push([s.b.lat, s.b.lng]); });
            map.fitBounds(bb, { padding:[50,50], maxZoom:15 });
          }
          render(); return;
        }
        var i = parseInt(el.getAttribute('data-zi'), 10);
        var on = !zonesOn[i];
        setZone(i, on);
        if (on){ map.fitBounds(sectorLayers[i].getLayers()[0].getBounds(), { padding:[60,60], maxZoom:16 }); }
        render();
      });
      L.DomEvent.disableClickPropagation(c);
      L.DomEvent.disableScrollPropagation(c);
      return c;
    }
  });
  map.addControl(new ZonesPanel());

  refresh(); // pinta todo al inicio (todas las empresas)
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
            {p.tipo ? <Text style={{ color: colors.muted, fontSize: 12 }}>🏷️ Modelo: {p.tipo}</Text> : null}
            {p.clasificacion ? <Text style={{ color: colors.muted, fontSize: 12 }}>🗃️ Clasificación: {p.clasificacion}</Text> : null}
            {p.plate || p.serial ? (
              <Text style={{ color: colors.muted, fontSize: 12 }}>🔖 {[p.plate && `Placa: ${p.plate}`, p.serial && `Serial: ${p.serial}`].filter(Boolean).join(' · ')}</Text>
            ) : null}
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
