# ccrew-backend

CloudDuck 경매 API 서버. **서브도메인 기반**으로 동작한다.

- API: `https://api.cloudduck.cloud`
- 프론트: `https://cloudduck.cloud` (별도 오리진)

예전에는 CloudFront 한 도메인에서 `/api/*` 경로를 ALB로 넘기는 경로 기반이었다.
지금은 호스트 자체가 API를 뜻하므로 **`/api` 접두사가 없다.**

| 예전 (경로 기반)                        | 지금 (서브도메인 기반)                       |
| --------------------------------------- | -------------------------------------------- |
| `https://cloudduck.cloud/api/auth/login` | `https://api.cloudduck.cloud/auth/login`      |
| `https://cloudduck.cloud/api/auctions`   | `https://api.cloudduck.cloud/auctions`        |
| `wss://cloudduck.cloud/ws`               | `wss://api.cloudduck.cloud/ws`                |

옛 경로로 부르면 404와 함께 바꿔야 할 경로를 알려준다.

## 엔드포인트

```
GET  /health                 ALB 헬스체크 (인증·호스트 검사 없음)
GET  /ping                   배포 확인용

POST /auth/signup
POST /auth/login
GET  /auth/me

GET  /auctions               ?status=&cat=&sort=
GET  /auctions/:id
GET  /auctions/:id/related
POST /auctions               (인증)
POST /auctions/:id/bids      (인증)
GET  /auctions/:id/bids
GET  /bids/me                (인증)

GET  /me/sales | /me/purchases | /me/notifications   (인증)
GET  /admin/stats | /admin/auctions | /admin/suspicious | /admin/logs | /admin/claims  (인증)
PATCH /admin/claims/:id      (인증)

POST /uploads/presign        (인증) S3 직접 업로드용 서명 URL 발급
WS   /ws?auctionId=:id       실시간 입찰
```

## 환경변수

| 이름                | 기본값                                                          | 설명                                                                                                    |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `API_HOST`          | `api.cloudduck.cloud`                                            | 이 API가 응답할 호스트. 콤마로 여러 개 가능                                                             |
| `ENFORCE_API_HOST`  | 프로덕션이면 `true`                                              | Host 헤더 검사. ALB DNS로 직접 디버깅할 땐 `false`                                                       |
| `CORS_ORIGINS`      | `https://cloudduck.cloud,https://www.cloudduck.cloud,http://localhost:5173,http://127.0.0.1:5173` | 브라우저에서 이 API를 부를 수 있는 프론트 오리진. **스킴 포함 필수**                                     |
| `ASSET_BASE_URL`    | (없음)                                                           | 업로드 이미지를 읽는 주소 앞부분. 없으면 상대경로                                                        |
| `UPLOAD_BUCKET`     | (없음)                                                           | presign 대상 S3 버킷. 없으면 업로드 API가 503                                                            |
| `AWS_REGION`        | `ap-northeast-2`                                                 | S3 리전                                                                                                  |
| `REDIS_URL`         | (없음)                                                           | 없으면 WebSocket 브로드캐스트가 태스크 하나 안에서만 동작                                                |
| `JWT_SECRET`        | `src/authMiddleware.js` 참고                                     | 토큰 서명 키                                                                                             |
| `ADMIN_EMAIL`       | `admin@cloudduck.cloud`                                          | 데모 관리자 계정                                                                                         |
| `ADMIN_PASSWORD`    | `admin1234`                                                      | 데모 관리자 비밀번호                                                                                     |
| `PORT`              | `3000`                                                           | 리슨 포트                                                                                                |

### 호스트가 갈라지면서 새로 필요해진 것

1. **CORS** — 경로 기반일 땐 같은 출처라 필요 없었다. 이제 필수.
2. **WebSocket Origin 검사** — WS 핸드셰이크에는 CORS가 적용되지 않아 직접 검사한다 (`src/realtime.js`).
3. **S3 버킷 CORS** — 브라우저가 프론트 도메인에서 S3로 직접 PUT 하므로 버킷 CORS에 `https://cloudduck.cloud` 의 `PUT` 허용이 필요하다.

## 로컬 실행

```bash
npm install
node server.js          # http://localhost:3000, 호스트 검사 꺼짐
```

프론트는 `npm run dev` 로 5173에서 띄우면 기본 `CORS_ORIGINS` 에 이미 들어있어 그대로 붙는다.
