import { ApiService } from "../abstractions/api.service";
import { CryptoService } from "../abstractions/crypto.service";
import { CryptoFunctionService } from "../abstractions/cryptoFunction.service";
import { KeyConnectorService as KeyConnectorServiceAbstraction } from "../abstractions/keyConnector.service";
import { LogService } from "../abstractions/log.service";
import { OrganizationService } from "../abstractions/organization.service";
import { StateService } from "../abstractions/state.service";
import { TokenService } from "../abstractions/token.service";
import { KdfType } from "../enums/kdfType";

import { OrganizationUserType } from "../enums/organizationUserType";

import { Utils } from "../misc/utils";

import { SymmetricCryptoKey } from "../models/domain/symmetricCryptoKey";

import { SetKeyConnectorKeyRequest } from "../models/request/account/setKeyConnectorKeyRequest";
import { KeyConnectorUserKeyRequest } from "../models/request/keyConnectorUserKeyRequest";
import { KeysRequest } from "../models/request/keysRequest";

export class KeyConnectorService implements KeyConnectorServiceAbstraction {
  constructor(
    private stateService: StateService,
    private cryptoFunctionService: CryptoFunctionService,
    protected cryptoService: CryptoService,
    protected apiService: ApiService,
    private tokenService: TokenService,
    protected logService: LogService,
    private organizationService: OrganizationService
  ) {}

  async postAndSetKey(
    url: string,
    kdf: KdfType,
    kdfIterations: number,
    orgId: string
  ): Promise<void> {
    const password = await this.cryptoFunctionService.randomBytes(64);

    const k = await this.cryptoService.makeKey(
      Utils.fromBufferToB64(password),
      await this.tokenService.getEmail(),
      kdf,
      kdfIterations
    );
    const keyConnectorRequest = new KeyConnectorUserKeyRequest(k.encKeyB64);
    await this.cryptoService.setKey(k);

    const encKey = await this.cryptoService.makeEncKey(k);
    await this.cryptoService.setEncKey(encKey[1].encryptedString);

    const [pubKey, privKey] = await this.cryptoService.makeKeyPair();

    try {
      await this.postUserKeyToKeyConnector(url, keyConnectorRequest);
    } catch (e) {
      throw new Error("Unable to reach key connector");
    }

    const keys = new KeysRequest(pubKey, privKey.encryptedString);
    const setPasswordRequest = new SetKeyConnectorKeyRequest(
      encKey[1].encryptedString,
      kdf,
      kdfIterations,
      orgId,
      keys
    );
    await this.apiService.postSetKeyConnectorKey(setPasswordRequest);
  }

  setUsesKeyConnector(usesKeyConnector: boolean) {
    return this.stateService.setUsesKeyConnector(usesKeyConnector);
  }

  async getUsesKeyConnector(): Promise<boolean> {
    return await this.stateService.getUsesKeyConnector();
  }

  async userNeedsMigration() {
    const loggedInUsingSso = this.tokenService.getIsExternal();
    const requiredByOrganization = (await this.getManagingOrganization()) != null;
    const userIsNotUsingKeyConnector = !(await this.getUsesKeyConnector());

    return loggedInUsingSso && requiredByOrganization && userIsNotUsingKeyConnector;
  }

  async migrateUser() {
    const organization = await this.getManagingOrganization();
    const key = await this.cryptoService.getKey();

    try {
      const keyConnectorRequest = new KeyConnectorUserKeyRequest(key.encKeyB64);
      await this.postUserKeyToKeyConnector(organization.keyConnectorUrl, keyConnectorRequest);
    } catch (e) {
      throw new Error("Unable to reach key connector");
    }

    await this.apiService.postConvertToKeyConnector();
  }

  async getAndSetKey(url: string): Promise<void> {
    try {
      const userKeyResponse = await this.getUserKeyFromKeyConnector(url);
      const keyArr = Utils.fromB64ToArray(userKeyResponse.key);
      const k = new SymmetricCryptoKey(keyArr);
      await this.cryptoService.setKey(k);
    } catch (e) {
      this.logService.error(e);
      throw new Error("Unable to reach key connector");
    }
  }

  async getManagingOrganization() {
    const orgs = await this.organizationService.getAll();
    return orgs.find(
      (o) =>
        o.keyConnectorEnabled &&
        o.type !== OrganizationUserType.Admin &&
        o.type !== OrganizationUserType.Owner &&
        !o.isProviderUser
    );
  }

  async setConvertAccountRequired(status: boolean) {
    await this.stateService.setConvertAccountToKeyConnector(status);
  }

  async getConvertAccountRequired(): Promise<boolean> {
    return await this.stateService.getConvertAccountToKeyConnector();
  }

  async removeConvertAccountRequired() {
    await this.stateService.setConvertAccountToKeyConnector(null);
  }

  async clear() {
    await this.removeConvertAccountRequired();
  }

  getUserKeyFromKeyConnector(url: string) {
    return this.apiService.getUserKeyFromKeyConnector(url);
  }

  postUserKeyToKeyConnector(url: string, request: KeyConnectorUserKeyRequest) {
    return this.apiService.postUserKeyToKeyConnector(url, request);
  }
}
