const ROUTE_API = 'https://shade-route-api.soobin090630.workers.dev';
const DEFAULT = { lat: 35.1532, lng: 129.1186 };
const map = new kakao.maps.Map(document.querySelector('#map'), {
  center: new kakao.maps.LatLng(DEFAULT.lat, DEFAULT.lng), level: 5,
});
const places = new kakao.maps.services.Places();
const note = document.querySelector('#map-notice');
const resultBox = document.querySelector('#search-results');
let start = null, destination = null, startMarker, destinationMarker, routeLine;
let route = [], buildings = [], shadows = [];

const rad = (value) => value * Math.PI / 180;
const toLatLng = (point) => new kakao.maps.LatLng(point.lat, point.lng);
const meters = (a, b) => {
  const lat = rad((a.lat + b.lat) / 2);
  return Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos(lat));
};
const move = (p, east, north) => ({
  lat: p.lat + north / 111320,
  lng: p.lng + east / (111320 * Math.cos(rad(p.lat))),
});

function solarPosition(date = new Date()) {
  const latitude = rad(35.1532);
  const day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86400000);
  const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const declination = rad(23.44 * Math.sin(rad((360 / 365) * (day - 81))));
  const solarTime = hour + (129.1186 - 135) / 15;
  const hourAngle = rad(15 * (solarTime - 12));
  const altitude = Math.asin(Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle));
  const azimuth = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(declination) * Math.cos(latitude)) + Math.PI;
  return { altitude: Math.max(rad(3), altitude), azimuth };
}

function clearShadows() { shadows.forEach((shape) => shape.setMap(null)); shadows = []; }
function nearRoute(point) { return route.some((routePoint) => meters(point, routePoint) < 45); }
function paintShadows() {
  clearShadows();
  if (!route.length) return;
  const sun = solarPosition();
  document.querySelector('#sun-time').textContent = `태양 고도 ${(sun.altitude / Math.PI * 180).toFixed(0)}°`;
  document.querySelector('#sun-detail').textContent = '파란 반투명 영역은 경로 주변 건물의 예상 그림자입니다.';
  let shown = 0;
  buildings.forEach((building) => {
    const center = building.points.reduce((sum, p) => ({ lat: sum.lat + p.lat / building.points.length, lng: sum.lng + p.lng / building.points.length }), { lat: 0, lng: 0 });
    if (!nearRoute(center)) return;
    const length = Math.min(170, building.height / Math.tan(sun.altitude));
    const east = -length * Math.sin(sun.azimuth), north = -length * Math.cos(sun.azimuth);
    const shifted = building.points.map((p) => move(p, east, north));
    const shape = new kakao.maps.Polygon({
      path: building.points.concat(shifted.reverse()).map(toLatLng), strokeWeight: 1,
      strokeColor: '#174d72', strokeOpacity: .75, fillColor: '#174d72', fillOpacity: .52, zIndex: 4,
    });
    shape.setMap(map); shadows.push(shape); shown++;
  });
  document.querySelector('#shade-title').textContent = shown ? `경로 주변 그림자 ${shown}곳` : '경로 주변 그림자 정보 준비 중';
  document.querySelector('#shade-badge').textContent = shown ? `그늘 ${shown}` : '그늘 분석';
}

async function loadBuildings() {
  if (!route.length) return;
  // Route points are sampled so the building request stays fast even for long walks.
  const samples = route.filter((_, index) => index % Math.max(1, Math.ceil(route.length / 12)) === 0);
  const around = samples.map((p) => `way[building](around:65,${p.lat},${p.lng});`).join('');
  const query = `[out:json][timeout:10];(${around});out tags geom;`;
  note.textContent = '경로 주변 건물과 예상 그림자를 분석하고 있어요…';
  try {
    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ];
    let data;
    for (const endpoint of endpoints) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) continue;
        data = await response.json();
        break;
      } catch {
        // Try the next public Overpass endpoint when one is unavailable.
      } finally {
        clearTimeout(timeout);
      }
    }
    if (!data) throw new Error('building data unavailable');
    buildings = data.elements.filter((item) => item.geometry?.length > 2).slice(0, 160).map((item) => ({
      height: Number.parseFloat(item.tags?.height) || Number.parseFloat(item.tags?.['building:levels']) * 3.2 || 11,
      points: item.geometry.map((p) => ({ lat: p.lat, lng: p.lon })),
    }));
    note.textContent = '파란 선은 보행 경로, 반투명 파랑은 경로 주변 예상 그림자입니다.';
  } catch {
    buildings = []; note.textContent = '보행 경로는 표시했어요. 건물 높이 자료를 불러오지 못해 그림자는 잠시 표시되지 않습니다.';
  }
  paintShadows();
}

async function getWalkingRoute() {
  if (!start || !destination) return;
  routeLine?.setMap(null); clearShadows();
  note.textContent = '인도를 따라가는 보행 경로를 찾고 있어요…';
  document.querySelector('#shade-title').textContent = '보행 경로 계산 중';
  try {
    const url = `${ROUTE_API}/route?start=${start.lng},${start.lat}&end=${destination.lng},${destination.lat}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('route unavailable');
    const geojson = await response.json();
    const coordinates = geojson.features?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) throw new Error('empty route');
    route = coordinates.map(([lng, lat]) => ({ lat, lng }));
    routeLine = new kakao.maps.Polyline({ path: route.map(toLatLng), strokeWeight: 7, strokeColor: '#1676d2', strokeOpacity: 1, strokeStyle: 'solid', zIndex: 6 });
    routeLine.setMap(map);
    const bounds = new kakao.maps.LatLngBounds(); route.forEach((point) => bounds.extend(toLatLng(point))); map.setBounds(bounds);
    document.querySelector('#shade-title').textContent = '인도를 따르는 파란 경로';
    document.querySelector('#shade-description').textContent = '건물 그림자는 이 경로 주변에서만 분석해 표시합니다.';
    document.querySelector('#shade-badge').textContent = '보행 경로';
    await loadBuildings();
  } catch {
    route = []; note.textContent = '보행 경로를 찾지 못했습니다. 출발지와 도착지를 목록에서 다시 선택해 주세요.';
    document.querySelector('#shade-title').textContent = '경로를 다시 선택해 주세요';
  }
}

function selectPlace(place, kind) {
  const point = { lat: Number(place.y), lng: Number(place.x) };
  const options = { position: toLatLng(point), map, title: place.place_name };
  if (kind === 'start') { startMarker?.setMap(null); startMarker = new kakao.maps.Marker(options); start = point; }
  else { destinationMarker?.setMap(null); destinationMarker = new kakao.maps.Marker(options); destination = point; }
  map.panTo(options.position); resultBox.innerHTML = '';
  if (start && destination) getWalkingRoute();
  else note.textContent = kind === 'start' ? '이제 도착지를 검색해 선택해 주세요.' : '이제 출발지를 검색해 선택해 주세요.';
}
function showResults(data, kind) {
  resultBox.innerHTML = '';
  if (!data.length) { resultBox.innerHTML = '<li>일치하는 장소나 주소를 찾지 못했어요.</li>'; return; }
  data.slice(0, 5).forEach((place) => {
    const li = document.createElement('li'), button = document.createElement('button');
    button.innerHTML = `${place.place_name}<small>${place.road_address_name || place.address_name}</small>`;
    button.onclick = () => selectPlace(place, kind); li.append(button); resultBox.append(li);
  });
}
function search(keyword, kind) {
  if (!keyword) return; resultBox.innerHTML = '<li>장소를 검색하고 있어요…</li>';
  places.keywordSearch(keyword, (data, status) => {
    if (status === kakao.maps.services.Status.OK) { showResults(data, kind); return; }
    new kakao.maps.services.Geocoder().addressSearch(keyword, (addresses, addressStatus) => {
      showResults(addressStatus === kakao.maps.services.Status.OK ? addresses.map((item) => ({ place_name: item.address_name, road_address_name: item.road_address?.address_name, address_name: item.address_name, x: item.x, y: item.y })) : [], kind);
    });
  });
}
document.querySelector('#start-form').addEventListener('submit', (event) => { event.preventDefault(); search(document.querySelector('#start').value.trim(), 'start'); });
document.querySelector('#search-form').addEventListener('submit', (event) => { event.preventDefault(); search(document.querySelector('#destination').value.trim(), 'destination'); });
document.querySelector('#location-button').style.display = 'none';
document.querySelector('#time-button').onclick = paintShadows;
document.querySelector('#language-button').onclick = () => { document.documentElement.lang = document.documentElement.lang === 'en' ? 'ko' : 'en'; };
map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
note.textContent = '출발지와 도착지를 검색한 뒤 목록에서 정확한 장소를 선택해 주세요.';
setInterval(paintShadows, 600000);
