// 오늘은 DB 없이 프로세스 메모리에 둔다.
// 주의: ECS 태스크가 2개 이상이면 태스크마다 데이터가 따로 논다.
// 스모크 테스트 단계에서는 desired_count = 1로 두고,
// 나중에 이 파일의 함수 시그니처만 유지한 채 RDS 쿼리로 교체하면 된다.

import crypto from 'crypto';

import { ASSET_BASE_URL } from './config.js';

const now = () => Date.now();
const afterSec = (s) => new Date(now() + s * 1000).toISOString();

export const users = new Map(); // email -> { id, email, passwordHash, nickname, role }

export const auctions = new Map();
export const bids = new Map(); // auctionId -> [{ id, userId, nickname, price, createdAt }]

export const claims = [
  { id: 'c1', name: '상품 미배송 신고', user: 'user_a15', status: '대기' },
  { id: 'c2', name: '상품 상태 불일치', user: 'user_c92', status: '처리중' },
  { id: 'c3', name: '낙찰 후 대금 미결제', user: 'user_b77', status: '완료' },
];

export const securityLogs = [
  { t: '12:44:10', msg: 'user_m03 로그인 성공 (Seoul)' },
  { t: '12:43:52', msg: '관리자 alarm: CPU 사용률 82% 도달 (auto-scaling 트리거)' },
  { t: '12:41:30', msg: '비정상 접근 시도 차단 — IP 203.0.113.44' },
];

export const suspiciousBids = [
  { t: '12:41:02', msg: 'user_k22 → 본인 등록 상품에 입찰 시도 (차단됨)' },
  { t: '12:35:47', msg: 'user_h91 → 90초 내 7회 연속 입찰 (모니터링 대상 등록)' },
];

export const notifications = [
  { id: 'n1', message: '명일방주 텍사스 스케일 피규어 — 새로운 입찰이 등록되었습니다', createdAt: afterSec(-300) },
  { id: 'n2', message: '원피스 루피 기어5 스케일 피규어 — 낙찰되었습니다', createdAt: afterSec(-3600) },
];

const seed = [
  {
    id: '1', name: '원피스 루피 기어5 스케일 피규어', brand: 'Banpresto',
    category: 'scale', startPrice: 30000, currentPrice: 42000,
    endsAt: afterSec(192), seller: 'seller_otaku', tag: '마감임박',
    description: '미개봉 새제품, 박스 손상 없음. 도색 상태 양호하며 부속품 전체 포함(교체용 손 4종, 전용 스탠드 포함). 정품 인증 스티커 확인 완료.',
    images: [],
  },
  {
    id: '2', name: '귀멸의칼날 넨도로이드 네즈코', brand: 'Good Smile Company',
    category: 'nendoroid', startPrice: 50000, currentPrice: 68000,
    endsAt: afterSec(720), seller: 'seller_nendo', tag: 'NEW', description: '', images: [],
  },
  {
    id: '3', name: '에반게리온 초합금 로봇혼', brand: 'Bandai Spirits',
    category: 'etc', startPrice: 120000, currentPrice: 155000,
    endsAt: afterSec(2400), seller: 'seller_evafig', tag: '', description: '', images: [],
  },
  {
    id: '4', name: '건담 RX-78-2 PG 프라모델', brand: 'Bandai',
    category: 'gunpla', startPrice: 70000, currentPrice: 89000,
    endsAt: afterSec(3600), seller: 'seller_gunpla', tag: '', description: '', images: [],
  },
  {
    id: '5', name: '명일방주 텍사스 스케일 피규어', brand: 'Myethos',
    category: 'scale', startPrice: 100000, currentPrice: 132000,
    endsAt: afterSec(7200), seller: 'seller_myethos', tag: '인기', description: '', images: [],
  },
  {
    id: '6', name: '스파이 패밀리 아냐 넨도로이드', brand: 'Good Smile Company',
    category: 'nendoroid', startPrice: 40000, currentPrice: 54000,
    endsAt: afterSec(10800), seller: 'seller_nendo', tag: '', description: '', images: [],
  },
  {
    id: '7', name: '체인소맨 파워 피규어', brand: 'Kotobukiya',
    category: 'scale', startPrice: 50000, currentPrice: 61000,
    endsAt: afterSec(14400), seller: 'seller_koto', tag: '', description: '', images: [],
  },
  {
    id: '8', name: '젤다의전설 링크 스케일 피규어', brand: 'First 4 Figures',
    category: 'scale', startPrice: 180000, currentPrice: 210000,
    endsAt: afterSec(18000), seller: 'seller_f4f', tag: '', description: '', images: [],
  },
];

for (const a of seed) {
  auctions.set(a.id, a);
  bids.set(a.id, []);
}

// 상세 페이지 초기 입찰 이력
bids.set('1', [
  { id: crypto.randomUUID(), userId: 'seed', nickname: 'user_c92', price: 42000, createdAt: afterSec(-30) },
  { id: crypto.randomUUID(), userId: 'seed', nickname: 'user_a15', price: 40000, createdAt: afterSec(-90) },
  { id: crypto.randomUUID(), userId: 'seed', nickname: 'user_b77', price: 38000, createdAt: afterSec(-150) },
]);

let seq = 100;
export const nextAuctionId = () => String(++seq);

export function secondsLeft(auction) {
  return Math.max(0, Math.floor((new Date(auction.endsAt).getTime() - now()) / 1000));
}

export function isEnded(auction) {
  return secondsLeft(auction) === 0;
}

// S3에는 원본 키(auctions/유저id/파일명)만 저장해두고,
// 화면에 보여줄 때만 이미지 주소로 바꾼다.
// 이미지는 API 도메인이 아니라 프론트/CDN 도메인에서 서빙된다.
// - ASSET_BASE_URL이 있으면 절대 URL (예: https://cdn.cloudduck.cloud/auctions/...)
// - 없으면 상대경로. 프론트 CloudFront의 /auctions/* behavior가 업로드 버킷을 가리키므로
//   프론트 페이지에서 그대로 열린다.
export function toImagePath(key) {
  if (!key) return null;
  return ASSET_BASE_URL ? `${ASSET_BASE_URL}/${key}` : `/${key}`;
}

// 프론트 카드/리스트가 쓰는 형태로 직렬화
export function toListItem(a) {
  const left = secondsLeft(a);
  return {
    id: a.id,
    name: a.name,
    brand: a.brand,
    price: a.currentPrice,
    tag: a.tag,
    secondsLeft: left,
    ended: left === 0,
    thumbnail: toImagePath(a.images[0]),
  };
}
