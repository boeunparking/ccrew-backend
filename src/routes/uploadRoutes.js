import { Router } from 'express';
import crypto from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireAuth } from '../authMiddleware.js';

const router = Router();

const BUCKET = process.env.UPLOAD_BUCKET;
const REGION = process.env.AWS_REGION || 'ap-northeast-2';
const s3 = new S3Client({ region: REGION });

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * 이미지가 백엔드 컨테이너를 거치지 않게 한다.
 * 브라우저 → S3로 직접 PUT 하고, 백엔드는 서명된 URL만 발급한다.
 * 컨테이너 메모리/대역폭을 아끼고 업로드도 빨라진다.
 *
 * 프론트 흐름:
 *   1) POST /api/uploads/presign  → { uploadUrl, key }
 *   2) fetch(uploadUrl, { method: 'PUT', body: file })
 *   3) POST /api/auctions 에 images: [key] 로 전달
 */
router.post('/presign', requireAuth, async (req, res) => {
  if (!BUCKET) {
    return res.status(503).json({ error: '업로드 버킷이 설정되지 않았습니다' });
  }

  const { contentType, fileName } = req.body ?? {};

  if (!ALLOWED.has(contentType)) {
    return res.status(400).json({ error: 'JPG, PNG, WEBP, GIF 이미지만 올릴 수 있습니다' });
  }

  const ext = (fileName?.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 5);
  const key = `auctions/${req.user.sub}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 300 }
  );

  // CloudFront의 auctions/* behavior가 업로드 버킷을 가리키므로
  // 키를 그대로 경로로 쓰면 된다 (경로 재작성 불필요)
  res.json({ uploadUrl, key, publicUrl: `/${key}` });
});

export default router;
