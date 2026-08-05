if (location.protocol === 'file:') location.replace('https://dljkfahuweir.github.io/heatwave-safe-prayer/');

const ROUTE_API = 'https://shade-route-api.soobin090630.workers.dev';
const DEFAULT = { lat: 35.1532, lng: 129.1186 };
const map = new kakao.maps.Map(document.querySelector('#map'), { center: new kakao.maps.LatLng(DEFAULT.lat, DEFAULT.lng), level: 5 });
const places = new kakao.maps.services.Places();
const note = document.querySelector('#map-notice');
const resultBox = document.querySelector('#search-results');
const candidateBox = document.querySelector('#route-candidates');
const controlSheet = document.querySelector('.control-sheet');
const sheetHandle = document.querySelector('.sheet-handle');
const appShell = document.querySelector('.app');
const savedRouteBox = document.querySelector('#saved-routes');
const reportForm = document.querySelector('#shade-report-form');
const reportStatus = document.querySelector('#report-status');
const reportType = document.querySelector('#report-type');
const customReportInput = document.querySelector('#report-custom-type');
let start, destination, startMarker, destinationMarker, routeLine, startLabel = '', destinationLabel = '';
let route = [], buildings = [], shadows = [], facilityMarkers = [], candidates = [], selectedCandidate = 0, activeFacilityInfo = null;

const rad = (n) => n * Math.PI / 180;
const toLatLng = (p) => new kakao.maps.LatLng(p.lat, p.lng);
const labeledPin = (color, label) => 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="52" viewBox="0 0 48 52"><rect x="2" y="1" width="44" height="17" rx="8.5" fill="${color}"/><text x="24" y="13" text-anchor="middle" fill="white" font-size="10" font-family="Arial,sans-serif" font-weight="700">${label}</text><path fill="${color}" stroke="white" stroke-width="1.5" d="M24 18.5a10.5 10.5 0 0 0-10.5 10.5C13.5 36.8 24 50 24 50s10.5-13.2 10.5-21A10.5 10.5 0 0 0 24 18.5z"/><circle cx="24" cy="29" r="3.3" fill="white"/></svg>`);
const startPinImage = new kakao.maps.MarkerImage(labeledPin('#1676d2', '출발'), new kakao.maps.Size(48, 52), { offset: new kakao.maps.Point(24, 52) });
const destinationPinImage = new kakao.maps.MarkerImage(labeledPin('#e74747', '목적'), new kakao.maps.Size(48, 52), { offset: new kakao.maps.Point(24, 52) });
const meters = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos(rad((a.lat + b.lat) / 2)));
const routeLength = (points) => points.slice(1).reduce((sum, p, i) => sum + meters(points[i], p), 0);
const move = (p, east, north) => ({ lat: p.lat + north / 111320, lng: p.lng + east / (111320 * Math.cos(rad(p.lat))) });
const nearRoute = (point, distance = 55) => route.some((p) => meters(point, p) < distance);

function solarPosition(date = new Date()) {
  const latitude = rad(DEFAULT.lat);
  const day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86400000);
  const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const declination = rad(23.44 * Math.sin(rad((360 / 365) * (day - 81))));
  const hourAngle = rad(15 * (hour + (DEFAULT.lng - 135) / 15 - 12));
  const actualAltitude = Math.asin(Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle));
  const azimuth = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(declination)) + Math.PI;
  return { actualAltitude, altitude: Math.max(rad(3), actualAltitude), azimuth };
}

function updateSunStatus() {
  const sun = solarPosition();
  const degrees = (sun.actualAltitude / Math.PI * 180).toFixed(1);
  document.querySelector('#sun-time').textContent = sun.actualAltitude > 0 ? `현재 태양 고도 ${degrees}°` : `현재 일몰 후 (${degrees}°)`;
  document.querySelector('#sun-detail').textContent = `실시간 갱신 · ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
}

function clearShadows() { shadows.forEach((shape) => shape.setMap(null)); shadows = []; }
function clearFacilities() {
  facilityMarkers.forEach(({ marker, info }) => { marker.setMap(null); info.close(); });
  facilityMarkers = []; activeFacilityInfo = null;
}

function reportMissingShade(point) {
  const location = `지도에서 선택한 예상 그늘 (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`;
  switchPage('report');
  document.querySelector('#report-location').value = location;
  reportType.value = '그늘로 표시됐지만 햇빛이 강함';
  updateCustomReportField();
  reportType.focus();
}

function paintShadows() {
  clearShadows();
  if (!route.length) return 0;
  const sun = solarPosition();
  let shown = 0;
  buildings.forEach((building) => {
    const center = building.points.reduce((sum, p) => ({ lat: sum.lat + p.lat / building.points.length, lng: sum.lng + p.lng / building.points.length }), { lat: 0, lng: 0 });
    if (!nearRoute(center)) return;
    const length = Math.min(170, building.height / Math.tan(sun.altitude));
    const shifted = building.points.map((p) => move(p, -length * Math.sin(sun.azimuth), -length * Math.cos(sun.azimuth)));
    const shape = new kakao.maps.Polygon({ path: building.points.concat(shifted.reverse()).map(toLatLng), strokeWeight: 1, strokeColor: '#174d72', strokeOpacity: .75, fillColor: '#174d72', fillOpacity: .52, zIndex: 4, clickable: true });
    shape.setMap(map); shadows.push(shape); shown++;
    kakao.maps.event.addListener(shape, 'click', () => reportMissingShade(center));
  });
  document.querySelector('#shade-badge').textContent = shown ? `그늘 ${shown}` : '그늘 분석';
  return shown;
}

function shadePercent(points) {
  if (!buildings.length) return 0;
  const sheltered = points.filter((p) => buildings.some((b) => nearRoute({ lat: p.lat, lng: p.lng }, 38))).length;
  return Math.min(95, Math.max(8, Math.round((sheltered / points.length) * 100)));
}

function renderCandidates() {
  candidateBox.innerHTML = '';
  candidates.forEach((candidate, index) => {
    const button = document.createElement('button');
    const minutes = Math.max(1, Math.round(candidate.distance / 78));
    const shade = shadePercent(candidate.points);
    const character = index === 0 ? '추천 · 큰길 위주' : index === 1 ? '골목길 포함 · 주의' : '시설 접근 우선';
    button.className = `route-option${index === selectedCandidate ? ' selected' : ''}`;
    button.innerHTML = `<strong>그늘길 후보 ${index + 1}</strong><span>${minutes}분 · 그늘 약 ${shade}%</span><small>${character}</small>`;
    button.onclick = () => selectCandidate(index);
    candidateBox.append(button);
  });
}

function selectCandidate(index) {
  selectedCandidate = index;
  route = candidates[index].points;
  routeLine?.setMap(null);
  routeLine = new kakao.maps.Polyline({ path: route.map(toLatLng), strokeWeight: 7, strokeColor: '#1676d2', strokeOpacity: 1, strokeStyle: 'solid', zIndex: 6 });
  routeLine.setMap(map);
  const bounds = new kakao.maps.LatLngBounds(); route.forEach((p) => bounds.extend(toLatLng(p))); map.setBounds(bounds);
  renderCandidates();
  updateSaveRouteButton();
  loadBuildings();
  loadFacilities();
}

async function loadBuildings() {
  if (!route.length) return;
  note.textContent = '경로 주변 건물 높이와 그늘을 분석하고 있어요.';
  const samples = route.filter((_, i) => i % Math.max(1, Math.ceil(route.length / 8)) === 0);
  try {
    const points = samples.map((p) => `${p.lng},${p.lat}`).join(';');
    const response = await fetch(`${ROUTE_API}/buildings?points=${encodeURIComponent(points)}`);
    if (!response.ok) throw new Error('building data unavailable');
    const data = await response.json();
    buildings = data.elements.filter((item) => item.geometry?.length > 2).slice(0, 160).map((item) => ({ height: Number.parseFloat(item.tags?.height) || Number.parseFloat(item.tags?.['building:levels']) * 3.2 || 11, points: item.geometry.map((p) => ({ lat: p.lat, lng: p.lon })) }));
    const shown = paintShadows();
    note.textContent = shown ? `경로 주변 건물 ${shown}곳의 예상 그림자를 표시했어요.` : '경로 주변에 분석 가능한 건물 그림자가 적어요.';
    renderCandidates();
  } catch {
    buildings = []; paintShadows(); note.textContent = '건물 높이 자료를 잠시 불러오지 못했어요. 경로와 대피 시설은 계속 볼 수 있어요.';
  }
}

const coolingPin = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="25" viewBox="0 0 20 25"><path fill="#e74747" stroke="#fff" stroke-width="1.5" d="M10 1.2a7.4 7.4 0 0 0-7.4 7.4C2.6 14.2 10 23.8 10 23.8s7.4-9.6 7.4-15.2A7.4 7.4 0 0 0 10 1.2z"/><circle cx="10" cy="8.6" r="2.5" fill="#fff"/></svg>');
const coolingPinImage = new kakao.maps.MarkerImage(coolingPin, new kakao.maps.Size(20, 25), { offset: new kakao.maps.Point(10, 25) });
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

function facilityMarker(place) {
  const marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(Number(place.y), Number(place.x)), map, title: place.place_name, image: coolingPinImage });
  const info = new kakao.maps.InfoWindow({ content: `<div style="padding:7px;font-size:12px;max-width:180px"><b>더위 대피</b><br>${place.place_name}</div>` });
  const phone = place.phone || '전화번호 정보 없음';
  const hours = place.hours || '운영시간은 해당 시설에 확인';
  const placeLink = place.place_url ? `<a href="${escapeHtml(place.place_url)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:5px;color:#1676d2">지도에서 상세 확인</a>` : '';
  info.setContent(`<div style="padding:9px 10px;font-size:12px;line-height:1.55;max-width:210px"><strong>${escapeHtml(place.place_name)}</strong><br>운영시간: ${escapeHtml(hours)}<br>전화번호: ${escapeHtml(phone)}${placeLink}</div>`);
  kakao.maps.event.addListener(marker, 'click', () => {
    if (activeFacilityInfo === info) { info.close(); activeFacilityInfo = null; return; }
    activeFacilityInfo?.close(); info.open(map, marker); activeFacilityInfo = info;
  });
  facilityMarkers.push({ marker, info });
}

async function loadFacilities() {
  if (!route.length) return;
  clearFacilities();
  const anchors = route.filter((_, i) => i % Math.max(1, Math.ceil(route.length / 4)) === 0);
  const terms = ['편의점', '은행', '무더위쉼터', '주민센터', '백화점'];
  const searches = anchors.flatMap((point) => terms.map((term) => new Promise((resolve) => places.keywordSearch(term, (data, status) => resolve(status === kakao.maps.services.Status.OK ? data : []), { location: toLatLng(point), radius: 650, size: 5 }))));
  const results = (await Promise.all(searches)).flat();
  const unique = new Map();
  results.filter((place) => nearRoute({ lat: Number(place.y), lng: Number(place.x) }, 180)).forEach((place) => unique.set(`${place.x},${place.y}`, place));
  [...unique.values()].slice(0, 12).forEach(facilityMarker);
}

async function getWalkingRoute() {
  if (!start || !destination) return;
  note.textContent = '그늘길 후보를 찾고 있어요.';
  try {
    const response = await fetch(`${ROUTE_API}/route?start=${start.lng},${start.lat}&end=${destination.lng},${destination.lat}`);
    if (!response.ok) throw new Error();
    const geojson = await response.json();
    const features = geojson.features?.filter((feature) => feature.geometry?.coordinates?.length > 1) || [];
    if (!features.length) throw new Error();
    candidates = features.slice(0, 4).map((feature) => { const points = feature.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })); return { points, distance: feature.properties?.summary?.distance || routeLength(points) }; });
    selectedCandidate = 0; renderCandidates(); selectCandidate(0);
  } catch { note.textContent = '보행 경로를 찾지 못했어요. 장소를 다시 선택해 주세요.'; }
}

const storageKey = () => 'sunSafeSavedRoutes';
const reportStorageKey = () => 'sunSafeShadeReports';
if (!localStorage.getItem(storageKey()) && localStorage.getItem('sunSafeSavedRoutes:guest')) localStorage.setItem(storageKey(), localStorage.getItem('sunSafeSavedRoutes:guest'));
const savedRoutes = () => JSON.parse(localStorage.getItem(storageKey()) || '[]');
const setSavedRoutes = (items) => localStorage.setItem(storageKey(), JSON.stringify(items));
const saveRouteButton = Object.assign(document.createElement('button'), { id: 'save-route', type: 'button', textContent: '★ 이 경로 저장' });
saveRouteButton.className = 'save-route-button';
document.querySelector('.route-card').after(saveRouteButton);

function updateSaveRouteButton() { saveRouteButton.disabled = !route.length || !start || !destination; }
function renderSavedRoutes() {
  const items = savedRoutes();
  savedRouteBox.innerHTML = '';
  if (!items.length) { savedRouteBox.innerHTML = '<div class="empty-state">아직 저장한 경로가 없어요.<br>홈 화면에서 경로를 찾은 뒤 저장해 보세요.</div>'; return; }
  items.forEach((item) => {
    const card = document.createElement('article'); card.className = 'saved-route';
    card.innerHTML = `<strong>${escapeHtml(item.startLabel)} → ${escapeHtml(item.destinationLabel)}</strong><small>${item.minutes}분 · 저장일 ${item.savedAt}</small><div class="saved-route-actions"><button type="button">길찾기</button><button type="button" class="delete-route">삭제</button></div>`;
    const [useButton, deleteButton] = card.querySelectorAll('button');
    useButton.onclick = () => { start = item.start; destination = item.destination; startLabel = item.startLabel; destinationLabel = item.destinationLabel; switchPage('home'); getWalkingRoute(); };
    deleteButton.onclick = () => { setSavedRoutes(savedRoutes().filter((routeItem) => routeItem.id !== item.id)); renderSavedRoutes(); };
    savedRouteBox.append(card);
  });
}
function saveCurrentRoute() {
  if (!route.length || !start || !destination) return;
  const item = { id: String(Date.now()), start, destination, startLabel: startLabel || '출발지', destinationLabel: destinationLabel || '도착지', minutes: Math.max(1, Math.round(routeLength(route) / 78)), savedAt: new Date().toLocaleDateString('ko-KR') };
  const items = savedRoutes();
  if (!items.some((saved) => saved.startLabel === item.startLabel && saved.destinationLabel === item.destinationLabel)) setSavedRoutes([item, ...items].slice(0, 20));
  saveRouteButton.textContent = '저장 완료 ✓'; setTimeout(() => { saveRouteButton.textContent = '★ 이 경로 저장'; }, 1400);
}
function switchPage(page) {
  appShell.classList.remove('page-home', 'page-saved', 'page-report'); appShell.classList.add(`page-${page}`);
  document.querySelectorAll('.page-nav button').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  if (page === 'saved') renderSavedRoutes();
  if (page === 'report') document.querySelector('#report-location').value = destinationLabel || '';
  if (page === 'home') setTimeout(() => map.relayout(), 250);
}

function selectPlace(place, kind) {
  const point = { lat: Number(place.y), lng: Number(place.x) };
  const options = { position: toLatLng(point), map, title: place.place_name };
  if (kind === 'start') { startMarker?.setMap(null); startMarker = new kakao.maps.Marker({ ...options, image: startPinImage }); start = point; startLabel = place.place_name; }
  else { destinationMarker?.setMap(null); destinationMarker = new kakao.maps.Marker({ ...options, image: destinationPinImage }); destination = point; destinationLabel = place.place_name; }
  map.panTo(options.position); resultBox.innerHTML = ''; if (start && destination) getWalkingRoute(); else note.textContent = '이제 다른 장소도 검색해 선택해 주세요.';
}
function showResults(data, kind) { resultBox.innerHTML = ''; if (!data.length) { resultBox.innerHTML = '<li>장소를 찾지 못했어요.</li>'; return; } data.slice(0, 5).forEach((place) => { const li = document.createElement('li'); const button = document.createElement('button'); button.innerHTML = `${place.place_name}<small>${place.road_address_name || place.address_name}</small>`; button.onclick = () => selectPlace(place, kind); li.append(button); resultBox.append(li); }); }
function search(keyword, kind) { if (!keyword) return; places.keywordSearch(keyword, (data, status) => { if (status === kakao.maps.services.Status.OK) return showResults(data, kind); new kakao.maps.services.Geocoder().addressSearch(keyword, (addresses, addressStatus) => showResults(addressStatus === kakao.maps.services.Status.OK ? addresses.map((item) => ({ place_name: item.address_name, road_address_name: item.road_address?.address_name, address_name: item.address_name, x: item.x, y: item.y })) : [], kind)); }); }

document.querySelector('#start-form').addEventListener('submit', (event) => { event.preventDefault(); search(document.querySelector('#start').value.trim(), 'start'); });
document.querySelector('#search-form').addEventListener('submit', (event) => { event.preventDefault(); search(document.querySelector('#destination').value.trim(), 'destination'); });
document.querySelector('#location-button').style.display = 'none';
document.querySelector('#time-button').onclick = () => { updateSunStatus(); paintShadows(); };
saveRouteButton.onclick = saveCurrentRoute;
document.querySelectorAll('.page-nav button').forEach((button) => button.addEventListener('click', () => switchPage(button.dataset.page)));
function updateCustomReportField() {
  const isCustom = reportType.value === '직접 입력';
  reportType.hidden = isCustom;
  customReportInput.hidden = !isCustom;
  customReportInput.required = isCustom;
  if (isCustom) customReportInput.focus();
}
reportType.addEventListener('change', updateCustomReportField);
customReportInput.addEventListener('blur', () => { if (!customReportInput.value.trim()) { reportType.hidden = false; customReportInput.hidden = true; reportType.value = '그늘로 표시됐지만 햇빛이 강함'; } });
reportForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const reports = JSON.parse(localStorage.getItem(reportStorageKey()) || '[]');
  reports.unshift({ location: document.querySelector('#report-location').value.trim(), type: reportType.hidden ? customReportInput.value.trim() : reportType.value, reportedAt: new Date().toLocaleString('ko-KR') });
  localStorage.setItem(reportStorageKey(), JSON.stringify(reports.slice(0, 30)));
  reportForm.reset(); updateCustomReportField(); reportStatus.textContent = '신고가 이 기기에 저장됐어요. 다음 데이터 업데이트에 참고할 수 있습니다.';
});
let sheetDragStart = null, ignoreSheetClick = false;
sheetHandle.addEventListener('pointerdown', (event) => {
  sheetDragStart = event.clientY;
  sheetHandle.setPointerCapture(event.pointerId);
});
sheetHandle.addEventListener('pointerup', (event) => {
  if (sheetDragStart === null) return;
  const distance = event.clientY - sheetDragStart;
  if (distance > 36) { controlSheet.classList.add('is-stowed'); ignoreSheetClick = true; }
  else if (distance < -36) { controlSheet.classList.remove('is-stowed'); ignoreSheetClick = true; }
  sheetDragStart = null;
});
sheetHandle.addEventListener('pointercancel', () => { sheetDragStart = null; });
sheetHandle.addEventListener('click', () => {
  if (ignoreSheetClick) { ignoreSheetClick = false; return; }
  controlSheet.classList.toggle('is-stowed');
});
map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
updateCustomReportField(); switchPage('home'); updateSaveRouteButton();
updateSunStatus(); setInterval(updateSunStatus, 60000); setInterval(() => { updateSunStatus(); paintShadows(); }, 600000);
