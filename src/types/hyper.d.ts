export {};

declare global {
  interface Window {
    require?: (module: string) => any;
    config?: {
      getConfig?: () => Record<string, any>;
    };
  }
}
