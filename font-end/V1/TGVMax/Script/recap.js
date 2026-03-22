// ─── recap.js ─────────────────────────────────────────────────────────────────
// Lit les trajets aller/retour depuis sessionStorage et les affiche.

const API = 'https://raptor-backend-2vdj.onrender.com';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function minutesToHHMM(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}h${String(m).padStart(2,'0')}`;
}

function formatPrice(v) {
  return v % 1 === 0 ? v + '€' : v.toFixed(2).replace('.', ',') + '€';
}

// ─── Logos / styles types de train (copie de trajets.js) ─────────────────────
const TRAIN_TYPE_STYLES = {
  'INOUI':           { bg: '#c8962e', label: 'TGV Inoui' },
  'OUIGO':           { bg: '#e80082', label: 'Ouigo GV' },
  'OUIGO_CLASSIQUE': { bg: '#9b1c6e', label: 'Ouigo Classique' },
  'TER':             { bg: '#4a6741', label: 'TER' },
  'CAR':             { bg: '#7a7265', label: 'Car TER' },
  'IC':              { bg: '#2a5a8b', label: 'Intercités' },
  'IC_NUIT':         { bg: '#1a2a4a', label: 'IC Nuit' },
  'LYRIA':           { bg: '#d4001a', label: 'Lyria' },
  'ICE':             { bg: '#d40000', label: 'ICE' },
  'TRAMTRAIN':       { bg: '#5a7a3a', label: 'TramTrain' },
  'NAVETTE':         { bg: '#7a6a5a', label: 'Navette' },
  'TRAIN':           { bg: '#3a3a3a', label: 'Train' },
  'EUROSTAR':        { bg: '#00435a', label: 'Eurostar' },
  'FRECCIAROSSA':    { bg: '#c60018', label: 'Frecciarossa' },
  'AVE':             { bg: '#82245d', label: 'AVE' },
  'RENFE':           { bg: '#5e1b43', label: 'Renfe' },
};

const TRAIN_TYPE_LOGO = {
  // ── France ────────────────────────────────────────────────────────────────
  'INOUI':           'tgv_inoui.png',
  'OUIGO':           'ouigo.png',
  'OUIGO_CLASSIQUE': 'ouigo-classique.png',
  'TER':             'TER.png',
  'CAR':             'TER.png',
  'IC':              'intercites.png',
  'IC_NUIT':         'intercites.png',
  'LYRIA':           'lyria.png',
  'ICE':             'ice.png',
  'TRAMTRAIN':       'TER.png',
  'NAVETTE':         'TER.png',
  'TRAIN':           'inoui.svg',
  // ── International ─────────────────────────────────────────────────────────
  'EUROSTAR':        'eurostar.png',
  'FRECCIAROSSA':    'frecciarossa.png',
  'EURONIGHT':       'intercites.png',
  'IC_IT':           'intercites.png',
  'REGIONALE_IT':    'trenitalia.png',
  // ── Espagne — Renfe ───────────────────────────────────────────────────────
  'AVE':             'ave.png',
  'AVE_INT':         'ave.png',
  'ALVIA':           'renfe.png',
  'AVLO':            'renfe.png',
  'AVANT':           'renfe.png',
  'EUROMED':         'renfe.png',
  'INTERCITY_ES':    'renfe.png',
  'MD':              'renfe.png',
  'REGIONAL_ES':     'renfe.png',
  'REG_EXP':         'renfe.png',
  'RENFE':           'renfe.png',
  // ── Espagne — OUIGO España ────────────────────────────────────────────────
  'OUIGO_ES':        'ouigo.png',   // même logo que Ouigo France (couleur identique)
};

function trainTypeBadge(trainType) {
  const s    = TRAIN_TYPE_STYLES[trainType] || TRAIN_TYPE_STYLES['TRAIN'];
  const logo = TRAIN_TYPE_LOGO[trainType];
  if (logo) {
    return '<span style="display:inline-flex;align-items:center;">'
      + '<img src="Assets/Icone_logo/' + logo + '" alt="' + s.label + '" title="' + s.label + '"'
      + ' style="height:20px;max-width:72px;object-fit:contain;vertical-align:middle;"'
      + ' onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'\';">'
      + '<span style="display:none;background:' + s.bg + ';color:#fff;font-size:9px;padding:2px 6px;border-radius:3px;font-weight:600">' + s.label + '</span>'
      + '</span>';
  }
  return '<span style="background:' + s.bg + ';color:#fff;font-size:9px;padding:2px 6px;border-radius:3px;font-weight:600">' + s.label + '</span>';
}

// ─── Rendu d'une carte de trajet ──────────────────────────────────────────────
function renderJourneyCard(j) {
  const isDirect = j.transfers === 0;
  const fromLeg  = j.legs[0];
  const toLeg    = j.legs[j.legs.length - 1];

  let timelineHtml = '<div class="trip-timeline">';
  j.legs.forEach((leg, li) => {
    if (li > 0) {
      const wait = Math.round((leg.dep_time - j.legs[li-1].arr_time) / 60);
      timelineHtml += `<div class="timeline-step">
        <div class="timeline-icon">⏱️</div>
        <div class="timeline-content">
          <div class="timeline-transfer-info">Correspondance — attente ${wait > 0 ? minutesToHHMM(wait) : 'courte'}</div>
        </div>
      </div>`;
    }
    timelineHtml += `<div class="timeline-step">
      <div class="timeline-icon">${li === 0 ? '🚉' : '🔄'}</div>
      <div class="timeline-content">
        <div class="timeline-time">${leg.dep_str}</div>
        <div class="timeline-station">${escapeHtml(leg.from_name)}</div>
        <div class="timeline-train-info">
          ${trainTypeBadge(leg.train_type)}
          <span class="timeline-duration">${minutesToHHMM(leg.duration)}</span>
        </div>
      </div>
    </div>`;
  });
  timelineHtml += `<div class="timeline-step">
    <div class="timeline-icon">📍</div>
    <div class="timeline-content">
      <div class="timeline-time">${toLeg.arr_str}</div>
      <div class="timeline-station">${escapeHtml(toLeg.to_name)}</div>
    </div>
  </div></div>`;

  const tarifHtml = j.tarif ? renderTarifBlock(j.tarif) :
    '<div class="card-price"><span class="price-unavail">Tarif non disponible</span></div>';

  return `<div class="journey-card expanded">
    <div class="card-summary">
      <div class="card-times">
        <div class="card-time-row">
          <span class="card-time">${fromLeg.dep_str}</span>
          <span class="card-sep">—</span>
          <span class="card-time">${toLeg.arr_str}</span>
        </div>
        <div class="card-station-row">
          <span class="card-station">${escapeHtml(fromLeg.from_name)}</span>
          <span class="card-sep"><i class="fa-solid fa-arrow-right"></i></span>
          <span class="card-station">${escapeHtml(toLeg.to_name)}</span>
        </div>
      </div>
      <div class="card-duration">${minutesToHHMM(j.duration)}</div>
      <div class="card-badges">
        ${isDirect
          ? `<span class="badge-direct">Direct</span>`
          : `<span class="badge-xfer">${j.transfers} correspondance${j.transfers > 1 ? 's' : ''}</span>`}
      </div>
    </div>
    <div class="card-legs" style="display:block">${timelineHtml}</div>
    ${tarifHtml}
  </div>`;
}

function renderTarifBlock(tarif) {
  if (!tarif) return '<div class="card-price"><span class="price-unavail">Tarif non disponible</span></div>';
  const { totalMin, totalMax, hasTer, allFound } = tarif;
  if (totalMin === 0 && totalMax === 0 && !allFound)
    return '<div class="card-price"><span class="price-unavail">Tarif non disponible</span></div>';

  let priceHtml = '';
  if (totalMin > 0 || totalMax > 0) {
    priceHtml = totalMin === totalMax
      ? `<div class="price-range"><span class="price-min">${formatPrice(totalMin)}</span></div>`
      : `<div class="price-range"><span class="price-min">${formatPrice(totalMin)}</span><span class="price-max"><i class="fa-solid fa-arrow-right"></i> ${formatPrice(totalMax)}</span></div>`;
  }
  const noteHtml = (hasTer && totalMin > 0)
    ? '<span class="price-ter">+ trajets sans tarif</span>'
    : (!allFound && totalMin === 0 ? '<span class="price-unavail">Tarif non disponible</span>' : '');

  return `<div class="card-price">${priceHtml || noteHtml}<span class="price-label">Sans carte · 2ème cl.</span></div>`;
}

// ─── Chargement des tarifs ────────────────────────────────────────────────────
async function loadTarifs(aller, retour) {
  try {
    const res  = await fetch(API + '/api/tarifs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ journeys: [aller, retour], profil: 'Tarif Normal', classe: '2' }),
    });
    const data = await res.json();
    if (!data.tarifs) return;

    aller.tarif  = data.tarifs[0];
    retour.tarif = data.tarifs[1];

    // Re-render les blocs prix
    ['card-aller', 'card-retour'].forEach((id, i) => {
      const t = i === 0 ? aller.tarif : retour.tarif;
      const card = document.querySelector(`#${id} .journey-card`);
      if (!card || !t) return;
      const existing = card.querySelector('.card-price');
      const newHtml  = renderTarifBlock(t);
      if (existing) existing.outerHTML = newHtml;
    });

    // Total
    const t0 = aller.tarif,  t1 = retour.tarif;
    if (t0 && t1 && (t0.totalMin > 0 || t1.totalMin > 0)) {
      const totalMin = t0.totalMin + t1.totalMin;
      const totalMax = t0.totalMax + t1.totalMax;
      const el = document.getElementById('recap-total');
      const priceEl = document.getElementById('recap-total-price');
      priceEl.textContent = totalMin === totalMax
        ? formatPrice(totalMin)
        : formatPrice(totalMin) + ' <i class="fa-solid fa-arrow-right"></i> ' + formatPrice(totalMax);
      el.style.display = 'flex';
    }
  } catch (e) {
    console.warn('Erreur tarifs récap:', e);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const allerRaw  = sessionStorage.getItem('recap_aller');
  const retourRaw = sessionStorage.getItem('recap_retour');

  if (!allerRaw || !retourRaw) {
    document.querySelector('.recap__main').innerHTML =
      '<div style="text-align:center;padding:60px 20px;color:rgba(25,96,128,0.5)">' +
      '<p style="font-size:18px">Aucun trajet sélectionné.</p>' +
      '<a href="trajets.html" style="color:rgb(44,110,127);font-weight:600"><i class="fa-solid fa-arrow-left"></i> Retour à la recherche</a></div>';
    return;
  }

  const aller  = JSON.parse(allerRaw);
  const retour = JSON.parse(retourRaw);
  const dateAller  = sessionStorage.getItem('recap_date_aller')  || '';
  const dateRetour = sessionStorage.getItem('recap_date_retour') || '';

  // Titre hero
  const a0 = aller.legs[0], aLast = aller.legs[aller.legs.length - 1];
document.getElementById('recap-title').innerHTML = 
    `${a0.from_name} <i class="fa-solid fa-arrows-left-right"" style="margin: 0 10px; font-size: 0.9em;"></i> ${aLast.to_name}`;  document.getElementById('recap-sub').innerHTML =
    'Aller-retour · ' + (dateAller || '') + (dateRetour ? ' <i class="fa-solid fa-arrow-right-long" style="margin: 0 5px;"></i> ' + dateRetour : '');

  // Dates colonnes
  if (dateAller)  document.getElementById('date-aller').textContent  = dateAller;
  if (dateRetour) document.getElementById('date-retour').textContent = dateRetour;

  // Render cartes
  document.getElementById('card-aller').innerHTML  = renderJourneyCard(aller);
  document.getElementById('card-retour').innerHTML = renderJourneyCard(retour);

  // Expand au clic
  document.querySelectorAll('.journey-card').forEach(card => {
    card.querySelector('.card-summary').addEventListener('click', () => {
      card.classList.toggle('expanded');
      const legs = card.querySelector('.card-legs')
      if (legs) legs.style.display = card.classList.contains('expanded') ? 'block' : 'none';
    });
  });

  // Tarifs en arrière-plan
  loadTarifs(aller, retour);
});