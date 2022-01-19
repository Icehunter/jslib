import { BaseImporter } from "./baseImporter";
import { Importer } from "./importer";

import { EncString } from "../models/domain/encString";
import { ImportResult } from "../models/domain/importResult";

import { CryptoService } from "../abstractions/crypto.service";
import { I18nService } from "../abstractions/i18n.service";
import { ImportService } from "../abstractions/import.service";
import { KdfType } from "../enums/kdfType";
import { SymmetricCryptoKey } from "../models/domain/symmetricCryptoKey";

class BitwardenPasswordProtectedFileFormat {
  encrypted: boolean;
  passwordProtected: boolean;
  format: "json" | "csv" | "encrypted_json";
  salt: string;
  kdfIterations: number;
  kdfType: number;
  // tslint:disable-next-line
  encKeyValidation_DO_NOT_EDIT: string;
  data: string;
}

export class BitwardenPasswordProtectedImporter extends BaseImporter implements Importer {
  private innerImporter: Importer;
  private key: SymmetricCryptoKey;

  constructor(
    private importService: ImportService,
    private cryptoService: CryptoService,
    private i18nService: I18nService,
    private password: string
  ) {
    super();
  }

  async parse(data: string): Promise<ImportResult> {
    const result = new ImportResult();
    const parsedData = JSON.parse(data);
    if (this.cannotParseFile(parsedData)) {
      result.success = false;
      return result;
    }

    this.setInnerImporter(parsedData.format);

    if (!(await this.checkPassword(parsedData))) {
      result.success = false;
      result.errorMessage = this.i18nService.t("importEncKeyError");
      return result;
    }

    const encData = new EncString(parsedData.data);
    const clearTextData = await this.cryptoService.decryptToUtf8(encData, this.key);
    return this.innerImporter.parse(clearTextData);
  }

  private async checkPassword(jdoc: BitwardenPasswordProtectedFileFormat): Promise<boolean> {
    this.key = await this.cryptoService.makePinKey(
      this.password,
      jdoc.salt,
      KdfType.PBKDF2_SHA256,
      jdoc.kdfIterations
    );

    const encKeyValidation = new EncString(jdoc.encKeyValidation_DO_NOT_EDIT);

    const encKeyValidationDecrypt = await this.cryptoService.decryptToUtf8(
      encKeyValidation,
      this.key
    );
    if (encKeyValidationDecrypt === null) {
      return false;
    }
    return true;
  }

  private cannotParseFile(jdoc: BitwardenPasswordProtectedFileFormat): boolean {
    return (
      !jdoc ||
      !jdoc.encrypted ||
      !jdoc.passwordProtected ||
      !(jdoc.format === "csv" || jdoc.format === "json" || jdoc.format === "encrypted_json") ||
      !jdoc.salt ||
      !jdoc.kdfIterations ||
      typeof jdoc.kdfIterations !== "number" ||
      jdoc.kdfType == null ||
      KdfType[jdoc.kdfType] == null ||
      !jdoc.encKeyValidation_DO_NOT_EDIT ||
      !jdoc.data
    );
  }

  private setInnerImporter(format: "csv" | "json" | "encrypted_json") {
    this.innerImporter =
      format === "csv"
        ? this.importService.getImporter("bitwardencsv", this.organizationId)
        : this.importService.getImporter("bitwardenjson", this.organizationId);
  }
}
