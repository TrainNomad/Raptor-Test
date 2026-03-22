// ─── Config ───────────────────────────────────────────────────────────────────
const API = 'https://raptor-tgvmax-backend.onrender.com';

// ─── État ─────────────────────────────────────────────────────────────────────
const searchState = {
  selectedFrom: null,
  selectedTo:   null,
};

// ─── Mise à jour du bouton ─────────────────────────────────────────────────────
function updateSearchBtn() {
  document.getElementById('btn-search').disabled =
    !(searchState.selectedFrom && searchState.selectedTo);
}

// ─── Dropdown type de trajet ───────────────────────────────────────────────────
(function () {
  const btn    = document.getElementById('tripTypeBtn');
  const menu   = document.getElementById('tripTypeMenu');
  const label  = document.getElementById('selectedTripType');
  const retour = document.getElementById('return-date-wrapper');

  btn.addEventListener('click', () => {
    menu.classList.toggle('hidden');
    btn.classList.toggle('active');
  });

  menu.querySelectorAll('.trip-type-option').forEach(opt => {
    opt.addEventListener('click', () => {
      menu.querySelectorAll('.trip-type-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      const val = opt.dataset.value;
      label.textContent    = val === 'roundtrip' ? 'Aller-retour' : 'Aller simple';
      retour.style.display = val === 'roundtrip' ? '' : 'none';
      menu.classList.add('hidden');
      btn.classList.remove('active');
    });
  });

  document.addEventListener('click', e => {
    if (!btn.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.add('hidden');
      btn.classList.remove('active');
    }
  });
})();

// ─── Date par défaut ──────────────────────────────────────────────────────────
document.getElementById('btn-search').disabled = true;
document.getElementById('input-date').value = new Date().toISOString().slice(0, 10);

// ─── Recherche → redirect vers trajets.html ───────────────────────────────────
document.getElementById('btn-search').addEventListener('click', () => {
  if (!searchState.selectedFrom || !searchState.selectedTo) return;

  const date  = document.getElementById('input-date').value  || '';
  const time  = document.getElementById('input-time').value  || '06:00';

  const getStopId = stop => (stop.stopIds && stop.stopIds.length)
    ? stop.stopIds[0]
    : (stop.id || '');

  const selectedTripOpt = document.querySelector('.trip-type-option.selected');
  const tripType   = selectedTripOpt ? selectedTripOpt.dataset.value : 'oneway';
  const returnDate = document.getElementById('return-date')
    ? document.getElementById('return-date').value : '';

  const params = new URLSearchParams({
    from:     getStopId(searchState.selectedFrom),
    fromName: searchState.selectedFrom.name,
    to:       getStopId(searchState.selectedTo),
    toName:   searchState.selectedTo.name,
    time,
    tripType,
  });
  if (date)       params.set('date', date);
  if (returnDate) params.set('returnDate', returnDate);

  window.location.href = 'trajets.html?' + params.toString();
});

// ─── Init autocomplétion ──────────────────────────────────────────────────────
setupAutocomplete('input-from', 'ac-from', 'id-from', 'selectedFrom', searchState, updateSearchBtn);
setupAutocomplete('input-to',   'ac-to',   'id-to',   'selectedTo',   searchState, updateSearchBtn);