// ============================================================
//   TrainNomad.eu — script/trajetsmax.js
// ============================================================


// ─── Toggle menu mobile ──────────────────────────────────────────────────────
function toggleMobileMenu() {
  const nav  = document.getElementById('mobile-nav');
  const icon = document.getElementById('mobile-menu-icon');
  const open = nav.classList.toggle('open');
  icon.textContent = open ? 'close' : 'menu';
}

// ════════════════════════════════════════════════════════
//  trajetsmax.js — TGV Max API + overlay non disponible
// ════════════════════════════════════════════════════════

// ─── État global ─────────────────────────────────────────
const state = {
  engineReady: false, selectedFrom: null, selectedTo: null,
  currentTime: null, currentDate: null, nextOffset: 0,
  allJourneys: [], lastDepTime: 0, currentCarte: 'Tarif Normal',
  profil: 'Tarif Normal', activeTypeFilters: null, availableTypes: [],
  isRoundTrip: false, phase: 'aller', selectedAller: null,
};

function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function minutesToHHMM(min) {
  if (!min && min !== 0) return '--';
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}h${String(m).padStart(2,'0')}`;
}
function setStatus(type,text) { document.getElementById('status-dot').className=`status-dot ${type}`; document.getElementById('status-text').textContent=text; }
function updateSearchBtn() { document.getElementById('btn-search').disabled=!(state.engineReady&&state.selectedFrom&&state.selectedTo); }

// ─── Init moteur ─────────────────────────────────────────
async function initEngine() {
  try {
    const res=await fetch(`${API}/api/meta`); if(!res.ok) throw new Error(res.statusText);
    const meta=await res.json(); state.engineReady=true;
    const today=new Date().toISOString().slice(0,10);
    const dateInput=document.getElementById('input-date');
    if(!dateInput.value) dateInput.value=today;
    if(meta.date_range) { dateInput.min=meta.date_range.first; dateInput.max=meta.date_range.last; }
    const dateInfo=meta.date_range?` | données du ${meta.date_range.first} au ${meta.date_range.last}`:'';
    setStatus('ok',`Moteur MAX prêt — ${(meta.total_stops||0).toLocaleString('fr-FR')} arrêts${dateInfo}`);
  } catch(e) { setStatus('err',`Moteur inaccessible : ${e.message}`); }
  updateSearchBtn();
}

// ─── Recherche ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('btn-search').addEventListener('click',doSearch);
  document.getElementById('input-time').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!document.getElementById('btn-search').disabled) doSearch(); });
});

async function doSearch() {
  if(!state.selectedFrom||!state.selectedTo) return;
  const time=document.getElementById('input-time').value||'01:00';
  const date=document.getElementById('input-date').value||'';
  const carte=document.getElementById('input-carte').value||'Tarif Normal';
  const isFilteredRelaunch=state._filterRelaunch, isPhaseSearch=state._phaseSearch;
  state._filterRelaunch=false; state._phaseSearch=false;
  state.currentTime=time; state.currentDate=date; state.currentCarte=carte;
  state.nextOffset=0; state.allJourneys=[]; state.lastDepTime=0;
  if(!isFilteredRelaunch&&!isPhaseSearch&&state.phase==='retour') { state.phase='aller'; state.selectedAller=null; hidePhaseBanner(); }
  if(!isFilteredRelaunch&&!isPhaseSearch) {
    state.activeTypeFilters=null; state.availableTypes=[];
    const dropdown=document.getElementById('ms-dropdown');
    if(dropdown) dropdown.querySelectorAll('.ms-item').forEach(el=>el.remove());
    const labelEl=document.getElementById('ms-label'), countEl=document.getElementById('ms-count');
    if(labelEl) labelEl.textContent='Tous les trains'; if(countEl) countEl.style.display='none';
    const allChk=document.getElementById('ms-all'); if(allChk){allChk.checked=true;allChk.indeterminate=false;}
  }
  const btn=document.getElementById('btn-search'); btn.disabled=true; btn.textContent='…';
  setStatus('loading','Calcul en cours…');
  document.getElementById('results').innerHTML='<div class="loading-container"><div class="spinner"></div><p>Chargement des horaires MAX…</p></div>';
  try {
    const dateParam=state.currentDate?`&date=${state.currentDate}`:'';
    const fromIds=(state.selectedFrom.stopIds||[state.selectedFrom.id]).join(',');
    const toIds=(state.selectedTo.stopIds||[state.selectedTo.id]).join(',');
    const limitParam=isFilteredRelaunch?'&limit=32':'';
    const url=`${API}/api/search?from=${encodeURIComponent(fromIds)}&to=${encodeURIComponent(toIds)}&time=${time}&offset=0${dateParam}${limitParam}`;
    const res=await fetch(url); const data=await res.json();
    const allReceived=data.journeys||[];
    const filtered=(isFilteredRelaunch&&state.activeTypeFilters)?allReceived.filter(j=>(j.train_types||[]).some(tt=>state.activeTypeFilters.has(tt))):allReceived;
    state.allJourneys=filtered;
    state.nextOffset=data.next_offset!==undefined?data.next_offset:7200;
    state.lastDepTime=filtered.length?Math.max(...filtered.map(j=>j.dep_time||0)):0;
    if(!isFilteredRelaunch) { const types=new Set(); allReceived.forEach(j=>(j.train_types||[]).forEach(t=>types.add(t))); state.availableTypes=[...types]; populateTypeCombobox(state.availableTypes); }
    const svcInfo=data.active_services?` | ${data.active_services} services actifs`:'';
    setStatus('ok',data.computed_ms!==undefined?`Réponse en ${data.computed_ms} ms${svcInfo}`:'Recherche effectuée');
    renderResults(state.allJourneys,state.selectedFrom.name,state.selectedTo.name,time,true);
  } catch(e) {
    setStatus('err',`Erreur : ${e.message}`);
    document.getElementById('results').innerHTML=`<div class="state-error">⚠ ${escapeHtml(e.message)}</div>`;
  } finally { btn.disabled=false; btn.textContent='RECHERCHER'; updateSearchBtn(); }
}

// ─── Voir plus ───────────────────────────────────────────
async function loadMore() {
  if(!state.selectedFrom||!state.selectedTo||!state.currentTime) return;
  const btn=document.getElementById('btn-more'); if(btn){btn.disabled=true;btn.textContent='Chargement…';}
  setStatus('loading','Recherche de trajets supplémentaires…');
  try {
    const dateParam=state.currentDate?`&date=${state.currentDate}`:'';
    const fromIds=(state.selectedFrom.stopIds||[state.selectedFrom.id]).join(',');
    const toIds=(state.selectedTo.stopIds||[state.selectedTo.id]).join(',');
    const afterDep=state.lastDepTime||0;
    const limitMore=state.activeTypeFilters?'&limit=32':'&limit=16';
    const url=`${API}/api/search?from=${encodeURIComponent(fromIds)}&to=${encodeURIComponent(toIds)}&time=${state.currentTime}&offset=${state.nextOffset}&after_dep=${afterDep}${limitMore}${dateParam}`;
    const res=await fetch(url); const data=await res.json();
    const allMore=data.journeys||[];
    const newJourneys=state.activeTypeFilters?allMore.filter(j=>(j.train_types||[]).some(tt=>state.activeTypeFilters.has(tt))):allMore;
    const existingKeys=new Set(state.allJourneys.map(j=>j.legs.map(l=>l.trip_id).join('|')));
    const fresh=newJourneys.filter(j=>{ const key=j.legs.map(l=>l.trip_id).join('|'); return !existingKeys.has(key)&&(j.dep_time||0)>state.lastDepTime; });
    if(!fresh.length){state.nextOffset+=3600;if(btn){btn.disabled=false;btn.textContent='Voir plus de trajets →';}setStatus('ok','Aucun nouveau trajet, essayez encore.');return;}
    state.allJourneys=[...state.allJourneys,...fresh];
    state.nextOffset=data.next_offset!==undefined?data.next_offset:state.nextOffset+7200;
    state.lastDepTime=data.last_dep_time!==undefined?data.last_dep_time:Math.max(...state.allJourneys.map(j=>j.dep_time||0));
    setStatus('ok',`${state.allJourneys.length} trajets chargés — ${data.computed_ms} ms`);
    renderResults(state.allJourneys,state.selectedFrom.name,state.selectedTo.name,state.currentTime,true);
  } catch(e) { setStatus('err',`Erreur : ${e.message}`); if(btn){btn.disabled=false;btn.textContent='Voir plus de trajets →';} }
}

// ─── Rendu résultats ─────────────────────────────────────
function renderResults(journeys,fromName,toName,time,showLoadMore=false) {
  const el=document.getElementById('results');
  if(!journeys||!journeys.length){el.innerHTML='<div class="state-empty"><span>🔍</span><p>Aucun trajet trouvé.</p></div>';return;}
  const isAllerPhase=state.isRoundTrip&&state.phase==='aller', isRetourPhase=state.isRoundTrip&&state.phase==='retour';
  const plural=journeys.length>1?journeys.length+' trajets trouvés':'1 trajet trouvé';
  const dateLabel=state.currentDate?' le '+state.currentDate:'';
  const phaseLabel=isAllerPhase?' — <strong>Choisissez votre trajet aller</strong>':isRetourPhase?' — <strong>Choisissez votre trajet retour</strong>':'';
  let out='';
  if(isRetourPhase&&state.selectedAller){
    const a=state.selectedAller,leg0=a.legs[0],legEnd=a.legs[a.legs.length-1],types=(a.train_types||[]).join(' · ')||'Train',xfers=a.transfers===0?'Direct':a.transfers+' corresp.';
    out+=`<div class="aller-recap-wrapper"><div class="aller-recap-label"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6.5" stroke="#4ade80" stroke-width="1.2"/><path d="M4.5 7l2 2 3-3" stroke="#4ade80" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>Trajet aller sélectionné</div><div class="aller-recap-card"><div><div class="aller-recap-times"><div><div class="aller-recap-time">${leg0.dep_str}</div><div class="aller-recap-stations">${escapeHtml(leg0.from_name)}</div></div><div class="aller-recap-arrow"><div class="aller-recap-arrow-line"></div><div class="aller-recap-dur">${minutesToHHMM(a.duration)}</div></div><div><div class="aller-recap-time">${legEnd.arr_str}</div><div class="aller-recap-stations">${escapeHtml(legEnd.to_name)}</div></div></div></div><div class="aller-recap-meta"><div class="aller-recap-badge">${escapeHtml(types)}</div><div style="font-size:11px;color:rgba(255,255,255,.45);font-weight:500">${xfers}</div><button class="aller-recap-change-btn" onclick="resetAllerSelection()">Modifier l'aller</button></div></div><div class="retour-section-label">Choisissez votre trajet retour</div></div>`;
  }
  out+='<div class="results-header"><div class="results-header-left"><div class="results-title">'+escapeHtml(fromName)+' → '+escapeHtml(toName)+'</div><div class="results-count">Départ après '+time+dateLabel+' — '+plural+phaseLabel+'</div></div><div class="results-sort"><svg viewBox="0 0 14 14" fill="none" width="14" height="14"><path d="M2 4h10M4 7h6M6 10h2" stroke="#6b7a8d" stroke-width="1.4" stroke-linecap="round"/></svg> Trier par : <span>Heure de départ</span></div></div>';
  const sortedJourneys=[...journeys].sort((a,b)=>(a.dep_time||0)-(b.dep_time||0));
  sortedJourneys.forEach((j,i)=>{out+=renderJourneyCard(j,i,isAllerPhase||isRetourPhase);});
  if(showLoadMore) out+='<div style="text-align:center;padding:28px 0 8px"><button id="btn-more" onclick="loadMore()" class="btn-more">Voir plus de trajets →</button></div>';
  el.innerHTML=out;
  el.querySelectorAll('.journey-card').forEach((card,idx)=>{
    const btnSelect=card.querySelector('.btn-select-journey');
    if(btnSelect) btnSelect.addEventListener('click',e=>{e.stopPropagation();if(state.isRoundTrip)selectJourneyForRoundTrip(sortedJourneys[idx]);else selectJourneySimple(sortedJourneys[idx]);});
    card.querySelector('.card-summary').addEventListener('click',e=>{if(e.target.closest('.btn-select-journey'))return;card.classList.toggle('expanded');});
  });
}

// ─── Rendu carte trajet (avec overlay MAX) ────────────────
function renderJourneyCard(j,i,showSelectBtn=false) {
  const isDirect=j.transfers===0, fromLeg=j.legs[0], toLeg=j.legs[j.legs.length-1];
  const overnight=toLeg.arr_time-fromLeg.dep_time>=86400;
  const overnightSup=overnight?`<sup class="card-overnight">+${Math.floor((toLeg.arr_time-fromLeg.dep_time)/86400)}</sup>`:'';
  const transferLabel=isDirect?'<span class="card-direct">DIRECT</span>':`<span class="card-corresp">${j.transfers} CORRESP.</span>`;

  // ── Disponibilité MAX ──────────────────────────────────
  // od_happy_card: "oui" = places dispo | "non" = épuisé | undefined = inconnu
  const isUnavail = j.od_happy_card === 'non';
  const maxOverlay = isUnavail
    ? `<div class="max-unavail-overlay"><div class="max-unavail-label">⛔ Places MAX épuisées</div></div>`
    : '';
  const maxBadge = j.od_happy_card === 'oui'
    ? `<span class="max-badge">MAX 0€</span>`
    : '';

  // ── Timeline ──────────────────────────────────────────
  let tlHtml='<div class="tl-wrap">';
  j.legs.forEach((leg,li)=>{
    const isFirst=li===0;
    if(li>0){const wait=Math.round((leg.dep_time-j.legs[li-1].arr_time)/60),waitLabel=wait>0?minutesToHHMM(wait):'courte';tlHtml+=`<div class="tl-transfer"><div class="tl-node-col"><div class="tl-circle tl-circle--xfer"><span class="material-symbols-outlined text-orange-400" style="font-size:14px"><i class="fa-solid fa-person-walking-dashed-line-arrow-right fa-xs"></i></span></div><div class="tl-vline"></div></div><div class="tl-xfer-body"><span class="tl-xfer-station">${escapeHtml(leg.from_name)}</span><div class="tl-xfer-sep"></div><span class="tl-xfer-wait">Correspondance : ${waitLabel}</span></div></div>`;}
    const legLogoFile=TRAIN_TYPE_LOGO[leg.train_type];
    const legLogoHtml=legLogoFile?`<img src="Assets/Icone_logo/${legLogoFile}" alt="${leg.train_type}" style="height:18px;max-width:60px;object-fit:contain;vertical-align:middle;" onerror="this.style.display='none'">`:`<span style="font-size:10px;font-weight:700;color:#94a3b8">${leg.train_type||''}</span>`;
    tlHtml+=`<div class="tl-stop"><div class="tl-node-col"><div class="tl-circle ${isFirst?'tl-circle--dep':'tl-circle--mid'}"></div><div class="tl-vline"></div></div><div class="tl-body"><div class="tl-stop-header"><span class="tl-stop-name">${escapeHtml(leg.from_name)}</span></div><span class="tl-stop-time">Départ à ${leg.dep_str}</span><div class="tl-dur-box">${legLogoHtml}<span class="tl-dur-ico"><i class="fa-solid fa-clock"></i></span><span class="tl-dur-text">Trajet : ${minutesToHHMM(leg.duration)}</span></div></div></div>`;
  });
  tlHtml+=`<div class="tl-stop tl-stop--final"><div class="tl-node-col"><div class="tl-circle tl-circle--arr"></div></div><div class="tl-body"><span class="tl-stop-name">${escapeHtml(toLeg.to_name)}</span><span class="tl-stop-time">Arrivée à ${toLeg.arr_str}${overnightSup}</span></div></div></div>`;

  const delay=`animation-delay:${i*50}ms`;
  return `
    <div class="journey-card${isUnavail?' journey-card--unavail':''}" style="${delay}">
      <div class="card-summary">
        <div class="card-dep-block">
          <span class="card-time">${fromLeg.dep_str}</span>
          <span class="card-station-lbl">${escapeHtml(fromLeg.from_name).toUpperCase()}</span>
        </div>
        <div class="card-mid-block">
          <span class="card-dur-lbl">${minutesToHHMM(j.duration)}</span>
          ${transferLabel}
          ${maxBadge}
        </div>
        <div class="card-arr-block">
          <span class="card-time">${toLeg.arr_str}${overnightSup}</span>
          <span class="card-station-lbl">${escapeHtml(toLeg.to_name).toUpperCase()}</span>
        </div>
        <div class="card-select-block">
          ${showSelectBtn?`<button class="btn-select-journey"><span class="btn-select-text">Sélectionner</span><span class="btn-select-arrow material-symbols-outlined" style="font-size:18px;line-height:1">arrow_forward</span></button>`:''}
        </div>
      </div>
      <div class="card-legs">${tlHtml}</div>
      ${maxOverlay}
    </div>`;
}

// ─── Styles trains ──────────────────────────────────────
const TRAIN_TYPE_STYLES={'INOUI':{bg:'#c8962e',label:'TGV Inoui'},'OUIGO':{bg:'#e80082',label:'Ouigo GV'},'OUIGO_CLASSIQUE':{bg:'#9b1c6e',label:'Ouigo Classique'},'TER':{bg:'#4a6741',label:'TER'},'CAR':{bg:'#7a7265',label:'Car TER'},'IC':{bg:'#2a5a8b',label:'Intercités'},'IC_NUIT':{bg:'#1a2a4a',label:'IC Nuit'},'LYRIA':{bg:'#d4001a',label:'Lyria'},'TRAMTRAIN':{bg:'#5a7a3a',label:'TramTrain'},'NAVETTE':{bg:'#7a6a5a',label:'Navette'},'ICE':{bg:'#d40000',label:'ICE'},'EUROSTAR':{bg:'#00435a',label:'Eurostar'},'FRECCIAROSSA':{bg:'#c60018',label:'Frecciarossa'},'AVE':{bg:'#8b1a4a',label:'AVE'},'AVE_INT':{bg:'#6b1238',label:'AVE Int.'},'ALVIA':{bg:'#c0392b',label:'Alvia'},'AVLO':{bg:'#e74c3c',label:'AVLO'},'AVANT':{bg:'#922b21',label:'Avant'},'EUROMED':{bg:'#1a5276',label:'Euromed'},'INTERCITY_ES':{bg:'#2471a3',label:'Intercity'},'MD':{bg:'#27ae60',label:'Media Distancia'},'REGIONAL_ES':{bg:'#1e8449',label:'Regional'},'REG_EXP':{bg:'#196f3d',label:'Reg. Exprés'},'OUIGO_ES':{bg:'#e80082',label:'Ouigo España'},'RENFE':{bg:'#5e1b43',label:'Renfe'},'TRAIN':{bg:'#3a3a3a',label:'Train'}};
const TRAIN_TYPE_LOGO={'INOUI':'tgv_inoui.png','OUIGO':'ouigo.png','OUIGO_CLASSIQUE':'ouigo-classique.png','TER':'TER.png','CAR':'TER.png','IC':'intercites.png','IC_NUIT':'intercites.png','LYRIA':'lyria.png','ICE':'ice.png','TRAMTRAIN':'TER.png','NAVETTE':'TER.png','TRAIN':'inoui.svg','IC_SNCB':'sncb.png','NIGHTJET':'nightjet.png','EUROSTAR':'eurostar.png','FRECCIAROSSA':'frecciarossa.png','EURONIGHT':'intercites.png','IC_IT':'intercites.png','REGIONALE_IT':'trenitalia.png','AVE':'Renfe_ave.png','AVE_INT':'Renfe_ave.png','ALVIA':'Renfe_Alvia.png','AVLO':'Renfe_Alvo.png','AVANT':'Renfe_Avant.png','EUROMED':'Renfe_Euromed.png','INTERCITY_ES':'renfe_Intercity.png','MD':'renfe_MD.png','REGIONAL_ES':'Renfe_Regionales.png','REG_EXP':'Renfe_Regionales.png','RENFE':'renfe.png','OUIGO_ES':'ouigo.png'};
const TYPE_ORDER=['INOUI','OUIGO','OUIGO_CLASSIQUE','IC','IC_NUIT','TER','CAR','TRAMTRAIN','NAVETTE','LYRIA','ICE','EUROSTAR','FRECCIAROSSA','AVE','AVE_INT','AVLO','OUIGO_ES','ALVIA','AVANT','EUROMED','INTERCITY_ES','MD','REGIONAL_ES','REG_EXP','RENFE','TRAIN'];

function populateTypeCombobox(availableTypes) {
  const dropdown=document.getElementById('ms-dropdown'),allChk=document.getElementById('ms-all');
  if(!dropdown||!availableTypes.length) return;
  const sorted=[...availableTypes].sort((a,b)=>{const ia=TYPE_ORDER.indexOf(a),ib=TYPE_ORDER.indexOf(b);return(ia===-1?99:ia)-(ib===-1?99:ib);});
  dropdown.querySelectorAll('.ms-item').forEach(el=>el.remove());
  sorted.forEach(key=>{const s=TRAIN_TYPE_STYLES[key]||{bg:'#3a3a3a',label:key};const item=document.createElement('label');item.className='ms-item';item.innerHTML=`<input type="checkbox" class="ms-chk" data-key="${key}" checked><span class="ms-color-dot" style="background:${s.bg}"></span><span class="ms-item-label">${s.label}</span>`;dropdown.appendChild(item);});
  updateMsLabel();
}

function updateMsLabel() {
  const labelEl=document.getElementById('ms-label'),countEl=document.getElementById('ms-count'),allChk=document.getElementById('ms-all'),dropdown=document.getElementById('ms-dropdown');
  if(!labelEl) return;
  const all=[...dropdown.querySelectorAll('.ms-chk')],checked=all.filter(c=>c.checked);
  if(checked.length===0||checked.length===all.length){if(checked.length===0)all.forEach(c=>{c.checked=true;});labelEl.textContent='Tous les trains';countEl.style.display='none';state.activeTypeFilters=null;if(allChk){allChk.checked=true;allChk.indeterminate=false;}}
  else{const names=checked.map(c=>{const s=TRAIN_TYPE_STYLES[c.dataset.key];return s?s.label:c.dataset.key;});labelEl.textContent=checked.length===1?names[0]:`${checked.length} types`;countEl.textContent=checked.length;countEl.style.display='';state.activeTypeFilters=new Set(checked.map(c=>c.dataset.key));if(allChk){allChk.checked=false;allChk.indeterminate=true;}}
}

(function initMultiSelect(){
  const btn=document.getElementById('ms-btn'),dropdown=document.getElementById('ms-dropdown'),allChk=document.getElementById('ms-all');
  if(!btn||!dropdown) return;
  allChk.addEventListener('change',()=>{dropdown.querySelectorAll('.ms-chk').forEach(c=>{c.checked=allChk.checked;});updateMsLabel();if(state.allJourneys.length)relaunchWithFilter();});
  dropdown.addEventListener('change',e=>{if(!e.target.classList.contains('ms-chk'))return;updateMsLabel();if(state.allJourneys.length)relaunchWithFilter();});
  btn.addEventListener('click',e=>{e.stopPropagation();const isOpen=dropdown.classList.toggle('open');btn.classList.toggle('open',isOpen);});
  document.addEventListener('click',e=>{if(!btn.contains(e.target)&&!dropdown.contains(e.target)){dropdown.classList.remove('open');btn.classList.remove('open');}});
  dropdown.addEventListener('click',e=>e.stopPropagation());
})();

function relaunchWithFilter(){state._filterRelaunch=true;state.nextOffset=0;state.allJourneys=[];state.lastDepTime=0;doSearch();}

(function(){
  const btn=document.getElementById('tripTypeBtn'),menu=document.getElementById('tripTypeMenu'),label=document.getElementById('selectedTripType'),retour=document.getElementById('return-date-wrapper');
  btn.addEventListener('click',()=>{menu.classList.toggle('hidden');btn.classList.toggle('active');});
  menu.querySelectorAll('.trip-type-option').forEach(opt=>{opt.addEventListener('click',()=>{menu.querySelectorAll('.trip-type-option').forEach(o=>o.classList.remove('selected'));opt.classList.add('selected');const val=opt.dataset.value;state.isRoundTrip=(val==='roundtrip');label.textContent=val==='roundtrip'?'Aller-retour':'Aller simple';retour.style.display=val==='roundtrip'?'':'none';state.phase='aller';state.selectedAller=null;hidePhaseBanner();menu.classList.add('hidden');btn.classList.remove('active');});});
  document.addEventListener('click',e=>{if(!btn.contains(e.target)&&!menu.contains(e.target)){menu.classList.add('hidden');btn.classList.remove('active');}});
})();

// ─── Aller-retour ───────────────────────────────────────
function selectJourneyForRoundTrip(journey) {
  if(state.phase==='aller'){
    state.selectedAller=journey; state.phase='retour'; state.allerDate=document.getElementById('input-date').value||'';
    const tmpFrom=state.selectedFrom; state.selectedFrom=state.selectedTo; state.selectedTo=tmpFrom;
    document.getElementById('input-from').value=state.selectedFrom.name||''; document.getElementById('id-from').value=(state.selectedFrom.stopIds||[]).join(',');
    document.getElementById('input-to').value=state.selectedTo.name||''; document.getElementById('id-to').value=(state.selectedTo.stopIds||[]).join(',');
    const retInput=document.getElementById('return-date'), returnDate=(retInput&&retInput.value)?retInput.value:'';
    if(!returnDate){const saisie=prompt('Date de retour (YYYY-MM-DD) :',state.allerDate||'');if(!saisie){state.phase='aller';state.selectedAller=null;hidePhaseBanner();return;}if(retInput)retInput.value=saisie;document.getElementById('input-date').value=saisie;state.retourDate=saisie;}else{document.getElementById('input-date').value=returnDate;state.retourDate=returnDate;}
    document.getElementById('input-time').value='02:00';
    showPhaseBanner('retour',journey); state.allJourneys=[]; state.nextOffset=0; state.lastDepTime=0; state.activeTypeFilters=null; state._phaseSearch=true; doSearch();
  } else if(state.phase==='retour'){
    const aller=state.selectedAller, retour=journey;
    sessionStorage.setItem('recap_aller',JSON.stringify(aller)); sessionStorage.setItem('recap_retour',JSON.stringify(retour));
    sessionStorage.setItem('recap_from',JSON.stringify(state.selectedTo)); sessionStorage.setItem('recap_to',JSON.stringify(state.selectedFrom));
    sessionStorage.setItem('recap_date_aller',state.allerDate||''); sessionStorage.setItem('recap_date_retour',state.retourDate||document.getElementById('input-date').value||'');
    sessionStorage.setItem('recap_is_simple','false'); window.location.href='recap.html';
  }
}

function selectJourneySimple(journey){const dateAller=document.getElementById('input-date').value||'';sessionStorage.removeItem('recap_retour');sessionStorage.removeItem('recap_date_retour');sessionStorage.setItem('recap_aller',JSON.stringify(journey));sessionStorage.setItem('recap_from',JSON.stringify(state.selectedFrom));sessionStorage.setItem('recap_to',JSON.stringify(state.selectedTo));sessionStorage.setItem('recap_date_aller',dateAller);sessionStorage.setItem('recap_is_simple','true');window.location.href='recap.html';}
function showPhaseBanner(){}
function hidePhaseBanner(){const b=document.getElementById('phase-banner');if(b)b.remove();}
function resetAllerSelection(){state.phase='aller';state.selectedAller=null;const t=state.selectedFrom;state.selectedFrom=state.selectedTo;state.selectedTo=t;document.getElementById('input-from').value=state.selectedFrom.name||'';document.getElementById('id-from').value=(state.selectedFrom.stopIds||[]).join(',');document.getElementById('input-to').value=state.selectedTo.name||'';document.getElementById('id-to').value=(state.selectedTo.stopIds||[]).join(',');if(state.allerDate)document.getElementById('input-date').value=state.allerDate;state.allJourneys=[];state.nextOffset=0;state.lastDepTime=0;state._phaseSearch=true;doSearch();}

// ─── Init depuis URL ────────────────────────────────────
function initFromURL(){
  const p=new URLSearchParams(window.location.search);
  const from=p.get('from'),fromName=p.get('fromName'),to=p.get('to'),toName=p.get('toName');
  if(!from||!to) return;
  document.getElementById('input-from').value=fromName||from; document.getElementById('id-from').value=from; state.selectedFrom={name:fromName||from,id:from,stopIds:from.split(',')};
  document.getElementById('input-to').value=toName||to; document.getElementById('id-to').value=to; state.selectedTo={name:toName||to,id:to,stopIds:to.split(',')};
  const time=p.get('time'); if(time) document.getElementById('input-time').value=time;
  const date=p.get('date'); if(date) document.getElementById('input-date').value=date;
  const tripType=p.get('tripType'),returnDate=p.get('returnDate');
  if(tripType==='roundtrip'){state.isRoundTrip=true;const menu=document.getElementById('tripTypeMenu'),label=document.getElementById('selectedTripType'),retourWrapper=document.getElementById('return-date-wrapper');if(menu){menu.querySelectorAll('.trip-type-option').forEach(o=>o.classList.remove('selected'));const rtOpt=menu.querySelector('[data-value="roundtrip"]');if(rtOpt)rtOpt.classList.add('selected');}if(label)label.textContent='Aller-retour';if(retourWrapper)retourWrapper.style.display='';if(returnDate){const retInput=document.getElementById('return-date');if(retInput)retInput.value=returnDate;}}
  updateSearchBtn();
}

setupAutocomplete('input-from','ac-from','id-from','selectedFrom',state,updateSearchBtn);
setupAutocomplete('input-to','ac-to','id-to','selectedTo',state,updateSearchBtn);

initFromURL();
initEngine().then(()=>{ if(state.selectedFrom&&state.selectedTo){history.replaceState(null,'',window.location.pathname);doSearch();} });