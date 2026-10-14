// Preview-only stand-in for the Firebase SDK. The hosted preview runs in demo mode and never calls
// Firebase, so the real SDK is left out of that single-file build. Production builds use the real SDK.
export const multiFactor = () => ({ enrolledFactors: [] as { factorId: string }[] });
export const TotpMultiFactorGenerator = { FACTOR_ID: 'totp' };
export const sendEmailVerification = async () => undefined;
