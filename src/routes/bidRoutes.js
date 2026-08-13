import { Router } from 'express';
import crypto from 'crypto';
import { auctions, bids, secondsLeft, isEnded } from '../store.js';
import { requireAuth } from '../authMiddleware.js';
import { broadcast } from '../realtime.js';

const router = Router();

const MIN_INCREMENT = 1000;

/**
 * 프로세스 내 경매별 순차 처리 큐.
 * 같은 경매에 동시 요청이 와도 읽기-검증-쓰기가 겹치지 않게 한다.
 *
 * 한계: 이건 이 컨테이너 안에서만 유효하다.
 * ECS 태스크가 여러 개면 태스크끼리는 못 막으므로,
 * 실제 운영에서는 (1) Redis 분산 락 또는
 * (2) RDS의 조건부 UPDATE(WHERE current_price < :new)로 최종 정합성을 보장해야 한다.
 */
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => {}));
  return next;
}

// POST /auctions/:id/bids  { price }
router.post('/auctions/:id/bids', requireAuth, async (req, res) => {
  const auctionId = req.params.id;
  const price = Number(req.body?.price);

  if (!Number.isFinite(price)) {
    return res.status(400).json({ error: '입찰가를 숫자로 입력해 주세요' });
  }

  try {
    const result = await withLock(auctionId, () => {
      const auction = auctions.get(auctionId);
      if (!auction) throw Object.assign(new Error('존재하지 않는 경매입니다'), { status: 404 });
      if (isEnded(auction)) throw Object.assign(new Error('이미 마감된 경매입니다'), { status: 409 });

      // 본인 상품 입찰 차단 (AdminDashboard의 이상 입찰 항목과 같은 규칙)
      if (auction.sellerId && auction.sellerId === req.user.sub) {
        throw Object.assign(new Error('본인이 등록한 상품에는 입찰할 수 없습니다'), { status: 403 });
      }

      const minimum = auction.currentPrice + MIN_INCREMENT;
      if (price < minimum) {
        throw Object.assign(
          new Error(`현재가보다 ${MIN_INCREMENT.toLocaleString()}원 이상 높게 입찰해 주세요`),
          { status: 400, minimum }
        );
      }

      const bid = {
        id: crypto.randomUUID(),
        userId: req.user.sub,
        nickname: req.user.nickname,
        price,
        createdAt: new Date().toISOString(),
      };

      auction.currentPrice = price;
      bids.get(auctionId).unshift(bid);

      return { auction, bid };
    });

    // 같은 경매를 보고 있는 모든 브라우저에 밀어준다
    broadcast(auctionId, {
      type: 'BID_PLACED',
      auctionId,
      currentPrice: result.auction.currentPrice,
      bidder: result.bid.nickname,
      secondsLeft: secondsLeft(result.auction),
      at: result.bid.createdAt,
    });

    res.status(201).json({
      currentPrice: result.auction.currentPrice,
      bid: { user: result.bid.nickname, price: result.bid.price, at: result.bid.createdAt },
    });
  } catch (e) {
    res.status(e.status ?? 500).json({ error: e.message, minimum: e.minimum });
  }
});

// GET /auctions/:id/bids
router.get('/auctions/:id/bids', (req, res) => {
  if (!auctions.has(req.params.id)) {
    return res.status(404).json({ error: '존재하지 않는 경매입니다' });
  }
  const history = bids.get(req.params.id) ?? [];
  res.json({
    items: history.map((b) => ({ user: b.nickname, price: b.price, at: b.createdAt })),
  });
});

// BidHistory.jsx — 내가 참여 중인 경매 목록
router.get('/bids/me', requireAuth, (req, res) => {
  const items = [];

  for (const auction of auctions.values()) {
    const mine = (bids.get(auction.id) ?? []).filter((b) => b.userId === req.user.sub);
    if (mine.length === 0) continue;

    const myBid = Math.max(...mine.map((b) => b.price));
    items.push({
      id: auction.id,
      name: auction.name,
      seller: auction.seller,
      myBid,
      price: auction.currentPrice,
      secondsLeft: secondsLeft(auction),
      ended: isEnded(auction),
    });
  }

  items.sort((a, b) => a.secondsLeft - b.secondsLeft);

  res.json({
    items,
    summary: {
      total: items.length,
      leading: items.filter((i) => !i.ended && i.price <= i.myBid).length,
      competing: items.filter((i) => !i.ended && i.price > i.myBid).length,
      closingSoon: items.filter((i) => !i.ended && i.secondsLeft <= 600).length,
    },
  });
});

export default router;
