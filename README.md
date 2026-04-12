# SBS아카데미안산 개강안내 관리 시스템

## 설정 방법

### 1. Supabase 설정

**DB 테이블 생성** (Supabase SQL Editor에서 실행):
```sql
CREATE TABLE classes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_type TEXT NOT NULL,
  room TEXT NOT NULL,
  room_slot TEXT,
  subject TEXT NOT NULL,
  days TEXT,
  start_date TEXT,
  end_date TEXT,
  start_time TEXT,
  end_time TEXT,
  face_to_face TEXT DEFAULT '대면',
  notes TEXT DEFAULT '-',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 공개 읽기 허용
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "공개 읽기" ON classes FOR SELECT USING (true);
CREATE POLICY "관리자 쓰기" ON classes FOR ALL USING (auth.role() = 'authenticated');
```

### 2. js/config.js 수정
```js
const SUPABASE_URL = 'https://xxxx.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';
```

### 3. Supabase Edge Function 배포
```bash
supabase functions deploy process-schedule
supabase secrets set CLAUDE_API_KEY=your-claude-api-key
```

### 4. 관리자 계정 생성
Supabase → Authentication → Users → Add User

### 5. GitHub Pages 설정
Repository Settings → Pages → Branch: main
