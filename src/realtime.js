import { WebSocketServer } from 'ws';

import { ENFORCE_API_HOST, isAllowedHost, isAllowedOrigin } from './config.js';

// 경매 ID별 구독 소켓 집합 (이 컨테이너 안에서만 유효)
const rooms = new Map(); // auctionId -> Set<ws>

let publish = null; // Redis가 붙으면 채워진다

/**
 * ECS 태스크가 2개 이상이면 각 컨테이너는 자기 메모리의 소켓만 안다.
 * 태스크 A에 붙은 유저는 태스크 B에서 발생한 입찰을 못 본다.
 * REDIS_URL이 있으면 pub/sub으로 전체 태스크에 퍼뜨려서 이 문제를 없앤다.
 */
async function connectRedis() {
  if (!process.env.REDIS_URL) {
    console.warn('[ws] REDIS_URL 없음 — 단일 태스크에서만 브로드캐스트가 완전합니다');
    return;
  }
  const { createClient } = await import('redis');
  const pub = createClient({ url: process.env.REDIS_URL });
  const sub = pub.duplicate();
  await Promise.all([pub.connect(), sub.connect()]);

  await sub.subscribe('auction-events', (raw) => {
    const { auctionId, payload } = JSON.parse(raw);
    deliverLocal(auctionId, payload);
  });

  publish = (auctionId, payload) =>
    pub.publish('auction-events', JSON.stringify({ auctionId, payload }));

  console.log('[ws] redis pub/sub 연결됨');
}

function deliverLocal(auctionId, payload) {
  const room = rooms.get(String(auctionId));
  if (!room) return;
  const msg = JSON.stringify(payload);
  for (const ws of room) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

/** 라우터에서 호출하는 진입점 */
export function broadcast(auctionId, payload) {
  if (publish) publish(auctionId, payload);
  else deliverLocal(auctionId, payload);
}

export function connectionCount() {
  let n = 0;
  for (const room of rooms.values()) n += room.size;
  return n;
}

/**
 * WebSocket 핸드셰이크에는 CORS가 적용되지 않는다.
 * 즉 어떤 사이트든 wss://api.cloudduck.cloud/ws 로 붙을 수 있으므로
 * Origin과 Host를 여기서 직접 검사한다.
 */
function verifyClient({ origin, req }, done) {
  const host = (req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
    .split(',')[0]
    .trim()
    .replace(/:\d+$/, '');

  if (ENFORCE_API_HOST && !isAllowedHost(host)) {
    return done(false, 421, 'unexpected host');
  }
  // 브라우저가 아닌 클라이언트(부하 테스트 등)는 Origin이 없다
  if (origin && !isAllowedOrigin(origin)) {
    return done(false, 403, 'origin not allowed');
  }
  done(true);
}

export function attachRealtime(server) {
  // api 서브도메인의 /ws 로 들어온다: wss://api.cloudduck.cloud/ws?auctionId=...
  const wss = new WebSocketServer({ server, path: '/ws', verifyClient });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const auctionId = url.searchParams.get('auctionId');
    if (!auctionId) return ws.close(1008, 'auctionId required');

    if (!rooms.has(auctionId)) rooms.set(auctionId, new Set());
    rooms.get(auctionId).add(ws);
    ws.isAlive = true;

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('close', () => {
      const room = rooms.get(auctionId);
      room?.delete(ws);
      if (room?.size === 0) rooms.delete(auctionId);
    });
  });

  // ALB 유휴 타임아웃(기본 60초)에 끊기지 않도록 하트비트.
  // 입찰이 없는 대기 시간에 커넥션이 죽는 걸 막는다.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

  wss.on('close', () => clearInterval(heartbeat));

  connectRedis().catch((e) => console.error('[ws] redis 연결 실패', e.message));

  return wss;
}
