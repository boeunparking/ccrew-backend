import http from 'http';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

import { createApp, state } from './src/app.js';
import { attachRealtime } from './src/realtime.js';
import { users } from './src/store.js';

const PORT = process.env.PORT || 3000;

const app = createApp();
const server = http.createServer(app);
attachRealtime(server);

/**
 * 워밍업. 여기서 DB 커넥션 풀과 Redis 연결을 만든 뒤에야
 * /health가 200을 반환하게 한다.
 * 그러면 ALB가 아직 준비 안 된 태스크로는 트래픽을 보내지 않는다.
 */
async function warmup() {
  // 데모용 관리자 계정. 실제 배포에서는 반드시 지우거나 시드 스크립트로 분리할 것.
  const email = process.env.ADMIN_EMAIL || 'admin@cloudduck.cloud';
  const password = process.env.ADMIN_PASSWORD || 'admin1234';
  users.set(email, {
    id: crypto.randomUUID(),
    email,
    passwordHash: await bcrypt.hash(password, 10),
    nickname: 'admin',
    role: 'admin',
  });

  state.ready = true;
  console.log('[init] warmup 완료, 트래픽 수신 시작');
}

// 컨테이너 밖에서 접근하려면 반드시 0.0.0.0
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[boot] listening on 0.0.0.0:${PORT}`);
  warmup().catch((e) => {
    console.error('[init] warmup 실패', e);
    process.exit(1);
  });
});

// Fargate가 태스크를 내릴 때 SIGTERM을 보낸다.
// ready를 먼저 내려서 ALB가 새 요청을 안 보내게 한 뒤 종료한다.
function shutdown(signal) {
  console.log(`[shutdown] ${signal} 수신`);
  state.ready = false;
  setTimeout(() => {
    server.close(() => process.exit(0));
  }, 3000);
  setTimeout(() => process.exit(1), 15000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
