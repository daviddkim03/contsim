// @ts-check
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['dist', 'node_modules']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Architecture rule (PROJECT.md section 7): the algorithm stays framework-free.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['three', 'three/*'], message: 'src/core must not depend on three.js.' },
            { group: ['**/ui/**'], message: 'src/core must not import from src/ui.' },
          ],
        },
      ],
    },
  },
  prettier,
)
