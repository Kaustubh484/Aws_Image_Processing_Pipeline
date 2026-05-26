module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    '**/*.test.ts'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/cdk.out/'
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      isolatedModules: true,
    }]
  }
}