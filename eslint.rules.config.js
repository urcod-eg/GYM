// Syntax check for firestore.rules with Firebase's own grammar (npm run lint:rules).
import rulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    files: ['**/*.rules'],
    plugins: { '@firebase/security-rules': rulesPlugin },
    languageOptions: { parser: rulesPlugin.parser },
    rules: {
      // Two reads are public on purpose: gymPublicConfig (name/logo on the sign-in screen) and
      // single-document gets of invites/loginAliases by unguessable or exact id.
      '@firebase/security-rules/no-open-reads': 'off',
      '@firebase/security-rules/no-open-writes': 'error',
      '@firebase/security-rules/no-redundant-matches': 'error',
    },
  },
];
