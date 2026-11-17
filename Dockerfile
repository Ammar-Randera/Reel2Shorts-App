FROM node:20-alpine AS base
RUN apk add --no-cache ffmpeg python3 make g++

WORKDIR /app

# Install server dependencies
COPY package.json package-lock.json* ./
RUN npm ci --production=false

# Install client dependencies and build
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm ci
COPY client/ ./client/
RUN cd client && npx vite build

# Copy server
COPY server/ ./server/
COPY .env.example .env.example

# Create directories
RUN mkdir -p uploads data

# Production
ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "server/index.js"]
