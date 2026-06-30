.PHONY: dev sync run tunnel bench test lint

sync:
	uv sync --all-extras

dev:
	uv run voice --help

run:
	uv run voice connect --agent claude

bench:
	uv run voice bench tts

test:
	uv run pytest -x

lint:
	uv run ruff check voice_dani web tests
	uv run mypy voice_dani
