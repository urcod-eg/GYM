import { useCallback } from 'react';
import { useApp } from './AppContext';
import { reasonOf } from '../firebase/data';
import { STRINGS, type StringKey } from '../i18n/strings';

/** Turns any refusal (rules, Firebase Auth, our own checks) into one clear, translated sentence. */
export function useErrorText() {
  const { t } = useApp();
  return useCallback(
    (e: unknown): string => {
      const key = `err.${reasonOf(e)}` as StringKey;
      if (!(key in STRINGS.ar)) console.warn('Unmapped error', e);
      return key in STRINGS.ar ? t(key) : t('err.unknown');
    },
    [t],
  );
}
