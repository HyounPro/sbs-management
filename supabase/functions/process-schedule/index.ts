import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { fileName, rawData } = await req.json();
    if (!rawData?.rows) throw new Error('rawData.rows 없음');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const scheduleType = detectScheduleType(rawData.sheetName || fileName || '');
    const classes = parseExcel(rawData.rows);

    if (classes.length === 0) throw new Error('파싱된 수업 데이터가 없습니다. 파일명에 평일/주말이 포함되어야 합니다.');

    // 기존 데이터 삭제 후 삽입
    await supabase.from('classes').delete().eq('schedule_type', scheduleType);
    const { error } = await supabase.from('classes').insert(
      classes.map(c => ({ ...c, schedule_type: scheduleType }))
    );
    if (error) throw new Error('DB 저장 오류: ' + error.message);

    return new Response(
      JSON.stringify({ success: true, count: classes.length, scheduleType }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

// ── 시간표 유형 판별 ──────────────────────────────────────
function detectScheduleType(name: string): string {
  if (name.includes('주말')) return 'weekend';
  return 'weekday';
}

// ── 엑셀 파서 (A열 시간 기반) ────────────────────────────
interface ClassRow {
  room_slot: string;
  room: string;
  subject: string;
  days: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  face_to_face: string;
  notes: string;
}

function parseExcel(rows: unknown[][]): ClassRow[] {
  if (rows.length < 2) return [];

  // 1행: 강의실 헤더 (A-1, A-2, B-1 ...)
  const headers: string[] = (rows[0] as string[]).map(h => h ? String(h).trim() : '');

  const results: ClassRow[] = [];

  // 열별 진행 중인 수업
  const pending = new Map<number, Partial<ClassRow>>();
  let lastTime = '';

  for (let ri = 1; ri < rows.length; ri++) {
    const row = rows[ri] as unknown[];
    const colA = row[0];
    const timeStr = extractTime(colA);

    // A열 시간 업데이트
    if (timeStr) lastTime = timeStr;

    // 각 열 처리
    for (let ci = 1; ci < row.length; ci++) {
      const cell = row[ci];
      if (cell === null || cell === undefined) continue;
      const val = String(cell).trim();
      if (!val) continue;

      const roomSlot = headers[ci] || '';
      if (!roomSlot || roomSlot === '정원') continue;
      const room = extractRoom(roomSlot);

      if (val.startsWith('개:')) {
        const p = pending.get(ci);
        if (p && !p.start_date) p.start_date = fmtDate(val.slice(2).trim());

      } else if (val.startsWith('종:')) {
        const p = pending.get(ci);
        if (p) {
          p.end_date = fmtDate(val.slice(2).trim());
          if (p.subject && p.start_date && p.end_date) {
            results.push(p as ClassRow);
          }
          pending.delete(ci);
        }

      } else if (isDays(val)) {
        const p = pending.get(ci);
        if (p && !p.days) p.days = fmtDays(val);

      } else if (!isMeta(val)) {
        // 과목명 — 현재 진행 중인 수업이 없을 때만 새 수업 시작
        if (!pending.has(ci) && lastTime) {
          pending.set(ci, {
            room_slot: roomSlot,
            room,
            subject: val,
            start_time: lastTime,
            end_time: addTwoHours(lastTime),
            days: '',
            start_date: '',
            end_date: '',
            face_to_face: '대면',
            notes: '-',
          });
        }
      }
    }
  }

  return results;
}

// ── 헬퍼 ─────────────────────────────────────────────────

// 강의실 슬롯에서 강의실명 추출: "A-1"→"A", "ART-1"→"ART", "게임A-2"→"게임A"
function extractRoom(roomSlot: string): string {
  const m = roomSlot.match(/^(.+)-\d+$/);
  return m ? m[1] : roomSlot;
}

// A열 시간 추출: "TIME:09:00" → "09:00"
function extractTime(val: unknown): string {
  if (typeof val === 'string' && val.startsWith('TIME:')) return val.slice(5);
  return '';
}

// 메타데이터 여부
function isMeta(val: string): boolean {
  if (val.startsWith('전체출석율')) return true;
  if (val === '수업없음') return true;
  if (val.startsWith('정원')) return true;
  if (val.startsWith('배정:')) return true;
  if (val.includes('[ 재:')) return true;
  if (val.startsWith('개:') || val.startsWith('종:')) return true;
  if (/^\d[\d\s\(\)WR%,]+$/.test(val)) return true;
  return false;
}

// 요일 패턴 여부
function isDays(val: string): boolean {
  const known = ['월~목', '월~금', '월수금월수', '화목화목금', '월수금', '화목', '금', '토', '토일', '수/목/금', '월/수/금'];
  if (known.includes(val)) return true;
  if (/^[월화수목금토일~·\/\s]{2,}$/.test(val)) return true;
  return false;
}

// 요일 포맷
function fmtDays(val: string): string {
  const map: Record<string, string> = {
    '월수금월수': '월·수·금',
    '화목화목금': '화·목·금',
    '월~목': '월~목',
    '월~금': '월~금',
    '월수금': '월·수·금',
    '화목': '화·목',
    '금': '금',
    '토': '토',
    '토일': '토·일',
    '수/목/금': '수·목·금',
    '월/수/금': '월·수·금',
  };
  return map[val] || val;
}

// 날짜 포맷: "2026-04-13" → "04.13"
function fmtDate(raw: string): string {
  const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[2]}.${m[3]}`;
  return raw;
}

// +2시간
function addTwoHours(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${String(h + 2).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
