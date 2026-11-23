# Build stage: production dependencies only, from the lockfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Final stage
FROM node:24-alpine
RUN apk add --no-cache ffmpeg
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --chown=node:node . .
USER node
EXPOSE 3001
# Node 24 has a global fetch, so no curl/wget is needed
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
