FROM rust:1.96.0-slim AS builder

COPY . /home/node/app
WORKDIR /home/node/app
RUN rustup target add x86_64-unknown-linux-musl \
		&& cargo build --release --target x86_64-unknown-linux-musl

FROM nginx:1.31.0-alpine3.23 AS server

WORKDIR /usr/share/nginx/

COPY --from=builder /home/node/app/target/x86_64-unknown-linux-musl/release/wallet-frontend-config-generator /usr/bin/wallet-frontend-config-generator

RUN chmod +x /usr/bin/wallet-frontend-config-generator

RUN ln -s /usr/bin/wallet-frontend-config-generator /usr/bin/wfcg

EXPOSE 80
