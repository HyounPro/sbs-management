import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.20.9';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { fileName, rawData } = await req.json();

    // ── Supabase 클라이언트 (서비스 롤) ──────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Claude 클라이언트 ─────────────────────────────────
    const anthropic = new Anthropic({
      apiKey: Deno.env.get('CLAUDE_API_KEY')!,
    });

    // ── 시간표 유형 판별 ──────────────────────────────────
    const sheetName: string = rawData.sheetName || '';
    const scheduleType = detectScheduleType(sheetName);

    // ── Claude에게 파싱 요청 ──────────────────────────────
    const prompt = buildPrompt(rawData.rows, sheetName);

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = (message.content[0] as { text: string }).text;

    // ── JSON 파싱 ─────────────────────────────────────────
    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) ||
                      responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Claude 응답에서 JSON을 찾을 수 없습니다.');
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const classes: ClassData[] = JSON.parse(jsonStr);

    // ── 기존 데이터 삭제 후 삽입 ─────────────────────────
    await supabase.from('classes').delete().eq('schedule_type', scheduleType);

    const rows = classes.map(c => ({
      schedule_type: scheduleType,
      room: c.room,
      room_slot: c.room_slot,
      subject: c.subject,
      days: c.days,
      start_date: c.start_date,
      end_date: c.end_date,
      start_time: c.start_time,
      end_time: c.end_time,
      face_to_face: c.face_to_face || '대면',
      notes: c.notes || '-',
    }));

    const { error } = await supabase.from('classes').insert(rows);
    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, count: rows.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

// ── 시간표 유형 판별 ──────────────────────────────────────
function detectScheduleType(sheetName: string): string {
  const s = sheetName;
  if (s.includes('4월') && s.includes('평일')) return 'weekday_apr';
  if (s.includes('4월') && s.includes('주말')) return 'weekend_apr';
  if (s.includes('3월') && s.includes('평일')) return 'weekday_mar';
  if (s.includes('3월') && s.includes('주말')) return 'weekend_mar';
  if (s.includes('평일')) return 'weekday_apr';
  if (s.includes('주말')) return 'weekend_apr';
  return 'weekday_apr';
}

// ── Claude 프롬프트 ───────────────────────────────────────
function buildPrompt(rows: unknown[][], sheetName: string): string {
  // 빈 행 제거 후 텍스트 변환
  const tableText = rows
    .filter(row => row.some(cell => cell !== null && cell !== undefined && cell !== ''))
    .map(row => row.map(cell => {
      if (cell instanceof Date) return cell.toISOString().split('T')[0];
      return cell === null || cell === undefined ? '' : String(cell);
    }).join('\t'))
    .join('\n');

  return `아래는 SBS아카데미안산 학원의 시간표 엑셀 데이터입니다. (시트명: ${sheetName})

엑셀 구조 설명:
- 1행: 강의실 슬롯 (A-1, A-2, B-1, B-2, C-1, C-2, D-1, D-2, D-3, E-1, E-2, E-3, F-1, F-2, F-3, G-1, G-2, H-1, H-2)
- 각 시간 블록마다: 과목명, 요일패턴, 개강일(개:YYYY-MM-DD), 종강일(종:YYYY-MM-DD) 포함
- 시간 블록: 09:00, 11:00, 14:00, 16:00, 18:00, 19:00 등
- 각 블록의 수업시간은 시작시간 기준 2시간 (예: 09:00~11:00)
- 요일패턴: 월~목, 월수금월수, 화목화목금 등

데이터:
${tableText}

위 데이터에서 실제 수업이 있는 항목만 추출하여 JSON 배열로 반환하세요.
조건:
- 과목명이 있고 개강일/종강일이 있는 항목만 포함
- "수업없음", null, 빈값 항목 제외
- 세미나/특강도 포함
- 요일패턴을 사람이 읽기 쉽게 변환 (월수금월수 → 월·수·금, 화목화목금 → 화·목·금, 월~목 → 월~목)
- 개강일/종강일: MM.DD 형식으로 변환 (예: 2026-04-13 → 04.13)
- 시작시간에서 end_time 계산 (시작+2시간, 단 14:00시작→16:00, 16:00시작→18:00, 18:00시작→20:00, 19:00시작→21:00)

반환 형식 (JSON만 반환, 다른 텍스트 없이):
\`\`\`json
[
  {
    "room_slot": "A-1",
    "room": "A",
    "subject": "일러스트",
    "days": "월~목",
    "start_date": "04.13",
    "end_date": "05.11",
    "start_time": "09:00",
    "end_time": "11:00",
    "face_to_face": "대면",
    "notes": "-"
  }
]
\`\`\``;
}

interface ClassData {
  room_slot: string;
  room: string;
  subject: string;
  days: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  face_to_face?: string;
  notes?: string;
}
