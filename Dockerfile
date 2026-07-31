# --- deps: 프로덕션 의존성만 설치 ---
FROM node:20-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# --- runtime ---
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY server.js ./
COPY src ./src

# root로 실행하지 않는다
USER node

EXPOSE 3000
CMD ["node", "server.js"]
