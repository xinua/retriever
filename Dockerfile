# ---------- FRONTEND BUILD ----------
  FROM node:22-slim AS frontend-build

  WORKDIR /frontend
  
  COPY frontend/package.json frontend/pnpm-lock.yaml* ./
  RUN corepack enable && pnpm install
  
  COPY frontend .
  RUN pnpm build
  
  
  # ---------- BACKEND BUILD ----------
  FROM node:22-bookworm-slim AS backend-build
  
  WORKDIR /backend
  
  COPY backend/package.json backend/package-lock.json* ./
  RUN npm install
  
  COPY backend .
  RUN npm run build
  
  
  # ---------- RUNTIME ----------
  FROM node:22-alpine

  ARG TARGETARCH

  WORKDIR /app

  # ffmpeg is required by yt-dlp to merge separate video/audio streams and to
  # extract audio. yt-dlp ships musl builds, so alpine needs no glibc shim.
  RUN apk add --no-cache ffmpeg ca-certificates && \
      case "${TARGETARCH:-amd64}" in \
        amd64) YTDLP_ASSET=yt-dlp_musllinux ;; \
        arm64) YTDLP_ASSET=yt-dlp_musllinux_aarch64 ;; \
        *) echo "unsupported arch: ${TARGETARCH}" && exit 1 ;; \
      esac && \
      wget -q -O /usr/local/bin/yt-dlp \
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_ASSET}" && \
      chmod +x /usr/local/bin/yt-dlp && \
      /usr/local/bin/yt-dlp --version

  # The POT provider plugin (8 KB of Python, no dependencies) teaches yt-dlp to
  # ask a provider server for a proof-of-origin token. It lives here rather than
  # in one of yt-dlp's default plugin folders on purpose: loaded, it probes its
  # built-in 127.0.0.1:4416 default and warns on every job needing a token, so
  # the app puts it on the search path with --plugin-dirs only when POT_BASE_URL
  # names a server. See services/ytdlp.ts:potArgs(). Keep this version in step
  # with the provider image tag documented in the README.
  ARG POT_PLUGIN_VERSION=1.3.2
  RUN mkdir -p /app/pot-plugin && \
      wget -q -O /app/pot-plugin/bgutil-ytdlp-pot-provider.zip \
        "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${POT_PLUGIN_VERSION}/bgutil-ytdlp-pot-provider.zip"

  COPY backend/package*.json ./
  RUN npm install --omit=dev
  
  COPY --from=backend-build /backend/dist ./dist
  COPY --from=frontend-build /frontend/dist ./public
  
  RUN mkdir -p /data/images /downloads
  
  ENV NODE_ENV=production
  ENV PORT=8000
  ENV HOST=0.0.0.0
  ENV DATA_DIR=/data
  ENV DOWNLOADS_DIR=/downloads
  ENV YTDLP_BIN=/usr/local/bin/yt-dlp
  ENV POT_PLUGIN_DIR=/app/pot-plugin
  
  VOLUME ["/data", "/downloads"]
  
  EXPOSE 8000
  
  HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
  
  CMD ["node", "dist/server.js"]

  LABEL org.opencontainers.image.source="https://github.com/aprilborn/retriever"
  LABEL org.opencontainers.image.version="1.1.1"
  LABEL org.opencontainers.image.title="Retriever"
  LABEL org.opencontainers.image.description="yt-dlp Web UI"
  LABEL org.opencontainers.image.documentation="https://github.com/aprilborn/retriever/blob/main/README.md"