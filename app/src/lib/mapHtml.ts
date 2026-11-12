import { LEAFLET_CSS, LEAFLET_JS } from './leaflet-assets';

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  label: string; // short text on the pin (initials)
  title: string; // shown in the popup
  sub?: string;
  color: string;
};

export type MapData = {
  markers?: MapMarker[];
  /** [lat, lng] pairs, drawn as a line */
  route?: [number, number][];
  /** zoom to fit everything the first time data arrives (and when `refit` is true) */
  refit?: boolean;
  focus?: string | null;
};

/**
 * A self-contained HTML page with Leaflet and OpenStreetMap tiles. The page exposes
 * window.setData(data) and also accepts the same object through postMessage.
 * When a marker is tapped it posts {type:'marker', id} to the host.
 */
export function mapHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>${LEAFLET_CSS}
html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#E9EEF3;font-family:Helvetica,Arial,sans-serif}
.pin{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:17px;color:#fff;font:700 12px Helvetica,Arial,sans-serif;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)}
.end{width:14px;height:14px;border-radius:7px;border:3px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)}
.leaflet-popup-content{margin:10px 12px;font-size:13px;line-height:1.35}
.leaflet-popup-content b{font-size:14px}
</style></head><body><div id="map"></div>
<script>${LEAFLET_JS}</script>
<script>
(function(){
  var map = L.map('map', { zoomControl: true, attributionControl: true }).setView([30.1975, 71.4710], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  var layer = L.layerGroup().addTo(map);
  var byId = {};
  var fitted = false;
  function post(msg){
    var s = JSON.stringify(msg);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
    else if (window.parent && window.parent !== window) window.parent.postMessage(s, '*');
  }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  window.setData = function(d){
    d = d || {};
    layer.clearLayers(); byId = {};
    var bounds = [];
    if (d.route && d.route.length) {
      L.polyline(d.route, { color: '#0B5CAD', weight: 4, opacity: 0.85 }).addTo(layer);
      var a = d.route[0], b = d.route[d.route.length - 1];
      L.marker(a, { icon: L.divIcon({ className: '', html: '<div class="end" style="background:#23804E"></div>', iconSize: [14,14], iconAnchor: [7,7] }) }).addTo(layer).bindPopup('Start');
      L.marker(b, { icon: L.divIcon({ className: '', html: '<div class="end" style="background:#C3352B"></div>', iconSize: [14,14], iconAnchor: [7,7] }) }).addTo(layer).bindPopup('Last point');
      for (var i = 0; i < d.route.length; i++) bounds.push(d.route[i]);
    }
    (d.markers || []).forEach(function(m){
      var icon = L.divIcon({ className: '', html: '<div class="pin" style="background:' + m.color + '">' + esc(m.label) + '</div>', iconSize: [34,34], iconAnchor: [17,17], popupAnchor: [0,-16] });
      var mk = L.marker([m.lat, m.lng], { icon: icon }).addTo(layer)
        .bindPopup('<b>' + esc(m.title) + '</b>' + (m.sub ? '<br>' + esc(m.sub) : ''));
      mk.on('click', function(){ post({ type: 'marker', id: m.id }); });
      byId[m.id] = mk;
      bounds.push([m.lat, m.lng]);
    });
    if (d.focus && byId[d.focus]) {
      map.setView(byId[d.focus].getLatLng(), Math.max(map.getZoom(), 15));
      byId[d.focus].openPopup();
    } else if ((!fitted || d.refit) && bounds.length) {
      if (bounds.length === 1) map.setView(bounds[0], 15); else map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
      fitted = true;
    }
  };
  window.addEventListener('message', function(e){
    try { var d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; if (d && d.__map) window.setData(d.data); } catch (err) {}
  });
  document.addEventListener('message', function(e){
    try { var d = JSON.parse(e.data); if (d && d.__map) window.setData(d.data); } catch (err) {}
  });
  post({ type: 'ready' });
})();
</script></body></html>`;
}

/** Distance along a route in km, skipping jumps from inaccurate points. */
export function routeKm(points: [number, number, number, number | null][]): number {
  const good = points.filter((p) => p[3] === null || p[3] <= 100);
  let km = 0;
  for (let i = 1; i < good.length; i++) {
    const [la1, lo1] = good[i - 1];
    const [la2, lo2] = good[i];
    const r = Math.PI / 180;
    const a = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2;
    km += 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return km;
}
