import { StateService } from "../abstractions/state.service";
import { TokenService as TokenServiceAbstraction } from "../abstractions/token.service";

import { Utils } from "../misc/utils";

export class TokenService implements TokenServiceAbstraction {
  constructor(private stateService: StateService) {}

  async setTokens(
    accessToken: string,
    refreshToken: string,
    clientIdClientSecret: [string, string]
  ): Promise<any> {
    await this.setToken(accessToken);
    await this.setRefreshToken(refreshToken);
    if (clientIdClientSecret != null) {
      await this.setClientId(clientIdClientSecret[0]);
      await this.setClientSecret(clientIdClientSecret[1]);
    }
  }

  async setClientId(clientId: string): Promise<any> {
    if ((await this.skipTokenStorage()) || clientId == null) {
      return;
    }
    return await this.stateService.setApiKeyClientId(clientId);
  }

  async getClientId(): Promise<string> {
    return await this.stateService.getApiKeyClientId();
  }

  async setClientSecret(clientSecret: string): Promise<any> {
    if ((await this.skipTokenStorage()) || clientSecret == null) {
      return;
    }
    return await this.stateService.setApiKeyClientSecret(clientSecret);
  }

  async getClientSecret(): Promise<string> {
    return await this.stateService.getApiKeyClientSecret();
  }

  async setToken(token: string): Promise<void> {
    await this.stateService.setAccessToken(token);
  }

  async getToken(): Promise<string> {
    return await this.stateService.getAccessToken();
  }

  async setRefreshToken(refreshToken: string): Promise<any> {
    if (await this.skipTokenStorage()) {
      return;
    }
    return await this.stateService.setRefreshToken(refreshToken);
  }

  async getRefreshToken(): Promise<string> {
    return await this.stateService.getRefreshToken();
  }

  async toggleTokens(): Promise<any> {
    const token = await this.getToken();
    const refreshToken = await this.getRefreshToken();
    const clientId = await this.getClientId();
    const clientSecret = await this.getClientSecret();
    const timeout = await this.stateService.getVaultTimeout();
    const action = await this.stateService.getVaultTimeoutAction();

    if ((timeout != null || timeout === 0) && action === "logOut") {
      // if we have a vault timeout and the action is log out, reset tokens
      await this.clearToken();
    }

    await this.setToken(token);
    await this.setRefreshToken(refreshToken);
    await this.setClientId(clientId);
    await this.setClientSecret(clientSecret);
  }

  async setTwoFactorToken(token: string): Promise<any> {
    return await this.stateService.setTwoFactorToken(token);
  }

  async getTwoFactorToken(): Promise<string> {
    return await this.stateService.getTwoFactorToken();
  }

  async clearTwoFactorToken(): Promise<any> {
    return await this.stateService.setTwoFactorToken(null);
  }

  async clearToken(userId?: string): Promise<any> {
    await this.stateService.setAccessToken(null, { userId: userId });
    await this.stateService.setRefreshToken(null, { userId: userId });
    await this.stateService.setApiKeyClientId(null, { userId: userId });
    await this.stateService.setApiKeyClientSecret(null, { userId: userId });
  }

  // jwthelper methods
  // ref https://github.com/auth0/angular-jwt/blob/master/src/angularJwt/services/jwt.js

  async decodeToken(token?: string): Promise<any> {
    const storedToken = await this.stateService.getDecodedToken();
    if (token === null && storedToken != null) {
      return storedToken;
    }

    token = token ?? (await this.stateService.getAccessToken());

    if (token == null) {
      throw new Error("Token not found.");
    }

    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("JWT must have 3 parts");
    }

    const decoded = Utils.fromUrlB64ToUtf8(parts[1]);
    if (decoded == null) {
      throw new Error("Cannot decode the token");
    }

    const decodedToken = JSON.parse(decoded);
    return decodedToken;
  }

  async getTokenExpirationDate(): Promise<Date> {
    const decoded = await this.decodeToken();
    if (typeof decoded.exp === "undefined") {
      return null;
    }

    const d = new Date(0); // The 0 here is the key, which sets the date to the epoch
    d.setUTCSeconds(decoded.exp);
    return d;
  }

  async tokenSecondsRemaining(offsetSeconds: number = 0): Promise<number> {
    const d = await this.getTokenExpirationDate();
    if (d == null) {
      return 0;
    }

    const msRemaining = d.valueOf() - (new Date().valueOf() + offsetSeconds * 1000);
    return Math.round(msRemaining / 1000);
  }

  async tokenNeedsRefresh(minutes: number = 5): Promise<boolean> {
    const sRemaining = await this.tokenSecondsRemaining();
    return sRemaining < 60 * minutes;
  }

  async getUserId(): Promise<string> {
    const decoded = await this.decodeToken();
    if (typeof decoded.sub === "undefined") {
      throw new Error("No user id found");
    }

    return decoded.sub as string;
  }

  async getEmail(): Promise<string> {
    const decoded = await this.decodeToken();
    if (typeof decoded.email === "undefined") {
      throw new Error("No email found");
    }

    return decoded.email as string;
  }

  async getEmailVerified(): Promise<boolean> {
    const decoded = await this.decodeToken();
    if (typeof decoded.email_verified === "undefined") {
      throw new Error("No email verification found");
    }

    return decoded.email_verified as boolean;
  }

  async getName(): Promise<string> {
    const decoded = await this.decodeToken();
    if (typeof decoded.name === "undefined") {
      return null;
    }

    return decoded.name as string;
  }

  async getPremium(): Promise<boolean> {
    const decoded = await this.decodeToken();
    if (typeof decoded.premium === "undefined") {
      return false;
    }

    return decoded.premium as boolean;
  }

  async getIssuer(): Promise<string> {
    const decoded = await this.decodeToken();
    if (typeof decoded.iss === "undefined") {
      throw new Error("No issuer found");
    }

    return decoded.iss as string;
  }

  async getIsExternal(): Promise<boolean> {
    const decoded = await this.decodeToken();

    return Array.isArray(decoded.amr) && decoded.amr.includes("external");
  }

  private async skipTokenStorage(): Promise<boolean> {
    const timeout = await this.stateService.getVaultTimeout();
    const action = await this.stateService.getVaultTimeoutAction();
    return timeout != null && action === "logOut";
  }
}
