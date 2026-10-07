FROM node:22-trixie-slim AS builder-base

RUN apt-get update -y && apt-get install -y git fontconfig && rm -rf /var/lib/apt/lists/*

ENV CI=true

WORKDIR /home/node/app

RUN corepack enable

# Install dependencies first so rebuild of these layers is only needed when dependencies change
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --parents packages/*/package.json ./
COPY patches ./patches
RUN --mount=type=cache,target=/pnpm-store \
	pnpm install --frozen-lockfile --store-dir=/pnpm-store

FROM builder-base AS test

COPY . .
RUN pnpm test


FROM builder-base AS builder

# This is just to make the builder stage depend on the test stage.
COPY --from=test /home/node/app/package.json /dev/null

COPY . .
RUN --mount=type=secret,id=wallet_frontend_envfile,dst=/home/node/app/.env,required=false NODE_OPTIONS=--max-old-space-size=2048 pnpm build


FROM wallet-frontend-config-manager AS deploy

WORKDIR /usr/share/nginx/

COPY ./nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY ./nginx/docker-entrypoint.d/ /docker-entrypoint.d/
COPY ./utils/create_custom_branding_resources.sh /home/node/app/

COPY --from=builder --chown=nginx:nginx /home/node/app/dist/ ./html/
COPY --from=builder --chown=nginx:nginx /home/node/app/dist/ ./dist/
COPY --from=builder --chown=nginx:nginx /home/node/app/.schemas/ ./.schemas/
COPY --from=builder --chown=nginx:nginx /home/node/app/config/ ./config/
COPY --from=builder --chown=nginx:nginx /home/node/app/branding/ ./branding/

EXPOSE 80
