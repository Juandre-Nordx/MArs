declare module 'gltf-validator' {
  export function validateBytes(
    data: Uint8Array,
    options: {
      maxIssues: number;
      externalResourceFunction: (uri: string) => Promise<Uint8Array>;
    },
  ): Promise<{
    issues: {
      numErrors: number;
      messages: { code: string; severity: number }[];
    };
  }>;
}
