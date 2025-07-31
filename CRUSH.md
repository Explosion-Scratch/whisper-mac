# CRUSH Development Guidelines

## Build Commands
- `npm run build` - Compile TypeScript and copy assets to dist/
- `npm run start` - Run the Electron app
- `npm run dev` - Watch mode for development
- `npm run pack` - Package the app
- `npm run dist` - Create distributable packages

## Test Commands
- Run all tests: Execute test files directly with `node dist/path/to/test.js`
- Run single test: `node dist/core/PromiseManager.test.js`
- For new tests, create a .test.ts file and compile with `npm run build`

## Linting/Type Checking
- TypeScript compilation serves as type checking: `tsc --noEmit`
- No dedicated linting configured

## Code Style Guidelines

### Imports
- Use ES6 import/export syntax
- Group imports in order: built-in modules, external packages, internal modules
- Use absolute paths when possible

### Formatting
- No specific formatter configured (prettier/eslint not in package.json)
- Follow standard TypeScript conventions
- Use 2-space indentation

### Types
- Use strict TypeScript typing (`strict: true` in tsconfig)
- Define interfaces for complex objects
- Use proper typing for function parameters and return values

### Naming Conventions
- Use PascalCase for classes and types
- Use camelCase for variables and functions
- Use UPPER_SNAKE_CASE for constants

### Error Handling
- Use async/await with try/catch blocks
- Prefer rejecting with Error objects
- Handle promise rejections appropriately

### Other Guidelines
- Use commonjs module system (per tsconfig)
- Target ES2016 JavaScript output
- Follow existing patterns in the codebase