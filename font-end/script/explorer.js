// ─── Slider durée max ────────────────────────────────────────────────────────

function updateDurSlider() {
  const slider = document.getElementById('dur-slider');
  const mask   = document.getElementById('dur-mask');
  const thumb  = document.getElementById('dur-thumb');
  const valEl  = document.getElementById('dur-val');
  if (!slider) return;

  const val  = parseInt(slider.value);
  const min  = parseInt(slider.min);
  const max  = parseInt(slider.max);
  const pct  = ((val - min) / (max - min)) * 100;
  const rPct = (100 - pct);                    // % depuis la droite

  // Masque grisé = partie droite du gradient (au-delà du curseur)
  if (mask)  mask.style.width = rPct + '%';

  // Thumb positionné depuis la droite
  if (thumb) {
    thumb.style.right     = rPct + '%';
    thumb.style.transform = 'translate(50%, -50%)';
  }

  if (val >= max) {
    if (valEl) valEl.textContent = 'Toutes';
    maxDurationMin = 9999;
  } else {
    const h = Math.floor(val / 60);
    const m = val % 60;
    if (valEl) valEl.textContent = h + 'h' + (m > 0 ? String(m).padStart(2, '0') : '');
    maxDurationMin = val;
  }
  if (allDestinations.length) refreshView();
}

document.addEventListener('DOMContentLoaded', () => {
  const slider = document.getElementById('dur-slider');
  if (slider) {
    slider.addEventListener('input', updateDurSlider);
    updateDurSlider();
  }
});

/* ════════════════════════════════════════════════════════════════════════════
   explorer.js — Leaflet (tuiles grises CartoDB) + Canvas overlay ultra-rapide
   ════════════════════════════════════════════════════════════════════════════ */

const map = L.map('map', {
  center: [48, 8], zoom: 5, minZoom: 3, maxZoom: 14, zoomControl: false,
});

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
  subdomains: 'abcd', maxZoom: 19,
}).addTo(map);

L.control.zoom({ position: 'bottomright' }).addTo(map);
L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

let allDestinations = [], lastResults = [], currentFilter = 'all', maxDurationMin = 9999;
let hoveredDest = null, openPopupDest = null;
let canvasReady = false;
let originMarker = null, leafletPopup = null;

// ── PixiJS WebGL renderer ─────────────────────────────────────────────────────
let pixiOverlay = null;
let pixiContainer = null; // PIXI.Container principal
let dotSprites = [];       // { dest, gfx } pour chaque point affiché

// ── Utilitaires couleur ───────────────────────────────────────────────────────
function durationColor(minutes) {
  const stops = [[0,[40,180,40]],[120,[180,210,30]],[300,[240,200,20]],[480,[230,90,20]],[720,[180,20,20]],[900,[80,0,0]]];
  if (minutes <= stops[0][0]) return stops[0][1];
  if (minutes >= stops[stops.length-1][0]) return stops[stops.length-1][1];
  let lo = stops[0], hi = stops[stops.length-1];
  for (let i=0;i<stops.length-1;i++) { if (minutes>=stops[i][0]&&minutes<=stops[i+1][0]) { lo=stops[i]; hi=stops[i+1]; break; } }
  const t = (minutes-lo[0])/(hi[0]-lo[0]);
  return lo[1].map((v,j) => Math.round(v+(hi[1][j]-v)*t));
}

function rgbToHex([r,g,b]) { return (r<<16)|(g<<8)|b; }
function rgbStr([r,g,b],a=1) { return `rgba(${r},${g},${b},${a})`; }

function dotRadius(zoom) {
  if (zoom<=4) return 4;
  if (zoom<=5) return 5;
  if (zoom<=6) return 6.5;
  if (zoom<=7) return 8;
  return 10;
}

// ── Init PixiOverlay ──────────────────────────────────────────────────────────
function initCanvas() {
  if (!window.L.pixiOverlay) {
    console.error('[Pixi] Leaflet.PixiOverlay non chargé — fallback canvas 2D');
    initCanvasFallback();
    return;
  }

  pixiContainer = new PIXI.Container();

  pixiOverlay = L.pixiOverlay((utils) => {
    const renderer = utils.getRenderer();
    const project  = utils.latLngToLayerPoint;
    const scale    = utils.getScale();
    const zoom     = map.getZoom();
    const r        = dotRadius(zoom);

    for (const item of dotSprites) {
      const { dest, gfxFill, gfxHalo } = item;
      const pt = project([dest.lat, dest.lon]);

      const rgb      = durationColor(dest.journeys[0]?.duration || 0);
      const color    = rgbToHex(rgb);
      const isHover  = dest === hoveredDest;
      const radius   = isHover ? r * 1.8 : r;

      // Halo survol
      gfxHalo.clear();
      if (isHover) {
        gfxHalo.beginFill(color, 0.22);
        gfxHalo.drawCircle(0, 0, radius * 2.6);
        gfxHalo.endFill();
      }
      gfxHalo.x = pt.x;
      gfxHalo.y = pt.y;

      // Point principal
      gfxFill.clear();
      // Contour blanc
      gfxFill.lineStyle(1.5 / scale, 0xFFFFFF, 0.75);
      gfxFill.beginFill(color, isHover ? 1 : 0.88);
      gfxFill.drawCircle(0, 0, radius);
      gfxFill.endFill();
      gfxFill.x = pt.x;
      gfxFill.y = pt.y;
    }

    renderer.render(pixiContainer);
  }, pixiContainer, { padding: 0.1 });

  pixiOverlay.addTo(map);
  canvasReady = true;
  bindCanvasEvents();
}

// ── Fallback Canvas 2D (si PixiOverlay indisponible) ─────────────────────────
let _cvs = null, _ctx = null;
function initCanvasFallback() {
  _cvs = document.createElement('canvas');
  _cvs.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:400;';
  map.getContainer().appendChild(_cvs);
  _ctx = _cvs.getContext('2d');
  const resize = () => { const s=map.getSize(); _cvs.width=s.x; _cvs.height=s.y; };
  resize();
  map.on('move zoom moveend zoomend resize', () => { resize(); if(lastResults.length) redrawCanvas(); });
  canvasReady = true;
  bindCanvasEvents();
}

// ── Redessiner tous les points ────────────────────────────────────────────────
function redrawCanvas() {
  if (pixiOverlay) {
    // Recréer les sprites pour les résultats actuels
    pixiContainer.removeChildren();
    dotSprites = [];
    for (const dest of lastResults) {
      const gfxHalo = new PIXI.Graphics();
      const gfxFill = new PIXI.Graphics();
      pixiContainer.addChild(gfxHalo);
      pixiContainer.addChild(gfxFill);
      dotSprites.push({ dest, gfxFill, gfxHalo });
    }
    pixiOverlay.redraw();
    return;
  }

  // Fallback canvas 2D
  if (!_ctx || !_cvs) return;
  _ctx.clearRect(0, 0, _cvs.width, _cvs.height);
  if (!lastResults.length) return;
  const zoom = map.getZoom(), r = dotRadius(zoom);
  for (const dest of lastResults) {
    const pt = map.latLngToContainerPoint([dest.lat, dest.lon]);
    dest._px = pt;
    const rgb = durationColor(dest.journeys[0]?.duration || 0);
    const isHover = dest === hoveredDest;
    if (isHover) {
      _ctx.beginPath(); _ctx.arc(pt.x,pt.y,r*2.8,0,Math.PI*2);
      _ctx.fillStyle = rgbStr(rgb,0.2); _ctx.fill();
    }
    _ctx.beginPath(); _ctx.arc(pt.x,pt.y,isHover?r*1.7:r,0,Math.PI*2);
    _ctx.fillStyle = rgbStr(rgb,isHover?1:0.88);
    _ctx.strokeStyle = 'rgba(255,255,255,0.7)'; _ctx.lineWidth = 1.2;
    _ctx.fill(); _ctx.stroke();
  }
}

// ── Hit-test souris ───────────────────────────────────────────────────────────
function hitTest(mx, my) {
  if (!lastResults.length) return null;
  const zoom = map.getZoom();
  const r    = dotRadius(zoom) * 3;
  let best = null, bestD = Infinity;

  for (const dest of lastResults) {
    let px, py;
    if (pixiOverlay) {
      const pt = pixiOverlay._utils?.latLngToLayerPoint
        ? pixiOverlay._utils.latLngToLayerPoint([dest.lat, dest.lon])
        : map.latLngToContainerPoint([dest.lat, dest.lon]);
      // Convertir layer → container
      const containerPt = map.latLngToContainerPoint([dest.lat, dest.lon]);
      px = containerPt.x; py = containerPt.y;
    } else {
      const pt = dest._px; if (!pt) continue;
      px = pt.x; py = pt.y;
    }
    const d = (px - mx) ** 2 + (py - my) ** 2;
    if (d < r * r && d < bestD) { best = dest; bestD = d; }
  }
  return best;
}

// ── Événements souris sur la carte ────────────────────────────────────────────
function bindCanvasEvents() {
  const container = map.getContainer();

  container.addEventListener('mousemove', e => {
    if (!lastResults.length) return;
    const rect = container.getBoundingClientRect();
    const hit  = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (hit !== hoveredDest) {
      hoveredDest = hit;
      container.style.cursor = hit ? 'pointer' : '';
      if (pixiOverlay) pixiOverlay.redraw();
      else redrawCanvas();
      syncHoverList();
    }
  });

  container.addEventListener('mouseleave', () => {
    if (hoveredDest) {
      hoveredDest = null;
      if (pixiOverlay) pixiOverlay.redraw();
      else redrawCanvas();
      syncHoverList();
    }
  });

  container.addEventListener('click', e => {
    if (!lastResults.length) return;
    const rect = container.getBoundingClientRect();
    const hit  = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      openDestPopup(hit);
      const idx = lastResults.indexOf(hit);
      if (idx >= 0) highlightCardByListIdx(idx);
    } else {
      if (leafletPopup) map.closePopup(leafletPopup);
    }
  });
}

function openDestPopup(dest) {
  const j    = dest.journeys[0];
  const legs = j.legs || [];
  const leg0 = legs[0] || {};
  const legN = legs[legs.length - 1] || {};
  const dur  = formatDuration(j.duration);
  const fromName = explorerState?.from?.name || leg0.from_name || '';

  const depStr = j.dep_str || leg0.dep_str || leg0.departure_time?.slice(0,5) || '--:--';
  const arrStr = j.arr_str || legN.arr_str || legN.arrival_time?.slice(0,5) || '--:--';

  const trainTypes = j.train_types || [];
  const trainT = trainTypes[0] || leg0.train_type || '';
  const trainBadge = trainT ? `<span class="popup-type">${escapeHtml(trainT)}</span>` : '';

  const p = new URLSearchParams({
    from:     document.getElementById('id-from').value,
    fromName,
    to:       dest.to_id,
    toName:   dest.name,
    date:     document.getElementById('date-input').value,
    time:     '06:00',
    carte:    'Tarif Normal',
  });
  const url = 'trajets.html?' + p.toString();

  const html = `<div class="popup-card">
    <div class="popup-card-city">${escapeHtml(dest.name)}</div>
    ${trainBadge}
    <div class="popup-train-row">
      <div>
        <div class="popup-dep">${depStr}</div>
        <div class="popup-dur">${escapeHtml(fromName)}</div>
      </div>
      <div style="text-align:center;flex:1">
        <div class="popup-arrow">→</div>
        <div class="popup-dur">${dur}</div>
      </div>
      <div style="text-align:right">
        <div class="popup-arr">${arrStr}</div>
        <div class="popup-dur">${escapeHtml(dest.name)}</div>
      </div>
    </div>
    <a href="${url}" class="popup-book-btn">Voir les trains →</a>
  </div>`;

  if (!leafletPopup) leafletPopup = L.popup({ maxWidth: 280, offset: [0, -4], closeButton: true });
  leafletPopup.setLatLng([dest.lat, dest.lon]).setContent(html).openOn(map);
  openPopupDest = dest;
}

function syncHoverList() {
  document.querySelectorAll('.result-card').forEach((card,i) => card.classList.toggle('hovered',lastResults[i]===hoveredDest));
}

function scoreDestination(dest) {
  const j=dest.journeys[0], types=j?.train_types||[], xfers=j?.transfers??2;
  let s=0;
  if(types.includes('FRECCIAROSSA'))s+=90;
  else if(types.includes('LYRIA')||types.includes('ICE'))s+=85;
  else if(types.includes('INOUI'))s+=80;
  else if(types.includes('OUIGO')||types.includes('OUIGO_CLASSIQUE'))s+=65;
  else if(types.includes('IC')||types.includes('IC_NUIT'))s+=50;
  else if(types.some(t=>t?.startsWith('TER')||t==='CAR'))s+=15;
  else s+=25;
  if(xfers===0)s+=30; else s-=xfers*10;
  if((j?.duration||0)>180&&xfers===0)s+=20;
  return Math.max(0,s);
}

async function fetchDestinations(fromIds, dateStr) {
  setProgress(30);
  document.getElementById('status-dot').className='status-dot loading';
  document.getElementById('status-text').textContent='Exploration en cours…';
  const r=await fetch(`${API_BASE}/api/explore?from=${encodeURIComponent(fromIds)}&date=${encodeURIComponent(dateStr)}`);
  if (!r.ok) throw new Error('HTTP '+r.status);
  const data=await r.json();
  setProgress(70);
  const journeys=data.journeys||[];
  if (!journeys.length){showNoResults();return;}
  buildDestinations(journeys);
}

function buildDestinations(journeys) {
  const destMap={};
  for (const j of journeys) {
    const last=j.legs?.[j.legs.length-1]; if(!last) continue;
    const key=last.to_id;
    if(!destMap[key]) destMap[key]={name:last.to_name||key,to_id:key,journeys:[],lat:null,lon:null};
    destMap[key].journeys.push(j);
    if(!destMap[key].lat&&j.dest_lat){destMap[key].lat=j.dest_lat;destMap[key].lon=j.dest_lon;}
  }
  allDestinations=Object.values(destMap).filter(d=>d.lat&&d.lon).map(d=>({...d,score:scoreDestination(d)})).sort((a,b)=>b.score-a.score);

  const s=explorerState?.from;
  if (s?.lat) {
    if(originMarker) map.removeLayer(originMarker);
    const el=document.createElement('div'); el.className='origin-pin';
    originMarker=L.marker([s.lat,s.lon],{icon:L.divIcon({className:'',html:el.outerHTML,iconSize:[18,18],iconAnchor:[9,9]}),zIndexOffset:9999}).addTo(map);
    originMarker.bindTooltip(s.name,{permanent:false,direction:'top'});
    map.flyTo([s.lat,s.lon],5.5,{animate:true,duration:1.2});
  }

  if (!canvasReady) initCanvas();
  document.getElementById('map-hint').classList.add('hidden');
  document.getElementById('filters-bar').classList.add('visible');

  document.getElementById('results-count-label').textContent='Destinations trouvées :';
  document.getElementById('status-dot').className='status-dot ok';
  document.getElementById('status-text').textContent=`${allDestinations.length} destinations`;
  refreshView();
}

function refreshView() {
  lastResults = allDestinations.filter(d => {
    if (currentFilter === 'direct' && d.journeys[0]?.transfers !== 0) return false;
    if (currentFilter !== 'all' && currentFilter !== 'direct') {
      const types = d.journeys[0]?.train_types || [];
      if (!types.some(t => t?.toUpperCase().includes(currentFilter.toUpperCase()))) return false;
    }
    const dur = d.journeys[0]?.duration || 0;
    if (maxDurationMin < 9999 && dur > maxDurationMin) return false;
    return true;
  });
  document.getElementById('results-count').textContent = lastResults.length;
  redrawCanvas();
  renderList(lastResults);
}

function renderList(destinations) {
  const listEl=document.getElementById('results-list');
  listEl.innerHTML='';
  if (!destinations.length){listEl.innerHTML='<div style="padding:20px;text-align:center;color:#94a3b8;font-size:12px">Aucune destination pour ce filtre</div>';return;}
  const TYPE_LABEL={'INOUI':'TGV Inoui','OUIGO':'Ouigo','OUIGO_CLASSIQUE':'Ouigo Classique','TER':'TER','IC':'Intercités','IC_NUIT':'IC Nuit','LYRIA':'🇨🇭 Lyria','ICE':'🇩🇪 ICE','EUROSTAR':'🇬🇧 Eurostar','FRECCIAROSSA':'🇮🇹 Frecciarossa','AVE':'🇪🇸 AVE','AVLO':'🇪🇸 AVLO'};
  const frag=document.createDocumentFragment();
  destinations.forEach(dest=>{
    const j=dest.journeys[0], dur=formatDuration(j.duration), xfers=j.transfers||0;
    const trainT=(j.train_types||[])[0]||'', rgb=durationColor(j.duration||0), color=rgbStr(rgb);
    const typeLabel=TYPE_LABEL[trainT]||trainT||'';
    const card=document.createElement('div'); card.className='result-card';
    card.innerHTML=`
      <div class="result-dot-badge" style="background:${color}"></div>
      <div class="result-info">
        <div class="result-city">${escapeHtml(dest.name)}</div>
        <div class="result-meta"><span>${j.dep_str||'--:--'} → ${j.arr_str||'--:--'}</span>${xfers>0?`<span class="dot"></span><span>${xfers} corresp.</span>`:''}</div>
      </div>
      <div class="result-right">
        <div class="result-time">${dur}</div>
        ${xfers===0?'<div class="result-transfers">Direct</div>':''}
        ${typeLabel?`<div class="result-train-type">${typeLabel}</div>`:''}
      </div>`;
    card.addEventListener('mouseenter',()=>{hoveredDest=dest;redrawCanvas();});
    card.addEventListener('mouseleave',()=>{hoveredDest=null;redrawCanvas();});
    card.addEventListener('click',()=>flyTo(dest));
    frag.appendChild(card);
  });
  listEl.appendChild(frag);
}

function flyTo(dest) {
  if (!dest?.lat) return;
  map.flyTo([dest.lat,dest.lon],Math.max(map.getZoom(),8),{animate:true,duration:1});
  openDestPopup(dest);
  const idx=lastResults.indexOf(dest); if(idx>=0) highlightCardByListIdx(idx);
}

function highlightCardByListIdx(idx) {
  document.querySelectorAll('.result-card').forEach((c,i)=>c.classList.toggle('highlighted',i===idx));
  document.querySelectorAll('.result-card')[idx]?.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function clearMap() {
  // Nettoyer le rendu Pixi ou le fallback canvas
  if (pixiContainer) { pixiContainer.removeChildren(); dotSprites = []; if (pixiOverlay) pixiOverlay.redraw(); }
  if (_ctx && _cvs) _ctx.clearRect(0, 0, _cvs.width, _cvs.height);
  if(originMarker){map.removeLayer(originMarker);originMarker=null;}
  if(leafletPopup) map.closePopup(leafletPopup);
  allDestinations=[];lastResults=[];hoveredDest=null;openPopupDest=null;
  document.getElementById('results-list').innerHTML='';
  document.getElementById('results-count').textContent='';
  document.getElementById('results-count-label').textContent='Lancez une recherche';
  document.getElementById('filters-bar').classList.remove('visible');

  maxDurationMin = 9999;
  const sliderEl = document.getElementById('dur-slider');
  if (sliderEl) { sliderEl.value = sliderEl.max; updateDurSlider(); }
  document.getElementById('map-hint').classList.remove('hidden');
  document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
  document.querySelector('[data-filter="all"]')?.classList.add('active');
  currentFilter='all';
}

function showNoResults(msg) {
  document.getElementById('map-hint').classList.remove('hidden');
  document.getElementById('map-hint').innerHTML=`<div class="hint-icon">🔍</div><div class="hint-title">Aucun résultat</div><div class="hint-sub">${msg||'Aucun trajet trouvé depuis cette gare pour cette date.'}</div>`;
  document.getElementById('status-dot').className='status-dot err';
  document.getElementById('status-text').textContent='Aucun résultat';
}
function formatDuration(m) { if(!m)return'--'; const h=Math.floor(m/60),mn=m%60; return h>0?`${h}h${mn>0?String(mn).padStart(2,'0'):''}`:mn+'min'; }
function setProgress(pct) { document.getElementById('progress-bar').style.width=pct+'%'; }

// ─── Autocomplétion ───────────────────────────────────────────────────────────
// const API_BASE = 'https://raptor-backend-2vdj.onrender.com';
const API_BASE = 'https://raptor-test.onrender.com';

let acTimers = {};

const AC_COUNTRY_NAMES = {
  FR:'France', IT:'Italie', BE:'Belgique', DE:'Allemagne',
  NL:'Pays-Bas', GB:'Royaume-Uni', ES:'Espagne', PT:'Portugal',
  CH:'Suisse', AT:'Autriche', PL:'Pologne', CZ:'Tchéquie', SK:'Slovaquie',
};

function setupAutocomplete(inputId, acId, hiddenId, stateKey, stateObj, onSelect) {
  const input  = document.getElementById(inputId);
  const ac     = document.getElementById(acId);
  const hidden = document.getElementById(hiddenId);
  let acIndex = -1, items = [];

  const close = () => { ac.classList.add('hidden'); ac.innerHTML = ''; acIndex = -1; items = []; };

  input.addEventListener('input', () => {
    clearTimeout(acTimers[inputId]);
    const q = input.value.trim();
    stateObj[stateKey] = null;
    hidden.value = '';
    if (onSelect) onSelect();
    if (q.length < 2) { close(); return; }
    acTimers[inputId] = setTimeout(async () => {
      try {
        const res   = await fetch(`${API_BASE}/api/stops?q=${encodeURIComponent(q)}`);
        const stops = await res.json();
        if (!stops.length) { close(); return; }
        const cityOrder = [], cityMap = new Map();
        for (const stop of stops) {
          const city = stop.city || stop.name, country = stop.country || 'FR';
          const countryName = AC_COUNTRY_NAMES[country] || country;
          const key = city + ':' + country;
          if (!cityMap.has(key)) { cityMap.set(key, { city, countryName, stops: [] }); cityOrder.push(key); }
          cityMap.get(key).stops.push(stop);
        }
        ac.innerHTML = ''; acIndex = -1; items = [];
        for (const key of cityOrder) {
          const { countryName, stops: gs } = cityMap.get(key);
          for (const stop of gs) {
            const div = document.createElement('div');
            div.className = 'ac-row'; div.setAttribute('data-ac-index', items.length);
            div.innerHTML = `<span class="ac-row-name">${escapeHtml(stop.name)}</span><span class="ac-row-country">${escapeHtml(countryName)}</span>`;
            div.addEventListener('mousedown', e => { e.preventDefault(); selectStop(stop, input, hidden, stateKey, stateObj, onSelect); close(); });
            ac.appendChild(div); items.push(stop);
          }
        }
        ac.style.cssText = 'position:absolute;top:100%;left:0;right:0;z-index:1000;';
        ac.classList.remove('hidden');
      } catch (_) {}
    }, 180);
  });

  input.addEventListener('keydown', e => {
    if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); acIndex = Math.min(acIndex+1, items.length-1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); acIndex = Math.max(acIndex-1, -1); highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (acIndex>=0 && items[acIndex]) { selectStop(items[acIndex], input, hidden, stateKey, stateObj, onSelect); close(); } }
    else if (e.key === 'Escape') close();
  });

  function highlight() {
    ac.querySelectorAll('[data-ac-index]').forEach(el =>
      el.classList.toggle('ac-active', parseInt(el.getAttribute('data-ac-index')) === acIndex));
  }
  input.addEventListener('blur', () => setTimeout(close, 150));
}

function selectStop(stop, input, hidden, stateKey, stateObj, onSelect) {
  input.value = stop.name;
  hidden.value = (stop.stopIds?.length) ? stop.stopIds.join(',') : (stop.id || '');
  stateObj[stateKey] = { ...stop, stopIds: stop.stopIds || [stop.id] };
  if (onSelect) onSelect();
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(function() {
  const t = new Date();
  const iso = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  document.getElementById('date-input').min = iso;
  const params = new URLSearchParams(window.location.search);
  document.getElementById('date-input').value = params.get('date') || iso;
})();

const explorerState = { from: null };

setupAutocomplete('input-from', 'ac-from', 'id-from', 'from', explorerState, () => {
  const s = explorerState.from;
  if (s?.lat && s.lon) map.flyTo({ center: [s.lon, s.lat], zoom: 6, duration: 1200 });
});

// ─── Pré-remplir depuis index.html (?from=...&fromName=...&date=...) ──────────
(function() {
  const params   = new URLSearchParams(window.location.search);
  const fromId   = params.get('from');
  const fromName = params.get('fromName');
  if (!fromId || !fromName) return;
  document.getElementById('input-from').value = fromName;
  document.getElementById('id-from').value    = fromId;
  explorerState.from = { name: fromName, stopIds: fromId.split(','), id: fromId };
  map.whenReady(() => setTimeout(doSearch, 300));
})();

// ─── Filtres ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter = chip.dataset.filter;
    refreshView();
  });
});

// ─── Search btn ───────────────────────────────────────────────────────────────
function doSearch() {
  const s = explorerState.from;
  if (!s) {
    const inp = document.getElementById('input-from');
    inp.focus(); inp.style.outline = '2px solid #f87171';
    setTimeout(() => inp.style.outline = '', 900);
    return;
  }
  const btn = document.getElementById('search-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Recherche…';
  clearMap(); setProgress(10);

  const fromIds = (s.stopIds || [s.id]).join(',');
  const dateStr = document.getElementById('date-input').value;

  fetchDestinations(fromIds, dateStr)
    .catch(e => { showNoResults('Erreur : ' + e.message); document.getElementById('status-dot').className = 'status-dot err'; document.getElementById('status-text').textContent = e.message; })
    .finally(() => {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Explorer';
      setProgress(100); setTimeout(() => setProgress(0), 500);
    });
}

// ─── Toggle carte/liste (mobile) ─────────────────────────────────────────────
let mobileMapVisible = false;

function toggleMapMobile() {
  const panel     = document.getElementById('side-panel');
  const mapCont   = document.getElementById('map-container');
  const icon      = document.getElementById('mobile-view-icon');
  const label     = document.getElementById('mobile-view-label');
  const closeBtn  = document.getElementById('mobile-close-map');

  mobileMapVisible = !mobileMapVisible;

  if (mobileMapVisible) {
    // Afficher la carte plein écran
    panel.classList.add('collapsed');
    mapCont.classList.add('map-open');
    if (closeBtn) closeBtn.classList.add('visible');
    icon.textContent  = 'list';
    label.textContent = 'Voir les destinations';
    // Forcer Leaflet à recalculer la taille
    setTimeout(() => map.invalidateSize(), 50);
  } else {
    // Retour à la liste
    panel.classList.remove('collapsed');
    mapCont.classList.remove('map-open');
    if (closeBtn) closeBtn.classList.remove('visible');
    icon.textContent  = 'map';
    label.textContent = 'Voir la carte';
  }
}

// ─── Toggle menu mobile ───────────────────────────────────────────────────────
function toggleMobileMenu() {
  const nav  = document.getElementById('mobile-nav');
  const icon = document.getElementById('mobile-menu-icon');
  const open = nav.classList.toggle('open');
  icon.textContent = open ? 'close' : 'menu';
}

// ─── Toggle sidebar ───────────────────────────────────────────────────────────
function togglePanel() {
  const panel = document.getElementById('side-panel');
  const btn   = document.getElementById('toggle-panel-btn');
  const lbl   = document.getElementById('toggle-label');
  const collapsed = panel.classList.toggle('collapsed');
  lbl.textContent = collapsed ? 'Afficher' : 'Masquer';
  btn.style.left  = collapsed ? '16px' : '352px';
}