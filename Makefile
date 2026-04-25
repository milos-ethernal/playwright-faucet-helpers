.PHONY: fund-pol send-pol fund-sei send-sei

fund-pol:
	npx playwright test tests/stakepool-pol.spec.ts --headed

send-pol:
	node scripts/send-pol.js

fund-sei:
	npx playwright test tests/sei.spec.ts --headed

send-sei:
	npm run send:sei