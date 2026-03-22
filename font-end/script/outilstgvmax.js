// ============================================================
//   TrainNomad.eu — script/outilstgvmax.js
//   Logique propre à la page Outils TGVmax
// ============================================================


// ═══════════════════ MENU MOBILE ══════════════
function toggleMobileMenu() {
  const nav  = document.getElementById('mobile-nav');
  const icon = document.getElementById('mobile-menu-icon');
  const open = nav.classList.toggle('open');
  icon.textContent = open ? 'close' : 'menu';
}
// ═══════════════════ CONFIG ═══════════════════
const MAX_API = 'https://raptor-tgvmax-backend.onrender.com';

const maxSearchState = { selectedFrom: null, selectedTo: null, toIsAnywhere: false };

// ═══════════════════ BOUTON ═══════════════════
function maxUpdateBtn() {
  document.getElementById('max-btn-search').disabled =
    !(maxSearchState.selectedFrom && (maxSearchState.selectedTo || maxSearchState.toIsAnywhere));
}

// ═══════════════════ TRIP TYPE ════════════════
function maxSetTripType(type) {
  const isRound = type === 'roundtrip';
  document.getElementById('max-trip-type').value = type;
  document.getElementById('max-tt-oneway').className =
    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ' +
    (isRound ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-midnight text-white');
  document.getElementById('max-tt-roundtrip').className =
    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ' +
    (isRound ? 'bg-midnight text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200');
  const retField = document.getElementById('max-return-date-field');
  const label    = document.getElementById('max-label-date');
  if (isRound) { retField.classList.remove('hidden'); retField.classList.add('flex'); label.textContent = 'Aller'; }
  else         { retField.classList.add('hidden'); retField.classList.remove('flex'); label.textContent = 'Date'; }
}

// ═══════════════════ RECHERCHE ════════════════
document.getElementById('max-btn-search').addEventListener('click', () => {
  const from = maxSearchState.selectedFrom;
  if (!from) return;
  const getAreaId = s => s.stopIds ? (s.stopIds.find(id => id.includes('StopArea')) || s.stopIds[0]) : s.id;
  const date = document.getElementById('max-input-date').value;

  // → N'importe où : carte interactive MAX
  if (maxSearchState.toIsAnywhere) {
    const params = new URLSearchParams({
      from:     getAreaId(from),
      fromName: from.name,
      date:     date || new Date().toISOString().slice(0, 10),
    });
    window.location.href = 'explorermax.html?' + params.toString();
    return;
  }

  const to = maxSearchState.selectedTo;
  if (!to) return;

  const params = new URLSearchParams({
    from:     getAreaId(from),   fromName: from.name,
    to:       getAreaId(to),     toName:   to.name,
    carte:    document.getElementById('max-input-carte').value || 'Tarif Normal',
    time:     document.getElementById('max-input-time').value  || '01:00',
    tripType: document.getElementById('max-trip-type').value   || 'oneway',
  });
  const returnDate = document.getElementById('max-return-date').value;
  if (date)       params.set('date', date);
  if (returnDate) params.set('returnDate', returnDate);
  window.location.href = 'trajetsmax.html?' + params.toString();
});

// ═══════════════════ AUTOCOMPLÉTION ═══════════
const MAX_COUNTRY_NAMES = {
  FR:'France', IT:'Italie', BE:'Belgique', DE:'Allemagne',
  NL:'Pays-Bas', GB:'Royaume-Uni', ES:'Espagne', PT:'Portugal',
  CH:'Suisse', AT:'Autriche', PL:'Pologne', CZ:'Tchéquie', SK:'Slovaquie',
};
let maxAcTimers = {};

function maxSetupAC(inputId, acId, hiddenId, stateKey, onSelect, withAnywhere = false) {
  const input  = document.getElementById(inputId);
  const ac     = document.getElementById(acId);
  const hidden = document.getElementById(hiddenId);
  let acIndex = -1, items = [];
  const close = () => { ac.classList.add('hidden'); ac.innerHTML = ''; acIndex = -1; items = []; };

  function injectAnywhere(container) {
    const div = document.createElement('div');
    div.className = 'ac-row';
    div.style.cssText = 'background:linear-gradient(90deg,#fff0f6,#fff);border-bottom:1px solid #fce7f3;';
    div.setAttribute('data-ac-index', 'anywhere');
    div.innerHTML = `
      <span style="display:flex;align-items:center;gap:8px;">
        <span class="material-symbols-outlined" style="font-size:16px;color:#FF007A;font-variation-settings:'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 20">explore</span>
        <span class="ac-row-name" style="color:#FF007A">N'importe où</span>
      </span>
      <span class="ac-row-country" style="color:#FF007A;font-weight:700">Explorer la carte →</span>`;
    div.addEventListener('mousedown', e => {
      e.preventDefault();
      input.value = "N'importe où 🗺️";
      hidden.value = '';
      maxSearchState[stateKey] = null;
      maxSearchState.toIsAnywhere = true;
      if (onSelect) onSelect();
      close();
    });
    container.insertBefore(div, container.firstChild);
  }

  if (withAnywhere) {
    input.addEventListener('focus', () => {
      if (ac.classList.contains('hidden')) {
        ac.innerHTML = ''; items = []; acIndex = -1;
        injectAnywhere(ac); ac.classList.remove('hidden');
      }
    });
  }

  input.addEventListener('input', () => {
    clearTimeout(maxAcTimers[inputId]);
    const q = input.value.trim();
    maxSearchState[stateKey] = null;
    maxSearchState.toIsAnywhere = false;
    hidden.value = '';
    if (onSelect) onSelect();
    if (q.length < 2) {
      if (withAnywhere) { ac.innerHTML=''; items=[]; acIndex=-1; injectAnywhere(ac); ac.classList.remove('hidden'); }
      else close();
      return;
    }
    maxAcTimers[inputId] = setTimeout(async () => {
      try {
        const res   = await fetch(`${MAX_API}/api/stops?q=${encodeURIComponent(q)}`);
        const stops = await res.json();
        ac.innerHTML = ''; acIndex = -1; items = [];
        if (withAnywhere) injectAnywhere(ac);
        if (stops.length) {
          const cityOrder = [], cityMap = new Map();
          for (const stop of stops) {
            const city = stop.city || stop.name, country = stop.country || 'FR';
            const key  = city + ':' + country;
            if (!cityMap.has(key)) { cityMap.set(key, { countryName: MAX_COUNTRY_NAMES[country]||country, stops:[] }); cityOrder.push(key); }
            cityMap.get(key).stops.push(stop);
          }
          for (const key of cityOrder) {
            const { countryName, stops: gs } = cityMap.get(key);
            for (const stop of gs) {
              const div = document.createElement('div');
              div.className = 'ac-row'; div.setAttribute('data-ac-index', items.length);
              div.innerHTML = `<span class="ac-row-name">${maxEscHtml(stop.name)}</span><span class="ac-row-country">${maxEscHtml(countryName)}</span>`;
              div.addEventListener('mousedown', e => { e.preventDefault(); maxSearchState.toIsAnywhere=false; maxSelectStop(stop,input,hidden,stateKey,onSelect); close(); });
              ac.appendChild(div); items.push(stop);
            }
          }
        }
        ac.classList.remove('hidden');
      } catch(_) {}
    }, 180);
  });

  input.addEventListener('keydown', e => {
    if (e.key==='ArrowDown')  { e.preventDefault(); acIndex=Math.min(acIndex+1,items.length-1); maxHighlight(ac,acIndex); }
    else if (e.key==='ArrowUp')   { e.preventDefault(); acIndex=Math.max(acIndex-1,-1); maxHighlight(ac,acIndex); }
    else if (e.key==='Enter')     { e.preventDefault(); if(acIndex>=0&&items[acIndex]){maxSearchState.toIsAnywhere=false;maxSelectStop(items[acIndex],input,hidden,stateKey,onSelect);close();} }
    else if (e.key==='Escape')    { close(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}

function maxHighlight(ac, idx) {
  ac.querySelectorAll('[data-ac-index]').forEach(el =>
    el.classList.toggle('ac-active', parseInt(el.getAttribute('data-ac-index'))===idx));
}
function maxSelectStop(stop, input, hidden, stateKey, onSelect) {
  input.value = stop.name;
  hidden.value = (stop.stopIds?.length) ? stop.stopIds.join(',') : (stop.id||'');
  maxSearchState[stateKey] = { ...stop, stopIds: stop.stopIds||[stop.id] };
  if (onSelect) onSelect();
}
function maxEscHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Init
document.getElementById('max-input-date').value = new Date().toISOString().slice(0, 10);
maxUpdateBtn();
maxSetupAC('max-input-from','max-ac-from','max-id-from','selectedFrom',maxUpdateBtn,false);
maxSetupAC('max-input-to',  'max-ac-to',  'max-id-to',  'selectedTo',  maxUpdateBtn,true);