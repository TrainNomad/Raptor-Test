// ─── Toggle menu mobile ───────────────────────────────────────────────────────
function toggleMobileMenu() {
  const nav  = document.getElementById('mobile-nav');
  const icon = document.getElementById('mobile-menu-icon');
  const open = nav.classList.toggle('open');
  icon.textContent = open ? 'close' : 'menu';
}

/* ============================================================
   TrainNomad.eu — script/index.js
   Logique principale de la page d'accueil
   ============================================================ */

// ─── Config API ───────────────────────────────────────────────────────────────
// const API = 'https://raptor-backend-2vdj.onrender.com';
        const API = 'https://raptor-test.onrender.com';

// ─── État de la recherche ─────────────────────────────────────────────────────
const searchState = {
  selectedFrom: null,
  selectedTo:   null,
};

// ─── Autocomplétion ───────────────────────────────────────────────────────────
let acTimers = {};

const AC_COUNTRY_NAMES = {
  FR: 'France',   IT: 'Italie',      BE: 'Belgique',  DE: 'Allemagne',
  NL: 'Pays-Bas', GB: 'Royaume-Uni', ES: 'Espagne',   PT: 'Portugal',
  CH: 'Suisse',   AT: 'Autriche',    PL: 'Pologne',   CZ: 'Tchéquie',
  SK: 'Slovaquie',
};

/**
 * Initialise l'autocomplétion sur un champ de saisie.
 *
 * @param {string} inputId   - ID du champ texte visible
 * @param {string} acId      - ID du conteneur de suggestions
 * @param {string} hiddenId  - ID du champ caché (stocke l'identifiant de gare)
 * @param {string} stateKey  - Clé dans stateObj à mettre à jour
 * @param {object} stateObj  - Objet d'état partagé
 * @param {function} onSelect - Callback appelé après sélection
 */
function setupAutocomplete(inputId, acId, hiddenId, stateKey, stateObj, onSelect) {
  const input  = document.getElementById(inputId);
  const ac     = document.getElementById(acId);
  const hidden = document.getElementById(hiddenId);
  let acIndex  = -1;
  let items    = []; // liste plate des gares UNIQUEMENT (pas les en-têtes ville)

  // ── Fermeture du panneau ──────────────────────────────────────────────────
  const close = () => {
    ac.classList.add('hidden');
    ac.innerHTML = '';
    acIndex = -1;
    items   = [];
  };

  // ── Saisie : déclenchement de la requête après 180 ms ────────────────────
  input.addEventListener('input', () => {
    clearTimeout(acTimers[inputId]);
    const q = input.value.trim();
    stateObj[stateKey] = null;
    hidden.value = '';
    if (onSelect) onSelect();

    if (q.length < 2) { close(); return; }

    acTimers[inputId] = setTimeout(async () => {
      try {
        const res   = await fetch(`${API}/api/stops?q=${encodeURIComponent(q)}`);
        const stops = await res.json();

        if (!stops.length) { close(); return; }

        // ── Grouper par ville + pays (ordre d'arrivée conservé) ──────────────
        const cityOrder = [];
        const cityMap   = new Map();

        for (const stop of stops) {
          const city        = stop.city || stop.name;
          const country     = stop.country || 'FR';
          const countryName = AC_COUNTRY_NAMES[country] || country;
          const key         = city + ':' + country;

          if (!cityMap.has(key)) {
            cityMap.set(key, { city, countryName, stops: [] });
            cityOrder.push(key);
          }
          cityMap.get(key).stops.push(stop);
        }

        ac.innerHTML = '';
        acIndex = -1;
        items   = [];

        for (const key of cityOrder) {
          const { countryName, stops: groupStops } = cityMap.get(key);

          // ── Une ligne par gare : "Nom en gras · Pays en gris" ───────────────
          for (const stop of groupStops) {
            const div = document.createElement('div');
            div.className = 'ac-row';
            div.setAttribute('data-ac-index', items.length);

            div.innerHTML = `
              <span class="ac-row-name">${escapeHtml(stop.name)}</span>
              <span class="ac-row-country">${escapeHtml(countryName)}</span>`;

            div.addEventListener('mousedown', e => {
              e.preventDefault();
              selectStop(stop, input, hidden, stateKey, stateObj, onSelect);
              close();
            });
            ac.appendChild(div);
            items.push(stop);
          }
        }

        ac.style.position = 'absolute';
        ac.style.top      = '100%';
        ac.style.left     = '0';
        ac.style.right    = '0';
        ac.style.zIndex   = '1000';
        ac.classList.remove('hidden');
      } catch (_) {}
    }, 180);
  });

  // ── Navigation clavier ────────────────────────────────────────────────────
  input.addEventListener('keydown', e => {
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acIndex = Math.min(acIndex + 1, items.length - 1);
      highlightItem();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      acIndex = Math.max(acIndex - 1, -1);
      highlightItem();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (acIndex >= 0 && items[acIndex]) {
        selectStop(items[acIndex], input, hidden, stateKey, stateObj, onSelect);
        close();
      }
    } else if (e.key === 'Escape') {
      close();
    }
  });

  function highlightItem() {
    ac.querySelectorAll('[data-ac-index]').forEach(el => {
      el.classList.toggle(
        'ac-active',
        parseInt(el.getAttribute('data-ac-index')) === acIndex
      );
    });
  }

  input.addEventListener('blur', () => setTimeout(close, 150));
}

// ─── Sélection d'une gare ─────────────────────────────────────────────────────
function selectStop(stop, input, hidden, stateKey, stateObj, onSelect) {
  input.value        = stop.name;
  hidden.value       = (stop.stopIds && stop.stopIds.length)
    ? stop.stopIds.join(',')
    : (stop.id || '');
  stateObj[stateKey] = { ...stop, stopIds: stop.stopIds || [stop.id] };
  if (onSelect) onSelect();
}

// ─── Utilitaire HTML escape ───────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

// ─── Mise à jour du bouton Rechercher ─────────────────────────────────────────
function updateSearchBtn() {
  document.getElementById('btn-search').disabled =
    !(searchState.selectedFrom && searchState.selectedTo);
}

// ─── Tabs (Trajets Europe / Explorer la carte) ────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove(
      'bg-white', 'text-midnight', 'border-[#4ade80]',
      'shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.05)]'
    );
    btn.classList.add('bg-white/50', 'text-slate-500', 'border-transparent');
    btn.querySelector('.material-symbols-outlined').classList.remove('text-[#4ade80]');
  });

  const active = document.getElementById('tab-' + tab);
  active.classList.remove('bg-white/50', 'text-slate-500', 'border-transparent');
  active.classList.add(
    'bg-white', 'text-midnight', 'border-[#4ade80]',
    'shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.05)]'
  );
  active.querySelector('.material-symbols-outlined').classList.add('text-[#4ade80]');

  const isCarte = tab === 'carte';

  // trip-type-row
  document.getElementById('trip-type-row').style.display = isCarte ? 'none' : '';

  // grid-europe
  const gridEurope = document.getElementById('grid-europe');
  gridEurope.classList.toggle('hidden', isCarte);

  // grid-carte — retirer/ajouter la classe Tailwind 'hidden'
  const gridCarte = document.getElementById('grid-carte');
  gridCarte.classList.toggle('hidden', !isCarte);
}

// ─── Toggle Aller simple / Aller-retour ───────────────────────────────────────
function setTripType(type) {
  const isRound = type === 'roundtrip';

  document.getElementById('tt-oneway').className =
    'flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ' +
    (isRound ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-midnight text-white');

  document.getElementById('tt-roundtrip').className =
    'flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ' +
    (isRound ? 'bg-midnight text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200');

  // Sync .trip-type-option.selected
  document.querySelectorAll('.trip-type-option').forEach(o => o.classList.remove('selected'));
  document.querySelector(`.trip-type-option[data-value="${type}"]`).classList.add('selected');

  // Champ date retour
  const retField = document.getElementById('return-date-field');
  if (isRound) {
    retField.classList.remove('hidden');
    retField.classList.add('flex');
    document.getElementById('search-grid').className =
      'grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-0';
    document.getElementById('label-date-depart').textContent = 'Aller';
  } else {
    retField.classList.add('hidden');
    retField.classList.remove('flex');
    document.getElementById('search-grid').className =
      'grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-0';
    document.getElementById('label-date-depart').textContent = 'Date';
  }
}

// ─── Redirection vers trajets.html ────────────────────────────────────────────
function handleSearch() {
  if (!searchState.selectedFrom || !searchState.selectedTo) return;

  const date  = document.getElementById('input-date').value  || '';
  const time  = document.getElementById('input-time').value  || '06:00';
  const carte = document.getElementById('input-carte').value || 'Tarif Normal';

  const getAreaId = stop => {
    if (!stop.stopIds) return stop.id;
    return stop.stopIds.find(id => id.includes('StopArea')) || stop.stopIds[0];
  };

  const selectedTripOpt = document.querySelector('.trip-type-option.selected');
  const tripType        = selectedTripOpt ? selectedTripOpt.dataset.value : 'oneway';
  const returnDate      = document.getElementById('return-date')
    ? document.getElementById('return-date').value
    : '';

  const params = new URLSearchParams({
    from:     getAreaId(searchState.selectedFrom),
    fromName: searchState.selectedFrom.name,
    to:       getAreaId(searchState.selectedTo),
    toName:   searchState.selectedTo.name,
    carte,
    time,
    tripType,
  });
  if (date)       params.set('date', date);
  if (returnDate) params.set('returnDate', returnDate);

  window.location.href = 'trajets.html?' + params.toString();
}

// ─── Redirection vers explorer.html ──────────────────────────────────────────
const carteState = { selectedFrom: null };

function goToExplorer() {
  const s    = carteState.selectedFrom;
  const from = document.getElementById('carte-id-from').value;
  const date = document.getElementById('carte-input-date').value;
  // Si gare sélectionnée → passer les params
  if (s && from) {
    const p = new URLSearchParams({ from, fromName: s.name || '', date });
    window.location.href = 'explorer.html?' + p.toString();
  } else {
    // Sinon → explorer.html sans paramètres
    window.location.href = 'explorer.html';
  }
}

function updateCarteBtnSearch() {
  const btn = document.getElementById('btn-search-carte');
  if (btn) btn.disabled = !carteState.selectedFrom;
}

// ─── Initialisation au chargement du DOM ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Bouton désactivé par défaut
  document.getElementById('btn-search').disabled = true;

  // Date du jour par défaut
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('input-date').value       = today;
  document.getElementById('carte-input-date').value = today;

  // Autocomplétion — recherche de trajets
  setupAutocomplete('input-from', 'ac-from', 'id-from', 'selectedFrom', searchState, updateSearchBtn);
  setupAutocomplete('input-to',   'ac-to',   'id-to',   'selectedTo',   searchState, updateSearchBtn);

  // Autocomplétion — Explorer la carte
  setupAutocomplete(
    'carte-input-from', 'carte-ac-from', 'carte-id-from',
    'selectedFrom', carteState, updateCarteBtnSearch
  );

  // Bouton Rechercher
  document.getElementById('btn-search').addEventListener('click', handleSearch);

  // ── Boutons Aller simple / Aller-retour ──────────────────────────────────
  document.getElementById('tt-oneway').addEventListener('click', () => setTripType('oneway'));
  document.getElementById('tt-roundtrip').addEventListener('click', () => setTripType('roundtrip'));

  // ── Date pickers — clic sur tout le champ ────────────────────────────────
  document.getElementById('date-depart-trigger').addEventListener('click', () => {
    document.getElementById('input-date').showPicker?.();
  });
  const retField = document.getElementById('return-date-field');
  retField.addEventListener('click', () => {
    document.getElementById('return-date').showPicker?.();
  });

  // ── Date picker carte ─────────────────────────────────────────────────────
  document.getElementById('carte-date-trigger').addEventListener('click', () => {
    document.getElementById('carte-input-date').showPicker?.();
  });

  // ── Tabs ─────────────────────────────────────────────────────────────────
  document.getElementById('tab-europe').addEventListener('click', () => switchTab('europe'));
  document.getElementById('tab-carte').addEventListener('click',  () => switchTab('carte'));

  // Bouton Explorer carte
  document.getElementById('btn-search-carte').addEventListener('click', goToExplorer);

  // ── Destinations cards cliquables ────────────────────────────────────────
  document.querySelectorAll('[data-href]').forEach(card => {
    card.addEventListener('click', () => {
      window.location.href = card.dataset.href;
    });
  });
});