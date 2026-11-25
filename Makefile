.PHONY: dev dev-live dev-backend web web-landing build run test fmt mobile db

web:
	npm install
	npm run build:web

web-landing:
	npm install
	npm run build:landing

build: web
	mkdir -p bin
	JEFF_VERSION="$${JEFF_VERSION:-0.0.0-dev}" cargo build --release --manifest-path backend/Cargo.toml --bin jeff
	cp backend/target/release/jeff bin/jeff

run:
	cd backend && cargo run --bin jeff

dev:
	@echo "API:     cd backend && cargo run --bin jeff"
	@echo "App:     npm run dev:web"
	@echo "Landing: npm run dev:landing"

dev-live:
	npm run dev:live

dev-backend:
	bash scripts/dev-backend-watch.sh

test:
	cargo test --manifest-path backend/Cargo.toml
	npm test

fmt:
	cargo fmt --manifest-path backend/Cargo.toml
	cargo fmt --manifest-path desktop/src-tauri/Cargo.toml
	cargo fmt --manifest-path mobile/src-tauri/Cargo.toml

mobile:
	npm ci
	cd mobile && npm run icons
	cd mobile && npm run tauri -- android build --debug --apk --target aarch64

db:
	docker compose -f scripts/compose.postgres.yml up -d
