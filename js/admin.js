// ── 상태 ────────────────────────────────────────────────
let uploadedFiles = [];

// ── 초기화 ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await sbClient.auth.getSession();
  if (session) showAdmin();
  else showLogin();

  bindLoginEvents();
  bindAdminEvents();
});

// ── 로그인 ───────────────────────────────────────────────
function showLogin() {
  document.getElementById('loginWrap').style.display = 'flex';
  document.getElementById('adminWrap').style.display = 'none';
}

function showAdmin() {
  document.getElementById('loginWrap').style.display = 'none';
  document.getElementById('adminWrap').style.display = 'block';
  loadStats();
}

function bindLoginEvents() {
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('loginPw').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pw = document.getElementById('loginPw').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';

  if (!email || !pw) { errEl.textContent = '이메일과 비밀번호를 입력하세요.'; return; }

  const { error } = await sbClient.auth.signInWithPassword({ email, password: pw });
  if (error) {
    errEl.textContent = '이메일 또는 비밀번호가 올바르지 않습니다.';
    return;
  }
  showAdmin();
}

// ── 관리자 이벤트 ─────────────────────────────────────────
function bindAdminEvents() {
  // 로그아웃
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await sbClient.auth.signOut();
    showLogin();
  });

  // 파일 업로드 영역
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');

  uploadArea.addEventListener('click', () => fileInput.click());
  uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag'));
  uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('drag');
    handleFiles(Array.from(e.dataTransfer.files));
  });

  fileInput.addEventListener('change', e => {
    handleFiles(Array.from(e.target.files));
    fileInput.value = '';
  });

  // 처리 버튼
  document.getElementById('processBtn').addEventListener('click', processFiles);

  // 초기화 버튼
  document.getElementById('clearDataBtn').addEventListener('click', async () => {
    if (!confirm('모든 개강안내 데이터를 삭제하시겠습니까?')) return;
    const { error } = await sbClient.from('classes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) { addLog('데이터 초기화 실패: ' + error.message, 'err'); return; }
    addLog('데이터 초기화 완료', 'ok');
    loadStats();
  });
}

// ── 파일 처리 ────────────────────────────────────────────
function handleFiles(files) {
  const xlsxFiles = files.filter(f => f.name.endsWith('.xlsx'));
  if (xlsxFiles.length === 0) {
    addLog('xlsx 파일만 업로드 가능합니다.', 'err');
    return;
  }

  xlsxFiles.forEach(f => {
    if (!uploadedFiles.find(u => u.name === f.name)) {
      uploadedFiles.push(f);
    }
  });

  renderFileList();
  document.getElementById('processBtn').disabled = uploadedFiles.length === 0;
}

function renderFileList() {
  const list = document.getElementById('fileList');
  list.innerHTML = uploadedFiles.map((f, i) => `
    <div class="file-item">
      <span class="file-name">📄 ${f.name}</span>
      <button class="file-remove" onclick="removeFile(${i})">✕</button>
    </div>
  `).join('');
}

function removeFile(idx) {
  uploadedFiles.splice(idx, 1);
  renderFileList();
  document.getElementById('processBtn').disabled = uploadedFiles.length === 0;
}

// ── 메인 처리 ────────────────────────────────────────────
async function processFiles() {
  if (uploadedFiles.length === 0) return;

  const btn = document.getElementById('processBtn');
  btn.disabled = true;
  btn.textContent = '처리 중...';
  clearLog();

  try {
    for (const file of uploadedFiles) {
      addLog(`📂 ${file.name} 파싱 중...`, 'info');

      // 1. SheetJS로 Excel 파싱
      const rawData = await parseExcel(file);
      addLog(`✅ 엑셀 파싱 완료 — ${rawData.length}개 행`, 'ok');

      // 2. Supabase Edge Function 호출 (Claude AI 처리)
      addLog('✨ Claude AI 분석 중...', 'info');
      const { data, error } = await sbClient.functions.invoke('process-schedule', {
        body: {
          fileName: file.name,
          rawData: rawData,
        },
      });

      if (error) {
        addLog(`❌ AI 처리 실패: ${error.message}`, 'err');
        continue;
      }

      addLog(`✅ ${data.count}개 개강안내 생성 완료`, 'ok');
    }

    addLog('🎉 모든 처리 완료!', 'ok');
    loadStats();
    uploadedFiles = [];
    renderFileList();
  } catch (e) {
    addLog('❌ 오류: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Claude AI로 개강안내 생성';
  }
}

// ── Excel 파싱 (SheetJS) ──────────────────────────────────
function parseExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
        resolve({ sheetName, rows: json });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ── 통계 로드 ────────────────────────────────────────────
async function loadStats() {
  const tabs = [
    { key: 'weekday_apr', label: '4월 평일반' },
    { key: 'weekend_apr', label: '4월 주말반' },
    { key: 'weekday_mar', label: '3월 평일반' },
    { key: 'weekend_mar', label: '3월 주말반' },
  ];

  const grid = document.getElementById('statsGrid');
  grid.innerHTML = '<span style="color:#666; font-size:13px;">로딩 중...</span>';

  const counts = await Promise.all(
    tabs.map(t => sbClient.from('classes').select('id', { count: 'exact', head: true }).eq('schedule_type', t.key))
  );

  grid.innerHTML = tabs.map((t, i) => `
    <div style="background:#1a1a1a; border:1px solid #2a2a2a; border-radius:8px; padding:14px; text-align:center;">
      <div style="font-size:22px; font-weight:800; color:#f5c400;">${counts[i].count || 0}</div>
      <div style="font-size:12px; color:#888; margin-top:4px;">${t.label}</div>
    </div>
  `).join('');
}

// ── 로그 ────────────────────────────────────────────────
function addLog(msg, type = 'info') {
  const box = document.getElementById('logBox');
  const line = document.createElement('div');
  line.className = type === 'ok' ? 'log-ok' : type === 'err' ? 'log-err' : 'log-info';
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

function clearLog() {
  document.getElementById('logBox').innerHTML = '';
}
