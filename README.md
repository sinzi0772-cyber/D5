# D5 Partner Desk

LG전자 플래그십 D5 전용 제휴업체 소개 고객 관리 앱입니다. 고객명은 마스킹하고 휴대폰 번호는 뒷 4자리만 저장합니다.

## 운영 기능

- Supabase Auth 로그인과 사용자 역할
- 관리자·지점장·부지점장 전체 관리
- 매니저 본인 담당 고객만 조회·수정
- 제휴업체(BILL To Name)별 고객 관리
- 담당 배정, 매장방문 예정일, 상태, 관리메모
- Supabase RLS와 고객 변경 이력
- 운영 환경변수 누락 시 고객 화면 차단

## 로컬 실행

```powershell
Copy-Item .env.example .env.local
pnpm install
pnpm run dev
```

로컬에서 Supabase 없이 UI 샘플을 확인하려면 `.env.local`의 `VITE_ENABLE_DEMO`를 `true`로 설정합니다. 실제 배포에서는 반드시 `false`로 유지합니다.

## 정식 배포

상세한 순서는 [DEPLOYMENT.md](./DEPLOYMENT.md)를 확인하세요.

1. Supabase 프로젝트에서 `supabase/schema.sql` 실행
2. Authentication에서 직원 계정 생성
3. `supabase/staff-profiles.sql` 실행해 역할 연결
4. GitHub 비공개 저장소에 push
5. Vercel에 저장소 연결
6. Vercel 환경변수에 Supabase URL과 anon key 등록
7. Production 배포 후 권한별 로그인 검사

`service_role` 키와 직원 비밀번호는 저장소 또는 `VITE_` 환경변수에 넣지 않습니다.
