.PHONY: test perf smoke load

test:
	bun test

perf:
	bun run test:perf

stress:
	bun run test:stress

smoke:
	bash scripts/smoke-cache.sh

load:
	bun run scripts/load-test.ts
