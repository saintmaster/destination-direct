// Destination Direct — NAT Tracks Netlify Function
//
// SOURCE: https://nms.aim.faa.gov/datanat/nat.json
// Found via browser DevTools Network tab on the public NMS NAT page
// (https://nms.aim.faa.gov/nat). This is a plain public JSON file served
// by Express — NO OAuth/Bearer token required, no rate-limit dance.
// Status 304/200, Cache-Control: private, max-age=30.
//
// We don't yet know the exact JSON shape, so this function:
//   1. Fetches the JSON directly.
//   2. Tries a few reasonable parse strategies (structured track objects,
//      OR a raw text blob containing "NAT-#/# TRACKS" — same regex parser
//      we built earlier for the AIXM NOTAM text).
//   3. ALWAYS includes a truncated raw dump in debug so we can see the
//      actual shape and refine the parser if the first guess is wrong.

const https = require('https');

const NAT_HOST = 'nms.aim.faa.gov';
const NAT_PATH = '/datanat/nat.json';

// ─── Simple HTTPS GET, no auth ────────────────────────────────────────────
function httpGet(hostname, path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, path, method: 'GET',
      headers: { 'Accept': 'application/json, text/plain, */*' }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: buffer.toString('utf8') });
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// ─── Regex parser for raw NAT-#/# TRACKS text blobs (proven earlier) ────────
function parseNATTracksFromText(blob) {
  const tracks = [];
  let tmi = '';

  const tmiM = blob.match(/TMI\s+IS\s+(\d{3})/i) || blob.match(/\bTMI[:\s]+(\d{3})\b/i);
  if (tmiM) tmi = tmiM[1];

  const natHeaders = (blob.match(/NAT-\d+\/\d+\s+TRACKS/gi) || []).length;

  const lines = blob.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    const trackM = line.match(/^([A-Z])\s+([A-Z]{3,5}(?:\s+(?:\d{2,4}(?:30)?\/\d{2,3}|[A-Z]{3,5}))+)/);
    if (!trackM) continue;

    const letter    = trackM[1];
    const routeStr  = trackM[2];
    const waypoints = [];

    const wptPat = /\b([A-Z]{3,5})\b|\b(\d{4})\/(\d{2,3})\b|\b(\d{2})\/(\d{2,3})\b/g;
    let wm;
    while ((wm = wptPat.exec(routeStr)) !== null) {
      if (wm[2]) {
        const lat = parseInt(wm[2].slice(0, 2)) + parseInt(wm[2].slice(2, 4)) / 60;
        const lon = -parseInt(wm[3]);
        const latD = Math.floor(lat);
        const latM = Math.round((lat - latD) * 60);
        const name = latD + (latM ? latM.toString().padStart(2,'0') : '') + 'N' + Math.abs(lon).toString().padStart(3, '0') + 'W';
        waypoints.push({ name, lat, lon });
      } else if (wm[4]) {
        const lat = parseInt(wm[4]);
        const lon = -parseInt(wm[5]);
        waypoints.push({ name: lat + 'N' + Math.abs(lon).toString().padStart(3, '0') + 'W', lat, lon });
      } else if (wm[1]) {
        const skip = /^(EAST|WEST|LVLS|NIL|EUR|RTS|NAR|PART|TRACKS|TRACK|REMARKS|END|FLS|INCLUSIVE|PBCS|OTS)$/.test(wm[1]);
        if (!skip) waypoints.push({ name: wm[1], lat: null, lon: null });
      }
    }

    let eastLvls = [], westLvls = [];
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const ll  = lines[j].trim();
      const em  = ll.match(/EAST\s+LVLS?\s+([\d\s]+)/i);
      const wm2 = ll.match(/WEST\s+LVLS?\s+([\d\s]+)/i);
      if (em)  eastLvls = em[1].trim().split(/\s+/).map(Number).filter(n => n > 100 && n < 500);
      if (wm2) westLvls = wm2[1].trim().split(/\s+/).map(Number).filter(n => n > 100 && n < 500);
      if (ll.match(/^[A-Z]\s+[A-Z]{3}/)) break;
    }

    if (waypoints.length >= 2) {
      const isEast = eastLvls.length > 0 && westLvls.length === 0;
      tracks.push({
        letter, waypoints,
        direction:  isEast ? 'east' : 'west',
        eastLevels: eastLvls,
        westLevels: westLvls,
        entry:      waypoints[0].name,
        exit:       waypoints[waypoints.length - 1].name,
        tmi
      });
    }
  }

  return { tracks, tmi, natHeaders };
}

// ─── Attempt to parse a structured JSON track object into our format ───────
// Tries common field name variants since we don't know the exact schema yet.
function tryParseStructuredTrack(t) {
  const letter = t.identifier || t.id || t.track || t.letter || t.name || '?';
  let waypoints = [];

  const routeSrc = t.route || t.waypoints || t.points || t.fixes || t.coordinates;
  if (Array.isArray(routeSrc)) {
    waypoints = routeSrc.map(w => {
      if (typeof w === 'string') return { name: w, lat: null, lon: null };
      const name = w.name || w.identifier || w.fix || w.id || '';
      const lat  = w.lat != null ? parseFloat(w.lat) : (w.latitude != null ? parseFloat(w.latitude) : null);
      const lon  = w.lon != null ? parseFloat(w.lon) : (w.longitude != null ? parseFloat(w.longitude) : null);
      return { name: String(name), lat, lon };
    }).filter(w => w.name || (w.lat != null && w.lon != null));
  }

  if (waypoints.length < 2) return null;

  const dirRaw = (t.direction || t.dir || '').toString().toUpperCase();
  const direction = dirRaw.startsWith('E') ? 'east' : dirRaw.startsWith('W') ? 'west' : 'west';

  const levels = t.levels || t.flightLevels || t.fls || [];
  const eastLevels = direction === 'east' ? levels : [];
  const westLevels = direction === 'west' ? levels : [];

  return {
    letter: String(letter).toUpperCase(),
    waypoints,
    direction,
    eastLevels, westLevels,
    entry: waypoints[0].name,
    exit:  waypoints[waypoints.length - 1].name,
    tmi:   t.tmi ? String(t.tmi) : ''
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────
exports.handler = async function(event, context) {
  const headers = {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control':               'no-cache'
  };

  try {
    const res = await httpGet(NAT_HOST, NAT_PATH);

    if (res.status !== 200 && res.status !== 304) {
      return { statusCode: 200, headers,
        body: JSON.stringify({ error: 'HTTP ' + res.status, tracks: [], tmi: '',
          debug: { raw_body_snippet: res.body.substring(0, 500) } }) };
    }

    let json = null;
    let parseError = null;
    try { json = JSON.parse(res.body); } catch (e) { parseError = e.message; }

    let tracks = [];
    let tmi = '';
    let natHeaders = 0;
    let strategy = 'none';

    if (json) {
      // Strategy A: top-level array of structured track objects
      const arr = Array.isArray(json) ? json
        : Array.isArray(json.tracks) ? json.tracks
        : Array.isArray(json.data) ? json.data
        : null;

      if (arr && arr.length > 0) {
        const parsed = arr.map(tryParseStructuredTrack).filter(Boolean);
        if (parsed.length > 0) {
          tracks = parsed;
          tmi = parsed[0].tmi || '';
          strategy = 'structured';
        }
      }

      // Strategy B: a text/string field containing "NAT-#/# TRACKS" raw text
      if (tracks.length === 0) {
        const textCandidates = [];
        const collectStrings = (obj, depth) => {
          if (depth > 3 || obj == null) return;
          if (typeof obj === 'string') {
            if (/NAT/i.test(obj) && /TRACK/i.test(obj)) textCandidates.push(obj);
          } else if (Array.isArray(obj)) {
            obj.forEach(v => collectStrings(v, depth + 1));
          } else if (typeof obj === 'object') {
            Object.values(obj).forEach(v => collectStrings(v, depth + 1));
          }
        };
        collectStrings(json, 0);
        if (textCandidates.length > 0) {
          const blob = textCandidates.join('\n');
          const r = parseNATTracksFromText(blob);
          tracks = r.tracks;
          tmi = r.tmi;
          natHeaders = r.natHeaders;
          strategy = 'text-regex';
        }
      }
    } else {
      // Not JSON at all — try regex directly on raw body
      const r = parseNATTracksFromText(res.body);
      tracks = r.tracks;
      tmi = r.tmi;
      natHeaders = r.natHeaders;
      strategy = 'raw-text-regex';
    }

    return { statusCode: 200, headers,
      body: JSON.stringify({
        tracks, tmi, validFrom: '', validTo: '',
        raw: NAT_HOST + NAT_PATH,
        debug: {
          source: 'https://' + NAT_HOST + NAT_PATH,
          http_status: res.status,
          parse_error: parseError,
          strategy: strategy,
          nat_headers: natHeaders,
          tracks_parsed: tracks.length,
          json_top_level_type: json ? (Array.isArray(json) ? 'array' : typeof json) : 'not-json',
          json_top_level_keys: (json && !Array.isArray(json) && typeof json === 'object') ? Object.keys(json) : null,
          raw_snippet: res.body.substring(0, 3000)
        }
      })
    };

  } catch (err) {
    return { statusCode: 200, headers,
      body: JSON.stringify({ error: err.message, tracks: [], tmi: '',
        debug: { error_detail: err.message } }) };
  }
};
