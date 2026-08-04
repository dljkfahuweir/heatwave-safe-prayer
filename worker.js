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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/route') return new Response('Not found', { status: 404, headers: cors(origin) });
    const start = url.searchParams.get('start');
    const end = url.searchParams.get('end');
    if (!start || !end || !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(start) || !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(end)) return new Response('Invalid coordinates', { status: 400, headers: cors(origin) });
    const upstream = await fetch(`https://api.openrouteservice.org/v2/directions/foot-walking?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, { headers: { Authorization: env.ORS_API_KEY, Accept: 'application/geo+json' } });
    return new Response(upstream.body, { status: upstream.status, headers: { ...cors(origin), 'Content-Type': upstream.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'public, max-age=600' } });
  },
};
