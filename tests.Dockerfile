FROM node:22-bullseye-slim AS builder-base

RUN apt-get update -y && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /home/node/app

RUN corepack enable

# Install dependencies first so rebuild of these layers is only needed when dependencies change
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY .env.template .env
RUN --mount=type=cache,target=/pnpm-store \
	pnpm install --frozen-lockfile --store-dir=/pnpm-store

COPY . .
RUN pnpm test
