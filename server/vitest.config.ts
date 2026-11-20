import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        environment: 'node',
        // Integration tests share one database; run files sequentially
        fileParallelism: false,
        testTimeout: 30000,
        hookTimeout: 60000,
        env: {
            NODE_ENV: 'test',
            JWT_SECRET: 'test-secret-that-is-long-enough-for-tests-0123456789',
            // Integration tests use a dedicated database that is wiped on every run.
            DB_HOST: process.env.TEST_DB_HOST || 'localhost',
            DB_PORT: process.env.TEST_DB_PORT || '5432',
            DB_USER: process.env.TEST_DB_USER || 'postgres',
            DB_PASSWORD: process.env.TEST_DB_PASSWORD || 'postgres',
            DB_NAME: process.env.TEST_DB_NAME || 'cloudledger_test',
        },
    },
});
