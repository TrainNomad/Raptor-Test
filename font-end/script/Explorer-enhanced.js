/* ════════════════════════════════════════════════════════════════════════════
   explorer_enhanced.js — MapLibre GL JS
   - Rendu WebGL natif : 5000 points en 60fps
   - GeoJSON layer mis à jour en un seul setData()
   - Mode "smart" : clustering Quadtree côté JS, un point par cellule
   - Mode "all"   : tous les points, rendu GPU direct
   - Popup au clic via MapLibre Popup
   - Couleur par durée interpolée côté GPU (expression MapLibre)
   ════════════════════════════════════════════════════════════════════════════ */

// ─── Slider durée max ─────────────────────────────────────────────────────────
function updateDurSlider() {
  const slider = document.getElementById('dur-slider');
  const mask   = document.getElementById('dur-mask');
  const thumb  = document.getElementById('dur-thumb');
  const valEl  = document.getElementById('dur-val');
  if (!slider) return;
  const val = parseInt(slider.value), min = parseInt(slider.min), max = parseInt(slider.max);
  const pct = ((val - min) / (max - min)) * 100, rPct = 100 - pct;
  if (mask)  mask.style.width = rPct + '%';
  if (thumb) { thumb.style.right = rPct + '%'; thumb.style.transform = 'translate(50%,-50%)'; }
  if (val >= max) { if (valEl) valEl.textContent = 'Toutes'; maxDurationMin = 9999; }
  else {
    const h = Math.floor(val/60), m = val%60;
    if (valEl) valEl.textContent = h + 'h' + (m > 0 ? String(m).padStart(2,'0') : '');
    maxDurationMin = val;
  }
  // Pendant le glissement : carte seule (GPU), pas de reconstruction DOM liste
  if (allDestinations.length) refreshMapOnly();
}

// Filtre + points carte uniquement — pas de renderList
function refreshMapOnly() {
  lastResults = allDestinations.filter(d => {
    if (currentFilter==='direct' && d.journeys[0]?.transfers!==0) return false;
    if (currentFilter!=='all'&&currentFilter!=='direct') {
      const types = d.journeys[0]?.train_types||[];
      if (!types.some(t=>t?.toUpperCase().includes(currentFilter.toUpperCase()))) return false;
    }
    const dur = d.journeys[0]?.duration||0;
    if (maxDurationMin<9999&&dur>maxDurationMin) return false;
    return true;
  });
  document.getElementById('results-count').textContent = lastResults.length;
  invalidateClusterCache();
  renderPoints();
}

document.addEventListener('DOMContentLoaded', () => {
  const s = document.getElementById('dur-slider');
  if (s) {
    s.addEventListener('input', updateDurSlider);
    // Liste reconstruite une seule fois au relâchement
    s.addEventListener('change', () => { if (allDestinations.length) renderList(lastResults); });
    updateDurSlider();
  }
});

// ─── MapLibre GL JS ───────────────────────────────────────────────────────────
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      'osm': {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
                'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
                'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap © CARTO',
        maxzoom: 19,
      }
    },
    layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 22 }]
  },
  center: [8, 48],
  zoom: 5,
  minZoom: 3,
  maxZoom: 14,
  attributionControl: false,
});

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

// ─── État global ──────────────────────────────────────────────────────────────
let allDestinations = [], lastResults = [], currentFilter = 'all', maxDurationMin = 9999;
let hoveredId = null, openPopupDest = null;
let originMarker = null, popup = null;
let mapReady = false;
let displayMode = 'smart';

// ─── Villes iconiques ─────────────────────────────────────────────────────────
const ICONIC_CITIES = new Set([
  'Paris','Lyon','Marseille','Bordeaux','Toulouse','Nice','Nantes','Strasbourg',
  'Lille','Rennes','Montpellier','Tours','Reims','Dijon','Grenoble','Avignon',
  'Metz','Nancy','Brest','Perpignan','Bayonne','Biarritz',
  'Barcelona','Madrid','Sevilla','Valencia','Bilbao','Zaragoza','Malaga',
  'Milano','Roma','Firenze','Venezia','Napoli','Torino','Genova','Bologna',
  'Bruxelles','Bruges','Gand','Anvers',
  'Amsterdam','Rotterdam','Utrecht',
  'Frankfurt','München','Berlin','Hamburg','Köln','Stuttgart','Düsseldorf','Dresden',
  'Zürich','Genève','Basel','Bern','Lausanne','Lugano',
  'London','Edinburgh','Birmingham','Manchester',
  'Wien','Salzburg','Innsbruck','Graz',
  'Praha','Warszawa','Budapest','Kraków',
  'Lisboa','Porto','Coimbra',
  'Luxembourg','Monaco',
]);

// ─── Score de pertinence ──────────────────────────────────────────────────────
function scoreDestination(dest) {
  const j = dest.journeys[0], types = j?.train_types||[], xfers = j?.transfers??2, dur = j?.duration||0;
  let s = 0;
  if (types.includes('FRECCIAROSSA')) s+=90;
  else if (types.includes('LYRIA')||types.includes('ICE')) s+=85;
  else if (types.includes('INOUI')) s+=80;
  else if (types.includes('OUIGO')||types.includes('OUIGO_CLASSIQUE')) s+=65;
  else if (types.includes('IC')||types.includes('IC_NUIT')) s+=50;
  else if (types.some(t=>t?.startsWith('TER')||t==='CAR')) s+=15;
  else s+=25;
  if (xfers===0) s+=30; else s-=xfers*10;
  if (dur>180&&xfers===0) s+=20;
  s+=Math.min(dest.journeys.length*3, 30);
  const words = dest.name.split(/[\s\-]/);
  if (ICONIC_CITIES.has(dest.name)||words.some(w=>ICONIC_CITIES.has(w))) s+=40;
  if (dur>=90&&dur<=240) s+=15; else if (dur>240&&dur<=480) s+=5;
  return Math.max(0, s);
}

function popularityLevel(score) {
  if (score>=150) return 3; if (score>=100) return 2; if (score>=60) return 1; return 0;
}

// ─── Index O(1) pour destIndex ────────────────────────────────────────────────
// Remplace allDestinations.indexOf(dest) qui est O(n) → O(n²) sur 4000 points
let destIndexMap = new Map();

function rebuildDestIndex() {
  destIndexMap = new Map();
  allDestinations.forEach((d, i) => destIndexMap.set(d, i));
}

// ─── Quadtree clustering ──────────────────────────────────────────────────────
function getCellSize(zoom) {
  if (zoom<=4) return 3; if (zoom<=5) return 1.5; if (zoom<=6) return 0.8;
  if (zoom<=7) return 0.4; if (zoom<=8) return 0.2; return 0.1;
}

// Cache cluster : invalider si zoom ou données changent
let _clusterCache = null; // { zoom, inputLen, result }

function clusterDestinations(destinations) {
  const zoom = Math.round(map.getZoom() * 2) / 2;
  const cell = getCellSize(zoom);
  if (_clusterCache && _clusterCache.zoom === zoom && _clusterCache.inputLen === destinations.length) {
    return _clusterCache.result;
  }
  const grid = new Map();
  for (const dest of destinations) {
    const key = `${Math.floor(dest.lon/cell)}:${Math.floor(dest.lat/cell)}`;
    const ex = grid.get(key);
    if (!ex || dest.score > ex.score) grid.set(key, dest);
  }
  const result = [...grid.values()];
  _clusterCache = { zoom, inputLen: destinations.length, result };
  return result;
}

function invalidateClusterCache() { _clusterCache = null; }

// ─── Convertir destinations → GeoJSON ────────────────────────────────────────
function toGeoJSON(destinations) {
  return {
    type: 'FeatureCollection',
    features: destinations.map((dest, i) => {
      const j = dest.journeys[0];
      return {
        type: 'Feature',
        id: i,
        geometry: { type: 'Point', coordinates: [dest.lon, dest.lat] },
        properties: {
          id: i,
          name: dest.name,
          duration: j?.duration || 0,
          score: dest.score,
          pop: popularityLevel(dest.score),
          transfers: j?.transfers ?? 0,
          dep: j?.dep_str || '--:--',
          arr: j?.arr_str || '--:--',
          trainType: (j?.train_types||[])[0] || '',
          trainCount: dest.journeys.length,
          destIndex: destIndexMap.get(dest) ?? 0, // O(1) au lieu de O(n)
        }
      };
    })
  };
}

// ─── Init layers MapLibre ─────────────────────────────────────────────────────
function initLayers() {
  // Source GeoJSON vide — mise à jour via setData()
  map.addSource('destinations', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  // Halo hover (cercle plus grand, semi-transparent)
  map.addLayer({
    id: 'dest-halo',
    type: 'circle',
    source: 'destinations',
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        4, 10, 8, 18, 12, 26
      ],
      'circle-color': durationColorExpression(),
      'circle-opacity': ['case', ['==', ['get', 'id'], ['literal', -1]], 0.25, 0],
      'circle-blur': 0.6,
    }
  });

  // Points principaux
  map.addLayer({
    id: 'dest-points',
    type: 'circle',
    source: 'destinations',
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        4, ['case', ['>=', ['get', 'pop'], 3], 7, ['>=', ['get', 'pop'], 2], 6, 5],
        6, ['case', ['>=', ['get', 'pop'], 3], 9, ['>=', ['get', 'pop'], 2], 7, 6],
        8, ['case', ['>=', ['get', 'pop'], 3], 12, ['>=', ['get', 'pop'], 2], 10, 8],
        12, ['case', ['>=', ['get', 'pop'], 3], 14, ['>=', ['get', 'pop'], 2], 12, 10],
      ],
      'circle-color': durationColorExpression(),
      'circle-opacity': 0.9,
      'circle-stroke-width': [
        'interpolate', ['linear'], ['zoom'],
        4, 1, 8, 1.5, 12, 2
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-opacity': 0.8,
    },
    // Transition douce quand les points apparaissent
    transition: { duration: 300, delay: 0 },
  });

  // Point d'origine (gare de départ)
  map.addSource('origin', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  // Halo pulsant autour de l'origine
  map.addLayer({
    id: 'origin-halo',
    type: 'circle',
    source: 'origin',
    paint: {
      'circle-radius': 18,
      'circle-color': '#1A2B3C',
      'circle-opacity': 0.15,
    }
  });
  map.addLayer({
    id: 'origin-point',
    type: 'circle',
    source: 'origin',
    paint: {
      'circle-radius': 9,
      'circle-color': '#1A2B3C',
      'circle-stroke-width': 3,
      'circle-stroke-color': '#ffffff',
    }
  });
  // Label de l'origine sous le point
  map.addLayer({
    id: 'origin-label',
    type: 'symbol',
    source: 'origin',
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
      'text-size': 11,
      'text-offset': [0, 1.6],
      'text-anchor': 'top',
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': '#1A2B3C',
      'text-halo-color': '#ffffff',
      'text-halo-width': 2,
    }
  });

  // ── Tooltip au survol ──
  const tooltip = document.createElement('div');
  tooltip.id = 'map-tooltip';
  tooltip.style.cssText = [
    'position:absolute',
    'z-index:100',
    'pointer-events:none',
    'background:#1A2B3C',
    'color:#fff',
    'font-family:\'Plus Jakarta Sans\',sans-serif',
    'font-size:12px',
    'font-weight:700',
    'padding:5px 10px',
    'border-radius:8px',
    'box-shadow:0 2px 8px rgba(0,0,0,0.25)',
    'white-space:nowrap',
    'opacity:0',
    'transition:opacity .12s ease',
    'transform:translate(-50%,-100%)',
    'margin-top:-8px',
  ].join(';');
  map.getContainer().appendChild(tooltip);

  // Interactions
  map.on('mouseenter', 'dest-points', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    if (!e.features.length) return;
    const props = e.features[0].properties;
    hoveredId = props.id;
    updateHalo();
    syncHoverListById(hoveredId);

    // Afficher le tooltip
    const pt = map.project(e.features[0].geometry.coordinates);
    tooltip.textContent = props.name;
    tooltip.style.left = pt.x + 'px';
    tooltip.style.top  = pt.y + 'px';
    tooltip.style.opacity = '1';
  });

  map.on('mousemove', 'dest-points', (e) => {
    if (!e.features.length) return;
    const props = e.features[0].properties;
    if (props.id !== hoveredId) {
      hoveredId = props.id;
      updateHalo();
      syncHoverListById(hoveredId);
    }
    // Suivre le curseur
    const pt = map.project(e.features[0].geometry.coordinates);
    tooltip.textContent = props.name;
    tooltip.style.left = pt.x + 'px';
    tooltip.style.top  = pt.y + 'px';
  });

  map.on('mouseleave', 'dest-points', () => {
    map.getCanvas().style.cursor = '';
    hoveredId = null;
    updateHalo();
    syncHoverListById(-1);
    tooltip.style.opacity = '0';
  });
  map.on('click', 'dest-points', (e) => {
    if (!e.features.length) return;
    const props = e.features[0].properties;
    const dest = lastResults[props.destIndex] || allDestinations[props.destIndex];
    if (dest) openDestPopup(dest, e.lngLat);
  });
  map.on('click', (e) => {
    // Clic hors d'un point → fermer popup
    const features = map.queryRenderedFeatures(e.point, { layers: ['dest-points'] });
    if (!features.length && popup) { popup.remove(); popup = null; }
  });

  mapReady = true;
  if (lastResults.length) renderPoints();
}

// Halo sur le point survolé
function updateHalo() {
  if (!mapReady) return;
  map.setPaintProperty('dest-halo', 'circle-opacity',
    ['case', ['==', ['get', 'id'], hoveredId ?? -1], 0.25, 0]
  );
}

// Expression MapLibre pour la couleur par durée (interpolation GPU)
function durationColorExpression() {
  return [
    'interpolate', ['linear'], ['get', 'duration'],
    0,   '#28b428',
    120, '#b4d21e',
    300, '#f0c814',
    480, '#e65a14',
    720, '#b41414',
    900, '#500000',
  ];
}

// ─── Rendu des points ─────────────────────────────────────────────────────────
function renderPoints() {
  if (!mapReady) return;
  const toShow = displayMode === 'smart'
    ? clusterDestinations(lastResults)
    : lastResults;

  // Réindexer pour hit-test
  toShow.forEach((dest, i) => dest._idx = i);

  map.getSource('destinations').setData(toGeoJSON(toShow));
}

// Recalculer à chaque fin de mouvement (le clustering change avec le zoom)
map.on('moveend', () => { invalidateClusterCache(); if (lastResults.length && displayMode === 'smart') renderPoints(); });
map.on('zoomend', () => { invalidateClusterCache(); if (lastResults.length) renderPoints(); });

// ─── Toggle mode ──────────────────────────────────────────────────────────────
function setDisplayMode(mode) {
  displayMode = mode;
  document.getElementById('btn-smart').classList.toggle('active', mode==='smart');
  document.getElementById('btn-all').classList.toggle('active', mode==='all');
  if (lastResults.length) renderPoints();
}

// ─── Popup ────────────────────────────────────────────────────────────────────
function openDestPopup(dest, lngLat) {
  const j = dest.journeys[0], legs = j.legs||[], leg0 = legs[0]||{}, legN = legs[legs.length-1]||{};
  const dur = formatDuration(j.duration);
  const fromName = explorerState?.from?.name || leg0.from_name || '';
  const depStr = j.dep_str || leg0.dep_str || leg0.departure_time?.slice(0,5) || '--:--';
  const arrStr = j.arr_str || legN.arr_str || legN.arrival_time?.slice(0,5) || '--:--';
  const trainT = (j.train_types||[])[0] || leg0.train_type || '';
  const trainBadge = trainT ? `<span class="popup-type">${escapeHtml(trainT)}</span>` : '';
  const pop = popularityLevel(dest.score);
  const popLabels = ['','⭐ Destination','⭐⭐ Populaire','🔥 Très populaire'];
  const popBadge = pop > 0 ? `<span class="popup-popularity">${popLabels[pop]}</span>` : '';
  const trainCount = dest.journeys.length;
  const trainCountBadge = trainCount > 1 ? `<span class="popup-train-count">${trainCount} trains dispo</span>` : '';
  const p = new URLSearchParams({
    from: document.getElementById('id-from').value, fromName,
    to: dest.to_id, toName: dest.name,
    date: document.getElementById('date-input').value, time: '06:00', carte: 'Tarif Normal',
  });

  const html = `<div class="popup-card">
    <div class="popup-card-city">${escapeHtml(dest.name)}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${trainBadge}${popBadge}${trainCountBadge}</div>
    <div class="popup-train-row">
      <div><div class="popup-dep">${depStr}</div><div class="popup-dur">${escapeHtml(fromName)}</div></div>
      <div style="text-align:center;flex:1"><div class="popup-arrow">→</div><div class="popup-dur">${dur}</div></div>
      <div style="text-align:right"><div class="popup-arr">${arrStr}</div><div class="popup-dur">${escapeHtml(dest.name)}</div></div>
    </div>
    <a href="trajets.html?${p.toString()}" class="popup-book-btn">Voir les trains →</a>
  </div>`;

  if (popup) popup.remove();
  popup = new maplibregl.Popup({ maxWidth: '290px', offset: 8, closeButton: true })
    .setLngLat(lngLat || [dest.lon, dest.lat])
    .setHTML(html)
    .addTo(map);

  openPopupDest = dest;
  const idx = lastResults.indexOf(dest);
  if (idx >= 0) highlightCardByListIdx(idx);
}

// ─── Sync hover liste ─────────────────────────────────────────────────────────
function syncHoverListById(id) {
  document.querySelectorAll('.result-card').forEach((card, i) => {
    card.classList.toggle('hovered', i === id);
  });
}
function syncHoverList() {}

// ─── Fetch & build ────────────────────────────────────────────────────────────
// const API_BASE = 'https://raptor-backend-2vdj.onrender.com';
const API_BASE = 'https://raptor-test.onrender.com';

// Timer d'animation progressive
let revealTimer = null;
let revealBatch = [];
let revealIndex = 0;

async function fetchDestinations(fromIds, dateStr) {
  setProgress(20);
  document.getElementById('status-dot').className = 'status-dot loading';
  document.getElementById('status-text').textContent = 'Exploration en cours…';

  const r = await fetch(`${API_BASE}/api/explore?from=${encodeURIComponent(fromIds)}&date=${encodeURIComponent(dateStr)}`);
  if (!r.ok) throw new Error('HTTP ' + r.status);

  setProgress(60);
  const data = await r.json();
  setProgress(80);

  const journeys = data.journeys || [];
  if (!journeys.length) { showNoResults(); return; }
  buildDestinations(journeys);
}

function buildDestinations(journeys) {
  // Construire la map destinations
  const destMap = {};
  for (const j of journeys) {
    const last = j.legs?.[j.legs.length-1]; if (!last) continue;
    const key = last.to_id;
    if (!destMap[key]) destMap[key] = { name: last.to_name||key, to_id: key, journeys: [], lat: null, lon: null };
    destMap[key].journeys.push(j);
    if (!destMap[key].lat && j.dest_lat) { destMap[key].lat = j.dest_lat; destMap[key].lon = j.dest_lon; }
  }

  allDestinations = Object.values(destMap)
    .filter(d => d.lat && d.lon)
    .map(d => ({ ...d, score: scoreDestination(d) }))
    .sort((a,b) => b.score - a.score);
  rebuildDestIndex();
  invalidateClusterCache();

  document.getElementById('map-hint').classList.add('hidden');
  document.getElementById('filters-bar').classList.add('visible');
  document.getElementById('display-toggle').classList.add('visible');
  document.getElementById('duration-legend').classList.add('visible');
  document.getElementById('results-count-label').textContent = 'Destinations trouvées :';

  // Placer le marqueur d'origine + flyTo
  const s = explorerState?.from;
  if (s?.lat) {
    map.getSource('origin').setData({
      type: 'FeatureCollection',
      features: [{ type:'Feature', geometry:{ type:'Point', coordinates:[s.lon, s.lat] }, properties:{ name: s.name } }]
    });
    map.flyTo({ center:[s.lon, s.lat], zoom:5.5, duration:1000 });
  }

  // Lancer l'animation de révélation progressive
  startRevealAnimation();
}

/*
  Animation de révélation :
  - On trie les destinations par score (meilleures en premier)
  - On les révèle par vagues : d'abord les tops, puis de plus en plus
  - Chaque vague apparaît avec un délai et une transition d'opacité
  - L'animation commence dès buildDestinations, avant même refreshView
*/
function startRevealAnimation() {
  // Arrêter toute animation en cours
  if (revealTimer) clearInterval(revealTimer);
  revealIndex = 0;

  // Appliquer les filtres courants pour obtenir lastResults
  lastResults = allDestinations.filter(d => {
    if (currentFilter==='direct' && d.journeys[0]?.transfers!==0) return false;
    if (currentFilter!=='all'&&currentFilter!=='direct') {
      const types = d.journeys[0]?.train_types||[];
      if (!types.some(t=>t?.toUpperCase().includes(currentFilter.toUpperCase()))) return false;
    }
    const dur = d.journeys[0]?.duration||0;
    if (maxDurationMin<9999&&dur>maxDurationMin) return false;
    return true;
  });

  // Taille des vagues : petites au début (effet "pop" visible), grandes ensuite
  const waves = buildWaves(lastResults);

  let visibleDests = [];
  let waveIdx = 0;

  // Vider la carte
  map.getSource('destinations').setData({ type:'FeatureCollection', features:[] });

  const showNextWave = () => {
    if (waveIdx >= waves.length) {
      // Animation terminée — rendu final complet
      clearInterval(revealTimer);
      revealTimer = null;
      document.getElementById('results-count').textContent = lastResults.length;
      document.getElementById('status-dot').className = 'status-dot ok';
      document.getElementById('status-text').textContent = `${allDestinations.length} destinations`;
      setProgress(100);
      setTimeout(() => setProgress(0), 500);
      renderList(lastResults);
      return;
    }

    // Ajouter la vague courante
    visibleDests = visibleDests.concat(waves[waveIdx]);
    waveIdx++;

    // Mettre à jour le compteur en temps réel
    document.getElementById('results-count').textContent = visibleDests.length;
    document.getElementById('status-text').textContent = `${visibleDests.length} / ${lastResults.length}…`;
    setProgress(80 + Math.round((waveIdx / waves.length) * 20));

    // Rendre les points visibles jusqu'ici
    renderPointsFrom(visibleDests);
  };

  // Première vague immédiate, puis intervalles croissants
  showNextWave(); // vague 0 → immédiat
  revealTimer = setInterval(showNextWave, 80);
}

// Découpe les destinations en vagues de taille progressive
// Ordre : score décroissant (les meilleures apparaissent en premier)
function buildWaves(destinations) {
  if (!destinations.length) return [];
  const waves = [];
  // Vague 1 : top 10 (capitales, grandes villes) → apparaissent en premier
  // Vague 2-N : par paquets de 30, de plus en plus vite
  const sorted = [...destinations]; // déjà triées par score desc
  waves.push(sorted.slice(0, 10));
  let i = 10;
  while (i < sorted.length) {
    waves.push(sorted.slice(i, i + 40));
    i += 40;
  }
  return waves;
}

// Rendre un sous-ensemble de destinations (pendant l'animation)
function renderPointsFrom(destinations) {
  if (!mapReady) return;
  const toShow = displayMode === 'smart'
    ? clusterDestinations(destinations)
    : destinations;
  map.getSource('destinations').setData(toGeoJSON(toShow));
}

function refreshView() {
  // Si l'animation est en cours, l'arrêter proprement
  if (revealTimer) { clearInterval(revealTimer); revealTimer = null; }

  lastResults = allDestinations.filter(d => {
    if (currentFilter==='direct' && d.journeys[0]?.transfers!==0) return false;
    if (currentFilter!=='all'&&currentFilter!=='direct') {
      const types = d.journeys[0]?.train_types||[];
      if (!types.some(t=>t?.toUpperCase().includes(currentFilter.toUpperCase()))) return false;
    }
    const dur = d.journeys[0]?.duration||0;
    if (maxDurationMin<9999&&dur>maxDurationMin) return false;
    return true;
  });
  document.getElementById('results-count').textContent = lastResults.length;
  renderPoints();
  renderList(lastResults);
}

// ─── Liste panneau gauche ─────────────────────────────────────────────────────
function renderList(destinations) {
  const listEl = document.getElementById('results-list');
  listEl.innerHTML = '';
  if (!destinations.length) {
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:12px">Aucune destination pour ce filtre</div>';
    return;
  }
  const TYPE_LABEL = {
    'INOUI':'TGV Inoui','OUIGO':'Ouigo','OUIGO_CLASSIQUE':'Ouigo Classique',
    'TER':'TER','IC':'Intercités','IC_NUIT':'IC Nuit',
    'LYRIA':'🇨🇭 Lyria','ICE':'🇩🇪 ICE','EUROSTAR':'🇬🇧 Eurostar',
    'FRECCIAROSSA':'🇮🇹 Frecciarossa','AVE':'🇪🇸 AVE','AVLO':'🇪🇸 AVLO',
  };
  const POP_BADGE = ['','','⭐','🔥'];

  // Couleur JS (même algo que l'expression MapLibre)
  function durColor(m) {
    const stops = [[0,'#28b428'],[120,'#b4d21e'],[300,'#f0c814'],[480,'#e65a14'],[720,'#b41414'],[900,'#500000']];
    if (m<=0) return stops[0][1]; if (m>=900) return stops[stops.length-1][1];
    let lo=stops[0],hi=stops[stops.length-1];
    for (let i=0;i<stops.length-1;i++) { if (m>=stops[i][0]&&m<=stops[i+1][0]) { lo=stops[i];hi=stops[i+1];break; } }
    const t=(m-lo[0])/(hi[0]-lo[0]);
    const lc=lo[1].match(/\w\w/g).map(h=>parseInt(h,16));
    const hc=hi[1].match(/\w\w/g).map(h=>parseInt(h,16));
    return '#'+lc.map((v,i)=>Math.round(v+(hc[i]-v)*t).toString(16).padStart(2,'0')).join('');
  }

  const frag = document.createDocumentFragment();
  destinations.forEach((dest, listIdx) => {
    const j = dest.journeys[0], dur = formatDuration(j.duration), xfers = j.transfers||0;
    const trainT = (j.train_types||[])[0]||'', typeLabel = TYPE_LABEL[trainT]||trainT||'';
    const pop = popularityLevel(dest.score), popBadge = POP_BADGE[pop];
    const trainCount = dest.journeys.length;
    const color = durColor(j.duration||0);

    const card = document.createElement('div');
    card.className = 'result-card' + (pop>=3?' result-card--popular':'');
    card.innerHTML = `
      <div class="result-dot-badge" style="background:${color}"></div>
      <div class="result-info">
        <div class="result-city">${escapeHtml(dest.name)}${popBadge?` <span class="result-pop-badge">${popBadge}</span>`:''}</div>
        <div class="result-meta">
          <span>${j.dep_str||'--:--'} → ${j.arr_str||'--:--'}</span>
          ${xfers>0?`<span class="dot"></span><span>${xfers} corresp.</span>`:''}
          ${trainCount>1?`<span class="dot"></span><span>${trainCount} trains</span>`:''}
        </div>
      </div>
      <div class="result-right">
        <div class="result-time">${dur}</div>
        ${xfers===0?'<div class="result-transfers">Direct</div>':''}
        ${typeLabel?`<div class="result-train-type">${typeLabel}</div>`:''}
      </div>`;

    card.addEventListener('mouseenter', () => {
      hoveredId = listIdx;
      updateHalo();
    });
    card.addEventListener('mouseleave', () => {
      hoveredId = null;
      updateHalo();
    });
    card.addEventListener('click', () => flyTo(dest));
    frag.appendChild(card);
  });
  listEl.appendChild(frag);
}

function flyTo(dest) {
  if (!dest?.lat) return;
  const currentZoom = map.getZoom();
  map.flyTo({ center: [dest.lon, dest.lat], zoom: Math.max(currentZoom, 8), duration: 800 });
  openDestPopup(dest);
  const idx = lastResults.indexOf(dest);
  if (idx >= 0) highlightCardByListIdx(idx);
}

function highlightCardByListIdx(idx) {
  document.querySelectorAll('.result-card').forEach((c,i) => c.classList.toggle('highlighted', i===idx));
  document.querySelectorAll('.result-card')[idx]?.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function clearMap() {
  if (revealTimer) { clearInterval(revealTimer); revealTimer = null; }
  if (mapReady) {
    map.getSource('destinations').setData({ type:'FeatureCollection', features:[] });
    map.getSource('origin').setData({ type:'FeatureCollection', features:[] });
    // Masquer le tooltip
    const tt = document.getElementById('map-tooltip');
    if (tt) tt.style.opacity = '0';
  }
  if (popup) { popup.remove(); popup = null; }
  allDestinations=[]; lastResults=[]; hoveredId=null; openPopupDest=null;
  document.getElementById('results-list').innerHTML = '';
  document.getElementById('results-count').textContent = '';
  document.getElementById('results-count-label').textContent = 'Lancez une recherche';
  document.getElementById('filters-bar').classList.remove('visible');
  document.getElementById('display-toggle').classList.remove('visible');
  document.getElementById('duration-legend').classList.remove('visible');
  maxDurationMin = 9999;
  const sl = document.getElementById('dur-slider');
  if (sl) { sl.value = sl.max; updateDurSlider(); }
  document.getElementById('map-hint').classList.remove('hidden');
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  document.querySelector('[data-filter="all"]')?.classList.add('active');
  currentFilter = 'all';
}

function showNoResults(msg) {
  document.getElementById('map-hint').classList.remove('hidden');
  document.getElementById('map-hint').innerHTML = `<div class="hint-icon">🔍</div><div class="hint-title">Aucun résultat</div><div class="hint-sub">${msg||'Aucun trajet trouvé depuis cette gare pour cette date.'}</div>`;
  document.getElementById('status-dot').className = 'status-dot err';
  document.getElementById('status-text').textContent = 'Aucun résultat';
}

function formatDuration(m) {
  if (!m) return '--';
  const h=Math.floor(m/60), mn=m%60;
  return h>0 ? `${h}h${mn>0?String(mn).padStart(2,'0'):''}` : mn+'min';
}
function setProgress(pct) { document.getElementById('progress-bar').style.width = pct+'%'; }

// ─── Autocomplétion ───────────────────────────────────────────────────────────
let acTimers = {};
const AC_COUNTRY_NAMES = {
  FR:'France',IT:'Italie',BE:'Belgique',DE:'Allemagne',NL:'Pays-Bas',
  GB:'Royaume-Uni',ES:'Espagne',PT:'Portugal',CH:'Suisse',AT:'Autriche',
  PL:'Pologne',CZ:'Tchéquie',SK:'Slovaquie',
};

function setupAutocomplete(inputId,acId,hiddenId,stateKey,stateObj,onSelect) {
  const input=document.getElementById(inputId),ac=document.getElementById(acId),hidden=document.getElementById(hiddenId);
  let acIndex=-1,items=[];
  const close=()=>{ac.classList.add('hidden');ac.innerHTML='';acIndex=-1;items=[];};
  input.addEventListener('input',()=>{
    clearTimeout(acTimers[inputId]);
    const q=input.value.trim(); stateObj[stateKey]=null; hidden.value='';
    if(onSelect)onSelect(); if(q.length<2){close();return;}
    acTimers[inputId]=setTimeout(async()=>{
      try {
        const res=await fetch(`${API_BASE}/api/stops?q=${encodeURIComponent(q)}`);
        const stops=await res.json(); if(!stops.length){close();return;}
        const cityOrder=[],cityMap=new Map();
        for(const stop of stops){
          const city=stop.city||stop.name,country=stop.country||'FR',key=city+':'+country;
          if(!cityMap.has(key)){cityMap.set(key,{city,countryName:AC_COUNTRY_NAMES[country]||country,stops:[]});cityOrder.push(key);}
          cityMap.get(key).stops.push(stop);
        }
        ac.innerHTML='';acIndex=-1;items=[];
        for(const key of cityOrder){
          const{countryName,stops:gs}=cityMap.get(key);
          for(const stop of gs){
            const div=document.createElement('div');
            div.className='ac-row';div.setAttribute('data-ac-index',items.length);
            div.innerHTML=`<span class="ac-row-name">${escapeHtml(stop.name)}</span><span class="ac-row-country">${escapeHtml(countryName)}</span>`;
            div.addEventListener('mousedown',e=>{e.preventDefault();selectStop(stop,input,hidden,stateKey,stateObj,onSelect);close();});
            ac.appendChild(div);items.push(stop);
          }
        }
        ac.style.cssText='position:absolute;top:100%;left:0;right:0;z-index:1000;';
        ac.classList.remove('hidden');
      }catch(_){}
    },180);
  });
  input.addEventListener('keydown',e=>{
    if(!items.length)return;
    if(e.key==='ArrowDown'){e.preventDefault();acIndex=Math.min(acIndex+1,items.length-1);highlight();}
    else if(e.key==='ArrowUp'){e.preventDefault();acIndex=Math.max(acIndex-1,-1);highlight();}
    else if(e.key==='Enter'){e.preventDefault();if(acIndex>=0&&items[acIndex]){selectStop(items[acIndex],input,hidden,stateKey,stateObj,onSelect);close();}}
    else if(e.key==='Escape')close();
  });
  function highlight(){ac.querySelectorAll('[data-ac-index]').forEach(el=>el.classList.toggle('ac-active',parseInt(el.getAttribute('data-ac-index'))===acIndex));}
  input.addEventListener('blur',()=>setTimeout(close,150));
}

function selectStop(stop,input,hidden,stateKey,stateObj,onSelect){
  input.value=stop.name; hidden.value=(stop.stopIds?.length)?stop.stopIds.join(','):(stop.id||'');
  stateObj[stateKey]={...stop,stopIds:stop.stopIds||[stop.id]}; if(onSelect)onSelect();
}
function escapeHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ─── Init date + URL params ───────────────────────────────────────────────────
(function(){
  const t=new Date();
  const iso=`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  document.getElementById('date-input').min=iso;
  document.getElementById('date-input').value=new URLSearchParams(window.location.search).get('date')||iso;
})();

const explorerState = { from: null };

setupAutocomplete('input-from','ac-from','id-from','from',explorerState,()=>{
  const s=explorerState.from;
  if(s?.lat&&s.lon) map.flyTo({ center:[s.lon,s.lat], zoom:6, duration:1200 });
});

// Pré-remplir depuis URL
(function(){
  const params=new URLSearchParams(window.location.search);
  const fromId=params.get('from'),fromName=params.get('fromName');
  if(!fromId||!fromName)return;
  document.getElementById('input-from').value=fromName;
  document.getElementById('id-from').value=fromId;
  explorerState.from={name:fromName,stopIds:fromId.split(','),id:fromId};
  map.on('load',()=>setTimeout(doSearch,300));
})();

// ─── Filtres ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.filter-chip').forEach(chip=>{
  chip.addEventListener('click',()=>{
    document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active'); currentFilter=chip.dataset.filter; refreshView();
  });
});

// ─── Search ───────────────────────────────────────────────────────────────────
function doSearch(){
  const s=explorerState.from;
  if(!s){const inp=document.getElementById('input-from');inp.focus();inp.style.outline='2px solid #f87171';setTimeout(()=>inp.style.outline='',900);return;}
  const btn=document.getElementById('search-btn');
  btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Recherche…';
  clearMap(); setProgress(10);
  fetchDestinations((s.stopIds||[s.id]).join(','),document.getElementById('date-input').value)
    .catch(e=>{showNoResults('Erreur : '+e.message);document.getElementById('status-dot').className='status-dot err';document.getElementById('status-text').textContent=e.message;})
    .finally(()=>{btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-location-crosshairs"></i> Explorer';setProgress(100);setTimeout(()=>setProgress(0),500);});
}

// ─── Attendre que la carte soit chargée pour init les layers ─────────────────
map.on('load', () => {
  initLayers();
  // Déclencher la recherche si pré-rempli (hors cas URL params qui a son propre handler)
});

// ─── Mobile & panel ───────────────────────────────────────────────────────────
let mobileMapVisible=false;
function toggleMapMobile(){
  const panel=document.getElementById('side-panel'),mapCont=document.getElementById('map-container');
  const main=document.getElementById('explorer-main');
  const icon=document.getElementById('mobile-view-icon'),label=document.getElementById('mobile-view-label');
  const closeBtn=document.getElementById('mobile-close-map');
  mobileMapVisible=!mobileMapVisible;
  if(mobileMapVisible){
    panel.classList.add('collapsed');mapCont.classList.add('map-open');
    main.classList.add('map-visible');
    if(closeBtn)closeBtn.classList.add('visible');
    icon.textContent='list';label.textContent='Voir les destinations';
    setTimeout(()=>map.resize(),50);
  }else{
    panel.classList.remove('collapsed');mapCont.classList.remove('map-open');
    main.classList.remove('map-visible');
    if(closeBtn)closeBtn.classList.remove('visible');
    icon.textContent='map';label.textContent='Voir la carte';
  }
}
function toggleMobileMenu(){
  const nav=document.getElementById('mobile-nav'),icon=document.getElementById('mobile-menu-icon');
  const open=nav.classList.toggle('open'); icon.textContent=open?'close':'menu';
}
function togglePanel(){
  const panel=document.getElementById('side-panel'),btn=document.getElementById('toggle-panel-btn'),lbl=document.getElementById('toggle-label');
  const collapsed=panel.classList.toggle('collapsed');
  lbl.textContent=collapsed?'Afficher':'Masquer'; btn.style.left=collapsed?'16px':'352px';
  setTimeout(()=>map.resize(),320);
}