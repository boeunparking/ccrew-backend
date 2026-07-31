import { Router } from 'express';
import {
  auctions, bids, claims, securityLogs, suspiciousBids, secondsLeft, isEnded,
} from '../store.js';
import { requireAuth, requireAdmin } from '../authMiddleware.js';
import { connectionCount } from '../realtime.js';

const router = Router();

// 이 라우터 전체가 관리자 전용
router.use(requireAuth, requireAdmin);

// AdminDashboard.jsx 상단 통계 3종
router.get('/stats', (_req, res) => {
  let bidCount = 0;
  for (const list of bids.values()) bidCount += list.length;

  res.json({
    bidCount,
    // 시뮬레이션이 아니라 실제 WebSocket 연결 수
    activeUsers: connectionCount(),
    suspiciousCount: suspiciousBids.length,
  });
});

// 실시간 경매 리스트
router.get('/auctions', (_req, res) => {
  const items = [...auctions.values()]
    .filter((a) => !isEnded(a))
    .sort((a, b) => secondsLeft(a) - secondsLeft(b))
    .map((a) => ({
      id: a.id,
      name: a.name,
      price: a.currentPrice,
      secondsLeft: secondsLeft(a),
    }));

  res.json({ items });
});

router.get('/suspicious', (_req, res) => res.json({ items: suspiciousBids }));
router.get('/logs', (_req, res) => res.json({ items: securityLogs }));
router.get('/claims', (_req, res) => res.json({ items: claims }));

// 클레임 처리 상태 진행: 대기 → 처리중 → 완료
router.patch('/claims/:id', (req, res) => {
  const claim = claims.find((c) => c.id === req.params.id);
  if (!claim) return res.status(404).json({ error: '존재하지 않는 클레임입니다' });

  const order = ['대기', '처리중', '완료'];
  const next = req.body?.status;

  if (next && order.includes(next)) {
    claim.status = next;
  } else {
    claim.status = order[Math.min(order.indexOf(claim.status) + 1, order.length - 1)];
  }

  res.json(claim);
});

export default router;
