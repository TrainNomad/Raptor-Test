// ─── Toggle menu mobile ───────────────────────────────────────────────────────
function toggleMobileMenu() {
  const nav  = document.getElementById('mobile-nav');
  const icon = document.getElementById('mobile-menu-icon');
  const open = nav.classList.toggle('open');
  icon.textContent = open ? 'close' : 'menu';
}

/* ════════════════════════════════════════════════════════════════════════════
   recap.js — Récapitulatif aller/retour depuis sessionStorage
   ════════════════════════════════════════════════════════════════════════════ */

// const API = 'https://raptor-backend-2vdj.onrender.com';
        const API = 'https://raptor-test.onrender.com';

// ─── Utils ────────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function minutesToHHMM(min) {
  if (!min) return '--';
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}
function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const months = ['jan.','fév.','mars','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.'];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

// ─── Logos / styles types de train ────────────────────────────────────────────
const TRAIN_TYPE_STYLES = {
  'INOUI':           { bg: '#c8962e', label: 'TGV Inoui' },
  'OUIGO':           { bg: '#e80082', label: 'Ouigo GV' },
  'OUIGO_CLASSIQUE': { bg: '#9b1c6e', label: 'Ouigo Classique' },
  'TER':             { bg: '#4a6741', label: 'TER' },
  'CAR':             { bg: '#7a7265', label: 'Car TER' },
  'IC':              { bg: '#2a5a8b', label: 'Intercités' },
  'IC_NUIT':         { bg: '#1a2a4a', label: 'IC Nuit' },
  'LYRIA':           { bg: '#d4001a', label: 'Lyria' },
  'TRAMTRAIN':       { bg: '#5a7a3a', label: 'TramTrain' },
  'NAVETTE':         { bg: '#7a6a5a', label: 'Navette' },
  'NIGHTJET':          { bg: '#1a1a2e', label: 'Nightjet' },
  'EUROPEAN_SLEEPER':  { bg: '#1c3a5e', label: 'European Sleeper' },
  'ICE':               { bg: '#d40000', label: 'ICE' },
  'EUROSTAR':          { bg: '#00435a', label: 'Eurostar' },
  'EC':                { bg: '#003d6e', label: 'EuroCity' },
  'IC_DB':             { bg: '#d40000', label: 'IC DB' },
  'FLIXTRAIN':         { bg: '#00c060', label: 'Flixtrain' },
  'TRAIN_DB':          { bg: '#d40000', label: 'DB' },
  'IC_SNCB':           { bg: '#003466', label: 'IC SNCB' },
  // ── Partenaires DB Fernverkehr (agences du feed gtfs.de) ──────────────────
  'RJ':                { bg: '#d40000', label: 'Railjet' },       // ÖBB / SBB
  'EN':                { bg: '#1a1a2e', label: 'EuroNight' },     // trains de nuit
  'IC_DSB':            { bg: '#c8001e', label: 'IC DSB' },        // Danemark
  'IC_NS':             { bg: '#003082', label: 'IC NS' },         // Pays-Bas
  'IC_NS_INT':          { bg: '#003082', label: 'NS Int.' },        // NS International
  'IC_PKP':            { bg: '#c8001e', label: 'IC PKP' },        // Pologne
  'IC_CD':             { bg: '#003466', label: 'IC ČD' },         // Tchéquie
  'IC_ZSSK':           { bg: '#003466', label: 'IC ZSSK' },       // Slovaquie
  'IC_MAV':            { bg: '#c8001e', label: 'IC MÁV' },        // Hongrie
  'THALYS_CORRIDOR':   { bg: '#003466', label: 'Thalys' },
  'ALFA_PENDULAR':     { bg: '#c8001e', label: 'Alfa Pendular' },
  'IC_CP':             { bg: '#005b99', label: 'Intercidades' },
  'IR_CP':             { bg: '#1e6e3d', label: 'Inter-regional' },
  'CP':                { bg: '#005b99', label: 'CP' },
  'AVANTI':            { bg: '#541f6b', label: 'Avanti' },
  'LNER':              { bg: '#d40000', label: 'LNER' },
  'CROSSCOUNTRY':      { bg: '#8b0000', label: 'CrossCountry' },
  'GWR':               { bg: '#0a4f2e', label: 'GWR' },
  'EMR':               { bg: '#6b1a8a', label: 'EMR' },
  'SWR':               { bg: '#003087', label: 'SWR' },
  'TRANSPENNINE':      { bg: '#003087', label: 'TransPennine' },
  'CALEDONIAN_SLEEPER':{ bg: '#1a2744', label: 'Caledonian Sleeper' },
  'LUMO':              { bg: '#5b2d8e', label: 'Lumo' },
  'GRAND_CENTRAL':     { bg: '#f5a623', label: 'Grand Central' },
  'HULL_TRAINS':       { bg: '#003087', label: 'Hull Trains' },
  'SCOTRAIL':          { bg: '#003087', label: 'ScotRail' },
  'NORTHERN':          { bg: '#003087', label: 'Northern' },
  'TRANSPORT_WALES':   { bg: '#c8001e', label: 'TfW' },
  'UK_RAIL':           { bg: '#1c3d6e', label: 'UK Rail' },
  'FRECCIAROSSA':    { bg: '#c60018', label: 'Frecciarossa' },
  'AVE':             { bg: '#8b1a4a', label: 'AVE' },
  'AVE_INT':         { bg: '#6b1238', label: 'AVE Int.' },
  'ALVIA':           { bg: '#c0392b', label: 'Alvia' },
  'AVLO':            { bg: '#e74c3c', label: 'AVLO' },
  'AVANT':           { bg: '#922b21', label: 'Avant' },
  'EUROMED':         { bg: '#1a5276', label: 'Euromed' },
  'INTERCITY_ES':    { bg: '#2471a3', label: 'Intercity' },
  'MD':              { bg: '#27ae60', label: 'Media Distancia' },
  'REGIONAL_ES':     { bg: '#1e8449', label: 'Regional' },
  'REG_EXP':         { bg: '#196f3d', label: 'Reg. Exprés' },
  'OUIGO_ES':        { bg: '#e80082', label: 'Ouigo España' },
  'RENFE':           { bg: '#5e1b43', label: 'Renfe' },
  'TRAIN':           { bg: '#3a3a3a', label: 'Train' },
};

const TRAIN_TYPE_LOGO = {
  // --- FRANCE & INTERNATIONAL ---
  'EUROSTAR':          'eurostar.png',
  'INOUI':             'tgv_inoui.png',
  'OUIGO':             'ouigo.png',
  'OUIGO_CLASSIQUE':   'ouigo-classique.png',
  'TER':               'TER.png',
  'IC':                'intercites.png',
  'IC_NUIT':           'intercites.png',
  'LYRIA':             'lyria.png',
  'TRAIN':             'tgv_inoui.png', // Remplacement du .svg par .png
    'THALYS_CORRIDOR':   'eurostar.png',
  // ── Belgique ────────────────────────────────────────────────────────────
  'IC_SNCB':           'SNCB.png',
  // ── Netherlands ────────────────────────────────────────────────────────────
  'IC_NS':              'NS.png',
  'IC_NS_INT':          'NS.png',      // Majuscule selon image
    // ── Italie ────────────────────────────────────────────────────────────
  'FRECCIAROSSA':      'frecciarossa.png',
  // ── Allemagne DB ────────────────────────────────────────────────────────────
  'ICE':               'ice.png',
  'IC_DB':             'ice.png',
  'EC':                'eurocity.png',
  'NIGHTJET':          'nightjet.png',
  'EUROPEAN_SLEEPER':  'european_sleeper.png',
  'FLIXTRAIN':         'Flixtrain.png',
  'TRAIN_DB':          'ice.png',
  // ── Partenaires DB Fernverkehr ───────────────────────────────────────────────
  'RJ':                'ice.png',          // Railjet ÖBB/SBB (fallback ICE visuel)
  'EN':                'nightjet.png',     // EuroNight

  // --- ROYAUME-UNI (UK) ---
  'AVANTI':            'avanti.png',
  'LNER':              'LNER.png',
  'CALEDONIAN_SLEEPER': 'CaledonianSleeper.png',
  'CROSSCOUNTRY':      'crosscountry.png',
  'TPE':               'TransPennineExpress.png',  // alias legacy
  'TRANSPENNINE':      'TransPennineExpress.png',
  'EMR':               'East_Midlands_Railway.png',
  'GWR':               'Great_Western_Railway.png',
  'SWR':               'South_Western_Railway.png',
  'HULL_TRAINS':       'HullTrains.png',
  'GRAND_CENTRAL':     'GrandCentral_Railway.png',
  'LUMO':              'Lumo.png',
  'SCOTRAIL':          'scotrail.png',
  'NORTHERN':          'northern.png',
  'TFW':               'transport_for_wales.png',  // alias legacy
  'TRANSPORT_WALES':   'transport_for_wales.png',

  // --- ESPAGNE (RENFE) ---
  'AVE':               'Renfe_ave.png',
  'AVE_INT':           'Renfe_ave.png',
  'ALVIA':             'Renfe_Alvia.png',
  'AVLO':              'Renfe_Avlo.png', 
  'AVANT':             'Renfe_Avant.png',
  'EUROMED':           'Renfe_Euromed.png',
  'INTERCITY_ES':      'Renfe_Intercity.png',
  'MD':                'Renfe_MD.png',
  'REGIONAL_ES':       'Renfe_regionales.png',
  'REG_EXP':           'Renfe_regionales.png',
  'RENFE':             'renfe.png',
  'OUIGO_ES':          'ouigo.png',

  // --- PORTUGAL (CP) ---
  'ALFA_PENDULAR':     'Alfa_Pendular.png',
  'IC_CP':             'Comboios-de-Portugal.png',
  'IR_CP':             'Comboios-de-Portugal.png',
  'CP':                'Comboios-de-Portugal.png',
  
  // ── Fallbacks ────────────────────────────────────────────────────────────────
  'UK_RAIL':           'uk-rail.png',
  'TRENITALIA':        'frecciarossa.png',  // alias legacy

}

function trainTypeBadge(trainType) {
  const s    = TRAIN_TYPE_STYLES[trainType] || TRAIN_TYPE_STYLES['TRAIN'];
  const logo = TRAIN_TYPE_LOGO[trainType];
  if (logo) {
    return '<span style="display:inline-flex;align-items:center;">'
      + '<img src="assets/Icone_logo/' + logo + '" alt="' + s.label + '" title="' + s.label + '"'
      + ' style="height:22px;max-width:80px;object-fit:contain;vertical-align:middle;"'
      + ' onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'\';">'
      + '<span style="display:none;background:' + s.bg + ';color:#fff;font-size:9px;padding:2px 6px;border-radius:3px;letter-spacing:.06em;font-weight:600">' + s.label + '</span>'
      + '</span>';
  }
  return '<span style="background:' + s.bg + ';color:#fff;font-size:9px;padding:2px 6px;border-radius:3px;letter-spacing:.06em;font-weight:600">' + s.label + '</span>';
}

// ─── Timeline (détail déroulant) — identique trajets.js ─────────────────────
function renderTimeline(j) {
  const toLeg = j.legs[j.legs.length - 1];
  const overnight = toLeg.arr_time - j.legs[0].dep_time >= 86400;
  const overnightSup = overnight
    ? `<sup class="card-overnight">+${Math.floor((toLeg.arr_time - j.legs[0].dep_time) / 86400)}</sup>`
    : '';

  let tlHtml = '<div class="tl-wrap">';

  j.legs.forEach((leg, li) => {
    const isFirst = li === 0;

    // Correspondance entre deux legs
    if (li > 0) {
      const wait = Math.round((leg.dep_time - j.legs[li - 1].arr_time) / 60);
      const waitLabel = wait > 0 ? minutesToHHMM(wait) : 'courte';
      tlHtml += `
        <div class="tl-transfer">
          <div class="tl-node-col">
            <div class="tl-circle tl-circle--xfer"><span><i class="fa-solid fa-person-walking-dashed-line-arrow-right fa-xs" style="color:#f59e0b"></i></span></div>
            <div class="tl-vline"></div>
          </div>
          <div class="tl-xfer-body">
            <span class="tl-xfer-station">${escapeHtml(leg.from_name)}</span>
            <div class="tl-xfer-sep"></div>
            <span class="tl-xfer-wait">Correspondance : ${waitLabel}</span>
          </div>
        </div>`;
    }

    // Logo du train pour ce leg
    const legLogoFile = TRAIN_TYPE_LOGO[leg.train_type];
    const legLogoHtml = legLogoFile
      ? `<img src="assets/Icone_logo/${legLogoFile}" alt="${leg.train_type}"
           style="height:18px;max-width:60px;object-fit:contain;vertical-align:middle;"
           onerror="this.style.display='none'">`
      : `<span style="font-size:10px;font-weight:700;color:#94a3b8">${leg.train_type || ''}</span>`;

    tlHtml += `
      <div class="tl-stop">
        <div class="tl-node-col">
          <div class="tl-circle ${isFirst ? 'tl-circle--dep' : 'tl-circle--mid'}"></div>
          <div class="tl-vline"></div>
        </div>
        <div class="tl-body">
          <div class="tl-stop-header">
            <span class="tl-stop-name">${escapeHtml(leg.from_name)}</span>
          </div>
          <span class="tl-stop-time">Départ à ${leg.dep_str}</span>
          <div class="tl-dur-box">
            ${legLogoHtml}
            <span class="tl-dur-ico"><i class="fa-solid fa-clock"></i></span>
            <span class="tl-dur-text">Trajet : ${minutesToHHMM(leg.duration)}</span>
          </div>
        </div>
      </div>`;
  });

  // Arrêt final
  tlHtml += `
    <div class="tl-stop tl-stop--final">
      <div class="tl-node-col">
        <div class="tl-circle tl-circle--arr"></div>
      </div>
      <div class="tl-body">
        <span class="tl-stop-name">${escapeHtml(toLeg.to_name)}</span>
        <span class="tl-stop-time">Arrivée à ${toLeg.arr_str}${overnightSup}</span>
      </div>
    </div>`;

  tlHtml += '</div>';
  return tlHtml;
}

// ─── Rendu d'une carte de trajet — identique trajets.js, sans logo à gauche ──
function renderJourneyCard(j) {
  const isDirect = j.transfers === 0;
  const fromLeg  = j.legs[0];
  const toLeg    = j.legs[j.legs.length - 1];

  const overnight = toLeg.arr_time - fromLeg.dep_time >= 86400;
  const overnightSup = overnight
    ? `<sup class="card-overnight">+${Math.floor((toLeg.arr_time - fromLeg.dep_time) / 86400)}</sup>`
    : '';

  const transferLabel = isDirect
    ? `<span class="card-direct">DIRECT</span>`
    : `<span class="card-corresp">${j.transfers} CORRESP.</span>`;

  return `
    <div class="journey-card">
      <div class="card-summary" onclick="toggleCard(this)">
        <div class="card-dep-block">
          <span class="card-time">${fromLeg.dep_str}</span>
          <span class="card-station-lbl">${escapeHtml(fromLeg.from_name).toUpperCase()}</span>
        </div>
        <div class="card-mid-block">
          <span class="card-dur-lbl">${minutesToHHMM(j.duration)}</span>
          ${transferLabel}
        </div>
        <div class="card-arr-block">
          <span class="card-time">${toLeg.arr_str}${overnightSup}</span>
          <span class="card-station-lbl">${escapeHtml(toLeg.to_name).toUpperCase()}</span>
        </div>
        <div class="card-chevron">
          <i class="fa-solid fa-chevron-down" style="font-size:11px"></i>
        </div>
      </div>
      <div class="card-legs">${renderTimeline(j)}</div>
    </div>`;
}

// ─── Toggle expansion ──────────────────────────────────────────────────────────
function toggleCard(summaryEl) {
  const card = summaryEl.closest('.journey-card');
  card.classList.toggle('expanded');
}

// ─── Redirection SNCF ─────────────────────────────────────────────────────────
function goToSncf() {
  window.open('https://www.sncf-connect.com', '_blank');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const allerRaw  = sessionStorage.getItem('recap_aller');
  const retourRaw = sessionStorage.getItem('recap_retour');

  const loadingEl = document.getElementById('recap-loading');
  const contentEl = document.getElementById('recap-content');

  if (!allerRaw) {
    loadingEl.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:#94a3b8">
        <span style="font-size:40px">🔍</span>
        <p style="font-size:16px;font-weight:700;margin-top:16px">Aucun trajet sélectionné.</p>
        <a href="trajets.html" style="color:var(--midnight-blue);font-weight:700;font-size:13px;text-decoration:underline;margin-top:8px;display:inline-block">
          ← Retour à la recherche
        </a>
      </div>`;
    return;
  }

  const isSimple   = sessionStorage.getItem('recap_is_simple') === 'true';
  const aller      = JSON.parse(allerRaw);
  let retour = null;
  try { retour = (!isSimple && retourRaw && retourRaw !== '') ? JSON.parse(retourRaw) : null; } catch(e) {}
  const dateAller  = sessionStorage.getItem('recap_date_aller')  || '';
  const dateRetour = sessionStorage.getItem('recap_date_retour') || '';

  // ── Titre hero ──
  const a0    = aller.legs[0];
  const aLast = aller.legs[aller.legs.length - 1];
  const arrowIcon = isSimple
    ? `<i class="fa-solid fa-arrow-right" style="font-size:.7em;margin:0 10px;color:var(--green-highlight)"></i>`
    : `<i class="fa-solid fa-arrows-left-right" style="font-size:.7em;margin:0 10px;color:var(--green-highlight)"></i>`;
  document.getElementById('recap-title').innerHTML =
    `${escapeHtml(a0.from_name)} ${arrowIcon} ${escapeHtml(aLast.to_name)}`;
  document.getElementById('recap-sub').textContent = isSimple
    ? 'Aller simple · ' + formatDate(dateAller)
    : 'Aller-retour · ' + [formatDate(dateAller), formatDate(dateRetour)].filter(Boolean).join(' → ');

  // ── Dates colonnes ──
  if (dateAller)  document.getElementById('date-aller').textContent = formatDate(dateAller);
  if (dateRetour) document.getElementById('date-retour').textContent = formatDate(dateRetour);

  // ── Rendu des cartes ──
  document.getElementById('card-aller').innerHTML = renderJourneyCard(aller);

  // Section retour : masquer si aller simple
  const sectionRetour = document.getElementById('section-retour');
  if (isSimple || !retour) {
    if (sectionRetour) sectionRetour.style.display = 'none';
  } else {
    document.getElementById('card-retour').innerHTML = renderJourneyCard(retour);
  }

  // ── Afficher le contenu ──
  loadingEl.style.display = 'none';
  contentEl.style.display = 'block';

  // Ouvrir automatiquement les cartes
  document.querySelectorAll('.journey-card').forEach(c => c.classList.add('expanded'));
});