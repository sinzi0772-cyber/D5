# D5 Partner Desk

LG전자 플래그십 D5 전용 제휴업체 소개 고객 관리 앱입니다. 고객명은 마스킹하고 휴대폰 번호는 뒷 4자리만 저장합니다.

## 운영 기능

- Firebase Authentication 로그인
- Cloud Firestore 고객 데이터 저장
- 관리자·지점장·부지점장 전체 관리
- 매니저 본인 담당 고객만 조회·진행정보 수정
- 제휴업체(BILL To Name)별 고객 관리
- 담당 배정, 매장방문 예정일, 상태, 관리메모
- Firestore Security Rules 기반 권한 통제
- 운영 환경변수 누락 시 고객 화면 차단

## 로컬 실행

```powershell
Copy-Item .env.example .env.local
pnpm install
pnpm run dev
```

Firebase 없이 UI 샘플을 확인할 때만 `.env.local`의 `VITE_ENABLE_DEMO`를 `true`로 설정합니다. 실제 배포에서는 반드시 `false`로 유지합니다.

## 정식 배포

[FIREBASE_SETUP.md](./FIREBASE_SETUP.md)와 [DEPLOYMENT.md](./DEPLOYMENT.md)를 순서대로 확인하세요.

고객 원본 파일, `.env.local`, 비밀번호, Firebase 서비스 계정 JSON은 공개 GitHub에 올리지 않습니다.
