module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleNameMapper: {
    '^@notification-system/types$': '<rootDir>/../../shared/types',
    '^@notification-system/utils$': '<rootDir>/../../shared/utils',
  },
  setupFilesAfterEnv: ['<rootDir>/../../tests/setup.ts'],
  testTimeout: 10000,
  verbose: true,
};
