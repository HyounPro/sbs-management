import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { fileName, rawData } = body;

    if (!rawData || !rawData.rows) {
      throw new Error('rawData 또는 rows가 없습니다.');
    }

    // ── Supabase 클라이언트 ───────────────────────────────
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── 시간표 유형 판별 ──────────────────────────────────
    const sheetName: string = rawData.sheetName || fileName || '';
    const scheduleType = detectScheduleType(sheetName);

    // ── 엑셀 데이터 → 텍스트 변환 ────────────────────────
    const tableText = convertRowsToText(rawData.rows);

    // ── Claude API 직접 호출 (fetch) ──────────────────────
    const claudeApiKey = Deno.env.get('CLAUDE_API_KEY')!;
    const prompt = buildPrompt(tableText, sheetName);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API 오류: ${claudeRes.status} - ${errText}`);
    }

    const claudeData = await claudeRes.json();
    const responseText: string = claudeData.content[0].text;

    // ── JSON 파싱 ─────────────────────────────────────────
    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) ||
                      responseText.match(/(\[[\s\S]*\])/);
    if (!jsonMatch) {
      throw new Error(`Claude 응답에서 JSON을 찾지 못했습니다. 응답: ${responseText.slice(0, 200)}`);
    }

    const jsonStr = jsonMatch[1];
    const classes = JSON.parse(jsonStr);

    if (!Array.isArray(classes) || classes.length === 0) {
      throw new Error('파싱된 수업 데이터가 없습니다.');
    }

    // ── 기존 데이터 삭제 후 삽입 ─────────────────────────
    await supabase.from('classes').delete().eq('schedule_type', scheduleType);

    const rows = classes.map((c: ClassData) => ({
      schedule_type: scheduleType,
      room: c.room || '',
      room_slot: c.room_slot || '',
      subject: c.subject || '',
      days: c.days || '',
      start_date: c.start_date || '',
      end_date: c.end_date || '',
      start_time: c.start_time || '',
      end_time: c.end_time || '',
      face_to_face: c.face_to_face || '대면',
      notes: c.notes || '-',
    }));

    const { error: insertError } = await supabase.from('classes').insert(rows);
    if (insertError) throw new Error(`DB 저장 오류: ${insertError.message}`);

    return new Response(
      JSON.stringify({ success: true, count: rows.length, scheduleType }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err) {
    console.error('process-schedule 오류:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

// ── 시간표 유형 판별 ──────────────────────────────────────
function detectScheduleType(name: string): string {
  if (name.includes('4월') && name.includes('주말')) return 'weekend_apr';
  if (name.includes('4월')) return 'weekday_apr';
  if (name.includes('3월') && name.includes('주말')) return 'weekend_mar';
  if (name.includes('3월')) return 'weekday_mar';
  if (name.includes('주말')) return 'weekend_apr';
  return 'weekday_apr';
}

// ── 엑셀 행 → 텍스트 ─────────────────────────────────────
function convertRowsToText(rows: unknown[][]): string {
  return rows
    .filter((row: unknown[]) => row.some(cell => cell !== null && cell !== undefined && cell !== ''))
    .map((row: unknown[]) =>
      row.map(cell => {
        if (cell === null || cell === undefined) return '';
        if (typeof cell === 'object' && 'toISOString' in (cell as object)) {
          return (cell as Date).toISOString().split('T')[0];
        }
        return String(cell);
      }).join('\t')
    )
    .join('\n');
}

// ── Claude 프롬프트 ───────────────────────────────────────
function buildPrompt(tableText: string, sheetName: string): string {
  return `아래는 SBS아카데미안산 학원의 시간표 엑셀 데이터입니다. (시트명: ${sheetName})

엑셀 구조 설명:
- 1행: 강의실 슬롯 헤더 (A-1, A-2, B-1, B-2, C-1 ... H-2)
- 각 열이 하나의 강의실 슬롯을 나타냄
- 각 시간 블록마다 (약 10행): 과목명, 요일패턴, 개강일(개:YYYY-MM-DD), 종강일(종:YYYY-MM-DD) 포함
- 수업 시작시간 블록: 09:00, 11:00, 14:00, 16:00, 18:00, 19:00 등
- 각 수업의 수강시간은 시작시간 기준 2시간 (09:00→11:00, 11:00→13:00, 14:00→16:00, 19:00→21:00)

데이터:
${tableText}

위 데이터에서 실제 수업이 있는 항목을 추출하여 JSON 배열로 반환하세요.

조건:
- 과목명, 개강일(개:), 종강일(종:)이 모두 있는 항목만 포함
- "수업없음", null, 빈값 항목 제외
- 세미나/특강도 포함
- 요일: 월수금월수→월·수·금, 화목화목금→화·목·금, 월~목→월~목 으로 변환
- 날짜: 2026-04-13 → 04.13 형식으로 변환
- end_time: start_time + 2시간

JSON만 반환 (다른 텍스트 없이):
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
