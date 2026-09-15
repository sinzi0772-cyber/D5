# Firebase 설정 안내

## 1. 프로젝트와 웹 앱 만들기

1. [Firebase Console](https://console.firebase.google.com/)에서 **프로젝트 추가**를 누릅니다.
2. 프로젝트 이름은 예를 들어 `d5-partner-desk`로 정합니다.
3. 프로젝트 개요에서 **웹 앱(</>) 추가**를 누르고 앱을 등록합니다.
4. 표시되는 `firebaseConfig` 값을 보관합니다. 이것은 Vercel 환경변수에 사용합니다.

## 2. 로그인 기능 켜기

1. **빌드 > Authentication > 시작하기**로 이동합니다.
2. **Sign-in method**에서 **이메일/비밀번호**를 사용 설정합니다.
3. **Users > Add user**에서 직원을 생성합니다.
4. 이메일은 `사번@d5.local` 형식으로 입력합니다.
   - 관리자: `12784@d5.local`
   - 지점장·부지점장 공용 관리번호: `1292@d5.local`
   - 매니저 예: `19447@d5.local`
5. 계정마다 서로 다른 임시 비밀번호를 지정합니다.

사번과 동일한 비밀번호는 추측하기 쉬우므로 운영에서는 사용하지 않습니다. 비밀번호는 코드와 GitHub에 기록하지 않습니다.

## 3. Firestore 만들기

1. **빌드 > Firestore Database > 데이터베이스 만들기**를 누릅니다.
2. **프로덕션 모드**를 선택합니다.
3. 위치는 사용자와 가까운 아시아 리전을 선택합니다. 생성 후 위치를 바꾸기 어렵습니다.
4. **Rules** 탭에서 이 저장소의 `firestore.rules` 전체를 붙여넣고 **게시**합니다.

## 4. 최초 관리자 만들기

1. 앱 배포 후 `12784`와 위에서 정한 관리자 비밀번호로 처음 로그인합니다.
2. 앱이 `profiles` 컬렉션에 관리자 프로필을 자동 생성합니다.
3. Firestore 데이터 화면에서 해당 문서의 `role`이 `admin`인지 확인합니다.

관리번호 `1292`는 첫 로그인 때 `store_manager`로, 일반 직원은 `manager`로 자동 생성됩니다. 추후 개인별 지점장·부지점장 계정을 운영할 경우 관리자가 Firestore 프로필의 `role`을 각각 `store_manager`, `assistant_manager`로 변경할 수 있습니다.

## 5. 중요 보안 원칙

- 공개 GitHub에는 앱 코드만 올립니다.
- 고객 원본 74건과 비밀번호는 올리지 않습니다.
- Firebase 서비스 계정 JSON과 Admin SDK 비밀키는 브라우저 앱이나 Vercel의 `VITE_` 변수에 넣지 않습니다.
- `firebaseConfig` 값은 웹 앱 식별 정보이며, 실제 데이터 보호는 `firestore.rules`와 Authentication이 담당합니다.
