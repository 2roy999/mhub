/**
 * Simple username/password authentication.
 */

import Dict from "./dict";

export interface Authenticator {
	/**
	 * Authenticate username/password.
	 * @param username Username.
	 * @param password Password.
	 * @return true if user exists with that password, false otherwise.
	 */
	authenticate(username: string, password: string): boolean;
}

/**
 * Basic username/password-based authentication manager.
 */
export class PlainAuthenticator implements Authenticator {
	private _users: Dict<string> = new Dict<string>(); // Username -> password mapping

	public static validateUsername(username: string): void {
		if (typeof username !== "string" || username === "") {
			throw new TypeError("invalid username");
		}
		if (username[0] === "@") {
			// @ sign is reserved for groups
			throw new TypeError("invalid username (cannot start with @)");
		}
	}

	/**
	 * Add/replace user, using given password.
	 * Note that a username cannot start with an `@`, because that is reserved
	 * for group names.
	 * @param username Username of user to add or replace
	 * @param password Password to use for this user
	 */
	public setUser(username: string, password: string): void {
		PlainAuthenticator.validateUsername(username);
		if (typeof password !== "string") {
			throw new TypeError("invalid password");
		}
		this._users.set(username, password);
	}

	public authenticate(username: string, password: string): boolean {
		PlainAuthenticator.validateUsername(username);
		if (typeof password !== "string") {
			throw new TypeError("invalid password");
		}
		return this._users.get(username) === password;
	}
}
