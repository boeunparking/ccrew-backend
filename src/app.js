import express from 'express';
import cors from 'cors';
import os from 'os';

import authRoutes from './routes/authRoutes.js';
import auctionRoutes from './routes/auctionRoutes.js';
import bidRoutes from './routes/bidRoutes.js';
import meRoutes from './routes/meRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';

import { API_HOSTS, ALLOWED_ORIGINS, ENFORCE_API_HOST, isAllowedHost, isAllowedOrigin } from './config.js';

export const state = { ready: false };

export function createApp() {
  const app = express();

  // ALB 뒤에 있으므로 X-Forwarded-For / X-Forwarded-Host를 신뢰한다.
  // req.hostname이 ALB가 아닌 브라우저가 요청한 호스트를 가리키게 하려면 필수.
  app.set('trust proxy', true);

  // 프론트(cloudduck.cloud)와 API(api.cloudduck.cloud)는 이제 서로 다른 출처다.
  // 경로 기반일 때는 같은 출처라 CORS가 필요 없었지만, 서브도메인으로 갈라진
  // 지금은 CORS가 없으면 브라우저가 모든 요청을 막는다.
  app.use(
    cors({
      origin(origin, cb) {
        // Origin 헤더가 없는 요청(서버 간 호출, curl, 헬스체크)은 그대로 통과
        if (!origin) return cb(null, true);
        // 허용 목록에 없으면 CORS 헤더를 붙이지 않는다 → 브라우저가 차단한다.
        // 여기서 에러를 던지면 500이 나가므로 false만 돌려준다.
        cb(null, isAllowedOrigin(origin));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400, // 프리플라이트를 하루 캐시해서 왕복을 줄인다
    })
  );

  // 캐시(CloudFront 등)가 Origin별 응답을 섞지 않게 한다
  app.use((_req, res, next) => {
    res.vary('Origin');
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  // --- ALB 헬스체크 대상. 인증도, 호스트 검사도 걸지 말 것 ---
  // 헬스체크는 Host 헤더에 태스크 IP가 들어오므로 반드시 호스트 검사보다 위에 있어야 한다.
  app.get('/health', (_req, res) => {
    if (!state.ready) return res.status(503).send('warming');
    res.status(200).send('ok');
  });

  // --- 서브도메인 검사 ---
  // api.cloudduck.cloud로 들어온 요청만 API로 취급한다.
  // ALB 리스너 규칙에서도 한 번 거르지만, ALB DNS나 다른 호스트로 우회해서
  // 들어오는 요청을 애플리케이션에서도 막아준다.
  app.use((req, res, next) => {
    if (!ENFORCE_API_HOST) return next();
    if (isAllowedHost(req.hostname)) return next();
    res.status(421).json({
      error: `이 API는 ${API_HOSTS.join(', ')} 호스트로만 접근할 수 있습니다`,
      requestedHost: req.hostname,
    });
  });

  // 배포 확인용. 어느 컨테이너가 어떤 호스트로 응답했는지 보인다.
  app.get('/ping', (req, res) => {
    res.json({
      message: 'pong',
      host: req.hostname,
      hostname: os.hostname(),
      uptimeSeconds: Math.floor(process.uptime()),
      clientIp: req.ip,
      time: new Date().toISOString(),
    });
  });

  // 호스트가 이미 API를 뜻하므로 /api 접두사를 붙이지 않는다.
  // 예) https://api.cloudduck.cloud/auctions
  app.use('/auth', authRoutes);
  app.use('/auctions', auctionRoutes);
  app.use('/', bidRoutes); // /auctions/:id/bids, /bids/me
  app.use('/me', meRoutes);
  app.use('/admin', adminRoutes);
  app.use('/uploads', uploadRoutes);

  app.use((req, res) => {
    // 예전 경로 기반 클라이언트가 남아 있으면 원인을 바로 알 수 있게 알려준다
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({
        error: '/api 접두사는 없어졌습니다. 서브도메인 루트 경로로 호출해 주세요',
        hint: `${req.path} → ${req.path.replace(/^\/api/, '')}`,
      });
    }
    res.status(404).json({ error: '없는 경로입니다' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[error]', err);
    res.status(err.status ?? 500).json({ error: '서버에서 문제가 발생했습니다' });
  });

  console.log(`[boot] API 호스트: ${API_HOSTS.join(', ')} (검사 ${ENFORCE_API_HOST ? '켜짐' : '꺼짐'})`);
  console.log(`[boot] 허용 출처: ${ALLOWED_ORIGINS.join(', ')}`);

  return app;
}
