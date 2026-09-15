# D5 Partner Desk 정식 배포 안내

## 배포 전 준비

- GitHub 비공개 저장소
- Supabase 프로젝트
- Vercel 프로젝트
- 관리자와 직원에게 개별 전달할 임시 비밀번호

공용 비밀번호나 사번과 동일한 비밀번호는 사용하지 않습니다. 지점장과 부지점장도 개인 사번 계정을 사용해야 수정자를 구분할 수 있습니다.

## 1. Supabase 구성

1. Supabase에서 새 프로젝트를 만듭니다.
2. SQL Editor에서 `supabase/schema.sql` 전체를 실행합니다.
3. Authentication 설정에서 일반 사용자의 임의 회원가입을 허용하지 않습니다.
4. Authentication > Users에서 다음 형식으로 직원을 생성합니다.
   - 이메일: `사번@d5.local`
   - 비밀번호: 개인별 임시 비밀번호
   - Auto Confirm User: 켬
5. 모든 직원 생성 후 `supabase/staff-profiles.sql`을 실행합니다.
6. Table Editor에서 `profiles`의 사번, 이름, 역할을 확인합니다.

최초 관리자 이메일은 `12784@d5.local`로 생성합니다. 비밀번호는 코드에 기록하지 말고 별도로 정합니다.

## 2. GitHub 업로드

1. GitHub에서 Private 저장소를 만듭니다.
2. 현재 프로젝트를 `main` 브랜치에 push합니다.
3. 저장소의 Actions에서 Build check가 통과하는지 확인합니다.
4. `.env.local`과 비밀번호 파일이 저장소에 포함되지 않았는지 확인합니다.

## 3. Vercel 연결

1. Vercel에서 Add New > Project를 선택합니다.
2. GitHub의 비공개 저장소를 Import합니다.
3. Framework Preset은 Vite로 설정합니다.
4. 다음 환경변수를 Production, Preview에 등록합니다.

```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_ENABLE_DEMO=false
```

5. Deploy를 실행합니다.
6. 배포 주소에서 로그인 화면이 표시되는지 확인합니다.

## 4. 운영 데이터 등록

관리자 계정으로 로그인한 다음 `신규 고객 등록`에서 고객을 한 건씩 등록합니다. 고객명은 자동으로 마스킹되고 휴대폰 번호는 뒷자리 4개만 저장됩니다. 등록 후 새로고침해 데이터가 유지되는지 확인합니다.

## 5. 권한 검사

서로 다른 계정으로 다음 항목을 확인합니다.

- 관리자: 전체 고객 조회, 신규 등록, 담당 배정
- 지점장·부지점장: 전체 고객 조회와 진행 관리
- 매니저: 본인 사번으로 배정된 고객만 조회
- 매니저: 담당 매니저 항목 변경 불가
- 로그아웃 사용자: 고객 화면 접근 불가
- 환경변수 없는 배포: 설정 필요 화면만 표시

## 6. 공개 전 보안 확인

- GitHub 저장소가 Private인지 확인
- Supabase RLS가 profiles, referrals, activity_logs에서 Enabled인지 확인
- Vercel에 service_role 키가 없는지 확인
- 비밀번호나 고객 원본 파일이 Git 기록에 없는지 확인
- Vercel Deployment Protection 또는 사내 접근 제한 적용
- 관리자 계정에 추측하기 어려운 비밀번호 사용
- Supabase 백업 및 로그 보존 정책 확인

## 운영 변경 절차

기능 수정은 별도 브랜치에서 검증한 후 `main`에 병합합니다. `main`에 병합된 버전만 Vercel Production으로 배포합니다. 문제가 발생하면 Vercel의 직전 정상 배포를 다시 활성화하고 원인을 수정합니다.
