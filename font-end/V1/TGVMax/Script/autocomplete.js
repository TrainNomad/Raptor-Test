// ─── Autocomplétion partagée (index + trajets) ───────────────────────────────
// Dépendances attendues dans le scope global : API, escapeHtml()
//
// Stratégie :
//   - Un seul endpoint /api/stops?q=
//   - Groupement par ville côté client
//   - La ville est un en-tête NON cliquable
//   - Seules les gares individuelles sont sélectionnables

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
  let acIndex  = -1;
  let items    = [];   // liste plate des gares UNIQUEMENT (pas les en-têtes ville)

  const close = () => {
    ac.classList.add('hidden');
    ac.innerHTML = '';
    acIndex = -1;
    items   = [];
  };

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

        // ── Grouper par ville+pays, en conservant l'ordre d'arrivée ──────────
        const cityOrder = [];
        const cityMap   = new Map(); // "ville:pays" → { city, countryName, stops[] }

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
          const { city, countryName, stops: groupStops } = cityMap.get(key);

          // ── En-tête ville (non cliquable) ──────────────────────────────────
          const header = document.createElement('div');
          header.className = 'ac-city-header';
          header.innerHTML = `
            <span class="ac-city-icon"><i class="fa-solid fa-location-dot"></i></span>
            <span class="ac-city-name">${escapeHtml(city)}</span>
            <span class="ac-city-country">${escapeHtml(countryName)}</span>`;
          ac.appendChild(header);

          // ── Gares du groupe (cliquables) ────────────────────────────────────
          for (const stop of groupStops) {
            const div = document.createElement('div');
            div.className = 'ac-station-child';
            div.setAttribute('data-ac-index', items.length);

            div.innerHTML = `
              <span class="ac-indent">↳</span>
              <span class="ac-station-name">${escapeHtml(stop.name)}</span>`;

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
        ac.style.top    = '100%';
        ac.style.left   = '0';
        ac.style.right  = '0';
        ac.style.zIndex = '1000';
        ac.classList.remove('hidden');
      } catch (_) {}
    }, 180);
  });

  // ── Navigation clavier (navigue entre gares uniquement, saute les en-têtes) ──
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
      el.classList.toggle('ac-active', parseInt(el.getAttribute('data-ac-index')) === acIndex);
    });
  }

  input.addEventListener('blur', () => setTimeout(close, 150));
}

// ─── Sélection gare ───────────────────────────────────────────────────────────
function selectStop(stop, input, hidden, stateKey, stateObj, onSelect) {
  input.value        = stop.name;
  hidden.value       = (stop.stopIds && stop.stopIds.length) ? stop.stopIds.join(',') : (stop.id || '');
  stateObj[stateKey] = { ...stop, stopIds: stop.stopIds || [stop.id] };
  if (onSelect) onSelect();
}

// ─── Styles CSS ──────────────────────────────────────────────────────────────
(function injectAcStyles() {
  if (document.getElementById('_ac_styles')) return;
  const s = document.createElement('style');
  s.id = '_ac_styles';
  s.textContent = `
    /* ── En-tête ville (non cliquable) ── */
    .ac-city-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px 4px;
      background: #fafafa;
      border-top: 1px solid #f0f0f0;
      pointer-events: none;
      user-select: none;
    }
    .ac-city-header:first-child { border-top: none; }
    .ac-city-icon    { font-size: 12px; color: #c0392b; flex-shrink: 0; }
    .ac-city-name    { font-weight: 700; font-size: 12px; color: #444; text-transform: uppercase; letter-spacing: 0.04em; }
    .ac-city-country { font-size: 11px; color: #bbb; }

    /* ── Gare sélectionnable ── */
    .ac-station-child {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px 6px 20px;
      cursor: pointer;
      line-height: 1.3;
    }
    .ac-station-child:hover,
    .ac-station-child.ac-active { background: #fce6e6; }
    .ac-indent       { color: #ddd; font-size: 11px; flex-shrink: 0; }
    .ac-station-name { font-size: 13px; color: #222; }
  `;
  document.head.appendChild(s);
})();

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}