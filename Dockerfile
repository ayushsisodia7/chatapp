FROM node:18-alpine

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend ./backend

WORKDIR /app/backend

ENV NODE_ENV=production

CMD ["node", "server.js"]
