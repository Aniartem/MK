FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY admin/package.json admin/
COPY pos/package.json pos/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production STATIC_DIR=/app/public
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY admin/package.json admin/
COPY pos/package.json pos/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY server/migrations server/migrations
COPY --from=build /app/admin/dist public
COPY --from=build /app/pos/dist public/pos
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
