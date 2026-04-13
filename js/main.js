// ── 상태 ────────────────────────────────────────────────
let allClasses = [];
let filtered = [];
let activeTab = 'weekday';
let activeRoom = '전체';
let searchQuery = '';
let multiSelectMode = false;
let selectedIds = new Set();
let messageTemplate = '';

const DISCORD_LINKS = {
  'A': 'https://discord.gg/UbPVxWgcct',
  'B': 'https://discord.gg/VBaPncjxXe',
  'C': 'https://discord.gg/2WcQwuzvxy',
  'D': 'https://discord.gg/bHxVuv3AxS',
  'E': 'https://discord.gg/AsV8M6P79c',
  'F': 'https://discord.gg/cEDxpq6aVS',
  'G': 'https://discord.gg/KrHJzzErWt',
  'H': 'https://discord.gg/7x4cFMtgcnw',
  'ART': '',
  '게임A': '',
  '게임D': '',
};

const DEFAULT_TEMPLATE =
`격일시간표 등 공지사항 필수확인
▶ sbs-ansan-notice.co.kr

■ SBS아카데미안산 개강안내 ■

· 수강과목 : {subject}({days})
· 개강일 : {start_date}
· 종강일 : {end_date}
· 수강시간 : {start_time}~{end_time}
· 강의실 : 3층 {room}강의장
· 비대면링크 : {discord_link}
· 대면/비대면 : {face_to_face}
· 특이사항 : {notes}

학원 소식을 인스타 팔로우 후 확인해보세요 :D
▶ instagram.com/sbsacademy_ansan

★ 개강안내 확인 후 답변 부탁 드립니다!`;

// ── 초기화 ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadTemplate(), loadClasses()]);
  bindEvents();
});

async function loadTemplate() {
  const { data } = await sbClient
    .from('settings')
    .select('value')
    .eq('key', 'message_template')
    .single();
  messageTemplate = data?.value || DEFAULT_TEMPLATE;
}

async function loadClasses() {
  const { data, error } = await sbClient
    .from('classes')
    .select('*')
    .order('room', { ascending: true })
    .order('room_slot', { ascending: true });

  if (error) { console.error('데이터 로드 실패:', error); return; }

  allClasses = data || [];
  buildRoomFilters();
  applyFilters();
}

// ── 강의실 필터 동적 생성 ────────────────────────────────
function buildRoomFilters() {
  const rooms = [...new Set(
    allClasses
      .filter(c => c.schedule_type === activeTab)
      .map(c => c.room)
  )].sort();

  const bar = document.getElementById('filterBar');
  bar.innerHTML = `<button class="filter-btn ${activeRoom === '전체' ? 'active' : ''}" data-room="전체">전체</button>`;

  rooms.forEach(room => {
    const btn = document.createElement('button');
    btn.className = `filter-btn${activeRoom === room ? ' active' : ''}`;
    btn.dataset.room = room;
    btn.textContent = `${room}강의장`;
    bar.appendChild(btn);
  });

  bar.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeRoom = btn.dataset.room;
      applyFilters();
    });
  });
}

// ── 이벤트 바인딩 ────────────────────────────────────────
function bindEvents() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      activeRoom = '전체';
      buildRoomFilters();
      applyFilters();
    });
  });

  document.getElementById('searchInput').addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    applyFilters();
  });

  document.getElementById('multiSelectBtn').addEventListener('click', () => {
    multiSelectMode = !multiSelectMode;
    document.getElementById('multiSelectBtn').classList.toggle('active', multiSelectMode);
    if (!multiSelectMode) clearSelection();
  });

  document.getElementById('copyAllBtn').addEventListener('click', () => {
    const texts = filtered.map(c => buildMessage(c));
    copyToClipboard(texts.join('\n\n────────────────────\n\n'));
    showToast('전체 복사 완료!');
  });

  document.getElementById('copySelectedBtn').addEventListener('click', () => {
    const texts = filtered.filter(c => selectedIds.has(c.id)).map(c => buildMessage(c));
    copyToClipboard(texts.join('\n\n────────────────────\n\n'));
    showToast(`${texts.length}개 복사 완료!`);
  });

  document.getElementById('clearSelectBtn').addEventListener('click', clearSelection);
}

// ── 필터 적용 ────────────────────────────────────────────
function applyFilters() {
  filtered = allClasses.filter(c => {
    const tabMatch = c.schedule_type === activeTab;
    const roomMatch = activeRoom === '전체' || c.room === activeRoom;
    const searchMatch = !searchQuery || c.subject.toLowerCase().includes(searchQuery.toLowerCase());
    return tabMatch && roomMatch && searchMatch;
  });
  render();
}

// ── 렌더링 ───────────────────────────────────────────────
function render() {
  const grid = document.getElementById('cardGrid');
  document.getElementById('totalCount').textContent = filtered.length;

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty" style="grid-column:1/-1;">
        <div class="empty-icon">📭</div>
        <div>해당하는 개강안내가 없습니다</div>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map(c => `
    <div class="card ${selectedIds.has(c.id) ? 'selected' : ''}"
         data-id="${c.id}"
         onclick="handleCardClick('${c.id}')">
      <div class="card-header">
        <div class="card-subject">${c.subject}</div>
        <div class="card-room">${c.room}강의장</div>
      </div>
      <div class="card-days">${c.days || '-'}</div>
      <div class="card-info">
        <div class="info-row">
          <span class="info-label">개강일</span>
          <span class="info-value">${c.start_date || '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">종강일</span>
          <span class="info-value">${c.end_date || '-'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">수강시간</span>
          <span class="info-value">${c.start_time}~${c.end_time}</span>
        </div>
        <div class="info-row">
          <span class="info-label">강의실</span>
          <span class="info-value">3층 ${c.room}강의장</span>
        </div>
      </div>
      <button class="copy-btn" onclick="event.stopPropagation(); copyCard('${c.id}', this)">
        복사하기
      </button>
    </div>
  `).join('');
}

// ── 카드 클릭 ────────────────────────────────────────────
function handleCardClick(id) {
  if (!multiSelectMode) return;
  selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
  updateSelectBar();
  render();
}

function clearSelection() {
  selectedIds.clear();
  updateSelectBar();
  render();
}

function updateSelectBar() {
  document.getElementById('selectCount').textContent = selectedIds.size;
  document.getElementById('selectBar').classList.toggle('visible', selectedIds.size > 0);
}

// ── 복사 ────────────────────────────────────────────────
function copyCard(id, btn) {
  const cls = allClasses.find(c => c.id === id);
  if (!cls) return;
  copyToClipboard(buildMessage(cls));
  btn.textContent = '복사됨 ✓';
  btn.classList.add('copied');
  setTimeout(() => { btn.textContent = '복사하기'; btn.classList.remove('copied'); }, 2000);
}

function buildMessage(c) {
  const discordLink = DISCORD_LINKS[c.room] || '-';
  return messageTemplate
    .replace('{subject}', c.subject || '-')
    .replace('{days}', c.days || '-')
    .replace('{start_date}', c.start_date || '-')
    .replace('{end_date}', c.end_date || '-')
    .replace('{start_time}', c.start_time || '-')
    .replace('{end_time}', c.end_time || '-')
    .replace('{room}', c.room || '-')
    .replace('{discord_link}', discordLink)
    .replace('{face_to_face}', c.face_to_face || '대면')
    .replace('{notes}', c.notes || '-');
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#f5c400;color:#111;padding:10px 20px;border-radius:8px;font-weight:700;z-index:999;font-size:14px;';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}
