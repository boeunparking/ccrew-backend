import express from 'express';
import cors from 'cors';
import os from 'os';

import authRoutes from './routes/authRoutes.js';
import auctionRoutes from './routes/auctionRoutes.js';
import bidRoutes from './routes/bidRoutes.js';
import meRoutes from './routes/meRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';

export const state = { ready: false };

export function createApp() {
  const app = express();

  // ALB 뒤에 있으므로 X-Forwarded-For에서 실제 클라이언트 IP를 읽는다
  app.set('trust proxy', true);

  // CloudFront /api/* 경로로 부르면 동일 출처라 CORS가 필요 없지만,
  // ALB DNS로 직접 테스트할 때를 위해 열어둔다.
  const origins = process.env.CORS_ORIGINS?.split(',').map((s) => s.trim());
  app.use(cors({ origin: origins ?? true, credentials: true }));

  app.use(express.json({ limit: '1mb' }));

  // --- ALB 헬스체크 대상. 인증을 걸지 말 것 ---
  app.get('/health', (_req, res) => {
    if (!state.ready) return res.status(503).send('warming');
    res.status(200).send('ok');
  });

  // 배포 확인용. 어느 컨테이너가 응답했는지 보인다.
  app.get('/api/ping', (req, res) => {
    res.json({
      message: 'pong',
      hostname: os.hostname(),
      uptimeSeconds: Math.floor(process.uptime()),
      clientIp: req.ip,
      time: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/auctions', auctionRoutes);
  app.use('/api', bidRoutes); // /api/auctions/:id/bids, /api/bids/me
  app.use('/api/me', meRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/uploads', uploadRoutes);

  app.use('/api', (_req, res) => res.status(404).json({ error: '없는 경로입니다' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[error]', err);
    res.status(err.status ?? 500).json({ error: '서버에서 문제가 발생했습니다' });
  });

  return app;
}
