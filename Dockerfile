# syntax=docker/dockerfile:1.7

FROM rust:1.88-bookworm AS builder

ARG TRUNK_VERSION=0.21.14

RUN rustup target add wasm32-unknown-unknown \
    && cargo install trunk --version "${TRUNK_VERSION}" --locked

WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY assets ./assets

RUN cargo build --locked --release -p server \
    && cd crates/client \
    && trunk build --locked

FROM debian:bookworm-slim AS runtime

RUN groupadd --system --gid 10001 rebate \
    && useradd --system --uid 10001 --gid rebate --home-dir /app rebate

WORKDIR /app
COPY --from=builder --chown=rebate:rebate /src/target/release/server /app/server
COPY --from=builder --chown=rebate:rebate /src/dist /app/dist

ENV PORT=3000 \
    CLIENT_DIST=/app/dist \
    RUST_LOG=info

EXPOSE 3000
USER 10001:10001

ENTRYPOINT ["/app/server"]
