/** Integration tests talk to REAL Postgres / Redis / RabbitMQ (see docker-compose.yml or CI services). */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'test/tsconfig.json' }] },
  testTimeout: 60000,
};
