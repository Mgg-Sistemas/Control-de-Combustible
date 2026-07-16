import React, { useEffect, useRef } from 'react';
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
  utm?: string | null;           // coordenadas en formato UTM (ya formateadas)
  route: [number, number][];
};

// Paleta de colores por EMPRESA (misma que usa el mapa para los pines/leyenda).
export const MAP_PALETTE = ['#2563EB','#DC2626','#16A34A','#D97706','#7C3AED','#DB2777','#0891B2','#65A30D','#EA580C','#0D9488','#9333EA','#CA8A04','#4F46E5','#BE123C','#15803D','#B45309'];

/** Leyenda por empresa (color + conteo), en orden de aparición (igual que el mapa). */
export function companyLegend(pins: MapPin[]): { rows: { company: string; color: string; count: number }[]; total: number } {
  const color: Record<string, string> = {};
  const count: Record<string, number> = {};
  const order: string[] = [];
  pins.forEach((p) => {
    const co = p.company || 'Sin empresa';
    if (!(co in color)) { color[co] = MAP_PALETTE[order.length % MAP_PALETTE.length]; order.push(co); }
    count[co] = (count[co] || 0) + 1;
  });
  return { rows: order.map((co) => ({ company: co, color: color[co], count: count[co] })), total: pins.length };
}

// ── SUB-SECTORES (zonas de La Guaira). El ORDEN define el índice para prender/apagar. ──
const SUBSECTORS: any[] = [
  { n:'Oeste · Sub 7: Catamare', color:'#D946EF',
    a:{ lbl:'Límite Oeste', name:'Central Eléctrica J.J. Sánchez', lat:10.586938, lng:-67.079676 },
    b:{ lbl:'Límite Este', name:'Playa La Zorra', lat:10.598137, lng:-67.044345 } },
  { n:'Oeste · Sub 6: Centrocatia', color:'#EC4899',
    a:{ lbl:'Límite Oeste', name:'Playa La Zorra', lat:10.598137, lng:-67.044345 },
    b:{ lbl:'Límite Este', name:'Quebrada Tacagua', lat:10.607800, lng:-67.030371 } },
  { n:'Oeste · Sub 4: Hugo Chávez', color:'#F43F5E',
    a:{ lbl:'Límite Oeste', name:'Av. El Balneario', lat:10.609909, lng:-67.028679 },
    b:{ lbl:'Límite Este', name:'Residencial Jurel', lat:10.610310, lng:-67.008093 } },
  { n:'Oeste · Sub 3: Franja Costera', color:'#84CC16',
    a:{ lbl:'Límite Oeste', name:'Av. El Balneario', lat:10.609909, lng:-67.028679 },
    b:{ lbl:'Límite Sur', name:'Zona Perimetral Norte Aeropuerto', lat:10.606976, lng:-66.998483 } },
  { n:'Oeste · Sub 5: Aeropuerto', color:'#EAB308',
    a:{ lbl:'Límite Oeste', name:'Final Aeropuerto de Maiquetía', lat:10.601648, lng:-67.017346 },
    b:{ lbl:'Límite Este', name:'Elevado de Pariata', lat:10.598585, lng:-66.961161 } },
  { n:'Oeste · Sub 2: El Trébol', color:'#F97316',
    a:{ lbl:'Límite Oeste', name:'Elevado de Pariata', lat:10.598585, lng:-66.961161 },
    b:{ lbl:'Límite Este', name:'Inicio Puerto de La Guaira', lat:10.602632, lng:-66.933117 } },
  { n:'Oeste · Sub 1: El Chorro', color:'#EF4444',
    a:{ lbl:'Límite Oeste', name:'Inicio Puerto de La Guaira', lat:10.602632, lng:-66.933117 },
    b:{ lbl:'Límite Este', name:'Punta Mulato', lat:10.603567, lng:-66.912374 } },
  { n:'Este · Sub 1: Álamo', color:'#F97316',
    a:{ lbl:'Límite Oeste', name:'Punta Mulato', lat:10.603567, lng:-66.912374 },
    b:{ lbl:'Límite Este', name:'Río Macuto', lat:10.607051, lng:-66.896534 } },
  { n:'Este · Sub 2: Macuto', color:'#22C55E',
    a:{ lbl:'Límite Oeste', name:'Río Macuto', lat:10.607051, lng:-66.896534 },
    b:{ lbl:'Límite Este', name:'Quebrada El Cojo', lat:10.611158, lng:-66.887963 } },
  { n:'Este · Sub 3: Camurí Chico', color:'#3B82F6',
    a:{ lbl:'Límite Oeste', name:'Quebrada El Cojo', lat:10.611158, lng:-66.887963 },
    b:{ lbl:'Límite Este', name:'Quebrada Camurí Chico', lat:10.611496, lng:-66.870785 } },
  { n:'Este · Sub 4: El Palmar', color:'#EAB308',
    a:{ lbl:'Límite Oeste', name:'Quebrada Camurí Chico', lat:10.611496, lng:-66.870785 },
    b:{ lbl:'Límite Este', name:'Quebrada San Juan', lat:10.612721, lng:-66.852966 } },
  { n:'Caraballeda', color:'#EC4899',
    pts:[
      [10.61470, -66.85180],
      [10.61680, -66.84330],
      [10.61760, -66.83560],
      [10.60420, -66.83660],
      [10.60250, -66.84760],
      [10.60650, -66.85320],
    ] },
  { n:'Este · Sub 6: Caribe', color:'#8B5CF6',
    a:{ lbl:'Límite Sur', name:'Av. 10 A', lat:10.613268, lng:-66.857451 },
    b:{ lbl:'Límite Este', name:'Quebrada San Juan', lat:10.612721, lng:-66.852966 } },
  { n:'Este · Sub 7: Tanaguarena', color:'#06B6D4',
    a:{ lbl:'Límite Nor-Oeste', name:'Punta Caraballeda', lat:10.619689, lng:-66.846207 },
    b:{ lbl:'Límite Este', name:'Punta Tanaguarena', lat:10.611003, lng:-66.818581 } },
];
/** Zonas (nombre + color) para pintar el panel FUERA del mapa. El índice = orden. */
export const MAP_ZONES = SUBSECTORS.map((s) => ({ n: s.n as string, color: s.color as string }));

function buildHtml(pins: MapPin[]): string {
  const data = JSON.stringify(pins);
  const zonesData = JSON.stringify(SUBSECTORS);
  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<link rel="stylesheet" href="https://unpkg.com/leaflet-control-geocoder@2.4.0/dist/Control.Geocoder.css"/>
<script src="https://unpkg.com/leaflet-control-geocoder@2.4.0/dist/Control.Geocoder.js"></script>
<style>html,body,#map{height:100%;margin:0}.leaflet-control-geocoder-expanded{min-width:260px}.leaflet-control-geocoder-form input{width:230px}
.zoneLbl{background:rgba(17,24,39,.72);color:#fff;border:0;border-radius:4px;font-weight:700;font-size:11px;padding:2px 6px;box-shadow:none;white-space:nowrap}
.zoneLbl:before{display:none}</style></head>
<body><div id="map"></div><script>
  var pins = ${data};
  var SUBSECTORS = ${zonesData};
  var map = L.map('map').setView([6.42, -66.58], 6); // Venezuela
  var sat = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles © Esri' }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 })
  ]);
  var calles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
  sat.addTo(map);
  L.control.layers({ 'Satélite': sat, 'Calles': calles }, null, { collapsed: true, position: 'topleft' }).addTo(map);

  if (L.Control && L.Control.Geocoder) {
    var geocoder = L.Control.Geocoder.nominatim({ geocodingQueryParams: { countrycodes: 've', 'accept-language': 'es', addressdetails: 1, limit: 8 } });
    L.Control.geocoder({ geocoder: geocoder, defaultMarkGeocode: true, collapsed: true, position: 'topleft', placeholder: 'Buscar estado, municipio, parroquia, calle…', errorMessage: 'No se encontró el lugar' }).addTo(map);
  }
  function pin(color){return L.divIcon({className:'',iconSize:[28,28],iconAnchor:[14,28],popupAnchor:[0,-26],
    html:'<svg width="28" height="28" viewBox="0 0 24 24"><path fill="'+color+'" stroke="white" stroke-width="1.2" d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/><circle cx="12" cy="9" r="2.6" fill="white"/></svg>'});}
  var PALETTE = ${JSON.stringify(MAP_PALETTE)};
  var companyColor = {}; var companyOrder = [];
  pins.forEach(function(p){ var co = p.company || 'Sin empresa'; if (!(co in companyColor)) { companyColor[co] = PALETTE[companyOrder.length % PALETTE.length]; companyOrder.push(co); } });

  // ── ¿En qué SECTOR/zona cae cada máquina? (punto-en-polígono) ──
  function polyOf(s){ if (s.pts && s.pts.length >= 3) return s.pts; var D = 0.007; return [[s.a.lat, s.a.lng], [s.b.lat, s.b.lng], [s.b.lat - D, s.b.lng], [s.a.lat - D, s.a.lng]]; }
  function pointInPoly(lat, lng, poly){ var inside = false; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++){ var yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1]; if (((yi > lat) != (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside; } return inside; }
  function zoneOf(lat, lng){
    for (var i = 0; i < SUBSECTORS.length; i++){ if (pointInPoly(lat, lng, polyOf(SUBSECTORS[i]))) return { name: SUBSECTORS[i].n, near: false }; }
    var best = null, bd = Infinity;
    for (var i = 0; i < SUBSECTORS.length; i++){ var pl = polyOf(SUBSECTORS[i]); for (var k = 0; k < pl.length; k++){ var dy = pl[k][0] - lat, dx = pl[k][1] - lng, d = dy*dy + dx*dx; if (d < bd){ bd = d; best = SUBSECTORS[i].n; } } }
    if (best && bd <= 0.0009) return { name: best, near: true };
    return null;
  }

  var routeGroup = L.layerGroup();
  var allMarkers = [];
  var allRoutes = [];
  pins.forEach(function(p){
    var co = p.company || 'Sin empresa';
    var color = companyColor[co];
    if (p.route && p.route.length > 1){ allRoutes.push({ layer: L.polyline(p.route, {color:color, weight:3, opacity:0.7}), company: co }); }
    var mk = L.marker([p.lat, p.lng], {icon: pin(color)});
    var esc = function(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    var placaSerial = [p.plate ? 'Placa: '+esc(p.plate) : '', p.serial ? 'Serial: '+esc(p.serial) : ''].filter(Boolean).join(' · ');
    var z = zoneOf(p.lat, p.lng);
    var zoneTxt = z ? (esc(z.name) + (z.near ? ' (cercana)' : '')) : 'Fuera de sectores';
    var div = document.createElement('div');
    div.innerHTML = '<b>'+esc(p.name)+'</b><br/>🏢 '+esc(co)
      + (p.tipo ? '<br/>🏷️ Modelo: '+esc(p.tipo) : '')
      + (p.clasificacion ? '<br/>🗃️ Clasificación: '+esc(p.clasificacion) : '')
      + (placaSerial ? '<br/>🔖 '+placaSerial : '')
      + '<br/>🗺️ Zona: <b>'+zoneTxt+'</b>'
      + '<br/>📍 UTM '+esc(p.utm || (p.lat+', '+p.lng))
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

  var currentCompany = null;
  var routesOn = true;
  function refresh(){
    var bounds = [];
    allMarkers.forEach(function(o){
      if (currentCompany === null || o.company === currentCompany){ o.marker.addTo(map); bounds.push(o.latlng); }
      else { map.removeLayer(o.marker); }
    });
    routeGroup.clearLayers();
    allRoutes.forEach(function(o){ if (currentCompany === null || o.company === currentCompany){ o.layer.addTo(routeGroup); } });
    if (routesOn){ routeGroup.addTo(map); } else { map.removeLayer(routeGroup); }
    if (bounds.length) map.fitBounds(bounds, {padding:[40,40], maxZoom:13});
  }

  // Botón VER / OCULTAR RUTA (ojo).
  var EYE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1E3A5F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B91C1C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  var RouteToggle = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function(){
      var c = L.DomUtil.create('div', 'leaflet-bar');
      var a = L.DomUtil.create('a', '', c);
      a.href = '#'; a.title = 'Ver / ocultar ruta';
      a.style.cssText = 'width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:#fff';
      a.innerHTML = EYE;
      L.DomEvent.on(a, 'click', function(e){ L.DomEvent.stop(e); routesOn = !routesOn; a.innerHTML = routesOn ? EYE : EYE_OFF; a.title = routesOn ? 'Ocultar ruta' : 'Ver ruta'; refresh(); });
      return c;
    }
  });
  map.addControl(new RouteToggle());

  // ── Ubicación del USUARIO logueado (se muestra CADA VEZ que se abre el mapa) ──
  var userMarker = null, userCircle = null;
  function userIcon(){ return L.divIcon({ className:'', iconSize:[18,18], iconAnchor:[9,9],
    html:'<div style="width:14px;height:14px;border-radius:50%;background:#2563EB;border:3px solid #fff;box-shadow:0 0 0 2px rgba(37,99,235,.6)"></div>' }); }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
  function distM(aLat,aLng,bLat,bLng){ var R=6371000, tr=function(d){return d*Math.PI/180;};
    var dLat=tr(bLat-aLat), dLng=tr(bLng-aLng);
    var s=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(tr(aLat))*Math.cos(tr(bLat))*Math.sin(dLng/2)*Math.sin(dLng/2);
    return 2*R*Math.asin(Math.sqrt(s)); }
  function fmtD(m){ return m<1000 ? Math.round(m)+' m' : (m/1000).toFixed(1)+' km'; }
  // Popup de MI ubicación: lista las máquinas más cercanas (≤20 km) con su distancia.
  function nearbyHtml(lat,lng){
    if(!pins.length) return '<b>📍 Tu ubicación</b><br/><span style="color:#777">No hay máquinas en el mapa.</span>';
    var arr = pins.map(function(p){ return { p:p, d:distM(lat,lng,p.lat,p.lng) }; }).sort(function(a,b){ return a.d-b.d; });
    var near = arr.filter(function(x){ return x.d<=20000; }).slice(0,8);
    var h = '<b>📍 Tu ubicación</b><br/><span style="color:#555;font-size:12px">Máquinas cercanas (≤20 km):</span>';
    if(!near.length){ var c=arr[0]; return h + '<br/><span style="color:#777;font-size:12px">Ninguna a menos de 20 km. La más cercana: <b>'+esc(c.p.name)+'</b> a '+fmtD(c.d)+'.</span>'; }
    h += '<div style="margin-top:4px;max-height:170px;overflow:auto">';
    near.forEach(function(x){
      var dot = x.p.operational===false ? '#DC2626' : '#16A34A';
      h += '<div style="padding:3px 0;border-top:1px solid #eee;font-size:12px">'
        + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+dot+';margin-right:5px"></span>'
        + '<b>'+esc(x.p.name)+'</b> · <span style="color:#2563EB;font-weight:700">'+fmtD(x.d)+'</span>'
        + '<br/><span style="color:#777">'+esc(x.p.company||'')+'</span></div>';
    });
    h += '</div>';
    return h;
  }
  map.on('locationfound', function(e){
    var html = nearbyHtml(e.latlng.lat, e.latlng.lng);
    if (userMarker){ userMarker.setLatLng(e.latlng); userMarker.setPopupContent(html); } else { userMarker = L.marker(e.latlng, { icon:userIcon(), zIndexOffset:1000 }).addTo(map).bindPopup(html, { maxWidth:260 }); }
    if (userCircle){ userCircle.setLatLng(e.latlng).setRadius(e.accuracy); } else { userCircle = L.circle(e.latlng, { radius:e.accuracy, color:'#2563EB', weight:1, fillColor:'#2563EB', fillOpacity:0.12 }).addTo(map); }
  });
  map.on('locationerror', function(){ /* sin permiso o no disponible: se ignora en silencio */ });
  // Rastrea la posición sin cambiar la vista (para no tapar las máquinas al abrir).
  map.locate({ watch:true, enableHighAccuracy:true, maximumAge:10000, timeout:15000 });
  // Botón "centrar en MI ubicación".
  var LocateBtn = L.Control.extend({ options:{ position:'topleft' }, onAdd:function(){
    var c=L.DomUtil.create('div','leaflet-bar'); var a=L.DomUtil.create('a','',c);
    a.href='#'; a.title='Mi ubicación'; a.textContent='📍';
    a.style.cssText='width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:#fff;font-size:18px;text-decoration:none';
    L.DomEvent.on(a,'click',function(ev){ L.DomEvent.stop(ev); if(userMarker){ map.setView(userMarker.getLatLng(), 16); userMarker.openPopup(); } else { map.locate({ setView:true, maxZoom:16, enableHighAccuracy:true }); } });
    return c; }});
  map.addControl(new LocateBtn());

  // Botón PANTALLA COMPLETA (usa la API de pantalla completa del navegador).
  var FsBtn = L.Control.extend({ options:{ position:'topright' }, onAdd:function(){
    var c=L.DomUtil.create('div','leaflet-bar'); var a=L.DomUtil.create('a','',c);
    a.href='#'; a.title='Pantalla completa'; a.textContent='⛶';
    a.style.cssText='width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:#fff;font-size:18px;text-decoration:none';
    L.DomEvent.on(a,'click',function(ev){ L.DomEvent.stop(ev);
      try {
        var el = document.documentElement;
        if (document.fullscreenElement){ (document.exitFullscreen||document.webkitExitFullscreen).call(document); }
        else { (el.requestFullscreen||el.webkitRequestFullscreen).call(el); }
        setTimeout(function(){ map.invalidateSize(); }, 300);
      } catch(err){ try { parent.postMessage({ type:'map-fullscreen' }, '*'); } catch(e){} }
    });
    return c; }});
  map.addControl(new FsBtn());

  // Botón GRANDE "Salir de pantalla completa": aparece SOLO cuando el mapa está en
  // pantalla completa del navegador, para que siempre se pueda quitar fácilmente.
  var exitFsBtn = document.createElement('button');
  exitFsBtn.textContent = '✕ Salir de pantalla completa';
  exitFsBtn.style.cssText = 'position:fixed;top:10px;right:10px;z-index:100000;display:none;background:#DC2626;color:#fff;border:none;border-radius:10px;padding:11px 15px;font-size:14px;font-weight:800;box-shadow:0 3px 10px rgba(0,0,0,.35);cursor:pointer';
  exitFsBtn.onclick = function(){ try { (document.exitFullscreen||document.webkitExitFullscreen||function(){}).call(document); } catch(e){} };
  document.body.appendChild(exitFsBtn);
  function onFsChange(){
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    exitFsBtn.style.display = fs ? 'block' : 'none';
    setTimeout(function(){ map.invalidateSize(); }, 200);
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  // Polígonos de zonas (prender/apagar desde FUERA del mapa por postMessage).
  var sectorLayers = {};
  var zonesOn = {};
  SUBSECTORS.forEach(function(s, i){
    if (s.pts && s.pts.length >= 3){
      var pg = L.polygon(s.pts, { color: s.color, weight: 2, fillColor: s.color, fillOpacity: 0.25 });
      pg.bindTooltip(s.n, { permanent: true, direction: 'center', className: 'zoneLbl' });
      sectorLayers[i] = L.layerGroup([pg]);
      return;
    }
    var D = 0.007;
    var poly = L.polygon([[s.a.lat, s.a.lng], [s.b.lat, s.b.lng], [s.b.lat - D, s.b.lng], [s.a.lat - D, s.a.lng]], { color: s.color, weight: 2, fillColor: s.color, fillOpacity: 0.25 });
    poly.bindTooltip(s.n, { permanent: true, direction: 'center', className: 'zoneLbl' });
    var mkr = function(pt){ var m = L.circleMarker([pt.lat, pt.lng], { radius:6, color:'#fff', weight:2, fillColor:s.color, fillOpacity:1 }); m.bindPopup('<b>'+s.n+'</b><br/>'+pt.lbl+': <b>'+pt.name+'</b><br/>📍 '+pt.lat.toFixed(6)+', '+pt.lng.toFixed(6)); return m; };
    sectorLayers[i] = L.layerGroup([poly, mkr(s.a), mkr(s.b)]);
  });
  function setZone(i, on){ zonesOn[i] = on; if (on){ sectorLayers[i].addTo(map); } else { map.removeLayer(sectorLayers[i]); } }

  // ── Mensajes desde la app (leyendas y filtros van FUERA del mapa) ──
  window.addEventListener('message', function(e){
    var d = (e && e.data) || {};
    if (d.type === 'map-filter-company'){ currentCompany = d.company || null; refresh(); }
    else if (d.type === 'map-routes'){ routesOn = !!d.on; refresh(); }
    else if (d.type === 'map-zones'){
      var on = d.on || [];
      SUBSECTORS.forEach(function(_, i){ setZone(i, on.indexOf(i) >= 0); });
      if (d.fit && on.length){
        var bb = []; on.forEach(function(i){ var s = SUBSECTORS[i]; if (!s) return; if (s.pts){ s.pts.forEach(function(p){ bb.push(p); }); } else { bb.push([s.a.lat, s.a.lng]); bb.push([s.b.lat, s.b.lng]); } });
        if (bb.length) map.fitBounds(bb, { padding:[40,40], maxZoom:15 });
      }
    }
  });

  refresh();
</script></body></html>`;
}

export function VenezuelaMap({ pins, onDelete, selectedCompany, zones, height }: {
  pins: MapPin[];
  onDelete?: (id: string, name?: string) => void;
  selectedCompany?: string | null;
  zones?: Set<number>;
  height?: number;
}) {
  const { colors } = useTheme();
  const iframeRef = useRef<any>(null);
  const post = (msg: any) => { try { iframeRef.current?.contentWindow?.postMessage(msg, '*'); } catch {} };

  // Al cambiar el filtro de empresa o las zonas, avisamos al mapa (sin recargarlo).
  useEffect(() => { post({ type: 'map-filter-company', company: selectedCompany ?? null }); }, [selectedCompany]);
  useEffect(() => { post({ type: 'map-zones', on: zones ? Array.from(zones) : [] }); }, [zones]);
  // Al recargarse el iframe (cambian los pines) reaplicamos el estado actual.
  const onLoad = () => {
    post({ type: 'map-filter-company', company: selectedCompany ?? null });
    post({ type: 'map-zones', on: zones ? Array.from(zones) : [] });
  };

  if (Platform.OS === 'web') {
    return React.createElement('iframe' as any, {
      ref: iframeRef,
      srcDoc: buildHtml(pins),
      onLoad,
      // Permite mostrar la ubicación del usuario y el modo pantalla completa.
      allow: 'geolocation; fullscreen',
      style: {
        width: '100%',
        height: height ?? 340,
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
