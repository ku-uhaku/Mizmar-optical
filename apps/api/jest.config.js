module.exports = {
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json', diagnostics: false }] },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@mizmar/shared$': '<rootDir>/../../../packages/shared/src',
    // ts rewrites the generated Prisma client's "./x.ts" imports to "./x.js"; resolve them back to the .ts sources
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
