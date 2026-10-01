FROM node:22-bookworm

RUN git config --system init.defaultBranch main

WORKDIR /prebuilt
COPY templates/nextjs-fullstack/ /prebuilt/
RUN rm -rf node_modules .next tsconfig.tsbuildinfo && npm install --no-audit --no-fund

WORKDIR /workspace
