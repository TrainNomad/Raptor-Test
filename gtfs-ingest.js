/**
 * GTFS Multi-Opérateurs → RAPTOR
 *
 * Usage :
 *   node gtfs-ingest.js                            ← lit operators.json
 *   node gtfs-ingest.js ./operators.json ./engine_data
 *
 * Filtres appliqués par opérateur (trains longue distance uniquement) :
 *   SNCF    : exclut CAR, NAVETTE, TRAMTRAIN et route_type 3 (bus)
 *   SNCB    : garde uniquement IC, EC, NJ, OTC
 *   TI      : tout (déjà uniquement Frecciarossa)
 *   ES      : tout (Eurostar)
 *   RENFE   : exclut PROXIMDAD, FEVE et bus (TRENCELTA gardé — liaison ES↔PT)
 *   OUIGO_ES: tout sauf bus
 *   CP      : garde uniquement AP (Alfa Pendular), IC (Intercidades), IR (Inter-regional)
 *
 * OPTIMISATION MÉMOIRE :
 *   Les stop_id strings sont encodés en entiers via un dictionnaire global.
 *   Format route_trips.json : stop_times contient des indices entiers (sid_idx)
 *   au lieu de strings répétées → ~60% de réduction RAM sur server.js
 *   Le fichier stop_id_dict.json contient le tableau [stopId0, stopId1, ...] (idx → string)
 */

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

const OPS_FILE = process.argv[2] || './operators.json';
const OUT_DIR  = process.argv[3] || './engine_data';

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── Utilitaires ──────────────────────────────────────────────────────────────

function timeToSeconds(t) {
  if (!t || !t.includes(':')) return null;
  const [h, m, s] = t.trim().split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 3600 + m * 60 + (s || 0);
}

function parseGTFSDate(d) {
  const s = String(d).trim();
  const date = new Date(parseInt(s.slice(0,4)), parseInt(s.slice(4,6)) - 1, parseInt(s.slice(6,8)));
  return { date, dow: date.getDay() };
}

const DOW_KEYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

// ── Fenêtre 92 jours ──────────────────────────────────────────────────────────
const WINDOW_DAYS  = 90;
const WINDOW_START = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
const WINDOW_END   = (() => { const d = new Date(WINDOW_START); d.setDate(d.getDate() + WINDOW_DAYS - 1); return d; })();
function gtfsDateInWindow(g) {
  const d = new Date(g.slice(0,4)+'-'+g.slice(4,6)+'-'+g.slice(6,8)+'T00:00:00');
  return d >= WINDOW_START && d <= WINDOW_END;
}
console.log('  Fenetre : ' + WINDOW_START.toISOString().slice(0,10)
  + ' -> ' + WINDOW_END.toISOString().slice(0,10));

function streamCSV(filePath, onRow) {
  return new Promise((resolve, reject) => {
    if (!require('fs').existsSync(filePath)) {
      console.warn('    ⚠  Manquant : ' + require('path').basename(filePath));
      return resolve([]);
    }
    const rows = []; let headers = null;
    const rl = require('readline').createInterface({
      input: require('fs').createReadStream(filePath, { encoding: 'utf8', highWaterMark: 256*1024 }),
      crlfDelay: Infinity,
    });
    rl.on('line', (raw) => {
      const line = raw.replace(/^﻿/,'').trim();
      if (!line) return;
      const cols = parseCSVLine(line);
      if (!headers) { headers = cols; return; }
      const row = {};
      headers.forEach((h,i) => { row[h] = (cols[i]||'').trim(); });
      if (onRow(row)) rows.push(row);
    });
    rl.on('close', () => resolve(rows));
    rl.on('error', reject);
  });
}

function activeServiceIdsInWindow(calendarRows, calendarDatesRows) {
  const active = new Set();
  const calByService = new Map();
  for (const row of calendarRows) {
    calByService.set(row.service_id, {
      start: parseGTFSDate(row.start_date).date,
      end:   parseGTFSDate(row.end_date).date,
      dow:   DOW_KEYS.map(k => row[k] === '1'),
    });
  }
  const cdByDate = new Map();
  for (const row of calendarDatesRows) {
    if (!gtfsDateInWindow(row.date.trim())) continue;
    if (!cdByDate.has(row.date)) cdByDate.set(row.date, []);
    cdByDate.get(row.date).push({ sid: row.service_id, type: row.exception_type });
  }
  const cur = new Date(WINDOW_START);
  while (cur <= WINDOW_END) {
    const g = cur.getFullYear()+String(cur.getMonth()+1).padStart(2,'0')+String(cur.getDate()).padStart(2,'0');
    const { date, dow } = parseGTFSDate(g);
    for (const [sid, cal] of calByService) {
      if (date >= cal.start && date <= cal.end && cal.dow[dow]) active.add(sid);
    }
    for (const { sid, type } of (cdByDate.get(g) || [])) {
      if (type === '1') active.add(sid);
    }
    cur.setDate(cur.getDate()+1);
  }
  for (const [, overrides] of cdByDate) {
    for (const { sid, type } of overrides) {
      if (type === '1') active.add(sid);
    }
  }
  return active;
}

async function readCSV(filePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) {
      console.warn('    ⚠  Manquant : ' + path.basename(filePath));
      return resolve([]);
    }
    const rows = []; let headers = null;
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    rl.on('line', (line) => {
      const clean = line.replace(/^\uFEFF/, '').trim();
      if (!clean) return;
      const cols = parseCSVLine(clean);
      if (!headers) { headers = cols; return; }
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (cols[i] !== undefined ? cols[i] : '').trim(); });
      rows.push(obj);
    });
    rl.on('close', () => resolve(rows));
    rl.on('error', () => resolve([]));
  });
}

function parseCSVLine(line) {
  const result = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur); cur = ''; }
    else { cur += c; }
  }
  result.push(cur);
  return result;
}

// ─── Filtres par opérateur ────────────────────────────────────────────────────

const SNCF_EXCLUDE_SHORT = new Set(['CAR', 'NAVETTE', 'TRAMTRAIN']);
const SNCB_KEEP_SHORT    = new Set(['IC', 'EC', 'NJ', 'OTC', 'L', 'P']);

function shouldKeepRoute(operatorId, r) {
  const short = (r.route_short_name || '').trim();
  const rtype = parseInt(r.route_type) || 0;

  switch (operatorId) {
    case 'SNCF':
      if (rtype === 3) return false;
      if (SNCF_EXCLUDE_SHORT.has(short)) return false;
      return true;

    case 'SNCB':
      if (rtype === 3) return false;
      if (short === 'S') return false;
      return SNCB_KEEP_SHORT.has(short) || rtype === 2 || (rtype >= 100 && rtype <= 199);

    case 'RENFE': {
      const s = (r.route_short_name || '').trim().toUpperCase();
      const RENFE_EXCLUDE = new Set(['PROXIMDAD', 'FEVE']);
      if (RENFE_EXCLUDE.has(s)) return false;
      return rtype !== 3;
    }

    case 'OUIGO_ES':
      return rtype !== 3;

    case 'CP': {
      const s = (r.route_short_name || '').trim().toUpperCase();
      const CP_URBAN_EXCLUDE = new Set(['U']);
      if (CP_URBAN_EXCLUDE.has(s)) return false;
      return rtype !== 3;
    }

    case 'UK':
      return rtype === 2 || (rtype >= 100 && rtype <= 199);

    case 'EU_SLEEPER':
      return rtype !== 3;

    case 'NL':
      return rtype === 2 || (rtype >= 100 && rtype <= 106);

    default:
      return rtype !== 3;
  }
}

// ─── Calendrier ───────────────────────────────────────────────────────────────

function computeActiveServices(calendarRows, calendarDatesRows, gtfsDate) {
  const { date, dow } = parseGTFSDate(gtfsDate);
  const dowKey = DOW_KEYS[dow];
  const active = new Set();
  for (const row of calendarRows) {
    const start = parseGTFSDate(row.start_date).date;
    const end   = parseGTFSDate(row.end_date).date;
    if (date >= start && date <= end && row[dowKey] === '1') active.add(row.service_id);
  }
  for (const row of calendarDatesRows) {
    if (row.date.trim() === gtfsDate) {
      if (row.exception_type === '1')      active.add(row.service_id);
      else if (row.exception_type === '2') active.delete(row.service_id);
    }
  }
  return active;
}

function buildCalendarIndex(calendarRows, calendarDatesRows, prefix) {
  const calByService = new Map();
  for (const row of calendarRows) {
    calByService.set(row.service_id, {
      start: parseGTFSDate(row.start_date).date,
      end:   parseGTFSDate(row.end_date).date,
      dow:   DOW_KEYS.map(k => row[k] === '1'),
    });
  }
  const cdByDate = new Map();
  for (const row of calendarDatesRows) {
    const d = row.date.trim();
    if (!gtfsDateInWindow(d)) continue;
    if (!cdByDate.has(d)) cdByDate.set(d, []);
    cdByDate.get(d).push({ sid: row.service_id, type: row.exception_type });
  }
  const allDates = new Set();
  for (const { start, end } of calByService.values()) {
    const cur  = new Date(Math.max(start.getTime(), WINDOW_START.getTime()));
    const stop = new Date(Math.min(end.getTime(),   WINDOW_END.getTime()));
    while (cur <= stop) {
      allDates.add(cur.getFullYear()+String(cur.getMonth()+1).padStart(2,'0')+String(cur.getDate()).padStart(2,'0'));
      cur.setDate(cur.getDate()+1);
    }
  }
  for (const d of cdByDate.keys()) allDates.add(d);

  const index = {};
  for (const gtfsDate of allDates) {
    const { date, dow } = parseGTFSDate(gtfsDate);
    const active = new Set();
    for (const [sid, cal] of calByService) {
      if (date >= cal.start && date <= cal.end && cal.dow[dow]) active.add(sid);
    }
    for (const { sid, type } of (cdByDate.get(gtfsDate) || [])) {
      if (type === '1') active.add(sid); else if (type === '2') active.delete(sid);
    }
    if (!active.size) continue;
    const iso = gtfsDate.slice(0,4)+'-'+gtfsDate.slice(4,6)+'-'+gtfsDate.slice(6,8);
    index[iso] = [...active].map(s => prefix + ':' + s);
  }
  return index;
}

// ─── Détection du type de train ───────────────────────────────────────────────

function detectTrainType(operatorId, stopId, tripId, routeShort, agencyCode) {
  const tid = (tripId || '').toUpperCase();

  switch (operatorId) {
    case 'SNCF': {
      const m    = (stopId || '').match(/StopPoint:OCE(.+)-\d{8}$/);
      const quai = m ? m[1].trim() : '';
      if (quai === 'OUIGO' || tid.includes('OUIGO')) {
        const numM = tripId.match(/^OCESN([47]\d{3})/);
        const num  = numM ? parseInt(numM[1]) : null;
        if (num !== null) return num >= 7000 ? 'OUIGO' : 'OUIGO_CLASSIQUE';
        return 'OUIGO';
      }
      if (quai === 'TGV INOUI'           || tid.includes('INOUI'))      return 'INOUI';
      if (quai === 'INTERCITES de nuit')                                 return 'IC_NUIT';
      if (quai === 'INTERCITES'          || tid.includes('INTERCITES'))  return 'IC';
      if (quai === 'Lyria'               || tid.includes('LYRIA'))       return 'LYRIA';
      if (quai === 'ICE')                                                return 'ICE';
      if (quai === 'Train TER')                                          return 'TER';
      return 'TRAIN';
    }

    case 'TI':
      return 'FRECCIAROSSA';

    case 'ES':
      return 'EUROSTAR';

    case 'SNCB': {
      const s = (routeShort || '').toUpperCase();
      if (s === 'NJ')  return 'NIGHTJET';
      if (s === 'EC')  return 'EC';
      if (s === 'OTC') return 'THALYS_CORRIDOR';
      if (s === 'IC')  return 'IC_SNCB';
      return 'IC_SNCB';
    }

    case 'DB_FV':
    case 'DB': {
      const rs = (routeShort || '').trim().toUpperCase();
      if (rs === 'ICE' || rs.startsWith('ICE'))            return 'ICE';
      if (rs === 'IC'  || rs === 'ICN')                    return 'IC_DB';
      if (rs === 'EC'  || rs === 'ECE')                    return 'EC';
      if (rs === 'NJ'  || rs === 'EN')                     return 'NIGHTJET';
      if (rs === 'FLX' || rs.startsWith('FLIXTRAIN'))      return 'FLIXTRAIN';
      if (tid.includes('ICE'))                             return 'ICE';
      if (tid.includes('_IC_') || tid.includes('-IC-'))    return 'IC_DB';
      if (tid.includes('EC'))                              return 'EC';
      if (tid.includes('NJ') || tid.includes('NIGHT'))     return 'NIGHTJET';
      if (tid.includes('FLX') || tid.includes('FLIXTRAIN')) return 'FLIXTRAIN';
      return 'TRAIN_DB';
    }

    case 'RENFE': {
      const rs = (routeShort || '').trim().toUpperCase();
      if (rs === 'AVE INT')   return 'AVE_INT';
      if (rs === 'AVE')       return 'AVE';
      if (rs === 'AVLO')      return 'AVLO';
      if (rs === 'ALVIA')     return 'ALVIA';
      if (rs === 'AVANT EXP') return 'AVANT';
      if (rs === 'AVANT')     return 'AVANT';
      if (rs === 'EUROMED')   return 'EUROMED';
      if (rs === 'INTERCITY') return 'INTERCITY_ES';
      if (rs === 'MD')        return 'MD';
      if (rs === 'REG.EXP.')  return 'REG_EXP';
      if (rs === 'REGIONAL')  return 'REGIONAL_ES';
      if (rs === 'TRENCELTA') return 'REGIONAL_ES';
      if (rs === 'PROXIMDAD') return 'MD';
      return 'RENFE';
    }

    case 'OUIGO_ES':
      return 'OUIGO_ES';

    case 'CP': {
      const rs = (routeShort || '').trim().toUpperCase();
      if (rs === 'AP') return 'ALFA_PENDULAR';
      if (rs === 'IC') return 'IC_CP';
      if (rs === 'IR') return 'IR_CP';
      return 'CP';
    }

    case 'UK': {
      const agency = (agencyCode || (tripId || '').substring(0, 2)).toUpperCase();
      switch (agency) {
        case 'VT': return 'AVANTI';
        case 'GR': return 'LNER';
        case 'CS': return 'CALEDONIAN_SLEEPER';
        case 'XC': return 'CROSSCOUNTRY';
        case 'TP': return 'TRANSPENNINE';
        case 'EM': return 'EMR';
        case 'GW': return 'GWR';
        case 'SW': return 'SWR';
        case 'HT': return 'HULL_TRAINS';
        case 'GC': return 'GRAND_CENTRAL';
        case 'LD': return 'LUMO';
        case 'SR': return 'SCOTRAIL';
        case 'NT': return 'NORTHERN';
        case 'AW':
        case 'TW': return 'TRANSPORT_WALES';
        default:   return 'UK_RAIL';
      }
    }

    case 'EU_SLEEPER':
      return 'EUROPEAN_SLEEPER';

    case 'NL': {
      const agency = (agencyCode || '').toUpperCase();
      const rs     = (routeShort || '').trim().toUpperCase();
      if (agency === 'IFF:NS_INT') {
        if (rs.includes('ICE') || tid.includes('ICE'))       return 'ICE';
        if (rs.includes('THA') || tid.includes('THALYS'))    return 'THALYS_CORRIDOR';
        return 'IC_NS_INT';
      }
      if (agency === 'IFF:EUROBAHN') return 'IC_DB';
      if (agency === 'IFF:VIAS')     return 'IC_DB';
      if (rs === 'IC' || rs === 'ICD' || rs === 'INTERCITY-DIRECT') return 'IC_NS';
      if (rs === 'SPR' || rs === 'SPRINTER') return 'IC_NS';
      if (agency === 'IFF:ARRIVA' || agency === 'IFF:BLAUWNET_A' ||
          agency === 'IFF:BLAUWNET_K' || agency === 'IFF:GV' ||
          agency === 'IFF:R-NET_NS') return 'IC_NS';
      return 'IC_NS';
    }

    default:
      return 'TRAIN';
  }
}

// ─── Haversine ────────────────────────────────────────────────────────────────

function haversine(lat1, lon1, lat2, lon2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat/2)**2 +
               Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─── Index de transfert inter-opérateurs ─────────────────────────────────────

function buildTransferIndex(stopsDict) {
  console.log('\n🔗 Construction de l\'index de transfert...');
  const transferIndex = {};
  const ids = Object.keys(stopsDict);

  {
    const parentToChildren = new Map();
    for (const id of ids) {
      const parent = stopsDict[id].parent_station;
      if (!parent) continue;
      if (!parentToChildren.has(parent)) parentToChildren.set(parent, []);
      parentToChildren.get(parent).push(id);
    }
    let parentLinks = 0;
    for (const [, children] of parentToChildren) {
      for (let ci = 0; ci < children.length; ci++) {
        for (let cj = ci + 1; cj < children.length; cj++) {
          const a = children[ci], b = children[cj];
          if (!transferIndex[a]) transferIndex[a] = [];
          if (!transferIndex[b]) transferIndex[b] = [];
          if (!transferIndex[a].includes(b)) { transferIndex[a].push(b); parentLinks++; }
          if (!transferIndex[b].includes(a)) { transferIndex[b].push(a); parentLinks++; }
        }
      }
    }
    console.log(`  parent_station  : ${parentLinks} liens quai<->quai (${parentToChildren.size} gares)`);
  }

  for (let i = 0; i < ids.length; i++) {
    const s1 = stopsDict[ids[i]];
    for (let j = i + 1; j < ids.length; j++) {
      const s2   = stopsDict[ids[j]];
      const dist = haversine(s1.lat, s1.lon, s2.lat, s2.lon);
      if (dist < 300) {
        if (!transferIndex[ids[i]]) transferIndex[ids[i]] = [];
        if (!transferIndex[ids[j]]) transferIndex[ids[j]] = [];
        if (!transferIndex[ids[i]].includes(ids[j])) transferIndex[ids[i]].push(ids[j]);
        if (!transferIndex[ids[j]].includes(ids[i])) transferIndex[ids[j]].push(ids[i]);
      }
    }
  }

  const stationsPath = path.join(__dirname, 'stations.json');
  if (fs.existsSync(stationsPath)) {
    console.log('  📖 Enrichissement via stations.json...');
    const stations = JSON.parse(fs.readFileSync(stationsPath, 'utf8'));
    let manualLinks = 0;
    for (const station of stations) {
      if (!station.stopIds || station.stopIds.length < 2) continue;
      for (const idA of station.stopIds) {
        if (!stopsDict[idA]) continue;
        if (!transferIndex[idA]) transferIndex[idA] = [];
        for (const idB of station.stopIds) {
          if (idA !== idB && stopsDict[idB] && !transferIndex[idA].includes(idB)) {
            transferIndex[idA].push(idB);
            manualLinks++;
          }
        }
      }
    }
    console.log(`  ✅ ${manualLinks} liaisons inter-opérateurs depuis stations.json`);
  }

  {
    const IBERIAN_BRIDGES = [
      { a: 'RENFE:22402',   b: 'CP:94_7005',   interCity: false },
      { a: 'RENFE:94033',   b: 'CP:94_18002',  interCity: false },
      { a: 'RENFE:96122',   b: 'CP:94_6122',   interCity: false },
      { a: 'RENFE:94021',   b: 'CP:94_6007',   interCity: false },
      { a: 'RENFE:94346',   b: 'CP:94_2006',   interCity: false },
      { a: 'CP:94_57497',   b: 'RENFE:37606',  interCity: true  },
    ];

    let iberianLinks = 0;
    for (const bridge of IBERIAN_BRIDGES) {
      const { a, b, interCity } = bridge;
      if (!stopsDict[a] || !stopsDict[b]) continue;
      if (!transferIndex[a]) transferIndex[a] = [];
      if (!transferIndex[b]) transferIndex[b] = [];
      const linkAB = interCity ? { id: b, interCity: true } : b;
      const linkBA = interCity ? { id: a, interCity: true } : a;
      if (!transferIndex[a].some(x => (x.id || x) === b)) { transferIndex[a].push(linkAB); iberianLinks++; }
      if (!transferIndex[b].some(x => (x.id || x) === a)) { transferIndex[b].push(linkBA); iberianLinks++; }
    }
    console.log(`  🇵🇹🇪🇸 ${iberianLinks} ponts ibériques Renfe ↔ CP (Tren Celta + Badajoz)`);
  }

  console.log(`  Total : ${Object.keys(transferIndex).length} arrêts avec correspondances`);
  return transferIndex;
}

// ─── Ingestion d'un opérateur ─────────────────────────────────────────────────

async function ingestOperator(op) {
  const { id: operatorId, name, gtfs_dir } = op;
  const P = (rawId) => operatorId + ':' + rawId;

  console.log(`\n  📂 ${name} (${operatorId}) — ${gtfs_dir}`);

  if (!fs.existsSync(gtfs_dir)) {
    console.warn(`    ❌ Dossier introuvable : ${gtfs_dir}`);
    return null;
  }

  const routesRawAll = await readCSV(path.join(gtfs_dir, 'routes.txt'));
  console.log(`    routes brut     : ${routesRawAll.length.toLocaleString()}`);
  const routesRaw    = routesRawAll.filter(r => shouldKeepRoute(operatorId, r));
  console.log(`    routes gardées  : ${routesRaw.length.toLocaleString()} (filtre longue distance)`);
  const keptRouteIds = new Set(routesRaw.map(r => r.route_id));
  const routeInfo    = {};
  const routeTypeMap = {};
  const routeAgency  = {};
  for (const r of routesRaw) {
    const agencyCode = r.agency_id ? r.agency_id.trim() : operatorId;
    routeInfo[P(r.route_id)] = {
      short:       r.route_short_name || '',
      long:        r.route_long_name  || '',
      type:        parseInt(r.route_type) || 0,
      operator:    operatorId,
      agency_code: agencyCode,
    };
    routeTypeMap[r.route_id] = r.route_short_name || '';
    routeAgency[r.route_id]  = agencyCode;
  }

  const calendarRaw      = await readCSV(path.join(gtfs_dir, 'calendar.txt'));
  const calendarDatesRaw = await readCSV(path.join(gtfs_dir, 'calendar_dates.txt'));
  const windowServiceIds = activeServiceIdsInWindow(calendarRaw, calendarDatesRaw);
  const calendarIndex    = buildCalendarIndex(calendarRaw, calendarDatesRaw, operatorId);
  console.log(`    dates GTFS      : ${Object.keys(calendarIndex).length}`);

  const tripToService  = {};
  const tripToRoute    = {};
  const tripToHeadsign = {};
  await streamCSV(path.join(gtfs_dir, 'trips.txt'), (row) => {
    if (!keptRouteIds.has(row.route_id)) return false;
    if (!windowServiceIds.has(row.service_id)) return false;
    tripToService[row.trip_id]  = P(row.service_id);
    tripToRoute[row.trip_id]    = P(row.route_id);
    tripToHeadsign[row.trip_id] = row.trip_headsign || '';
    return false;
  });
  const validTripIds = new Set(Object.keys(tripToRoute));
  console.log(`    trips gardés    : ${validTripIds.size.toLocaleString()}`);

  if (!validTripIds.size) {
    console.warn(`    ⚠  Aucun trip actif dans la fenêtre`);
    return null;
  }

  const usedStopIds = new Set();
  const tripStops   = {};
  await new Promise((resolve, reject) => {
    const stFile = path.join(gtfs_dir, 'stop_times.txt');
    if (!fs.existsSync(stFile)) { console.warn('    ⚠  Manquant : stop_times.txt'); return resolve(); }
    let headers = null; let totalLines = 0;
    let iTrip = -1, iStop = -1, iSeq = -1, iDep = -1, iArr = -1;
    const rl = readline.createInterface({
      input: fs.createReadStream(stFile, { encoding: 'utf8', highWaterMark: 512*1024 }),
      crlfDelay: Infinity,
    });
    rl.on('line', (raw) => {
      const line = raw.replace(/^\uFEFF/,'').trim();
      if (!line) return;
      totalLines++;
      const cols = parseCSVLine(line);
      if (!headers) {
        headers = cols;
        iTrip = cols.indexOf('trip_id');
        iStop = cols.indexOf('stop_id');
        iSeq  = cols.indexOf('stop_sequence');
        iDep  = cols.indexOf('departure_time');
        iArr  = cols.indexOf('arrival_time');
        return;
      }
      const trip_id = cols[iTrip]?.trim();
      if (!trip_id || !validTripIds.has(trip_id)) return;
      const stop_id = cols[iStop]?.trim();
      usedStopIds.add(stop_id);
      if (!tripStops[trip_id]) tripStops[trip_id] = [];
      tripStops[trip_id].push({
        seq:      parseInt(cols[iSeq]) || 0,
        stop_id:  P(stop_id),
        dep_time: timeToSeconds(cols[iDep]?.trim()),
        arr_time: timeToSeconds(cols[iArr]?.trim()),
      });
    });
    rl.on('close', () => { console.log(`    stop_times lus  : ${totalLines.toLocaleString()}`); resolve(); });
    rl.on('error', reject);
  });

  const stopsDict = {};
  await streamCSV(path.join(gtfs_dir, 'stops.txt'), (row) => {
    if (!usedStopIds.has(row.stop_id) && row.location_type !== '1') return false;
    stopsDict[P(row.stop_id)] = {
      name:           row.stop_name || row.stop_id,
      lat:            parseFloat(row.stop_lat)  || 0,
      lon:            parseFloat(row.stop_lon)  || 0,
      operator:       operatorId,
      code:           row.stop_code ? row.stop_code.trim().toUpperCase() : undefined,
      parent_station: row.parent_station ? P(row.parent_station) : null,
    };
    return false;
  });
  console.log(`    stops gardés    : ${Object.keys(stopsDict).length.toLocaleString()}`)

  for (const [trip_id, stops] of Object.entries(tripStops)) {
    stops.sort((a, b) => a.seq - b.seq);

    const segments = [];
    let segStart = 0;
    for (let i = 1; i < stops.length; i++) {
      const prevTime = stops[i-1].dep_time ?? stops[i-1].arr_time ?? -1;
      const currTime = stops[i].arr_time   ?? stops[i].dep_time   ?? prevTime + 1;
      if (prevTime >= 0 && currTime < prevTime - 600) {
        segments.push({ stops: stops.slice(segStart, i) });
        segStart = i;
      }
    }
    segments.push({ stops: stops.slice(segStart) });

    if (segments.length > 1) {
      segments.sort((a, b) => {
        const ta = a.stops[0].dep_time ?? a.stops[0].arr_time ?? 0;
        const tb = b.stops[0].dep_time ?? b.stops[0].arr_time ?? 0;
        return ta - tb;
      });
      const mergedSegs = [segments[0].stops];
      for (let k = 1; k < segments.length; k++) {
        const lastStop  = mergedSegs[mergedSegs.length-1].slice(-1)[0];
        const firstStop = segments[k].stops[0];
        const lastTime  = lastStop.arr_time  ?? lastStop.dep_time  ?? -1;
        const firstTime = firstStop.dep_time ?? firstStop.arr_time ?? lastTime + 1;
        if (firstTime >= lastTime - 600) {
          mergedSegs[mergedSegs.length-1] = mergedSegs[mergedSegs.length-1].concat(segments[k].stops);
        } else {
          mergedSegs.push(segments[k].stops);
        }
      }
      mergedSegs.sort((a, b) => b.length - a.length);
      mergedSegs[0].sort((a, b) => (a.dep_time ?? a.arr_time ?? 0) - (b.dep_time ?? b.arr_time ?? 0));
      tripStops[trip_id] = mergedSegs[0];
    } else {
      stops.sort((a, b) => (a.dep_time ?? a.arr_time ?? 0) - (b.dep_time ?? b.arr_time ?? 0));
    }
  }

  const routesByStop = {};
  const routeStops   = {};
  const routeTrips   = {};

  for (const [trip_id, stops] of Object.entries(tripStops)) {
    const route_id   = tripToRoute[trip_id]   || P('unknown');
    const service_id = tripToService[trip_id] || '';
    const rawRouteId = route_id.replace(operatorId + ':', '');
    const routeShort = routeTypeMap[rawRouteId] || '';

    if (!routeStops[route_id] || stops.length > routeStops[route_id].length) {
      routeStops[route_id] = stops.map(s => s.stop_id);
    }
    if (!routeTrips[route_id]) routeTrips[route_id] = [];

    const rawRoute   = route_id.replace(operatorId + ':', '');
    const agencyCode = routeAgency[rawRoute] || operatorId;
    const trainType  = detectTrainType(operatorId, stops[0]?.stop_id || '', trip_id, routeShort, agencyCode);
    const firstDep   = stops.find(s => s.dep_time !== null)?.dep_time ?? Infinity;
    routeTrips[route_id].push({
      trip_id:        P(trip_id),
      service_id,
      dep_time_first: firstDep,
      train_type:     trainType,
      operator:       operatorId,
      agency_code:    agencyCode,
      stop_times:     stops,
    });

    for (const s of stops) {
      if (!routesByStop[s.stop_id]) routesByStop[s.stop_id] = new Set();
      routesByStop[s.stop_id].add(route_id);
    }
  }

  for (const rid of Object.keys(routeTrips)) {
    routeTrips[rid].sort((a, b) => a.dep_time_first - b.dep_time_first);
  }

  if (operatorId === 'UK') {
    let prunedRoutes = 0;
    for (const rid of Object.keys(routeTrips)) {
      const nStops = (routeStops[rid] || []).length;
      if (nStops < 4) {
        delete routeTrips[rid];
        delete routeStops[rid];
        delete routeInfo[rid];
        prunedRoutes++;
      }
    }
    if (prunedRoutes) console.log(`    routes <4 stops pruned : ${prunedRoutes}`);

    let prunedTrips = 0;
    const MAX_TRIPS_PER_ROUTE = 80;
    for (const rid of Object.keys(routeTrips)) {
      if (routeTrips[rid].length > MAX_TRIPS_PER_ROUTE) {
        const all = routeTrips[rid];
        const step = all.length / MAX_TRIPS_PER_ROUTE;
        const kept = Array.from({length: MAX_TRIPS_PER_ROUTE}, (_, i) => all[Math.round(i * step)]);
        prunedTrips += all.length - MAX_TRIPS_PER_ROUTE;
        routeTrips[rid] = kept;
      }
    }
    if (prunedTrips) console.log(`    trips capped (>${MAX_TRIPS_PER_ROUTE}/route) : ${prunedTrips}`);
  }

  const routesByStopSerial = {};
  for (const [stop, routes] of Object.entries(routesByStop)) {
    routesByStopSerial[stop] = [...routes];
  }

  const totalTrips = Object.values(routeTrips).reduce((s, t) => s + t.length, 0);
  console.log(`    trips RAPTOR    : ${totalTrips.toLocaleString()}`);
  console.log(`    routes RAPTOR   : ${Object.keys(routeInfo).length.toLocaleString()}`);

  return { stopsDict, routeInfo, routesByStopSerial, routeStops, routeTrips, calendarIndex };
}

// ─── Fusion multi-opérateurs ──────────────────────────────────────────────────

function mergeResults(results) {
  const merged = {
    stopsDict:     {},
    routeInfo:     {},
    routesByStop:  {},
    routeStops:    {},
    routeTrips:    {},
    calendarIndex: {},
  };

  for (const r of results) {
    if (!r) continue;
    Object.assign(merged.stopsDict,  r.stopsDict);
    Object.assign(merged.routeInfo,  r.routeInfo);
    Object.assign(merged.routeStops, r.routeStops);
    Object.assign(merged.routeTrips, r.routeTrips);

    for (const [stop, routes] of Object.entries(r.routesByStopSerial)) {
      if (!merged.routesByStop[stop]) merged.routesByStop[stop] = new Set();
      for (const rid of routes) merged.routesByStop[stop].add(rid);
    }

    for (const [date, services] of Object.entries(r.calendarIndex)) {
      if (!merged.calendarIndex[date]) {
        merged.calendarIndex[date] = services.slice();
      } else {
        for (const s of services) merged.calendarIndex[date].push(s);
      }
    }
  }

  const routesByStopSerial = {};
  for (const [stop, routes] of Object.entries(merged.routesByStop)) {
    routesByStopSerial[stop] = [...routes];
  }
  merged.routesByStop = routesByStopSerial;

  return merged;
}

// ─── Encodage dictionnaire stop_id → entier ───────────────────────────────────
// Réduit drastiquement la taille de route_trips.json en remplaçant les strings
// stop_id répétées (ex: "SNCF:StopPoint:OCETGV INOUI-87212027") par des entiers.
// Le fichier stop_id_dict.json contient le tableau inverse (idx → string).
//
// Impact mémoire sur server.js :
//   Avant : chaque stop_time = objet { stop_id: string, dep_time, arr_time }
//           overhead JS ~200 bytes/objet × millions de stop_times
//   Après : chaque stop_time = [sidIdx, depTime, arrTime] (tableau compact)
//           + un seul tableau de strings (le dictionnaire), lu une fois

function buildStopIdDict(merged) {
  // Collecter tous les stop_ids uniques utilisés dans route_trips
  const allStopIds = new Set();
  for (const trips of Object.values(merged.routeTrips)) {
    for (const trip of trips) {
      for (const st of trip.stop_times) {
        allStopIds.add(st.stop_id);
      }
    }
  }
  // Aussi les stop_ids dans routeStops
  for (const stops of Object.values(merged.routeStops)) {
    for (const sid of stops) allStopIds.add(sid);
  }

  // Tableau idx → string (le dictionnaire)
  const dict = [...allStopIds].sort();
  // Map string → idx pour l'encodage
  const dictMap = new Map(dict.map((s, i) => [s, i]));

  console.log(`  Dictionnaire stop_id : ${dict.length.toLocaleString()} entrées uniques`);
  return { dict, dictMap };
}

function encodeRouteTrips(routeTrips, dictMap) {
  // Convertit stop_times de { stop_id, dep_time, arr_time } vers [sidIdx, dep, arr]
  // arr omis si identique à dep (économie supplémentaire)
  const encoded = {};
  for (const [routeId, trips] of Object.entries(routeTrips)) {
    encoded[routeId] = trips.map(trip => ({
      trip_id:        trip.trip_id,
      service_id:     trip.service_id,
      dep_time_first: trip.dep_time_first,
      train_type:     trip.train_type,
      operator:       trip.operator,
      agency_code:    trip.agency_code,
      // stop_times encodés : [sidIdx, dep_time, arr_time?]
      // arr_time omis si null ou égal à dep_time
      st: trip.stop_times.map(s => {
        const idx = dictMap.get(s.stop_id);
        const dep = s.dep_time;
        const arr = (s.arr_time !== null && s.arr_time !== dep) ? s.arr_time : null;
        return arr !== null ? [idx, dep, arr] : [idx, dep];
      }),
    }));
  }
  return encoded;
}

function encodeRouteStops(routeStops, dictMap) {
  // Convertit routeStops de { routeId: [stopId, ...] } vers { routeId: [idx, ...] }
  const encoded = {};
  for (const [routeId, stops] of Object.entries(routeStops)) {
    encoded[routeId] = stops.map(sid => dictMap.get(sid) ?? -1);
  }
  return encoded;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  GTFS Multi-Opérateurs → RAPTOR Ingestion            ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.time('Total');

  if (!fs.existsSync(OPS_FILE)) {
    const example = [
      { "id": "SNCF",     "name": "SNCF",             "gtfs_dir": "./gtfs/sncf" },
      { "id": "TI",       "name": "Trenitalia France", "gtfs_dir": "./gtfs/trenitalia" },
      { "id": "ES",       "name": "Eurostar",          "gtfs_dir": "./gtfs/eurostar" },
      { "id": "SNCB",     "name": "SNCB Belgique",     "gtfs_dir": "./gtfs/sncb" },
      { "id": "RENFE",    "name": "Renfe Espagne",      "gtfs_dir": "./gtfs/renfe" },
      { "id": "OUIGO_ES", "name": "OUIGO España",       "gtfs_dir": "./gtfs/ouigo_es" },
      { "id": "CP",       "name": "CP Portugal",        "gtfs_dir": "./gtfs/cp" },
    ];
    fs.writeFileSync(OPS_FILE, JSON.stringify(example, null, 2));
    console.log(`\n⚠  operators.json créé. Editez-le puis relancez.`);
    process.exit(0);
  }

  const operators = JSON.parse(fs.readFileSync(OPS_FILE, 'utf8'));
  console.log(`\n${operators.length} opérateur(s) : ${operators.map(o => o.id).join(', ')}`);

  console.log('\n── Ingestion ─────────────────────────────────────────');
  const results = [];
  for (const op of operators) {
    const r = await ingestOperator(op);
    results.push(r);
  }

  console.log('\n── Fusion ────────────────────────────────────────────');
  const merged = mergeResults(results.filter(Boolean));

  console.log('\n── Transferts ────────────────────────────────────────');
  const transferIndex = buildTransferIndex(merged.stopsDict);

  console.log('\n── Encodage dictionnaire ─────────────────────────────');
  const { dict, dictMap } = buildStopIdDict(merged);
  const encodedRouteTrips = encodeRouteTrips(merged.routeTrips, dictMap);
  const encodedRouteStops = encodeRouteStops(merged.routeStops, dictMap);

  console.log('\n── Écriture ──────────────────────────────────────────');
  const writeJSON = (filename, data) => {
    const p = path.join(OUT_DIR, filename);
    fs.writeFileSync(p, JSON.stringify(data));
    const size = (fs.statSync(p).size / 1024 / 1024).toFixed(2);
    console.log(`  ✓ ${filename.padEnd(30)} ${size} MB`);
  };

  const metaSrc = path.join(__dirname, 'operators_meta.json');
  const metaDst = path.join(OUT_DIR, 'operators_meta.json');
  if (fs.existsSync(metaSrc)) {
    fs.copyFileSync(metaSrc, metaDst);
    console.log('  ✓ operators_meta.json copié');
  } else {
    console.warn('  ⚠  operators_meta.json introuvable à la racine');
  }

  writeJSON('stops.json',          merged.stopsDict);
  writeJSON('routes_info.json',    merged.routeInfo);
  writeJSON('routes_by_stop.json', merged.routesByStop);
  writeJSON('calendar_index.json', merged.calendarIndex);
  writeJSON('transfer_index.json', transferIndex);

  // ── Nouveaux fichiers optimisés ────────────────────────────────────────────
  // stop_id_dict.json   : tableau [stopId0, stopId1, ...] (idx → string)
  // route_trips.json    : stop_times encodés [sidIdx, dep, arr?] au lieu d'objets
  // route_stops.json    : tableaux d'indices entiers au lieu de strings
  writeJSON('stop_id_dict.json',   dict);
  writeJSON('route_trips.json',    encodedRouteTrips);
  writeJSON('route_stops.json',    encodedRouteStops);

  // ── Comparaison tailles ────────────────────────────────────────────────────
  for (const f of ['route_trips.json','stop_id_dict.json','route_stops.json',
                    'calendar_index.json','stops.json','transfer_index.json']) {
    const fp = path.join(OUT_DIR, f);
    if (fs.existsSync(fp)) {
      const kb = Math.round(fs.statSync(fp).size / 1024);
      console.log('  ' + f.padEnd(32) + kb.toLocaleString() + ' KB');
    }
  }

  const sortedDates = Object.keys(merged.calendarIndex).sort();
  const meta = {
    generated_at:    new Date().toISOString(),
    operators:       operators.map(o => o.id),
    total_stops:     Object.keys(merged.stopsDict).length,
    total_routes:    Object.keys(merged.routeInfo).length,
    total_trips:     Object.values(merged.routeTrips).reduce((s, t) => s + t.length, 0),
    total_transfers: Object.keys(transferIndex).length,
    stop_id_dict_size: dict.length,
    date_range: {
      first: sortedDates[0] || null,
      last:  sortedDates[sortedDates.length-1] || null,
      count: sortedDates.length,
    },
  };
  writeJSON('meta.json', meta);

  console.log('\n══ Résumé ════════════════════════════════════════════');
  console.log(`  Opérateurs    : ${meta.operators.join(', ')}`);
  console.log(`  Arrêts        : ${meta.total_stops.toLocaleString()}`);
  console.log(`  Routes        : ${meta.total_routes.toLocaleString()}`);
  console.log(`  Trips         : ${meta.total_trips.toLocaleString()}`);
  console.log(`  Transferts    : ${meta.total_transfers.toLocaleString()} arrêts`);
  console.log(`  Dict stop_id  : ${meta.stop_id_dict_size.toLocaleString()} entrées`);
  console.log(`  Dates         : ${meta.date_range.first} → ${meta.date_range.last}`);
  console.timeEnd('Total');
}

main().catch(err => { console.error('Erreur :', err); process.exit(1); });