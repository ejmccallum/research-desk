export interface BackupPreflight { included: string[]; convertedLinks: string[]; missing: string[]; changed: string[]; }
export interface BackupResult extends BackupPreflight { path: string; sha256: string; }
export interface RestoreSummary { verifiedFiles: number; convertedLinks: string[]; unavailableLinks: string[]; }
