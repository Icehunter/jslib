import { SecureNoteType } from '../../enums/secureNoteType';

import { SecureNoteData } from '../data/secureNoteData';

import Domain from './domain';

import { SecureNoteView } from '../view/secureNoteView';

export class SecureNote extends Domain {
    type: SecureNoteType;

    constructor(obj?: SecureNoteData, alreadyEncrypted: boolean = false) {
        super();
        if (obj == null) {
            return;
        }

        this.type = obj.type;
    }

    decrypt(orgId: string): Promise<SecureNoteView> {
        return Promise.resolve(new SecureNoteView(this));
    }
}