export function homeDir(): string {
  // Windows shells set USERPROFILE instead of HOME; os.homedir() covers
  // renderer contexts where neither env var is present
  return (
    process.env.HOME ||
    process.env.USERPROFILE ||
    (typeof window !== 'undefined' && window.require
      ? (() => {
          try {
            return window.require('os').homedir();
          } catch {
            return '';
          }
        })()
      : '')
  );
}
