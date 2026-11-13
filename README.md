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

## 판매 RAW 기준

- 일시불은 BEST의 `판매주문 상세현황 조회` 엑셀을 사용합니다.
- 일시불 RAW 배송요청일은 `LGE배송요청일` 열을 사용합니다. 수기 배송예정일과 별도로 표시합니다.
- 구독은 BEST의 `케어솔루션 케어_판매조회` 엑셀을 사용합니다.
- 엑셀을 내려받은 날짜와 관계없이 주문일자로 판매월을 구분합니다. 판매경로 1·2는 각 주문 원본에서 확인합니다.
- 구독 RAW의 `BEST고객번호`가 연결 고객에게 한 번호로 확인되면 직원 화면의 이름 아래에 표시합니다.
- 예상 수수료는 일시불 `매출`과 구독 `마감됨` 행을 기준으로 계산합니다. 원본 상태를 확인할 수 없는 금액은 보류합니다.
- 구매일은 원본 판매일을 우선 표시합니다. 확인된 판매확정일이나 주문일자를 쓰는 경우 날짜 옆에 원본 항목명을 표시합니다.

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
