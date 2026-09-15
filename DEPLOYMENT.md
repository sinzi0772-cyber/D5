# D5 Partner Desk 정식 배포 안내

## 1. Firebase 준비

[FIREBASE_SETUP.md](./FIREBASE_SETUP.md)에 따라 다음을 완료합니다.

- Firebase 웹 앱 등록
- 이메일/비밀번호 로그인 활성화
- Firestore 프로덕션 데이터베이스 생성
- `firestore.rules` 게시
- 관리자 및 직원 Authentication 계정 생성

## 2. GitHub 확인

공개 저장소에는 코드만 올립니다. 다음 파일이 없는지 확인합니다.

- `.env.local`
- 고객 원본 CSV/엑셀/JSON
- 실제 고객 74건이 들어 있는 소스
- 직원 비밀번호
- Firebase 서비스 계정 JSON

## 3. Vercel 연결

1. Vercel에서 **Add New > Project**를 선택합니다.
2. GitHub의 `sinzi0772-cyber/D5` 저장소를 Import합니다.
3. Framework Preset은 **Vite**, Build Command는 `pnpm run build`, Output Directory는 `dist`로 둡니다.
4. **Environment Variables**에 Firebase 웹 앱 값을 등록합니다.

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_ENABLE_DEMO=false
```

5. 각 변수는 Production과 Preview에 적용합니다.
6. **Deploy**를 누릅니다.

## 4. 배포 후 검사

- 로그인하지 않으면 고객 화면이 보이지 않는지 확인
- 관리자 `12784` 로그인 후 신규 고객 등록 및 새로고침 유지 확인
- 매니저 계정은 본인에게 배정된 고객만 보이는지 확인
- 매니저가 고객명·제휴업체·담당자를 변경할 수 없는지 확인
- 고객명은 마스킹되고 휴대폰 번호는 뒤 4자리만 저장되는지 확인
- Firebase Firestore의 `profiles`, `referrals` 컬렉션 생성 확인

데이터 이전은 배포와 권한 검사가 끝난 뒤 관리자 화면에서 진행합니다. 원본 고객 데이터는 공개 저장소를 거치지 않습니다.
