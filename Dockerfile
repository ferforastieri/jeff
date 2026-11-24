# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS web
WORKDIR /src
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
COPY landing/preview/package.json landing/preview/package.json
COPY desktop/package.json desktop/package.json
COPY mobile/package.json mobile/package.json
COPY packages/brand/package.json packages/brand/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/icons/package.json packages/icons/package.json
RUN npm ci
COPY packages/brand ./packages/brand
COPY packages/ui ./packages/ui
COPY packages/icons ./packages/icons
COPY web ./web
RUN npm run build:web

FROM rust:1-bookworm AS build
ARG JEFF_VERSION=dev
ENV JEFF_VERSION=${JEFF_VERSION}
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates pkg-config \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY backend/Cargo.toml backend/Cargo.lock backend/build.rs ./backend/
COPY backend/src ./backend/src
COPY backend/schema ./backend/schema
COPY backend/skills ./backend/skills
COPY --from=web /src/web/dist ./web/dist
RUN cargo build --release --manifest-path backend/Cargo.toml --bin jeff

FROM python:3.11-slim AS pydebug
RUN pip install --no-cache-dir --target /debugpy debugpy==1.8.22

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates bash git ripgrep openssh-client tini python3 chromium fonts-liberation curl unzip xz-utils libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 --shell /bin/bash jeff \
    && mkdir -p /data /workspaces \
    && chown -R jeff:jeff /data /workspaces
COPY --from=web /usr/local/bin/node /usr/local/bin/node
COPY --from=web /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY --from=build /src/backend/target/release/jeff /usr/local/bin/jeff
COPY --from=pydebug /debugpy /usr/local/lib/jeff/debug-adapters/python
USER jeff
WORKDIR /home/jeff
ENV JEFF_ADDR=0.0.0.0:8787 \
    JEFF_DATA_DIR=/data \
    JEFF_WORKSPACES=/workspaces
EXPOSE 8787
VOLUME ["/data", "/workspaces"]
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/jeff"]
