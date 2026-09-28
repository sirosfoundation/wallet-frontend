OUT := npm/dist

.PHONY: all build run test fmt clean

all: build

# Native binary (CLI)
run:
	cargo run --release

wasm:
	wasm-pack build --release --target bundler --out-dir $(OUT)
	jq -s '.[0] * .[1]' $(OUT)/package.json package.json > $(OUT)/package.tmp.json
	mv $(OUT)/package.tmp.json $(OUT)/package.json

native:
	cargo build --release

build: native wasm

test:
	cargo test

fmt:
	cargo fmt

clean:
	cargo clean
	rm -rf $(OUT)
