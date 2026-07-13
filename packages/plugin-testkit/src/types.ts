export interface TestkitIssue {
  path: string;
  code: string;
  message: string;
}

export interface TestkitValidationResult {
  ok: boolean;
  issues: readonly TestkitIssue[];
}

export interface ContributionDeclarations {
  elements: readonly { name: string; schemaVersion: number; browser: boolean; snapshot: string }[];
  tools: readonly string[];
  procedures: readonly string[];
  migrations: readonly string[];
}

export interface ContributionRegistrations {
  elements: readonly string[];
  tools: readonly string[];
  procedures: readonly string[];
  migrations: readonly string[];
}
