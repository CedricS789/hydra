export interface CompanionApp {
  id: string;
  name: string;
  executablePath: string;
  arguments: string;
  workingDirectory: string;
  enabled: boolean;
  runAsAdmin?: boolean;
}
