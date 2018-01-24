import { CipherType } from '../enums/cipherType';

import { CipherData } from '../models/data/cipherData';

import { Card } from '../models/domain/card';
import { Cipher } from '../models/domain/cipher';
import { CipherString } from '../models/domain/cipherString';
import Domain from '../models/domain/domain';
import { Field } from '../models/domain/field';
import { Identity } from '../models/domain/identity';
import { Login } from '../models/domain/login';
import { SecureNote } from '../models/domain/secureNote';
import { SymmetricCryptoKey } from '../models/domain/symmetricCryptoKey';

import { CipherRequest } from '../models/request/cipherRequest';

import { CipherResponse } from '../models/response/cipherResponse';
import { ErrorResponse } from '../models/response/errorResponse';

import { CardView } from '../models/view/cardView';
import { CipherView } from '../models/view/cipherView';
import { FieldView } from '../models/view/fieldView';
import { IdentityView } from '../models/view/identityView';
import { LoginView } from '../models/view/loginView';
import { View } from '../models/view/view';

import { ConstantsService } from './constants.service';

import { ApiService } from '../abstractions/api.service';
import { CipherService as CipherServiceAbstraction } from '../abstractions/cipher.service';
import { CryptoService } from '../abstractions/crypto.service';
import { SettingsService } from '../abstractions/settings.service';
import { StorageService } from '../abstractions/storage.service';
import { UserService } from '../abstractions/user.service';

const Keys = {
    ciphersPrefix: 'ciphers_',
    localData: 'sitesLocalData',
    neverDomains: 'neverDomains',
};

export class CipherService implements CipherServiceAbstraction {
    static sortCiphersByLastUsed(a: any, b: any): number {
        const aLastUsed = a.localData && a.localData.lastUsedDate ? a.localData.lastUsedDate as number : null;
        const bLastUsed = b.localData && b.localData.lastUsedDate ? b.localData.lastUsedDate as number : null;

        if (aLastUsed != null && bLastUsed != null && aLastUsed < bLastUsed) {
            return 1;
        }
        if (aLastUsed != null && bLastUsed == null) {
            return -1;
        }

        if (bLastUsed != null && aLastUsed != null && aLastUsed > bLastUsed) {
            return -1;
        }
        if (bLastUsed != null && aLastUsed == null) {
            return 1;
        }

        return 0;
    }

    static sortCiphersByLastUsedThenName(a: any, b: any): number {
        const result = CipherService.sortCiphersByLastUsed(a, b);
        if (result !== 0) {
            return result;
        }

        const nameA = (a.name + '_' + a.username).toUpperCase();
        const nameB = (b.name + '_' + b.username).toUpperCase();

        if (nameA < nameB) {
            return -1;
        }
        if (nameA > nameB) {
            return 1;
        }

        return 0;
    }

    decryptedCipherCache: CipherView[];

    constructor(private cryptoService: CryptoService, private userService: UserService,
        private settingsService: SettingsService, private apiService: ApiService,
        private storageService: StorageService) {
    }

    clearCache(): void {
        this.decryptedCipherCache = null;
    }

    async encrypt(model: CipherView): Promise<Cipher> {
        const cipher = new Cipher();
        cipher.id = model.id;
        cipher.folderId = model.folderId;
        cipher.favorite = model.favorite;
        cipher.organizationId = model.organizationId;
        cipher.type = model.type;
        cipher.collectionIds = model.collectionIds;

        const key = await this.cryptoService.getOrgKey(cipher.organizationId);
        await Promise.all([
            this.encryptObjProperty(model, cipher, {
                name: null,
                notes: null,
            }, key),
            this.encryptCipherData(cipher, model, key),
            this.encryptFields(model.fields, key).then((fields) => {
                cipher.fields = fields;
            }),
        ]);

        return cipher;
    }

    async encryptFields(fieldsModel: FieldView[], key: SymmetricCryptoKey): Promise<Field[]> {
        if (!fieldsModel || !fieldsModel.length) {
            return null;
        }

        const self = this;
        const encFields: Field[] = [];
        await fieldsModel.reduce((promise, field) => {
            return promise.then(() => {
                return self.encryptField(field, key);
            }).then((encField: Field) => {
                encFields.push(encField);
            });
        }, Promise.resolve());

        return encFields;
    }

    async encryptField(fieldModel: FieldView, key: SymmetricCryptoKey): Promise<Field> {
        const field = new Field();
        field.type = fieldModel.type;

        await this.encryptObjProperty(fieldModel, field, {
            name: null,
            value: null,
        }, key);

        return field;
    }

    async get(id: string): Promise<Cipher> {
        const userId = await this.userService.getUserId();
        const localData = await this.storageService.get<any>(Keys.localData);
        const ciphers = await this.storageService.get<{ [id: string]: CipherData; }>(
            Keys.ciphersPrefix + userId);
        if (ciphers == null || !ciphers.hasOwnProperty(id)) {
            return null;
        }

        return new Cipher(ciphers[id], false, localData ? localData[id] : null);
    }

    async getAll(): Promise<Cipher[]> {
        const userId = await this.userService.getUserId();
        const localData = await this.storageService.get<any>(Keys.localData);
        const ciphers = await this.storageService.get<{ [id: string]: CipherData; }>(
            Keys.ciphersPrefix + userId);
        const response: Cipher[] = [];
        for (const id in ciphers) {
            if (ciphers.hasOwnProperty(id)) {
                response.push(new Cipher(ciphers[id], false, localData ? localData[id] : null));
            }
        }
        return response;
    }

    async getAllDecrypted(): Promise<CipherView[]> {
        if (this.decryptedCipherCache != null) {
            return this.decryptedCipherCache;
        }

        const decCiphers: CipherView[] = [];
        const key = await this.cryptoService.getKey();
        if (key == null) {
            throw new Error('No key.');
        }

        const promises: any[] = [];
        const ciphers = await this.getAll();
        ciphers.forEach((cipher) => {
            promises.push(cipher.decrypt().then((c) => decCiphers.push(c)));
        });

        await Promise.all(promises);
        this.decryptedCipherCache = decCiphers;
        return this.decryptedCipherCache;
    }

    async getAllDecryptedForGrouping(groupingId: string, folder: boolean = true): Promise<CipherView[]> {
        const ciphers = await this.getAllDecrypted();

        return ciphers.filter((cipher) => {
            if (folder && cipher.folderId === groupingId) {
                return true;
            } else if (!folder && cipher.collectionIds != null && cipher.collectionIds.indexOf(groupingId) > -1) {
                return true;
            }

            return false;
        });
    }

    async getAllDecryptedForDomain(domain: string, includeOtherTypes?: any[]): Promise<CipherView[]> {
        if (domain == null && !includeOtherTypes) {
            return Promise.resolve([]);
        }

        const eqDomainsPromise = domain == null ? Promise.resolve([]) :
            this.settingsService.getEquivalentDomains().then((eqDomains: any[][]) => {
                let matches: any[] = [];
                eqDomains.forEach((eqDomain) => {
                    if (eqDomain.length && eqDomain.indexOf(domain) >= 0) {
                        matches = matches.concat(eqDomain);
                    }
                });

                if (!matches.length) {
                    matches.push(domain);
                }

                return matches;
            });

        const result = await Promise.all([eqDomainsPromise, this.getAllDecrypted()]);
        const matchingDomains = result[0];
        const ciphers = result[1];

        return ciphers.filter((cipher) => {
            if (domain && cipher.type === CipherType.Login && cipher.login.domain &&
                matchingDomains.indexOf(cipher.login.domain) > -1) {
                return true;
            } else if (includeOtherTypes && includeOtherTypes.indexOf(cipher.type) > -1) {
                return true;
            }

            return false;
        });
    }

    async getLastUsedForDomain(domain: string): Promise<CipherView> {
        const ciphers = await this.getAllDecryptedForDomain(domain);
        if (ciphers.length === 0) {
            return null;
        }

        const sortedCiphers = ciphers.sort(CipherService.sortCiphersByLastUsed);
        return sortedCiphers[0];
    }

    async updateLastUsedDate(id: string): Promise<void> {
        let ciphersLocalData = await this.storageService.get<any>(Keys.localData);
        if (!ciphersLocalData) {
            ciphersLocalData = {};
        }

        if (ciphersLocalData[id]) {
            ciphersLocalData[id].lastUsedDate = new Date().getTime();
        } else {
            ciphersLocalData[id] = {
                lastUsedDate: new Date().getTime(),
            };
        }

        await this.storageService.save(Keys.localData, ciphersLocalData);

        if (this.decryptedCipherCache == null) {
            return;
        }

        for (let i = 0; i < this.decryptedCipherCache.length; i++) {
            const cached = this.decryptedCipherCache[i];
            if (cached.id === id) {
                cached.localData = ciphersLocalData[id];
                break;
            }
        }
    }

    async saveNeverDomain(domain: string): Promise<void> {
        if (domain == null) {
            return;
        }

        let domains = await this.storageService.get<{ [id: string]: any; }>(Keys.neverDomains);
        if (!domains) {
            domains = {};
        }
        domains[domain] = null;
        await this.storageService.save(Keys.neverDomains, domains);
    }

    async saveWithServer(cipher: Cipher): Promise<any> {
        const request = new CipherRequest(cipher);

        let response: CipherResponse;
        if (cipher.id == null) {
            response = await this.apiService.postCipher(request);
            cipher.id = response.id;
        } else {
            response = await this.apiService.putCipher(cipher.id, request);
        }

        const userId = await this.userService.getUserId();
        const data = new CipherData(response, userId, cipher.collectionIds);
        await this.upsert(data);
    }

    saveAttachmentWithServer(cipher: Cipher, unencryptedFile: any): Promise<any> {
        const self = this;

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsArrayBuffer(unencryptedFile);

            reader.onload = async (evt: any) => {
                const key = await self.cryptoService.getOrgKey(cipher.organizationId);
                const encFileName = await self.cryptoService.encrypt(unencryptedFile.name, key);
                const encData = await self.cryptoService.encryptToBytes(evt.target.result, key);

                const fd = new FormData();
                const blob = new Blob([encData], { type: 'application/octet-stream' });
                fd.append('data', blob, encFileName.encryptedString);

                let response: CipherResponse;
                try {
                    response = await self.apiService.postCipherAttachment(cipher.id, fd);
                } catch (e) {
                    reject((e as ErrorResponse).getSingleMessage());
                    return;
                }

                const userId = await self.userService.getUserId();
                const data = new CipherData(response, userId, cipher.collectionIds);
                this.upsert(data);
                resolve(new Cipher(data));

            };

            reader.onerror = (evt) => {
                reject('Error reading file.');
            };
        });
    }

    async upsert(cipher: CipherData | CipherData[]): Promise<any> {
        const userId = await this.userService.getUserId();
        let ciphers = await this.storageService.get<{ [id: string]: CipherData; }>(
            Keys.ciphersPrefix + userId);
        if (ciphers == null) {
            ciphers = {};
        }

        if (cipher instanceof CipherData) {
            const c = cipher as CipherData;
            ciphers[c.id] = c;
        } else {
            (cipher as CipherData[]).forEach((c) => {
                ciphers[c.id] = c;
            });
        }

        await this.storageService.save(Keys.ciphersPrefix + userId, ciphers);
        this.decryptedCipherCache = null;
    }

    async replace(ciphers: { [id: string]: CipherData; }): Promise<any> {
        const userId = await this.userService.getUserId();
        await this.storageService.save(Keys.ciphersPrefix + userId, ciphers);
        this.decryptedCipherCache = null;
    }

    async clear(userId: string): Promise<any> {
        await this.storageService.remove(Keys.ciphersPrefix + userId);
        this.decryptedCipherCache = null;
    }

    async delete(id: string | string[]): Promise<any> {
        const userId = await this.userService.getUserId();
        const ciphers = await this.storageService.get<{ [id: string]: CipherData; }>(
            Keys.ciphersPrefix + userId);
        if (ciphers == null) {
            return;
        }

        if (typeof id === 'string') {
            const i = id as string;
            delete ciphers[id];
        } else {
            (id as string[]).forEach((i) => {
                delete ciphers[i];
            });
        }

        await this.storageService.save(Keys.ciphersPrefix + userId, ciphers);
        this.decryptedCipherCache = null;
    }

    async deleteWithServer(id: string): Promise<any> {
        await this.apiService.deleteCipher(id);
        await this.delete(id);
    }

    async deleteAttachment(id: string, attachmentId: string): Promise<void> {
        const userId = await this.userService.getUserId();
        const ciphers = await this.storageService.get<{ [id: string]: CipherData; }>(
            Keys.ciphersPrefix + userId);

        if (ciphers == null || !ciphers.hasOwnProperty(id) || ciphers[id].attachments == null) {
            return;
        }

        for (let i = 0; i < ciphers[id].attachments.length; i++) {
            if (ciphers[id].attachments[i].id === attachmentId) {
                ciphers[id].attachments.splice(i, 1);
            }
        }

        await this.storageService.save(Keys.ciphersPrefix + userId, ciphers);
        this.decryptedCipherCache = null;
    }

    async deleteAttachmentWithServer(id: string, attachmentId: string): Promise<void> {
        try {
            await this.apiService.deleteCipherAttachment(id, attachmentId);
        } catch (e) {
            return Promise.reject((e as ErrorResponse).getSingleMessage());
        }
        await this.deleteAttachment(id, attachmentId);
    }

    sortCiphersByLastUsed(a: any, b: any): number {
        return CipherService.sortCiphersByLastUsed(a, b);
    }

    sortCiphersByLastUsedThenName(a: any, b: any): number {
        return CipherService.sortCiphersByLastUsedThenName(a, b);
    }

    // Helpers

    private async encryptObjProperty<V extends View, D extends Domain>(model: V, obj: D,
        map: any, key: SymmetricCryptoKey): Promise<void> {
        const promises = [];
        const self = this;

        for (const prop in map) {
            if (!map.hasOwnProperty(prop)) {
                continue;
            }

            // tslint:disable-next-line
            (function (theProp, theObj) {
                const p = Promise.resolve().then(() => {
                    const modelProp = (model as any)[(map[theProp] || theProp)];
                    if (modelProp && modelProp !== '') {
                        return self.cryptoService.encrypt(modelProp, key);
                    }
                    return null;
                }).then((val: CipherString) => {
                    (theObj as any)[theProp] = val;
                });
                promises.push(p);
            })(prop, obj);
        }

        await Promise.all(promises);
    }

    private async encryptCipherData(cipher: Cipher, model: CipherView, key: SymmetricCryptoKey) {
        switch (cipher.type) {
            case CipherType.Login:
                cipher.login = new Login();
                await this.encryptObjProperty(model.login, cipher.login, {
                    uri: null,
                    username: null,
                    password: null,
                    totp: null,
                }, key);
                return;
            case CipherType.SecureNote:
                cipher.secureNote = new SecureNote();
                cipher.secureNote.type = model.secureNote.type;
                return;
            case CipherType.Card:
                cipher.card = new Card();
                await this.encryptObjProperty(model.card, cipher.card, {
                    cardholderName: null,
                    brand: null,
                    number: null,
                    expMonth: null,
                    expYear: null,
                    code: null,
                }, key);
                return;
            case CipherType.Identity:
                cipher.identity = new Identity();
                await this.encryptObjProperty(model.identity, cipher.identity, {
                    title: null,
                    firstName: null,
                    middleName: null,
                    lastName: null,
                    address1: null,
                    address2: null,
                    address3: null,
                    city: null,
                    state: null,
                    postalCode: null,
                    country: null,
                    company: null,
                    email: null,
                    phone: null,
                    ssn: null,
                    username: null,
                    passportNumber: null,
                    licenseNumber: null,
                }, key);
                return;
            default:
                throw new Error('Unknown cipher type.');
        }
    }
}
