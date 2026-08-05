const allowedOrigins = new Set([
  'https://dljkfahuweir.github.io',
  'https://sunghonim.github.io',
  'http://localhost:5173',
]);

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://dljkfahuweir.github.io',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function json(body, status, origin, cacheControl = 'no-store') {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json', 'Cache-Control': cacheControl } });
}

async function loadBuildings(points) {
  const around = points.map(({ lat, lng }) => `way[building](around:50,${lat},${lng});`).join('');
  const query = `[out:json][timeout:15];(${around});out tags geom;`;
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];
  return Promise.any(endpoints.map(async (endpoint) => {
    const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, { headers: { 'User-Agent': 'Heatwave-Safe-Walk/1.0' } });
    if (!response.ok) throw new Error(`Overpass ${response.status}`);
    return response.json();
  }));
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    const url = new URL(request.url);
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors(origin) });

    if (url.pathname === '/buildings') {
      const rawPoints = url.searchParams.get('points') || '';
      const points = rawPoints.split(';').map((value) => {
        const [lng, lat] = value.split(',').map(Number);
        return { lat, lng };
      }).filter(({ lat, lng }) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180).slice(0, 10);
      if (!points.length) return json({ error: 'Invalid points' }, 400, origin);

      const cache = caches.default;
      const cached = await cache.match(request);
      if (cached) return new Response(cached.body, { status: cached.status, headers: { ...Object.fromEntries(cached.headers), ...cors(origin) } });
      try {
        const data = await loadBuildings(points);
        const response = json(data, 200, origin, 'public, max-age=600');
        ctx.waitUntil(cache.put(request, response.clone()));
        return response;
      } catch {
        return json({ error: 'Building data temporarily unavailable' }, 503, origin);
      }
    }

    if (url.pathname !== '/route') return new Response('Not found', { status: 404, headers: cors(origin) });
    const start = url.searchParams.get('start');
    const end = url.searchParams.get('end');
    const coordinate = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;
    if (!start || !end || !coordinate.test(start) || !coordinate.test(end)) return new Response('Invalid coordinates', { status: 400, headers: cors(origin) });
    const [startLng, startLat] = start.split(',').map(Number);
    const [endLng, endLat] = end.split(',').map(Number);
    const upstream = await fetch('https://api.openrouteservice.org/v2/directions/foot-walking/geojson', {
      method: 'POST',
      headers: { Authorization: env.ORS_API_KEY, Accept: 'application/geo+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: [[startLng, startLat], [endLng, endLat]], alternative_routes: { target_count: 3, weight_factor: 1.4, share_factor: 0.6 } }),
    });
    return new Response(upstream.body, { status: upstream.status, headers: { ...cors(origin), 'Content-Type': upstream.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'public, max-age=600' } });
  },
};
