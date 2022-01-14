import { Importer } from "../importers/importer";
import { ImportType } from "../services/import.service";

export interface ImportOption {
  id: string;
  name: string;
}
export abstract class ImportService {
  featuredImportOptions: readonly ImportOption[];
  regularImportOptions: readonly ImportOption[];
  getImportOptions: () => ImportOption[];
  import: (importer: Importer, fileContents: string, organizationId?: string) => Promise<Error>;
  getImporter: (format: ImportType, organizationId: string, password?: string) => Importer;
}
