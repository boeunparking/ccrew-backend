/**
 * 인증 관련 API 엔드포인트.
 *   POST /auth/signup
 *   POST /auth/login
 *   GET  /auth/me
 *
 * 토큰 생성/검증 로직 자체는 src/authMiddleware.js 에 있다.
 */
import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { users } from "../store.js";
import { signToken, requireAuth } from "../authMiddleware.js";

const router = Router();

// SignUp.jsx: { email, password, passwordConfirm }
router.post("/signup", async (req, res) => {
  const { email, password, passwordConfirm } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ error: "이메일과 비밀번호를 입력해 주세요" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "비밀번호는 8자 이상이어야 합니다" });
  }
  if (password !== passwordConfirm) {
    return res.status(400).json({ error: "비밀번호가 서로 다릅니다" });
  }
  if (users.has(email)) {
    return res.status(409).json({ error: "이미 가입된 이메일입니다" });
  }

  const user = {
    id: crypto.randomUUID(),
    email,
    passwordHash: await bcrypt.hash(password, 10),
    nickname: email.split("@")[0],
    role: "user",
  };
  users.set(email, user);

  res
    .status(201)
    .json({ id: user.id, email: user.email, nickname: user.nickname });
});

// Login.jsx: { email, password }
router.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = users.get(email);

  // 계정 존재 여부를 노출하지 않도록 같은 메시지를 쓴다
  const fail = () =>
    res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다" });

  if (!user) return fail();
  if (!(await bcrypt.compare(password ?? "", user.passwordHash))) return fail();

  res.json({
    token: signToken(user),
    user: {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      role: user.role,
    },
  });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({
    id: req.user.sub,
    email: req.user.email,
    nickname: req.user.nickname,
    role: req.user.role,
  });
});

export default router;
