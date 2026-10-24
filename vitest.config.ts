import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const contractsEntry = fileURLToPath(
  new URL('./packages/contracts/src/index.ts', import.meta.url),
);

/**
 * Tests always resolve the shared contracts package to its source so that no
 * test run depends on a prior build step.
 */
const contractsAlias = {
  '@agent-chat/contracts': contractsEntry,
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: contractsAlias },
        test: {
          name: 'managed',
          environment: 'node',
          include: ['tests/managed/**/*.test.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        resolve: { alias: contractsAlias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
        },
      },
      {
        resolve: { alias: contractsAlias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        resolve: { alias: contractsAlias },
        test: {
          name: 'contracts',
          environment: 'node',
          include: ['tests/contracts/**/*.test.ts'],
        },
      },
    ],
  },
});
