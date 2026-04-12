// Supabase 설정
// 아래 값을 본인의 Supabase 프로젝트 값으로 교체하세요
const SUPABASE_URL = 'https://iotzkrppiykmlodqmzih.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvdHprcnBwaXlrbWxvZHFtemloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MzAzMjksImV4cCI6MjA5MDQwNjMyOX0.mFu5JpJwCYaWmcouZvNijagwSG2yAvULvz9kzMlXguU';

const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
