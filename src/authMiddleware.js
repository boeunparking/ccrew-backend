/**
 * 인증 "도구" 모음 — 엔드포인트가 아니다.
 * 토큰을 만들고 검증하는 함수와, 라우터가 가져다 쓰는 미들웨어가 들어 있다.
 *
 * 헷갈리기 쉬운 짝: src/routes/authRoutes.js 는 실제 URL(/auth/login 등)을 정의한다.
 * 이 파일은 그 라우터를 포함한 모든 라우터가 공용으로 쓴다.
 */
import jwt from 'jsonwebtoken';

// 프로덕션에서는 Secrets Manager가 주입한다. 로컬 기본값은 개발용.
const SECRET = process.env.JWT_SECRET || 'dev-only-not-for-production';
const EXPIRES_IN = '7d';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, nickname: user.nickname, role: user.role },
    SECRET,
    { expiresIn: EXPIRES_IN }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

function readToken(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7);
}

// 로그인 필수 구간
export function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다' });
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: '세션이 만료되었습니다. 다시 로그인해 주세요' });
  }
}

// 로그인해도 되고 안 해도 되는 구간 (있으면 req.user 채움)
export function optionalAuth(req, _res, next) {
  const token = readToken(req);
  if (token) {
    try {
      req.user = verifyToken(token);
    } catch {
      /* 무시하고 비로그인으로 처리 */
    }
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: '관리자만 접근할 수 있습니다' });
  }
  next();
}
